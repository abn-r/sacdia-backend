import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppForbiddenException,
  AppNotFoundException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertCanPlanSupplies,
  canBypassSupplyFreeze,
  canDeliverSupplies,
  canReviewSupplyPayment,
  isLfCaja,
  isSupplyOrganizer,
  type CamporeeKind,
  type CamporeeSupplyActor,
} from './camporee-supply-actor';
import {
  assertDateInCamporee,
  camporeeWhere,
  ELIGIBLE_ENROLLMENT_STATUSES,
  loadSupplyCamporee,
  utcYmd,
  type SupplyCamporeeRow,
} from './camporee-context';
import { CamporeeSupplyFolioService } from './folio.service';
import { canClubEditSupplyDate, lineTotalCentavos } from './freeze';
import type {
  AdjustSupplyLineDto,
  DeliverSupplyLineDto,
  ReplaceSupplyPlanDto,
  SupplyPlanLineInputDto,
} from './dto/supply.dto';

export type SupplyClock = { now(): Date };

const SYSTEM_CLOCK: SupplyClock = { now: () => new Date() };

const PLAN_INCLUDE = {
  lines: {
    include: {
      slot: true,
      product: true,
      deliveries: true,
    },
    orderBy: [{ supply_date: 'asc' as const }],
  },
  payments: { orderBy: { created_at: 'asc' as const } },
  club: { select: { name: true } },
} as const;

@Injectable()
export class CamporeeSupplyPlansService {
  clock: SupplyClock = SYSTEM_CLOCK;

  constructor(
    private readonly prisma: PrismaService,
    private readonly folio: CamporeeSupplyFolioService,
  ) {}

  async getOwnPlan(
    camporeeId: number,
    kind: CamporeeKind,
    actor: CamporeeSupplyActor,
  ) {
    assertCanPlanSupplies(actor);
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    await this.assertSectionEnrolled(actor, camporee);
    const plan = await this.findSectionPlan(actor, camporee);
    if (!plan) {
      return {
        plan: null,
        catalog: await this.catalogLite(camporee),
      };
    }
    return {
      plan: serializePlan(plan, camporee),
      catalog: await this.catalogLite(camporee),
    };
  }

  async replaceDraft(
    camporeeId: number,
    kind: CamporeeKind,
    dto: ReplaceSupplyPlanDto,
    actor: CamporeeSupplyActor,
  ) {
    assertCanPlanSupplies(actor);
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    await this.assertSectionEnrolled(actor, camporee);
    const section = actor.activeSection!;

    const plan = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.camporee_supply_plans.findFirst({
        where: {
          club_section_id: section.club_section_id,
          ...camporeeWhere(kind, camporeeId),
        },
      });
      if (existing && existing.status !== 'DRAFT') {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_PLAN_NOT_DRAFT,
        );
      }
      const row =
        existing ??
        (await tx.camporee_supply_plans.create({
          data: {
            local_field_id: section.local_field_id!,
            club_id: section.club_id,
            club_section_id: section.club_section_id,
            ...camporeeWhere(kind, camporeeId),
            status: 'DRAFT',
          },
        }));

      const resolved = await this.resolveLines(tx, camporee, dto.lines);
      await tx.camporee_supply_lines.deleteMany({
        where: { plan_id: row.camporee_supply_plan_id },
      });
      if (resolved.length > 0) {
        await tx.camporee_supply_lines.createMany({
          data: resolved.map((line) => ({
            plan_id: row.camporee_supply_plan_id,
            ...line,
          })),
        });
      }
      return tx.camporee_supply_plans.findUniqueOrThrow({
        where: { camporee_supply_plan_id: row.camporee_supply_plan_id },
        include: PLAN_INCLUDE,
      });
    });

    return serializePlan(plan, camporee);
  }

  async submit(
    camporeeId: number,
    kind: CamporeeKind,
    actor: CamporeeSupplyActor,
  ) {
    assertCanPlanSupplies(actor);
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    await this.assertSectionEnrolled(actor, camporee);
    const section = actor.activeSection!;

    const plan = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.camporee_supply_plans.findFirst({
        where: {
          club_section_id: section.club_section_id,
          ...camporeeWhere(kind, camporeeId),
        },
        include: { lines: true, payments: true },
      });
      if (!existing) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_LINES_REQUIRED,
        );
      }
      if (existing.status !== 'DRAFT') {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_PLAN_NOT_DRAFT,
        );
      }
      if (existing.lines.length === 0) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_LINES_REQUIRED,
        );
      }
      const total = existing.lines.reduce(
        (sum, line) => sum + line.line_total_centavos,
        0,
      );
      if (total <= 0) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_LINES_REQUIRED,
        );
      }
      const allocated = await this.folio.allocate(
        tx,
        existing.local_field_id,
        this.clock.now(),
      );
      await tx.camporee_supply_payment_docs.create({
        data: {
          plan_id: existing.camporee_supply_plan_id,
          local_field_id: existing.local_field_id,
          club_section_id: existing.club_section_id,
          ...camporeeWhere(kind, camporeeId),
          kind: 'PRINCIPAL',
          folio: allocated.folio,
          folio_reference: allocated.folio_reference,
          total_centavos: total,
          status: 'ISSUED',
          created_by_id: actor.userId,
        },
      });
      await tx.camporee_supply_plans.update({
        where: { camporee_supply_plan_id: existing.camporee_supply_plan_id },
        data: {
          status: 'SUBMITTED',
          committed_total_centavos: total,
          submitted_by_id: actor.userId,
          submitted_at: this.clock.now(),
        },
      });
      await tx.camporee_supply_plan_audits.create({
        data: {
          plan_id: existing.camporee_supply_plan_id,
          actor_id: actor.userId,
          action: 'SUBMIT',
          payload: { total_centavos: total, folio: allocated.folio_reference },
        },
      });
      return tx.camporee_supply_plans.findUniqueOrThrow({
        where: { camporee_supply_plan_id: existing.camporee_supply_plan_id },
        include: PLAN_INCLUDE,
      });
    });

    return serializePlan(plan, camporee);
  }

  async adjustLine(
    camporeeId: number,
    kind: CamporeeKind,
    dto: AdjustSupplyLineDto,
    actor: CamporeeSupplyActor,
  ) {
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    const clubActor = Boolean(actor.activeSection);
    if (clubActor && !canBypassSupplyFreeze(actor)) {
      assertCanPlanSupplies(actor);
      await this.assertSectionEnrolled(actor, camporee);
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      const ownSection = clubActor && !canBypassSupplyFreeze(actor);
      const clubSectionId = ownSection
        ? actor.activeSection!.club_section_id
        : dto.club_section_id ?? actor.activeSection?.club_section_id;
      if (typeof clubSectionId !== 'number') {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_SUPPLIES_NOT_FOUND);
      }
      const existing = await this.lockPlanForActor(
        tx,
        camporee,
        actor,
        clubSectionId,
        ownSection,
      );
      if (existing.status !== 'SUBMITTED') {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_PLAN_NOT_SUBMITTED,
        );
      }

      this.assertEditableDate(camporee, existing.status, dto.date, actor, dto.bypass_reason);

      const qtyMilli = toMilli(dto.qty);
      const resolved =
        qtyMilli === 0
          ? null
          : (
              await this.resolveLines(tx, camporee, [
                {
                  date: dto.date,
                  slot_id: dto.slot_id,
                  product_id: dto.product_id,
                  qty: dto.qty,
                },
              ])
            )[0];

      const current = existing.lines.find(
        (line) =>
          utcYmd(line.supply_date) === dto.date &&
          line.slot_id === dto.slot_id &&
          line.product_id === dto.product_id,
      );
      const deliveredMilli = current
        ? current.deliveries.reduce((sum, row) => sum + toMilli(row.qty), 0)
        : 0;
      if (qtyMilli < deliveredMilli) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_OVER_DELIVERY,
        );
      }

      if (qtyMilli === 0) {
        if (current) {
          await tx.camporee_supply_lines.delete({
            where: { camporee_supply_line_id: current.camporee_supply_line_id },
          });
        }
      } else if (current) {
        await tx.camporee_supply_lines.update({
          where: { camporee_supply_line_id: current.camporee_supply_line_id },
          data: {
            qty: resolved!.qty,
            unit_cost_centavos: resolved!.unit_cost_centavos,
            line_total_centavos: resolved!.line_total_centavos,
          },
        });
      } else {
        await tx.camporee_supply_lines.create({
          data: {
            plan_id: existing.camporee_supply_plan_id,
            ...resolved!,
          },
        });
      }

      const freshLines = await tx.camporee_supply_lines.findMany({
        where: { plan_id: existing.camporee_supply_plan_id },
      });
      const newTotal = freshLines.reduce(
        (sum, line) => sum + line.line_total_centavos,
        0,
      );
      const delta = newTotal - existing.committed_total_centavos;
      if (delta !== 0) {
        const principal = existing.payments.find((row) => row.kind === 'PRINCIPAL');
        if (!principal) {
          throw new AppUnprocessableEntityException(
            ErrorCode.CAMPOREE_SUPPLIES_PAYMENT_NOT_FOUND,
          );
        }
        const allocated = await this.folio.allocate(
          tx,
          existing.local_field_id,
          this.clock.now(),
        );
        await tx.camporee_supply_payment_docs.create({
          data: {
            plan_id: existing.camporee_supply_plan_id,
            local_field_id: existing.local_field_id,
            club_section_id: existing.club_section_id,
            ...camporeeWhere(kind, camporeeId),
            kind: delta > 0 ? 'CHARGE' : 'REFUND',
            parent_id: principal.camporee_supply_payment_doc_id,
            folio: allocated.folio,
            folio_reference: allocated.folio_reference,
            total_centavos: Math.abs(delta),
            status: 'ISSUED',
            note: `Ajuste del plan; folio principal ${principal.folio_reference}`,
            created_by_id: actor.userId,
          },
        });
      }

      await tx.camporee_supply_plans.update({
        where: { camporee_supply_plan_id: existing.camporee_supply_plan_id },
        data: { committed_total_centavos: newTotal },
      });
      await tx.camporee_supply_plan_audits.create({
        data: {
          plan_id: existing.camporee_supply_plan_id,
          actor_id: actor.userId,
          action: dto.bypass_reason ? 'BYPASS_FREEZE' : 'ADJUST',
          reason: dto.bypass_reason?.trim() || null,
          payload: {
            date: dto.date,
            slot_id: dto.slot_id,
            product_id: dto.product_id,
            qty: dto.qty,
            delta,
          },
        },
      });

      return tx.camporee_supply_plans.findUniqueOrThrow({
        where: { camporee_supply_plan_id: existing.camporee_supply_plan_id },
        include: PLAN_INCLUDE,
      });
    });

    return serializePlan(plan, camporee);
  }

  async listPlans(
    camporeeId: number,
    kind: CamporeeKind,
    actor: CamporeeSupplyActor,
  ) {
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    this.assertCanList(actor);
    const plans = await this.prisma.camporee_supply_plans.findMany({
      where: {
        ...camporeeWhere(kind, camporeeId),
        ...this.listScopeWhere(actor),
      },
      include: PLAN_INCLUDE,
      orderBy: { created_at: 'asc' },
    });
    return plans.map((plan) => serializePlan(plan, camporee));
  }

  async deliver(
    camporeeId: number,
    kind: CamporeeKind,
    lineId: string,
    dto: DeliverSupplyLineDto,
    actor: CamporeeSupplyActor,
  ) {
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    const qtyMilli = toMilli(dto.qty);
    if (qtyMilli <= 0) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_SUPPLIES_QTY_INVALID,
      );
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      const line = await tx.camporee_supply_lines.findFirst({
        where: { camporee_supply_line_id: lineId },
        include: {
          plan: true,
          deliveries: true,
        },
      });
      if (
        !line ||
        (kind === 'local'
          ? line.plan.local_camporee_id !== camporeeId
          : line.plan.union_camporee_id !== camporeeId)
      ) {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_SUPPLIES_LINE_NOT_FOUND);
      }
      if (!canDeliverSupplies(actor, line.plan.local_field_id)) {
        throw new AppForbiddenException(ErrorCode.CAMPOREE_SUPPLIES_FORBIDDEN);
      }
      const deliveredMilli = line.deliveries.reduce(
        (sum, row) => sum + toMilli(row.qty),
        0,
      );
      if (deliveredMilli + qtyMilli > toMilli(line.qty)) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_OVER_DELIVERY,
        );
      }
      await tx.camporee_supply_deliveries.create({
        data: {
          line_id: line.camporee_supply_line_id,
          qty: milliToDecimal(qtyMilli),
          delivered_by_id: actor.userId,
          note: dto.note?.trim() || null,
        },
      });
      return tx.camporee_supply_plans.findUniqueOrThrow({
        where: { camporee_supply_plan_id: line.plan_id },
        include: PLAN_INCLUDE,
      });
    });

    return serializePlan(plan, camporee);
  }

  async markPaid(
    paymentId: string,
    actor: CamporeeSupplyActor,
  ) {
    const payment = await this.prisma.camporee_supply_payment_docs.findUnique({
      where: { camporee_supply_payment_doc_id: paymentId },
    });
    if (!payment) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_SUPPLIES_PAYMENT_NOT_FOUND);
    }
    if (!canReviewSupplyPayment(actor, payment.local_field_id)) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_SUPPLIES_FORBIDDEN);
    }
    if (payment.status !== 'ISSUED') {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_SUPPLIES_PAYMENT_NOT_FOUND,
      );
    }
    const updated = await this.prisma.camporee_supply_payment_docs.update({
      where: { camporee_supply_payment_doc_id: paymentId },
      data: {
        status: 'PAID',
        paid_by_id: actor.userId,
        paid_at: this.clock.now(),
      },
    });
    return mapPayment(updated);
  }

  async kitchenReport(
    camporeeId: number,
    kind: CamporeeKind,
    actor: CamporeeSupplyActor,
    date?: string,
  ) {
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    this.assertCanList(actor);
    const lines = await this.prisma.camporee_supply_lines.findMany({
      where: {
        plan: {
          ...camporeeWhere(kind, camporeeId),
          ...this.listScopeWhere(actor),
          status: 'SUBMITTED',
        },
        ...(date ? { supply_date: new Date(`${date}T00:00:00.000Z`) } : {}),
      },
      include: {
        slot: true,
        product: true,
        deliveries: true,
        plan: {
          include: { club: { select: { name: true } } },
        },
      },
      orderBy: [{ supply_date: 'asc' }],
    });
    return {
      timezone: camporee.timezone,
      date: date ?? null,
      rows: lines.map((line) => ({
        date: utcYmd(line.supply_date),
        slot_id: line.slot_id,
        slot_label: line.slot.label,
        deliver_time: line.slot.deliver_time,
        product_id: line.product_id,
        product_name: line.product.name,
        uom: line.product.uom,
        club_section_id: line.plan.club_section_id,
        club_name: line.plan.club.name,
        qty: milliToDecimal(toMilli(line.qty)).toFixed(3),
        delivered_qty: milliToDecimal(
          line.deliveries.reduce((sum, row) => sum + toMilli(row.qty), 0),
        ).toFixed(3),
        line_total_centavos: line.line_total_centavos,
      })),
    };
  }

  async cashReport(
    camporeeId: number,
    kind: CamporeeKind,
    actor: CamporeeSupplyActor,
  ) {
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    this.assertCanList(actor);
    const plans = await this.prisma.camporee_supply_plans.findMany({
      where: {
        ...camporeeWhere(kind, camporeeId),
        ...this.listScopeWhere(actor),
        status: 'SUBMITTED',
      },
      include: {
        payments: true,
        club: { select: { name: true } },
      },
    });
    return {
      timezone: camporee.timezone,
      sections: plans.map((plan) => {
        const principal = sumKind(plan.payments, 'PRINCIPAL');
        const charges = sumKind(plan.payments, 'CHARGE');
        const refunds = sumKind(plan.payments, 'REFUND');
        const paid =
          sumPaid(plan.payments, 'PRINCIPAL') +
          sumPaid(plan.payments, 'CHARGE') -
          sumPaid(plan.payments, 'REFUND');
        return {
          plan_id: plan.camporee_supply_plan_id,
          club_section_id: plan.club_section_id,
          club_name: plan.club.name,
          principal_centavos: principal,
          charges_centavos: charges,
          refunds_centavos: refunds,
          net_centavos: principal + charges - refunds,
          paid_centavos: paid,
          outstanding_centavos: principal + charges - refunds - paid,
        };
      }),
    };
  }

  private assertCanList(actor: CamporeeSupplyActor): void {
    if (!isSupplyOrganizer(actor) && !isLfCaja(actor)) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_SUPPLIES_FORBIDDEN);
    }
  }

  private listScopeWhere(actor: CamporeeSupplyActor): {
    local_field_id?: number;
  } {
    if (actor.territory.level === 'all' || actor.territory.level === 'union') {
      return {};
    }
    if (actor.territory.level === 'local_field') {
      return { local_field_id: actor.territory.localFieldId };
    }
    if (typeof actor.localFieldId === 'number' && isLfCaja(actor)) {
      return { local_field_id: actor.localFieldId };
    }
    return { local_field_id: -1 };
  }

  private async catalogLite(camporee: SupplyCamporeeRow) {
    const where = camporeeWhere(camporee.kind, camporee.id);
    const [slots, products] = await Promise.all([
      this.prisma.camporee_supply_slots.findMany({
        where: { ...where, active: true },
        orderBy: [{ sort_order: 'asc' }, { deliver_time: 'asc' }],
      }),
      this.prisma.camporee_supply_products.findMany({
        where: { ...where, active: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      supply_edit_cutoff_local_time: camporee.cutoffHm,
      timezone: camporee.timezone,
      start_date: camporee.startDate,
      end_date: camporee.endDate,
      slots: slots.map((slot) => ({
        slot_id: slot.camporee_supply_slot_id,
        label: slot.label,
        deliver_time: slot.deliver_time,
        sort_order: slot.sort_order,
      })),
      products: products.map((product) => ({
        product_id: product.camporee_supply_product_id,
        name: product.name,
        uom: product.uom,
        unit_cost_centavos: product.unit_cost_centavos,
      })),
    };
  }

  private async findSectionPlan(
    actor: CamporeeSupplyActor,
    camporee: SupplyCamporeeRow,
  ) {
    return this.prisma.camporee_supply_plans.findFirst({
      where: {
        club_section_id: actor.activeSection!.club_section_id,
        ...camporeeWhere(camporee.kind, camporee.id),
      },
      include: PLAN_INCLUDE,
    });
  }

  private async assertSectionEnrolled(
    actor: CamporeeSupplyActor,
    camporee: SupplyCamporeeRow,
  ): Promise<void> {
    const section = actor.activeSection;
    if (!section || typeof section.local_field_id !== 'number') {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_SUPPLIES_FORBIDDEN);
    }
    const enrollment = await this.prisma.camporee_clubs.findFirst({
      where: {
        club_section_id: section.club_section_id,
        active: true,
        status: { in: [...ELIGIBLE_ENROLLMENT_STATUSES] },
        ...(camporee.kind === 'local'
          ? { camporee_id: camporee.id }
          : { union_camporee_id: camporee.id }),
      },
      select: { camporee_club_id: true },
    });
    if (!enrollment) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_SUPPLIES_SECTION_NOT_ELIGIBLE,
      );
    }
    if (camporee.kind === 'union') {
      const participating =
        await this.prisma.union_camporee_local_fields.findFirst({
          where: {
            union_camporee_lf_id: camporee.id,
            local_field_id: section.local_field_id,
            active: true,
          },
          select: { local_field_id: true },
        });
      if (!participating) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_SECTION_NOT_ELIGIBLE,
        );
      }
    }
  }

  private async resolveLines(
    tx: Prisma.TransactionClient,
    camporee: SupplyCamporeeRow,
    lines: SupplyPlanLineInputDto[],
  ) {
    const unique = new Map<string, SupplyPlanLineInputDto>();
    for (const line of lines) {
      assertDateInCamporee(line.date, camporee);
      const key = `${line.date}|${line.slot_id}|${line.product_id}`;
      unique.set(key, line);
    }
    const slotIds = [...new Set([...unique.values()].map((line) => line.slot_id))];
    const productIds = [
      ...new Set([...unique.values()].map((line) => line.product_id)),
    ];
    const where = camporeeWhere(camporee.kind, camporee.id);
    const [slots, products] = await Promise.all([
      tx.camporee_supply_slots.findMany({
        where: {
          camporee_supply_slot_id: { in: slotIds },
          active: true,
          ...where,
        },
      }),
      tx.camporee_supply_products.findMany({
        where: {
          camporee_supply_product_id: { in: productIds },
          active: true,
          ...where,
        },
      }),
    ]);
    const slotSet = new Set(slots.map((row) => row.camporee_supply_slot_id));
    const productMap = new Map(
      products.map((row) => [row.camporee_supply_product_id, row]),
    );
    return [...unique.values()].map((line) => {
      if (!slotSet.has(line.slot_id)) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_SLOT_INVALID,
        );
      }
      const product = productMap.get(line.product_id);
      if (!product) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_PRODUCT_INVALID,
        );
      }
      const qty = milliToDecimal(toMilli(line.qty));
      return {
        supply_date: new Date(`${line.date}T00:00:00.000Z`),
        slot_id: line.slot_id,
        product_id: line.product_id,
        qty,
        unit_cost_centavos: product.unit_cost_centavos,
        line_total_centavos: lineTotalCentavos(
          qty.toFixed(3),
          product.unit_cost_centavos,
        ),
      };
    });
  }

  private async lockPlanForActor(
    tx: Prisma.TransactionClient,
    camporee: SupplyCamporeeRow,
    actor: CamporeeSupplyActor,
    clubSectionId: number,
    requireOwnSection: boolean,
  ) {
    const existing = await tx.camporee_supply_plans.findFirst({
      where: {
        club_section_id: clubSectionId,
        ...camporeeWhere(camporee.kind, camporee.id),
      },
      include: {
        lines: { include: { deliveries: true } },
        payments: true,
      },
    });
    if (!existing) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_SUPPLIES_NOT_FOUND);
    }
    if (
      !requireOwnSection &&
      !canReviewSupplyPayment(actor, existing.local_field_id) &&
      !canBypassSupplyFreeze(actor)
    ) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_SUPPLIES_FORBIDDEN);
    }
    if (
      !requireOwnSection &&
      actor.territory.level === 'local_field' &&
      existing.local_field_id !== actor.territory.localFieldId
    ) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_SUPPLIES_FORBIDDEN);
    }
    return existing;
  }

  private assertEditableDate(
    camporee: SupplyCamporeeRow,
    status: 'DRAFT' | 'SUBMITTED',
    supplyDate: string,
    actor: CamporeeSupplyActor,
    bypassReason?: string,
  ): void {
    const allowed = canClubEditSupplyDate({
      planStatus: status,
      supplyDate,
      now: this.clock.now(),
      timeZone: camporee.timezone,
      cutoffHm: camporee.cutoffHm,
    });
    if (allowed) {
      return;
    }
    if (canBypassSupplyFreeze(actor)) {
      if (!bypassReason || bypassReason.trim().length < 3) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_BYPASS_REASON_REQUIRED,
        );
      }
      return;
    }
    throw new AppUnprocessableEntityException(
      ErrorCode.CAMPOREE_SUPPLIES_DAY_LOCKED,
    );
  }
}

function toMilli(qty: Prisma.Decimal | string | number): number {
  const value = typeof qty === 'number' ? qty : Number(qty);
  if (!Number.isFinite(value) || value < 0) {
    throw new AppUnprocessableEntityException(
      ErrorCode.CAMPOREE_SUPPLIES_QTY_INVALID,
    );
  }
  const milli = Math.round(value * 1000);
  if (Math.abs(value * 1000 - milli) > 1e-6) {
    throw new AppUnprocessableEntityException(
      ErrorCode.CAMPOREE_SUPPLIES_QTY_INVALID,
    );
  }
  return milli;
}

function milliToDecimal(milli: number): Prisma.Decimal {
  return new Prisma.Decimal((milli / 1000).toFixed(3));
}

function sumKind(
  payments: Array<{ kind: string; total_centavos: number; status: string }>,
  kind: string,
): number {
  return payments
    .filter((row) => row.kind === kind && row.status !== 'CANCELLED')
    .reduce((sum, row) => sum + row.total_centavos, 0);
}

function sumPaid(
  payments: Array<{ kind: string; total_centavos: number; status: string }>,
  kind: string,
): number {
  return payments
    .filter((row) => row.kind === kind && row.status === 'PAID')
    .reduce((sum, row) => sum + row.total_centavos, 0);
}

function mapPayment(row: {
  camporee_supply_payment_doc_id: string;
  kind: string;
  parent_id: string | null;
  folio_reference: string;
  total_centavos: number;
  status: string;
  note: string | null;
  created_at: Date;
  paid_at: Date | null;
}) {
  return {
    payment_id: row.camporee_supply_payment_doc_id,
    kind: row.kind,
    parent_id: row.parent_id,
    folio_reference: row.folio_reference,
    total_centavos: row.total_centavos,
    status: row.status,
    note: row.note,
    created_at: row.created_at.toISOString(),
    paid_at: row.paid_at?.toISOString() ?? null,
  };
}

function serializePlan(
  plan: {
    camporee_supply_plan_id: string;
    club_section_id: number;
    local_field_id: number;
    status: string;
    committed_total_centavos: number;
    submitted_at: Date | null;
    club: { name: string };
    lines: Array<{
      camporee_supply_line_id: string;
      supply_date: Date;
      slot_id: string;
      product_id: string;
      qty: Prisma.Decimal;
      unit_cost_centavos: number;
      line_total_centavos: number;
      slot: { label: string; deliver_time: string; sort_order: number };
      product: { name: string; uom: string };
      deliveries: Array<{ qty: Prisma.Decimal }>;
    }>;
    payments: Array<{
      camporee_supply_payment_doc_id: string;
      kind: string;
      parent_id: string | null;
      folio_reference: string;
      total_centavos: number;
      status: string;
      note: string | null;
      created_at: Date;
      paid_at: Date | null;
    }>;
  },
  camporee: SupplyCamporeeRow,
) {
  const orderedLines = [...plan.lines].sort((left, right) => {
    const byDate = utcYmd(left.supply_date).localeCompare(utcYmd(right.supply_date));
    if (byDate !== 0) {
      return byDate;
    }
    return left.slot.sort_order - right.slot.sort_order;
  });
  const principal = sumKind(plan.payments, 'PRINCIPAL');
  const charges = sumKind(plan.payments, 'CHARGE');
  const refunds = sumKind(plan.payments, 'REFUND');
  return {
    plan_id: plan.camporee_supply_plan_id,
    club_section_id: plan.club_section_id,
    club_name: plan.club.name,
    local_field_id: plan.local_field_id,
    status: plan.status,
    committed_total_centavos: plan.committed_total_centavos,
    net_centavos: principal + charges - refunds,
    submitted_at: plan.submitted_at?.toISOString() ?? null,
    cutoff: camporee.cutoffHm,
    timezone: camporee.timezone,
    lines: orderedLines.map((line) => ({
      line_id: line.camporee_supply_line_id,
      date: utcYmd(line.supply_date),
      slot_id: line.slot_id,
      slot_label: line.slot.label,
      deliver_time: line.slot.deliver_time,
      product_id: line.product_id,
      product_name: line.product.name,
      uom: line.product.uom,
      qty: milliToDecimal(toMilli(line.qty)).toFixed(3),
      delivered_qty: milliToDecimal(
        line.deliveries.reduce((sum, row) => sum + toMilli(row.qty), 0),
      ).toFixed(3),
      unit_cost_centavos: line.unit_cost_centavos,
      line_total_centavos: line.line_total_centavos,
    })),
    payments: plan.payments.map(mapPayment),
  };
}
