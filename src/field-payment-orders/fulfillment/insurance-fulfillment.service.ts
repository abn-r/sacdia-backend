import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  classifyInsurancePurchase,
  resolveInsuranceValidity,
} from '../../insurance/domain/insurance-policy';
import { PrismaService } from '../../prisma/prisma.service';
import type { OrderActor } from '../order-actor';
import type {
  OrderForFulfillment,
  PreparedOrder,
  PurposeFulfillment,
} from './ports';

export interface InsuranceOrderRequest {
  insurance_cycle_config_id: number;
  beneficiary_user_ids: string[];
}

/**
 * Insurance purpose port (plan base Tasks 2.1–2.2, decisión 11).
 *
 * prepareOrder: validates cycle/club_type/membership/duplicates and snapshots
 * the unit cost in centavos. fulfill (Task 2.2) materializes coverage.
 */
@Injectable()
export class InsuranceFulfillmentService implements PurposeFulfillment {
  constructor(private readonly prisma: PrismaService) {}

  async prepareOrder(
    rawDto: unknown,
    actor: OrderActor,
  ): Promise<PreparedOrder> {
    const dto = rawDto as InsuranceOrderRequest;
    const section = actor.activeSection;
    if (!section) {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
    }

    const cycle = await this.prisma.insurance_cycle_configs.findUnique({
      where: { insurance_cycle_config_id: dto.insurance_cycle_config_id },
      include: { product: true },
    });
    if (!cycle?.active || !cycle.product?.active) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
        { reason: 'cycle_not_found_or_inactive' },
      );
    }

    const sectionRow = await this.prisma.club_sections.findUnique({
      where: { club_section_id: section.club_section_id },
      select: {
        club_type_id: true,
        main_club_id: true,
        clubs: { select: { club_id: true, local_field_id: true } },
      },
    });
    const localFieldId = sectionRow?.clubs?.local_field_id;
    if (!sectionRow || typeof localFieldId !== 'number') {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
    }
    if (
      cycle.local_field_id !== localFieldId ||
      cycle.club_type_id !== sectionRow.club_type_id
    ) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
        { reason: 'cycle_scope_mismatch' },
      );
    }

    const unitCostCentavos = Math.round(Number(cycle.unit_cost) * 100);
    if (!Number.isFinite(unitCostCentavos) || unitCostCentavos <= 0) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_COST_NOT_CONFIGURED,
      );
    }

    await this.assertSectionMembership(
      this.prisma,
      section.club_section_id,
      dto.beneficiary_user_ids,
    );
    await this.assertNotAlreadyCovered(
      this.prisma,
      dto.insurance_cycle_config_id,
      dto.beneficiary_user_ids,
    );

    return {
      local_field_id: localFieldId,
      club_id: sectionRow.clubs?.club_id ?? section.club_id,
      club_section_id: section.club_section_id,
      purpose_ref_id: cycle.insurance_cycle_config_id,
      unit_cost_centavos: unitCostCentavos,
      currency: 'MXN',
      concept: cycle.product.name,
      beneficiary_user_ids: dto.beneficiary_user_ids,
    };
  }

  /**
   * Decisión 11 — approve TX única: revalidar elegibilidad por línea →
   * purchase CONFIRMED → 1 slot ASSIGNED + 1 assignment ACTIVE por línea →
   * upsert bridge `member_insurances` → link línea↔assignment. Cualquier
   * throw hace rollback de toda la aprobación (incluido el APPROVED).
   */
  async fulfill(
    tx: Prisma.TransactionClient,
    order: OrderForFulfillment,
    actor: OrderActor,
  ): Promise<void> {
    if (!order.insurance_cycle_config_id) {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
        { reason: 'missing_cycle_reference' },
      );
    }
    const cycle = await tx.insurance_cycle_configs.findUnique({
      where: { insurance_cycle_config_id: order.insurance_cycle_config_id },
      include: { product: true },
    });
    if (!cycle?.active || !cycle.product?.active) {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
        { reason: 'cycle_not_found_or_inactive' },
      );
    }
    if (cycle.product.validity_mode !== 'FIXED_MONTHS') {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
        { reason: 'unsupported_validity_mode' },
      );
    }

    const userIds = order.lines.map((line) => line.beneficiary_user_id);
    await this.assertSectionMembership(
      tx as unknown as Pick<PrismaService, 'club_role_assignments'>,
      order.club_section_id,
      userIds,
    );
    await this.assertNotAlreadyCovered(
      tx as unknown as Pick<PrismaService, 'insurance_assignments'>,
      order.insurance_cycle_config_id,
      userIds,
    );

    const now = new Date();
    const classification = classifyInsurancePurchase(
      now,
      new Date(cycle.purchase_deadline),
    );
    const validity = resolveInsuranceValidity({
      validityMode: 'FIXED_MONTHS',
      startsAt: now,
      durationMonths: cycle.product.default_duration_months ?? 12,
    });

    const purchase = await tx.insurance_purchases.create({
      data: {
        insurance_cycle_config_id: order.insurance_cycle_config_id,
        owner_club_id: order.club_id,
        purchasing_section_id: order.club_section_id,
        quantity: order.lines.length,
        unit_cost_snapshot: cycle.unit_cost,
        total_amount: (order.total_centavos / 100).toFixed(2),
        external_reference: order.folio_reference,
        receipt_date: now,
        applied_deadline: cycle.purchase_deadline,
        classification,
        status: 'CONFIRMED',
        submitted_by_id: order.issued_by_id,
        reviewed_by_id: actor.userId,
        reviewed_at: now,
        created_by_id: actor.userId,
        modified_by_id: actor.userId,
      },
    });

    for (const line of order.lines) {
      const slot = await tx.insurance_coverage_slots.create({
        data: {
          insurance_purchase_id: purchase.insurance_purchase_id,
          sequence_number: line.sequence,
          owner_club_id: order.club_id,
          purchasing_section_id: order.club_section_id,
          current_section_id: order.club_section_id,
          status: 'ASSIGNED',
          created_by_id: actor.userId,
          modified_by_id: actor.userId,
        },
      });
      const assignment = await tx.insurance_assignments.create({
        data: {
          insurance_coverage_slot_id: slot.insurance_coverage_slot_id,
          subject_type: 'MEMBER',
          user_id: line.beneficiary_user_id,
          valid_from: validity.startsAt,
          valid_until: validity.endsAt,
          status: 'ACTIVE',
          assigned_by_id: actor.userId,
          confirmed_by_id: actor.userId,
          confirmed_at: now,
          created_by_id: actor.userId,
          modified_by_id: actor.userId,
        },
      });
      await tx.insurance_slot_movements.createMany({
        data: [
          {
            insurance_coverage_slot_id: slot.insurance_coverage_slot_id,
            movement_type: 'PURCHASE_CONFIRMED',
            from_section_id: null,
            to_section_id: order.club_section_id,
            reason: `Field payment order ${order.folio_reference} approved`,
            performed_by_id: actor.userId,
          },
          {
            insurance_coverage_slot_id: slot.insurance_coverage_slot_id,
            movement_type: 'ASSIGNED',
            from_section_id: null,
            to_section_id: order.club_section_id,
            insurance_assignment_id: assignment.insurance_assignment_id,
            reason: `Assigned via order ${order.folio_reference}`,
            performed_by_id: actor.userId,
          },
        ],
      });

      await this.upsertBridge(tx, {
        userId: line.beneficiary_user_id,
        providerName: cycle.product.name,
        folioReference: order.folio_reference,
        validFrom: validity.startsAt,
        validUntil: validity.endsAt,
        actorId: actor.userId,
      });

      await tx.field_payment_order_lines.update({
        where: {
          field_payment_order_line_id: line.field_payment_order_line_id,
        },
        data: { insurance_assignment_id: assignment.insurance_assignment_id },
      });
    }
  }

  /**
   * Legacy bridge: camporees (y otras lecturas) siguen consultando
   * `member_insurances`; extendemos la vigencia si ya existe una póliza
   * activa del mismo tipo, o creamos el registro puente.
   */
  private async upsertBridge(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      providerName: string;
      folioReference: string;
      validFrom: Date;
      validUntil: Date;
      actorId: string;
    },
  ): Promise<void> {
    const existing = await tx.member_insurances.findFirst({
      where: {
        user_id: input.userId,
        insurance_type: 'GENERAL_ACTIVITIES',
        active: true,
        end_date: { gte: input.validFrom },
      },
      orderBy: { end_date: 'desc' },
    });
    if (existing) {
      if (existing.end_date < input.validUntil) {
        await tx.member_insurances.update({
          where: { insurance_id: existing.insurance_id },
          data: {
            end_date: input.validUntil,
            modified_by_id: input.actorId,
          },
        });
      }
      return;
    }
    await tx.member_insurances.create({
      data: {
        user_id: input.userId,
        insurance_type: 'GENERAL_ACTIVITIES',
        provider: input.providerName,
        policy_number: input.folioReference,
        start_date: input.validFrom,
        end_date: input.validUntil,
        active: true,
        created_by_id: input.actorId,
        modified_by_id: input.actorId,
      },
    });
  }

  private async assertSectionMembership(
    db: Pick<PrismaService, 'club_role_assignments'>,
    clubSectionId: number,
    userIds: string[],
  ): Promise<void> {
    const memberships = await db.club_role_assignments.findMany({
      where: {
        user_id: { in: userIds },
        club_section_id: clubSectionId,
        active: true,
        status: 'active',
      },
      select: { user_id: true },
    });
    const memberSet = new Set(memberships.map((row) => row.user_id));
    const missing = userIds.filter((userId) => !memberSet.has(userId));
    if (missing.length > 0) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED,
        { reason: 'not_section_members', user_ids: missing },
      );
    }
  }

  private async assertNotAlreadyCovered(
    db: Pick<PrismaService, 'insurance_assignments'>,
    cycleConfigId: number,
    userIds: string[],
  ): Promise<void> {
    const covered = await db.insurance_assignments.findMany({
      where: {
        user_id: { in: userIds },
        status: 'ACTIVE',
        coverage_slot: {
          purchase: { insurance_cycle_config_id: cycleConfigId },
        },
      },
      select: { user_id: true },
    });
    if (covered.length > 0) {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
        { user_ids: covered.map((row) => row.user_id) },
      );
    }
  }
}
