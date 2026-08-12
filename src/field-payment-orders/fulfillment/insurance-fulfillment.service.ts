import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
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

  async fulfill(
    _tx: Prisma.TransactionClient,
    _order: OrderForFulfillment,
    _actor: OrderActor,
  ): Promise<void> {
    throw new AppBadRequestException(
      ErrorCode.FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED,
      { reason: 'insurance_fulfillment_not_available' },
    );
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
