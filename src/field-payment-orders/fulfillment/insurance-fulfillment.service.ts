import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { classifyInsurancePurchase } from '../../insurance/domain/insurance-policy';
import { PrismaService } from '../../prisma/prisma.service';
import { InsuranceCoverageService } from '../insurance-coverage.service';
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
 * Annual model: coverage lasts until the end of the cycle's ecclesiastical
 * year, a person holds one insurance per year (any LF/club/club type) and can
 * be in only one live-or-paid order per year. `purpose_ref_id` of INSURANCE
 * lines is the ecclesiastical year id, so the existing partial unique index
 * `uq_field_payment_order_lines_active_beneficiary` enforces the second rule
 * without a migration.
 *
 * prepareOrder: validates cycle/club_type/eligibility/conflicts and snapshots
 * the unit cost in centavos. fulfill materializes coverage.
 */
@Injectable()
export class InsuranceFulfillmentService implements PurposeFulfillment {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coverage: InsuranceCoverageService,
  ) {}

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
      include: { product: true, ecclesiastical_year: true },
    });
    if (!cycle?.active || !cycle.product?.active) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
        { reason: 'cycle_not_found_or_inactive' },
      );
    }
    if (cycle.ecclesiastical_year.end_date < this.coverage.today()) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
        { reason: 'cycle_year_ended' },
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

    await this.coverage.assertSectionPeople(
      this.prisma,
      section.club_section_id,
      dto.beneficiary_user_ids,
    );
    await this.coverage.assertCanBeInsured(this.prisma, {
      yearId: cycle.ecclesiastical_year_id,
      userIds: dto.beneficiary_user_ids,
    });

    return {
      local_field_id: localFieldId,
      club_id: sectionRow.clubs?.club_id ?? section.club_id,
      club_section_id: section.club_section_id,
      purpose_ref_id: cycle.ecclesiastical_year_id,
      insurance_cycle_config_id: cycle.insurance_cycle_config_id,
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
      include: { product: true, ecclesiastical_year: true },
    });
    if (!cycle?.active || !cycle.product?.active) {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
        { reason: 'cycle_not_found_or_inactive' },
      );
    }

    const userIds = order.lines.map((line) => line.beneficiary_user_id);
    await this.coverage.assertSectionPeople(tx, order.club_section_id, userIds);
    // Re-check at approve: coverage may have been paid elsewhere meanwhile.
    // The order being approved is excluded from the live-order check.
    await this.coverage.assertCanBeInsured(tx, {
      yearId: cycle.ecclesiastical_year_id,
      userIds,
      excludeOrderId: order.field_payment_order_id,
    });

    const now = new Date();
    const classification = classifyInsurancePurchase(
      now,
      new Date(cycle.purchase_deadline),
    );
    // Annual validity: from approval (or the year start, if later) to the end
    // of the cycle's ecclesiastical year. DATE columns, so end-of-day inclusive.
    const yearStart = cycle.ecclesiastical_year.start_date;
    const validity = {
      startsAt: yearStart > now ? yearStart : now,
      endsAt: cycle.ecclesiastical_year.end_date,
    };

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

    const slots = await tx.insurance_coverage_slots.createManyAndReturn({
      data: order.lines.map((line) => ({
        insurance_purchase_id: purchase.insurance_purchase_id,
        sequence_number: line.sequence,
        owner_club_id: order.club_id,
        purchasing_section_id: order.club_section_id,
        current_section_id: order.club_section_id,
        status: 'ASSIGNED' as const,
        created_by_id: actor.userId,
        modified_by_id: actor.userId,
      })),
    });
    const slotBySequence = new Map(
      slots.map((slot) => [slot.sequence_number, slot]),
    );

    const assignments = await tx.insurance_assignments.createManyAndReturn({
      data: order.lines.map((line) => {
        const slot = slotBySequence.get(line.sequence);
        if (!slot) {
          throw new AppConflictException(
            ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
            { reason: 'missing_slot_for_line', sequence: line.sequence },
          );
        }
        return {
          insurance_coverage_slot_id: slot.insurance_coverage_slot_id,
          subject_type: 'MEMBER' as const,
          user_id: line.beneficiary_user_id,
          valid_from: validity.startsAt,
          valid_until: validity.endsAt,
          status: 'ACTIVE' as const,
          assigned_by_id: actor.userId,
          confirmed_by_id: actor.userId,
          confirmed_at: now,
          created_by_id: actor.userId,
          modified_by_id: actor.userId,
        };
      }),
    });
    const assignmentBySlotId = new Map(
      assignments.map((assignment) => [
        assignment.insurance_coverage_slot_id,
        assignment,
      ]),
    );

    await tx.insurance_slot_movements.createMany({
      data: order.lines.flatMap((line) => {
        const slot = slotBySequence.get(line.sequence);
        const assignment = slot
          ? assignmentBySlotId.get(slot.insurance_coverage_slot_id)
          : undefined;
        if (!slot || !assignment) {
          throw new AppConflictException(
            ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
            { reason: 'missing_slot_or_assignment', sequence: line.sequence },
          );
        }
        return [
          {
            insurance_coverage_slot_id: slot.insurance_coverage_slot_id,
            movement_type: 'PURCHASE_CONFIRMED' as const,
            from_section_id: null,
            to_section_id: order.club_section_id,
            reason: `Field payment order ${order.folio_reference} approved`,
            performed_by_id: actor.userId,
          },
          {
            insurance_coverage_slot_id: slot.insurance_coverage_slot_id,
            movement_type: 'ASSIGNED' as const,
            from_section_id: null,
            to_section_id: order.club_section_id,
            insurance_assignment_id: assignment.insurance_assignment_id,
            reason: `Assigned via order ${order.folio_reference}`,
            performed_by_id: actor.userId,
          },
        ];
      }),
    });

    await this.coverage.upsertBridges(tx, {
      userIds,
      providerName: cycle.product.name,
      folioReference: order.folio_reference,
      validFrom: validity.startsAt,
      validUntil: validity.endsAt,
      actorId: actor.userId,
    });

    for (const line of order.lines) {
      const slot = slotBySequence.get(line.sequence);
      const assignment = slot
        ? assignmentBySlotId.get(slot.insurance_coverage_slot_id)
        : undefined;
      if (!assignment) {
        throw new AppConflictException(
          ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
          { reason: 'missing_assignment_for_line', sequence: line.sequence },
        );
      }
      await tx.field_payment_order_lines.update({
        where: {
          field_payment_order_line_id: line.field_payment_order_line_id,
        },
        data: { insurance_assignment_id: assignment.insurance_assignment_id },
      });
    }
  }
}
