import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import 'multer';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCamporeePaymentOrderDto,
  CreateInsurancePaymentOrderDto,
  ListPaymentOrdersQueryDto,
} from './dto/field-payment-orders.dto';
import { FieldPaymentFolioService } from './folio.service';
import { FieldPaymentOrdersFlagService } from './field-payment-orders-flag.service';
import { FieldPaymentOrderProofService } from './field-payment-order-proof.service';
import {
  FieldPaymentOrderPdfModel,
  FieldPaymentOrderPdfService,
} from './field-payment-order-pdf.service';
import {
  CAMPOREE_FULFILLMENT_PORT,
  INSURANCE_FULFILLMENT_PORT,
} from './fulfillment/ports';
import type {
  OrderForFulfillment,
  PreparedOrder,
  PurposeFulfillment,
} from './fulfillment/ports';
import type { OrderActor } from './order-actor';
import { assertTransition, FieldPaymentOrderStatus } from './state-machine';

type OrderPurpose = 'INSURANCE' | 'CAMPOREE';

const PURPOSE_LABELS: Record<OrderPurpose, string> = {
  INSURANCE: 'Seguro',
  CAMPOREE: 'Camporee',
};

@Injectable()
export class FieldPaymentOrdersService {
  private readonly logger = new Logger(FieldPaymentOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly folio: FieldPaymentFolioService,
    private readonly flag: FieldPaymentOrdersFlagService,
    private readonly proofs: FieldPaymentOrderProofService,
    private readonly pdf: FieldPaymentOrderPdfService,
    @Inject(INSURANCE_FULFILLMENT_PORT)
    private readonly insuranceFulfillment: PurposeFulfillment,
    @Inject(CAMPOREE_FULFILLMENT_PORT)
    private readonly camporeeFulfillment: PurposeFulfillment,
  ) {}

  private portFor(purpose: OrderPurpose): PurposeFulfillment {
    return purpose === 'INSURANCE'
      ? this.insuranceFulfillment
      : this.camporeeFulfillment;
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createInsuranceOrder(
    dto: CreateInsurancePaymentOrderDto,
    actor: OrderActor,
    idempotencyKey?: string,
  ) {
    return this.create('INSURANCE', dto, actor, idempotencyKey);
  }

  async createCamporeeOrder(
    camporeeId: number,
    dto: CreateCamporeePaymentOrderDto,
    actor: OrderActor,
    idempotencyKey?: string,
  ) {
    return this.create(
      'CAMPOREE',
      { ...dto, camporee_id: camporeeId },
      actor,
      idempotencyKey,
    );
  }

  private async create(
    purpose: OrderPurpose,
    dto: unknown,
    actor: OrderActor,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.field_payment_orders.findFirst({
        where: { issued_by_id: actor.userId, idempotency_key: idempotencyKey },
        include: { lines: true },
      });
      if (existing) {
        return existing;
      }
    }

    const prepared: PreparedOrder = await this.portFor(purpose).prepareOrder(
      dto,
      actor,
    );

    if (!(await this.flag.isEnabledForLocalField(prepared.local_field_id))) {
      throw new AppForbiddenException(
        ErrorCode.FIELD_PAYMENT_ORDER_FLAG_DISABLED,
      );
    }
    if (prepared.beneficiary_user_ids.length === 0) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_BENEFICIARIES_REQUIRED,
      );
    }
    if (prepared.unit_cost_centavos <= 0) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_COST_NOT_CONFIGURED,
      );
    }

    const expiryDays = await this.flag.getExpiryDays();
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    const totalCentavos =
      prepared.unit_cost_centavos * prepared.beneficiary_user_ids.length;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { folio, folio_reference } = await this.folio.allocate(
          tx,
          prepared.local_field_id,
        );
        return tx.field_payment_orders.create({
          data: {
            purpose,
            local_field_id: prepared.local_field_id,
            club_id: prepared.club_id,
            club_section_id: prepared.club_section_id,
            folio,
            folio_reference,
            insurance_cycle_config_id:
              purpose === 'INSURANCE' ? prepared.purpose_ref_id : null,
            local_camporee_id:
              purpose === 'CAMPOREE' ? prepared.purpose_ref_id : null,
            currency: prepared.currency,
            unit_cost_centavos: prepared.unit_cost_centavos,
            total_centavos: totalCentavos,
            expires_at: expiresAt,
            issued_by_id: actor.userId,
            idempotency_key: idempotencyKey ?? null,
            lines: {
              create: prepared.beneficiary_user_ids.map((userId, index) => ({
                sequence: index + 1,
                beneficiary_user_id: userId,
                unit_cost_centavos: prepared.unit_cost_centavos,
                purpose,
                purpose_ref_id: prepared.purpose_ref_id,
              })),
            },
          },
          include: { lines: true },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppConflictException(
          ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
        );
      }
      throw error;
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async list(query: ListPaymentOrdersQueryDto, actor: OrderActor) {
    const scope = this.buildScopeWhere(actor);
    await this.expireDueOrders(scope);

    return this.prisma.field_payment_orders.findMany({
      where: {
        ...scope,
        ...(query.purpose ? { purpose: query.purpose } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.camporee_id ? { local_camporee_id: query.camporee_id } : {}),
      },
      include: { lines: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async get(orderId: string, actor: OrderActor) {
    const order = await this.findOrder(orderId, { lines: true, proofs: true });
    this.assertCanAccess(order, actor);
    return this.expireIfDue(order);
  }

  async getDocument(orderId: string, actor: OrderActor) {
    const order = await this.get(orderId, actor);
    const model = await this.buildPdfModel(order);
    const buffer = await this.pdf.render(model);
    return { buffer, folio_reference: order.folio_reference };
  }

  async getProofDownload(orderId: string, actor: OrderActor) {
    const order = await this.findOrder(orderId);
    this.assertCanAccess(order, actor);
    return this.proofs.getSignedDownload(orderId);
  }

  // ── Mutations (director) ──────────────────────────────────────────────────

  async uploadProof(
    orderId: string,
    file: Express.Multer.File,
    actor: OrderActor,
  ) {
    const found = await this.findOrder(orderId);
    this.assertSectionScope(found, actor);
    const order = await this.expireIfDue(found);
    if (order.status === 'EXPIRED') {
      throw new AppBadRequestException(ErrorCode.FIELD_PAYMENT_ORDER_EXPIRED);
    }
    return this.proofs.upload(
      {
        field_payment_order_id: order.field_payment_order_id,
        local_field_id: order.local_field_id,
        status: order.status as FieldPaymentOrderStatus,
      },
      file,
      { userId: actor.userId },
    );
  }

  async cancel(orderId: string, actor: OrderActor) {
    const found = await this.findOrder(orderId);
    this.assertSectionScope(found, actor);
    const order = await this.expireIfDue(found);
    assertTransition(order.status as FieldPaymentOrderStatus, 'CANCELLED');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.field_payment_orders.update({
        where: { field_payment_order_id: orderId },
        data: {
          status: 'CANCELLED',
          cancelled_by_id: actor.userId,
          cancelled_at: new Date(),
        },
      });
      await tx.field_payment_order_lines.updateMany({
        where: { field_payment_order_id: orderId },
        data: { active_guard: false },
      });
      return updated;
    });
  }

  // ── Review (Campo Local) ─────────────────────────────────────────────────

  async reviewQueue(query: ListPaymentOrdersQueryDto, actor: OrderActor) {
    this.requireReviewer(actor);
    const scope = this.reviewScopeWhere(actor);
    await this.expireDueOrders(scope);

    return this.prisma.field_payment_orders.findMany({
      where: {
        ...scope,
        status: 'PROOF_SUBMITTED',
        ...(query.purpose ? { purpose: query.purpose } : {}),
        ...(query.camporee_id ? { local_camporee_id: query.camporee_id } : {}),
      },
      include: { lines: true, proofs: { orderBy: { created_at: 'desc' } } },
      orderBy: { created_at: 'asc' },
    });
  }

  async approve(orderId: string, actor: OrderActor) {
    this.requireReviewer(actor);
    const order = await this.findOrder(orderId, { lines: true });
    this.assertReviewerScope(order, actor);
    assertTransition(order.status as FieldPaymentOrderStatus, 'APPROVED');

    const proof = await this.prisma.field_payment_order_proofs.findFirst({
      where: { field_payment_order_id: orderId, status: 'SUBMITTED' },
      orderBy: { created_at: 'desc' },
    });
    if (!proof) {
      throw new AppNotFoundException(
        ErrorCode.FIELD_PAYMENT_ORDER_PROOF_NOT_FOUND,
      );
    }
    if (proof.uploaded_by_id === actor.userId) {
      throw new AppForbiddenException(
        ErrorCode.FIELD_PAYMENT_ORDER_MAKER_CHECKER,
      );
    }

    const port = this.portFor(order.purpose as OrderPurpose);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Re-read inside TX to serialize concurrent approvals on the same order.
      const fresh = await tx.field_payment_orders.update({
        where: {
          field_payment_order_id: orderId,
          status: 'PROOF_SUBMITTED',
        },
        data: {
          status: 'APPROVED',
          approved_by_id: actor.userId,
          approved_at: now,
        },
        include: { lines: { orderBy: { sequence: 'asc' } } },
      });

      await port.fulfill(tx, fresh as unknown as OrderForFulfillment, actor);

      await tx.field_payment_order_proofs.update({
        where: {
          field_payment_order_proof_id: proof.field_payment_order_proof_id,
        },
        data: {
          status: 'APPROVED',
          reviewed_by_id: actor.userId,
          reviewed_at: now,
        },
      });
      return fresh;
    }).catch((error) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        // Lost the race: someone else transitioned the order first.
        throw new AppConflictException(
          ErrorCode.FIELD_PAYMENT_ORDER_INVALID_TRANSITION,
        );
      }
      throw error;
    });
  }

  async reject(orderId: string, reason: string, actor: OrderActor) {
    this.requireReviewer(actor);
    if (!reason?.trim()) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_REJECT_REASON_REQUIRED,
      );
    }
    const order = await this.findOrder(orderId);
    this.assertReviewerScope(order, actor);
    assertTransition(order.status as FieldPaymentOrderStatus, 'PROOF_REJECTED');

    const proof = await this.prisma.field_payment_order_proofs.findFirst({
      where: { field_payment_order_id: orderId, status: 'SUBMITTED' },
      orderBy: { created_at: 'desc' },
    });
    if (!proof) {
      throw new AppNotFoundException(
        ErrorCode.FIELD_PAYMENT_ORDER_PROOF_NOT_FOUND,
      );
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.field_payment_order_proofs.update({
        where: {
          field_payment_order_proof_id: proof.field_payment_order_proof_id,
        },
        data: {
          status: 'REJECTED',
          reject_reason: reason.trim(),
          reviewed_by_id: actor.userId,
          reviewed_at: now,
        },
      });
      return tx.field_payment_orders.update({
        where: { field_payment_order_id: orderId },
        data: { status: 'PROOF_REJECTED' },
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async findOrder(
    orderId: string,
    include?: Prisma.field_payment_ordersInclude,
  ) {
    const order = await this.prisma.field_payment_orders.findUnique({
      where: { field_payment_order_id: orderId },
      ...(include ? { include } : {}),
    });
    if (!order) {
      throw new AppNotFoundException(ErrorCode.FIELD_PAYMENT_ORDER_NOT_FOUND);
    }
    return order;
  }

  private buildScopeWhere(actor: OrderActor): Prisma.field_payment_ordersWhereInput {
    if (actor.globalAccess) {
      return {};
    }
    if (actor.canReview && typeof actor.localFieldId === 'number') {
      return { local_field_id: actor.localFieldId };
    }
    return { club_section_id: { in: actor.sectionIds } };
  }

  private reviewScopeWhere(
    actor: OrderActor,
  ): Prisma.field_payment_ordersWhereInput {
    if (actor.globalAccess) {
      return {};
    }
    return { local_field_id: actor.localFieldId };
  }

  private requireReviewer(actor: OrderActor) {
    if (!actor.canReview) {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
    }
  }

  private assertReviewerScope(
    order: { local_field_id: number },
    actor: OrderActor,
  ) {
    if (actor.globalAccess) {
      return;
    }
    if (order.local_field_id !== actor.localFieldId) {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
    }
  }

  private assertSectionScope(
    order: { club_section_id: number },
    actor: OrderActor,
  ) {
    if (actor.globalAccess) {
      return;
    }
    if (!actor.sectionIds.includes(order.club_section_id)) {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
    }
  }

  private assertCanAccess(
    order: { club_section_id: number; local_field_id: number },
    actor: OrderActor,
  ) {
    if (actor.globalAccess) {
      return;
    }
    if (actor.sectionIds.includes(order.club_section_id)) {
      return;
    }
    if (actor.canReview && order.local_field_id === actor.localFieldId) {
      return;
    }
    throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
  }

  /** Lazy expiry for a single loaded order (ISSUED past expires_at). */
  private async expireIfDue<
    T extends {
      field_payment_order_id: string;
      status: string;
      expires_at: Date;
    },
  >(order: T): Promise<T> {
    if (order.status !== 'ISSUED' || order.expires_at > new Date()) {
      return order;
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.field_payment_orders.updateMany({
        where: {
          field_payment_order_id: order.field_payment_order_id,
          status: 'ISSUED',
        },
        data: { status: 'EXPIRED', expired_at: now },
      });
      await tx.field_payment_order_lines.updateMany({
        where: { field_payment_order_id: order.field_payment_order_id },
        data: { active_guard: false },
      });
    });
    this.logger.log(
      `field_payment_order expired lazily: ${order.field_payment_order_id}`,
    );
    return { ...order, status: 'EXPIRED', expired_at: now } as T;
  }

  /** Lazy expiry for scoped listings. */
  private async expireDueOrders(scope: Prisma.field_payment_ordersWhereInput) {
    const due = await this.prisma.field_payment_orders.findMany({
      where: { ...scope, status: 'ISSUED', expires_at: { lt: new Date() } },
      select: { field_payment_order_id: true },
    });
    if (due.length === 0) {
      return;
    }
    const ids = due.map((order) => order.field_payment_order_id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.field_payment_orders.updateMany({
        where: { field_payment_order_id: { in: ids }, status: 'ISSUED' },
        data: { status: 'EXPIRED', expired_at: now },
      });
      await tx.field_payment_order_lines.updateMany({
        where: { field_payment_order_id: { in: ids } },
        data: { active_guard: false },
      });
    });
    this.logger.log(`field_payment_orders expired lazily: ${ids.length}`);
  }

  private async buildPdfModel(order: {
    field_payment_order_id: string;
    purpose: string;
    local_field_id: number;
    club_id: number;
    club_section_id: number;
    folio_reference: string;
    currency: string;
    unit_cost_centavos: number;
    total_centavos: number;
    created_at: Date;
    expires_at: Date;
    issued_by_id: string;
    insurance_cycle_config_id: number | null;
    local_camporee_id: number | null;
    lines?: Array<{ sequence: number; beneficiary_user_id: string }>;
  }): Promise<FieldPaymentOrderPdfModel> {
    const config = await this.prisma.field_payment_order_configs.findUnique({
      where: { local_field_id: order.local_field_id },
    });
    if (!config?.active) {
      throw new AppNotFoundException(
        ErrorCode.FIELD_PAYMENT_ORDER_CONFIG_NOT_FOUND,
      );
    }

    const lines = order.lines ?? [];
    const userIds = [
      order.issued_by_id,
      ...lines.map((line) => line.beneficiary_user_id),
    ];
    const [users, localField, club, section] = await Promise.all([
      this.prisma.users.findMany({
        where: { user_id: { in: userIds } },
        select: {
          user_id: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
        },
      }),
      this.prisma.local_fields.findUnique({
        where: { local_field_id: order.local_field_id },
        select: { name: true },
      }),
      this.prisma.clubs.findUnique({
        where: { club_id: order.club_id },
        select: { name: true },
      }),
      this.prisma.club_sections.findUnique({
        where: { club_section_id: order.club_section_id },
        select: { club_types: { select: { name: true } } },
      }),
    ]);

    const nameOf = (userId: string) => {
      const user = users.find((candidate) => candidate.user_id === userId);
      if (!user) {
        return userId;
      }
      return [user.name, user.paternal_last_name, user.maternal_last_name]
        .filter(Boolean)
        .join(' ');
    };

    let concept = '';
    if (order.purpose === 'INSURANCE' && order.insurance_cycle_config_id) {
      const cycle = await this.prisma.insurance_cycle_configs.findUnique({
        where: {
          insurance_cycle_config_id: order.insurance_cycle_config_id,
        },
        select: { product: { select: { name: true } } },
      });
      concept = cycle?.product?.name ?? 'Seguro institucional';
    } else if (order.purpose === 'CAMPOREE' && order.local_camporee_id) {
      const camporee = await this.prisma.local_camporees.findUnique({
        where: { local_camporee_id: order.local_camporee_id },
        select: { name: true },
      });
      concept = camporee?.name ?? 'Camporee';
    }

    return {
      folio_reference: order.folio_reference,
      purpose_label: PURPOSE_LABELS[order.purpose as OrderPurpose],
      concept,
      local_field_name: localField?.name ?? `Campo Local ${order.local_field_id}`,
      club_name: club?.name ?? `Club ${order.club_id}`,
      section_name: section?.club_types?.name ?? `Sección ${order.club_section_id}`,
      issued_by_name: nameOf(order.issued_by_id),
      issued_at: order.created_at,
      expires_at: order.expires_at,
      currency: order.currency,
      unit_cost_centavos: order.unit_cost_centavos,
      total_centavos: order.total_centavos,
      beneficiaries: lines
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((line) => ({
          sequence: line.sequence,
          full_name: nameOf(line.beneficiary_user_id),
        })),
      payment_instructions: {
        bank_name: config.bank_name,
        bank_account: config.bank_account,
        bank_clabe: config.bank_clabe,
        bank_holder: config.bank_holder,
        cash_instructions: config.cash_instructions,
        extra_notes: config.extra_notes,
      },
    };
  }
}
