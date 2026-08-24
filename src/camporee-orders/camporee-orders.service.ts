import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertCanIssueOrder,
  canAuthorizeWithoutProof,
  canDeliverToSection,
  canReviewPayment,
  type CamporeeOrderActor,
} from './camporee-order-actor';
import { CamporeeOrderDistributionService } from './distribution.service';
import type { CreateCamporeeOrderDto } from './dto/create-camporee-order.dto';
import type { ListCamporeeOrdersQueryDto } from './dto/list-camporee-orders.query.dto';
import {
  deriveDistributionStatus,
  summarizeNamedLines,
  type CamporeeOrderView,
} from './dto/camporee-order.dto';
import { EligibilityService } from './eligibility.service';
import { CamporeeOrderFolioService } from './folio.service';
import {
  assertOrdersWindow,
  resolveOrdersDeadline,
  type CamporeeKind,
  type CamporeeOrdersWindowSource,
} from './offerings.service';
import {
  CamporeeOrderPdfService,
  type CamporeeOrderPdfModel,
} from './pdf.service';
import { CamporeeOrderProofService } from './proof.service';
import {
  assertTransition,
  type CamporeeOrderStatus,
} from './state-machine';

export const CAMPOREE_ORDERS_EXPIRY_DAYS_KEY = 'camporee_orders.expiry_days';
export const DEFAULT_CAMPOREE_ORDER_EXPIRY_DAYS = 15;

type SizeScheme = 'LETTER' | 'NUMERIC' | 'NONE';

type OfferingRow = {
  camporee_order_offering_id: string;
  local_camporee_id: number | null;
  union_camporee_id: number | null;
  product_id: string;
  price_centavos: number;
  active: boolean;
  product: {
    camporee_order_product_id: string;
    title: string;
    size_scheme: SizeScheme;
    active: boolean;
    options: Array<{
      camporee_order_product_option_id: string;
      product_id: string;
      label: string;
      active: boolean;
    }>;
  };
};

const ORDER_INCLUDE = {
  lines: { orderBy: { sequence: 'asc' as const } },
} as const;

type OrderRow = Prisma.camporee_ordersGetPayload<{
  include: typeof ORDER_INCLUDE;
}>;

const CAMPOREE_WINDOW_SELECT = {
  orders_enabled: true,
  orders_opens_at: true,
  orders_deadline: true,
  end_date: true,
  timezone: true,
} as const;

@Injectable()
export class CamporeeOrdersService {
  private readonly logger = new Logger(CamporeeOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly folio: CamporeeOrderFolioService,
    private readonly eligibility: EligibilityService,
    private readonly pdf: CamporeeOrderPdfService,
    private readonly proofs: CamporeeOrderProofService,
    private readonly distribution: CamporeeOrderDistributionService,
  ) {}

  async create(
    camporeeId: number,
    kind: CamporeeKind,
    dto: CreateCamporeeOrderDto,
    actor: CamporeeOrderActor,
    idempotencyKey?: string,
  ): Promise<CamporeeOrderView> {
    assertCanIssueOrder(actor);
    const section = actor.activeSection;
    const localFieldId = section?.local_field_id;
    if (!section || typeof localFieldId !== 'number') {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }

    const fingerprint = fingerprintPayload(kind, camporeeId, dto.lines);
    if (idempotencyKey) {
      const existing = await this.findByIdempotency(
        actor.userId,
        idempotencyKey,
      );
      if (existing) {
        this.assertFingerprintMatch(existing, fingerprint);
        return this.toDto(existing);
      }
    }

    if (dto.lines.length === 0) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_LINES_REQUIRED,
      );
    }

    const lineKeys = new Set<string>();
    for (const line of dto.lines) {
      const key = lineIdentity(
        line.camporee_member_id,
        line.offering_id,
        line.option_id,
      );
      if (lineKeys.has(key)) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_LINES_REQUIRED,
        );
      }
      lineKeys.add(key);
    }

    const camporee = await this.loadCamporee(camporeeId, kind);
    const now = new Date();
    assertOrdersWindow(camporee, now);

    await this.eligibility.assertSectionCanOrder(actor, camporeeId, kind);

    const paymentConfig =
      await this.prisma.field_payment_order_configs.findUnique({
        where: { local_field_id: localFieldId },
      });
    if (!paymentConfig || paymentConfig.active !== true) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_PAYMENT_CONFIG_REQUIRED,
      );
    }

    const offerings = await this.loadOfferings(
      dto.lines.map((line) => line.offering_id),
    );
    const snapshots = await this.buildLineSnapshots(
      dto,
      offerings,
      actor,
      camporeeId,
      kind,
    );
    const totalCentavos = snapshots.reduce(
      (sum, line) => sum + line.line_total_centavos,
      0,
    );
    const expiryDays = await this.getExpiryDays();
    const ttl = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
    const deadline = resolveOrdersDeadline(camporee);
    const expiresAt = ttl < deadline ? ttl : deadline;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const { folio, folio_reference } = await this.folio.allocate(
          tx,
          localFieldId,
          now,
        );
        return tx.camporee_orders.create({
          data: {
            local_field_id: localFieldId,
            club_id: section.club_id,
            club_section_id: section.club_section_id,
            local_camporee_id: kind === 'local' ? camporeeId : null,
            union_camporee_id: kind === 'union' ? camporeeId : null,
            folio,
            folio_reference,
            status: 'ISSUED',
            currency: 'MXN',
            total_centavos: totalCentavos,
            expires_at: expiresAt,
            issued_by_id: actor.userId,
            authorized_without_proof: false,
            idempotency_key: idempotencyKey ?? null,
            bank_name: paymentConfig.bank_name,
            bank_account: paymentConfig.bank_account,
            bank_clabe: paymentConfig.bank_clabe,
            bank_holder: paymentConfig.bank_holder,
            cash_instructions: paymentConfig.cash_instructions,
            extra_notes: paymentConfig.extra_notes,
            lines: {
              create: snapshots,
            },
          },
          include: ORDER_INCLUDE,
        });
      });
      this.logger.log(
        JSON.stringify({
          event: 'camporee_order.issued',
          order_id: created.camporee_order_id,
          folio_reference: created.folio_reference,
          lines: snapshots.length,
          total_centavos: totalCentavos,
        }),
      );
      return this.toDto(created);
    } catch (error) {
      if (idempotencyKey && isPrismaUniqueConstraint(error)) {
        const existing = await this.findByIdempotency(
          actor.userId,
          idempotencyKey,
        );
        if (existing) {
          this.assertFingerprintMatch(existing, fingerprint);
          return this.toDto(existing);
        }
      }
      throw error;
    }
  }

  async list(
    query: ListCamporeeOrdersQueryDto,
    actor: CamporeeOrderActor,
  ): Promise<CamporeeOrderView[]> {
    const scope = this.buildScopeWhere(actor);
    await this.expireDueOrders(scope);
    const orders = await this.prisma.camporee_orders.findMany({
      where: {
        ...scope,
        ...(query.status ? { status: query.status } : {}),
        ...(query.camporee_id ? { local_camporee_id: query.camporee_id } : {}),
        ...(query.union_camporee_id
          ? { union_camporee_id: query.union_camporee_id }
          : {}),
      },
      include: ORDER_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return orders.map((order) => this.toDto(order));
  }

  async reviewQueue(actor: CamporeeOrderActor): Promise<CamporeeOrderView[]> {
    if (!actor.canReview) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }
    if (!actor.globalAccess && typeof actor.localFieldId !== 'number') {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }
    const scope: Prisma.camporee_ordersWhereInput = actor.globalAccess
      ? {}
      : { local_field_id: actor.localFieldId };
    await this.expireDueOrders(scope);
    const orders = await this.prisma.camporee_orders.findMany({
      where: { ...scope, status: 'PROOF_SUBMITTED' },
      include: ORDER_INCLUDE,
      orderBy: { created_at: 'asc' },
    });
    return orders.map((order) => this.toDto(order));
  }

  async get(
    orderId: string,
    actor: CamporeeOrderActor,
  ): Promise<CamporeeOrderView> {
    const found = await this.loadOrder(orderId);
    this.assertCanAccess(found, actor);
    const order = await this.expireIfDue(found);
    return this.toDto(order);
  }

  async getDocument(orderId: string, actor: CamporeeOrderActor) {
    const view = await this.get(orderId, actor);
    const order = await this.loadOrder(orderId);
    const model = await this.buildPdfModel(order);
    const buffer = await this.pdf.render(model);
    return { buffer, folio_reference: view.folio_reference };
  }

  async getProofDownload(orderId: string, actor: CamporeeOrderActor) {
    const order = await this.loadOrder(orderId);
    this.assertCanAccess(order, actor);
    return this.proofs.getSignedDownload(orderId);
  }

  async uploadProof(
    orderId: string,
    file: Express.Multer.File,
    actor: CamporeeOrderActor,
  ) {
    const found = await this.loadOrder(orderId);
    this.assertCanAccess(found, actor);
    const order = await this.expireIfDue(found);
    const result = await this.proofs.upload(
      {
        camporee_order_id: order.camporee_order_id,
        local_field_id: order.local_field_id,
        status: order.status as CamporeeOrderStatus,
        authorized_without_proof: order.authorized_without_proof,
      },
      file,
      { userId: actor.userId },
    );
    this.logger.log(
      JSON.stringify({
        event: 'camporee_order.proof_submitted',
        order_id: order.camporee_order_id,
        documentary: result.documentary,
      }),
    );
    return {
      proof: result.proof,
      order: this.toDto(await this.loadOrder(orderId)),
    };
  }

  async cancel(
    orderId: string,
    actor: CamporeeOrderActor,
    reason?: string,
  ): Promise<CamporeeOrderView> {
    const found = await this.loadOrder(orderId);
    if (!canReviewPayment(actor, found.local_field_id)) {
      this.assertCanAccess(found, actor);
    }
    const order = await this.expireIfDue(found);
    assertTransition(order.status as CamporeeOrderStatus, 'CANCELLED');

    await this.prisma.camporee_orders.update({
      where: { camporee_order_id: orderId },
      data: {
        status: 'CANCELLED',
        cancelled_by_id: actor.userId,
        cancelled_at: new Date(),
        cancel_reason: reason?.trim() || null,
      },
    });
    this.logger.log(
      JSON.stringify({
        event: 'camporee_order.cancelled',
        order_id: orderId,
      }),
    );
    return this.toDto(await this.loadOrder(orderId));
  }

  async approve(
    orderId: string,
    actor: CamporeeOrderActor,
  ): Promise<CamporeeOrderView> {
    const order = await this.loadOrder(orderId);
    this.assertReviewer(actor, order.local_field_id);
    const proof = await this.findSubmittedProof(orderId);
    if (proof.uploaded_by_id === actor.userId) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_MAKER_CHECKER);
    }

    const now = new Date();
    if (this.isDocumentaryReview(order)) {
      await this.prisma.camporee_order_proofs.update({
        where: { camporee_order_proof_id: proof.camporee_order_proof_id },
        data: {
          status: 'APPROVED',
          reviewed_by_id: actor.userId,
          reviewed_at: now,
        },
      });
      this.logger.log(
        JSON.stringify({
          event: 'camporee_order.proof_approved_documentary',
          order_id: orderId,
          status: order.status,
        }),
      );
      return this.toDto(await this.loadOrder(orderId));
    }

    assertTransition(order.status as CamporeeOrderStatus, 'PAID');
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.camporee_orders.updateMany({
        where: {
          camporee_order_id: orderId,
          status: 'PROOF_SUBMITTED',
        },
        data: {
          status: 'PAID',
          approved_by_id: actor.userId,
          approved_at: now,
        },
      });
      if (moved.count === 0) {
        throw new AppConflictException(
          ErrorCode.CAMPOREE_ORDER_INVALID_TRANSITION,
        );
      }
      await tx.camporee_order_proofs.update({
        where: { camporee_order_proof_id: proof.camporee_order_proof_id },
        data: {
          status: 'APPROVED',
          reviewed_by_id: actor.userId,
          reviewed_at: now,
        },
      });
    });
    this.logger.log(
      JSON.stringify({
        event: 'camporee_order.paid',
        order_id: orderId,
      }),
    );
    return this.toDto(await this.loadOrder(orderId));
  }

  async reject(
    orderId: string,
    reason: string,
    actor: CamporeeOrderActor,
  ): Promise<CamporeeOrderView> {
    if (!reason?.trim()) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_ORDER_REJECT_REASON_REQUIRED,
      );
    }
    const order = await this.loadOrder(orderId);
    this.assertReviewer(actor, order.local_field_id);
    const proof = await this.findSubmittedProof(orderId);
    const now = new Date();
    const trimmed = reason.trim();

    if (this.isDocumentaryReview(order)) {
      await this.prisma.camporee_order_proofs.update({
        where: { camporee_order_proof_id: proof.camporee_order_proof_id },
        data: {
          status: 'REJECTED',
          reject_reason: trimmed,
          reviewed_by_id: actor.userId,
          reviewed_at: now,
        },
      });
      this.logger.log(
        JSON.stringify({
          event: 'camporee_order.proof_rejected_documentary',
          order_id: orderId,
          status: order.status,
        }),
      );
      return this.toDto(await this.loadOrder(orderId));
    }

    assertTransition(order.status as CamporeeOrderStatus, 'PROOF_REJECTED');
    await this.prisma.$transaction(async (tx) => {
      await tx.camporee_order_proofs.update({
        where: { camporee_order_proof_id: proof.camporee_order_proof_id },
        data: {
          status: 'REJECTED',
          reject_reason: trimmed,
          reviewed_by_id: actor.userId,
          reviewed_at: now,
        },
      });
      await tx.camporee_orders.update({
        where: { camporee_order_id: orderId },
        data: { status: 'PROOF_REJECTED' },
      });
    });
    this.logger.log(
      JSON.stringify({
        event: 'camporee_order.proof_rejected',
        order_id: orderId,
      }),
    );
    return this.toDto(await this.loadOrder(orderId));
  }

  async authorizeWithoutProof(
    orderId: string,
    reason: string,
    actor: CamporeeOrderActor,
  ): Promise<CamporeeOrderView> {
    const found = await this.loadOrder(orderId);
    if (!canAuthorizeWithoutProof(actor, found.local_field_id)) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }
    if (!reason?.trim()) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_ORDER_AUTHORIZATION_REASON_REQUIRED,
      );
    }
    const order = await this.expireIfDue(found);
    assertTransition(order.status as CamporeeOrderStatus, 'PAID');
    const now = new Date();
    await this.prisma.camporee_orders.update({
      where: { camporee_order_id: orderId },
      data: {
        status: 'PAID',
        authorized_without_proof: true,
        authorized_by_id: actor.userId,
        authorized_at: now,
        authorization_reason: reason.trim(),
      },
    });
    this.logger.log(
      JSON.stringify({
        event: 'camporee_order.authorized_without_proof',
        order_id: orderId,
      }),
    );
    return this.toDto(await this.loadOrder(orderId));
  }

  async deliverToSection(
    orderId: string,
    actor: CamporeeOrderActor,
  ): Promise<CamporeeOrderView> {
    const order = await this.loadOrder(orderId);
    if (!canDeliverToSection(actor, order.local_field_id)) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }
    assertTransition(order.status as CamporeeOrderStatus, 'DELIVERED');
    await this.prisma.camporee_orders.update({
      where: { camporee_order_id: orderId },
      data: {
        status: 'DELIVERED',
        delivered_to_section_by_id: actor.userId,
        delivered_to_section_at: new Date(),
      },
    });
    this.logger.log(
      JSON.stringify({
        event: 'camporee_order.delivered_to_section',
        order_id: orderId,
      }),
    );
    return this.toDto(await this.loadOrder(orderId));
  }

  async deliverToMember(
    orderId: string,
    lineId: string,
    actor: CamporeeOrderActor,
  ): Promise<CamporeeOrderView> {
    const order = await this.loadOrder(orderId);
    this.assertCanAccess(order, actor);
    await this.distribution.deliverToMember(order, lineId, actor);
    return this.toDto(await this.loadOrder(orderId));
  }

  private async buildLineSnapshots(
    dto: CreateCamporeeOrderDto,
    offerings: Map<string, OfferingRow>,
    actor: CamporeeOrderActor,
    camporeeId: number,
    kind: CamporeeKind,
  ) {
    const beneficiaries = await this.eligibility.assertBeneficiariesEligible(
      dto.lines.map((line) => line.camporee_member_id),
      actor,
      camporeeId,
      kind,
    );
    const beneficiaryByMemberId = new Map(
      beneficiaries.map((beneficiary) => [
        beneficiary.camporee_member_id,
        beneficiary,
      ]),
    );

    return dto.lines.map((line, index) => {
      const offering = offerings.get(line.offering_id);
      if (!offering) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_OFFERING_INVALID,
        );
      }
      this.assertOfferingForCamporee(offering, camporeeId, kind);
      const option = this.assertSizeOption(offering, line.option_id);
      const beneficiary = beneficiaryByMemberId.get(line.camporee_member_id);
      if (!beneficiary) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
        );
      }
      const unitPrice = offering.price_centavos;
      return {
        sequence: index + 1,
        camporee_member_id: line.camporee_member_id,
        beneficiary_user_id: beneficiary.user_id,
        beneficiary_name_snapshot: beneficiary.beneficiary_name_snapshot,
        offering_id: offering.camporee_order_offering_id,
        product_id: offering.product_id,
        option_id: option?.camporee_order_product_option_id ?? null,
        product_title_snapshot: offering.product.title,
        option_label_snapshot: option?.label ?? null,
        qty: line.qty,
        unit_price_centavos: unitPrice,
        line_total_centavos: unitPrice * line.qty,
      };
    });
  }

  private assertOfferingForCamporee(
    offering: OfferingRow,
    camporeeId: number,
    kind: CamporeeKind,
  ): void {
    const belongs =
      kind === 'local'
        ? offering.local_camporee_id === camporeeId
        : offering.union_camporee_id === camporeeId;
    if (!offering.active || !offering.product.active || !belongs) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_OFFERING_INVALID,
      );
    }
  }

  private assertSizeOption(
    offering: OfferingRow,
    optionId: string | null | undefined,
  ) {
    const scheme = offering.product.size_scheme;
    if (scheme === 'NONE') {
      if (optionId) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
        );
      }
      return null;
    }
    if (!optionId) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_OPTION_REQUIRED,
      );
    }
    const option = offering.product.options.find(
      (candidate) => candidate.camporee_order_product_option_id === optionId,
    );
    if (
      !option ||
      !option.active ||
      option.product_id !== offering.product_id
    ) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_OFFERING_INVALID,
      );
    }
    return option;
  }

  private async loadOfferings(
    offeringIds: string[],
  ): Promise<Map<string, OfferingRow>> {
    const uniqueIds = [...new Set(offeringIds)];
    const rows = await this.prisma.camporee_order_offerings.findMany({
      where: { camporee_order_offering_id: { in: uniqueIds } },
      include: {
        product: {
          include: { options: true },
        },
      },
    });
    if (rows.length !== uniqueIds.length) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_OFFERING_INVALID,
      );
    }
    return new Map(
      rows.map((row) => [row.camporee_order_offering_id, row as OfferingRow]),
    );
  }

  private async loadCamporee(
    camporeeId: number,
    kind: CamporeeKind,
  ): Promise<CamporeeOrdersWindowSource> {
    if (kind === 'local') {
      const camporee = await this.prisma.local_camporees.findUnique({
        where: { local_camporee_id: camporeeId },
        select: CAMPOREE_WINDOW_SELECT,
      });
      if (!camporee) {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_NOT_FOUND);
      }
      return camporee;
    }
    const camporee = await this.prisma.union_camporees.findUnique({
      where: { union_camporee_id: camporeeId },
      select: CAMPOREE_WINDOW_SELECT,
    });
    if (!camporee) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_NOT_FOUND);
    }
    return camporee;
  }

  private async getExpiryDays(): Promise<number> {
    const row = await this.prisma.system_config.findUnique({
      where: { config_key: CAMPOREE_ORDERS_EXPIRY_DAYS_KEY },
    });
    if (!row?.config_value) {
      return DEFAULT_CAMPOREE_ORDER_EXPIRY_DAYS;
    }
    const parsed = Number.parseInt(row.config_value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_CAMPOREE_ORDER_EXPIRY_DAYS;
    }
    return parsed;
  }

  private async loadOrder(orderId: string): Promise<OrderRow> {
    const order = await this.prisma.camporee_orders.findUnique({
      where: { camporee_order_id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_NOT_FOUND);
    }
    return order;
  }

  private assertReviewer(actor: CamporeeOrderActor, localFieldId: number) {
    if (!canReviewPayment(actor, localFieldId)) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }
  }

  private isDocumentaryReview(order: {
    status: string;
    authorized_without_proof: boolean;
  }): boolean {
    return (
      order.authorized_without_proof === true &&
      (order.status === 'PAID' || order.status === 'DELIVERED')
    );
  }

  private async findSubmittedProof(orderId: string) {
    const proof = await this.prisma.camporee_order_proofs.findFirst({
      where: { order_id: orderId, status: 'SUBMITTED' },
      orderBy: { created_at: 'desc' },
    });
    if (!proof) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_PROOF_NOT_FOUND);
    }
    return proof;
  }

  /** Lazy expiry for a single loaded order (ISSUED past expires_at). */
  private async expireIfDue<
    T extends {
      camporee_order_id: string;
      status: string;
      expires_at: Date;
    },
  >(order: T): Promise<T> {
    if (order.status !== 'ISSUED' || order.expires_at > new Date()) {
      return order;
    }
    const now = new Date();
    await this.prisma.camporee_orders.updateMany({
      where: {
        camporee_order_id: order.camporee_order_id,
        status: 'ISSUED',
      },
      data: { status: 'EXPIRED', expired_at: now },
    });
    this.logger.log(
      JSON.stringify({
        event: 'camporee_order.expired',
        order_id: order.camporee_order_id,
      }),
    );
    return { ...order, status: 'EXPIRED', expired_at: now } as T;
  }

  /** Lazy expiry for scoped listings. Does not expire PAID. */
  private async expireDueOrders(scope: Prisma.camporee_ordersWhereInput) {
    const due = await this.prisma.camporee_orders.findMany({
      where: { ...scope, status: 'ISSUED', expires_at: { lt: new Date() } },
      select: { camporee_order_id: true },
    });
    if (due.length === 0) {
      return;
    }
    const ids = due.map((order) => order.camporee_order_id);
    const now = new Date();
    await this.prisma.camporee_orders.updateMany({
      where: { camporee_order_id: { in: ids }, status: 'ISSUED' },
      data: { status: 'EXPIRED', expired_at: now },
    });
    this.logger.log(
      JSON.stringify({
        event: 'camporee_order.expired',
        count: ids.length,
        order_ids: ids,
      }),
    );
  }

  private async buildPdfModel(order: OrderRow): Promise<CamporeeOrderPdfModel> {
    const lines = [...order.lines].sort((a, b) => a.sequence - b.sequence);
    const [issuer, localField, club, section, localCamporee, unionCamporee] =
      await Promise.all([
        this.prisma.users.findUnique({
          where: { user_id: order.issued_by_id },
          select: {
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
        order.local_camporee_id
          ? this.prisma.local_camporees.findUnique({
              where: { local_camporee_id: order.local_camporee_id },
              select: { name: true },
            })
          : Promise.resolve(null),
        order.union_camporee_id
          ? this.prisma.union_camporees.findUnique({
              where: { union_camporee_id: order.union_camporee_id },
              select: { name: true },
            })
          : Promise.resolve(null),
      ]);

    const issuedByName = issuer
      ? [issuer.name, issuer.paternal_last_name, issuer.maternal_last_name]
          .filter(Boolean)
          .join(' ')
      : order.issued_by_id;

    return {
      folio_reference: order.folio_reference,
      camporee_name:
        localCamporee?.name ??
        unionCamporee?.name ??
        (order.union_camporee_id
          ? `Camporee de union ${order.union_camporee_id}`
          : `Camporee ${order.local_camporee_id}`),
      local_field_name:
        localField?.name ?? `Campo Local ${order.local_field_id}`,
      club_name: club?.name ?? `Club ${order.club_id}`,
      section_name:
        section?.club_types?.name ?? `Seccion ${order.club_section_id}`,
      issued_by_name: issuedByName,
      issued_at: order.created_at,
      expires_at: order.expires_at,
      currency: order.currency,
      total_centavos: order.total_centavos,
      authorized_without_proof: order.authorized_without_proof,
      summary: summarizeNamedLines(lines),
      lines: lines.map((line) => ({
        sequence: line.sequence,
        beneficiary_name_snapshot: line.beneficiary_name_snapshot,
        product_title_snapshot: line.product_title_snapshot,
        option_label_snapshot: line.option_label_snapshot,
        qty: line.qty,
      })),
      payment_instructions: {
        bank_name: order.bank_name,
        bank_account: order.bank_account,
        bank_clabe: order.bank_clabe,
        bank_holder: order.bank_holder,
        cash_instructions: order.cash_instructions,
        extra_notes: order.extra_notes,
      },
    };
  }

  private async findByIdempotency(
    issuedById: string,
    idempotencyKey: string,
  ): Promise<OrderRow | null> {
    const existing = await this.prisma.camporee_orders.findFirst({
      where: { issued_by_id: issuedById, idempotency_key: idempotencyKey },
      include: ORDER_INCLUDE,
    });
    return existing;
  }

  private assertFingerprintMatch(
    existing: OrderRow,
    fingerprint: string,
  ): void {
    const existingKind: CamporeeKind = existing.union_camporee_id
      ? 'union'
      : 'local';
    const existingCamporeeId =
      existing.union_camporee_id ?? existing.local_camporee_id;
    if (
      !existingCamporeeId ||
      fingerprintPayload(
        existingKind,
        existingCamporeeId,
        existing.lines.map((line) => ({
          camporee_member_id: line.camporee_member_id,
          offering_id: line.offering_id,
          option_id: line.option_id,
          qty: line.qty,
        })),
      ) !== fingerprint
    ) {
      throw new AppConflictException(ErrorCode.IDEMPOTENCY_KEY_REUSED);
    }
  }

  private buildScopeWhere(
    actor: CamporeeOrderActor,
  ): Prisma.camporee_ordersWhereInput {
    if (actor.globalAccess) {
      return {};
    }
    if (actor.canReview && typeof actor.localFieldId === 'number') {
      return { local_field_id: actor.localFieldId };
    }
    if (actor.activeSection) {
      return { club_section_id: actor.activeSection.club_section_id };
    }
    return { club_section_id: { in: actor.sectionIds } };
  }

  private assertCanAccess(
    order: { club_section_id: number; local_field_id: number },
    actor: CamporeeOrderActor,
  ): void {
    if (actor.globalAccess) {
      return;
    }
    if (actor.activeSection?.club_section_id === order.club_section_id) {
      return;
    }
    if (actor.sectionIds.includes(order.club_section_id)) {
      return;
    }
    if (actor.canReview && order.local_field_id === actor.localFieldId) {
      return;
    }
    throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
  }

  private toDto(order: OrderRow): CamporeeOrderView {
    const lines = [...order.lines].sort((a, b) => a.sequence - b.sequence);
    return {
      camporee_order_id: order.camporee_order_id,
      local_field_id: order.local_field_id,
      club_id: order.club_id,
      club_section_id: order.club_section_id,
      local_camporee_id: order.local_camporee_id,
      union_camporee_id: order.union_camporee_id,
      folio: order.folio,
      folio_reference: order.folio_reference,
      status: order.status,
      currency: order.currency,
      total_centavos: order.total_centavos,
      expires_at: order.expires_at,
      issued_by_id: order.issued_by_id,
      approved_by_id: order.approved_by_id,
      approved_at: order.approved_at,
      authorized_without_proof: order.authorized_without_proof,
      authorized_by_id: order.authorized_by_id,
      authorized_at: order.authorized_at,
      authorization_reason: order.authorization_reason,
      delivered_to_section_by_id: order.delivered_to_section_by_id,
      delivered_to_section_at: order.delivered_to_section_at,
      bank_name: order.bank_name,
      bank_account: order.bank_account,
      bank_clabe: order.bank_clabe,
      bank_holder: order.bank_holder,
      cash_instructions: order.cash_instructions,
      extra_notes: order.extra_notes,
      created_at: order.created_at,
      modified_at: order.modified_at,
      lines: lines.map((line) => ({
        camporee_order_line_id: line.camporee_order_line_id,
        sequence: line.sequence,
        camporee_member_id: line.camporee_member_id,
        beneficiary_user_id: line.beneficiary_user_id,
        beneficiary_name_snapshot: line.beneficiary_name_snapshot,
        offering_id: line.offering_id,
        product_id: line.product_id,
        option_id: line.option_id,
        product_title_snapshot: line.product_title_snapshot,
        option_label_snapshot: line.option_label_snapshot,
        qty: line.qty,
        unit_price_centavos: line.unit_price_centavos,
        line_total_centavos: line.line_total_centavos,
        delivered_to_member_at: line.delivered_to_member_at,
        delivered_to_member_by_id: line.delivered_to_member_by_id,
      })),
      summary: summarizeNamedLines(lines),
      distribution_status: deriveDistributionStatus(lines),
    };
  }
}

function lineIdentity(
  camporeeMemberId: number,
  offeringId: string,
  optionId: string | null | undefined,
): string {
  return `${camporeeMemberId}:${offeringId}:${optionId ?? ''}`;
}

function fingerprintPayload(
  kind: CamporeeKind,
  camporeeId: number,
  lines: Array<{
    camporee_member_id: number;
    offering_id: string;
    option_id?: string | null;
    qty: number;
  }>,
): string {
  const normalized = lines
    .map((line) => ({
      camporee_member_id: line.camporee_member_id,
      offering_id: line.offering_id,
      option_id: line.option_id ?? null,
      qty: line.qty,
    }))
    .sort((left, right) => {
      const a = `${left.camporee_member_id}:${left.offering_id}:${left.option_id ?? ''}:${left.qty}`;
      const b = `${right.camporee_member_id}:${right.offering_id}:${right.option_id ?? ''}:${right.qty}`;
      return a.localeCompare(b);
    });
  return JSON.stringify({ kind, camporee_id: camporeeId, lines: normalized });
}

function isPrismaUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
