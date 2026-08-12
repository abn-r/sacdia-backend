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

export interface CamporeeOrderRequest {
  camporee_id: number;
  beneficiary_user_ids: string[];
}

const VALID_SECTION_STATUSES = ['registered', 'approved'];

type EligibilityDb = Pick<
  PrismaService,
  | 'camporee_clubs'
  | 'club_role_assignments'
  | 'camporee_members'
  | 'insurance_assignments'
  | 'member_insurances'
>;

/**
 * Camporee purpose port (plan base Tasks 3.1–3.2, decisiones 8 y 12).
 * Ningún camporee es gratis: registration_cost null/0 bloquea la orden.
 * El approve crea todos los camporee_members `approved` en la misma TX.
 */
@Injectable()
export class CamporeeFulfillmentService implements PurposeFulfillment {
  constructor(private readonly prisma: PrismaService) {}

  async prepareOrder(
    rawDto: unknown,
    actor: OrderActor,
  ): Promise<PreparedOrder> {
    const dto = rawDto as CamporeeOrderRequest;
    const section = actor.activeSection;
    if (!section) {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
    }

    const camporee = await this.prisma.local_camporees.findUnique({
      where: { local_camporee_id: dto.camporee_id },
      select: {
        local_camporee_id: true,
        name: true,
        local_field_id: true,
        active: true,
        registration_cost: true,
        member_registration_deadline: true,
        start_date: true,
        end_date: true,
      },
    });
    if (!camporee?.active) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
        { reason: 'camporee_not_found_or_inactive' },
      );
    }

    const sectionRow = await this.prisma.club_sections.findUnique({
      where: { club_section_id: section.club_section_id },
      select: {
        club_type_id: true,
        clubs: { select: { club_id: true, local_field_id: true } },
      },
    });
    const localFieldId = sectionRow?.clubs?.local_field_id;
    if (!sectionRow || typeof localFieldId !== 'number') {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
    }
    if (camporee.local_field_id !== localFieldId) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
        { reason: 'camporee_outside_local_field' },
      );
    }
    if (
      camporee.member_registration_deadline &&
      camporee.member_registration_deadline < new Date()
    ) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
        { reason: 'member_registration_closed' },
      );
    }

    // Decisión 8: ningún camporee gratis — costo no configurado bloquea.
    const unitCostCentavos = Math.round(
      Number(camporee.registration_cost ?? 0) * 100,
    );
    if (!Number.isFinite(unitCostCentavos) || unitCostCentavos <= 0) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_COST_NOT_CONFIGURED,
      );
    }

    await this.assertEligibility(
      this.prisma,
      camporee.local_camporee_id,
      section.club_section_id,
      dto.beneficiary_user_ids,
    );

    return {
      local_field_id: localFieldId,
      club_id: sectionRow.clubs?.club_id ?? section.club_id,
      club_section_id: section.club_section_id,
      purpose_ref_id: camporee.local_camporee_id,
      unit_cost_centavos: unitCostCentavos,
      currency: 'MXN',
      concept: camporee.name,
      beneficiary_user_ids: dto.beneficiary_user_ids,
    };
  }

  /**
   * Decisión 12 — approve TX única: revalidar (sección registrada, membresía,
   * seguro vigente por línea) → crear todos los camporee_members `approved` →
   * link orden↔members. Un fallo → cero miembros (rollback total).
   */
  async fulfill(
    tx: Prisma.TransactionClient,
    order: OrderForFulfillment,
    actor: OrderActor,
  ): Promise<void> {
    if (!order.local_camporee_id) {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
        { reason: 'missing_camporee_reference' },
      );
    }

    const db = tx as unknown as EligibilityDb &
      Pick<PrismaService, 'local_camporees' | 'clubs' | 'field_payment_order_lines'>;

    const camporee = await db.local_camporees.findUnique({
      where: { local_camporee_id: order.local_camporee_id },
      select: {
        local_camporee_id: true,
        local_field_id: true,
        active: true,
      },
    });
    if (!camporee?.active) {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
        { reason: 'camporee_not_found_or_inactive' },
      );
    }

    const userIds = order.lines.map((line) => line.beneficiary_user_id);
    const enrollment = await this.assertEligibility(
      db,
      order.local_camporee_id,
      order.club_section_id,
      userIds,
    );

    const club = await db.clubs.findUnique({
      where: { club_id: order.club_id },
      select: { name: true },
    });
    const bridgeByUser = await this.loadBridgeInsurance(db, userIds);
    const now = new Date();

    for (const line of order.lines) {
      const member = await db.camporee_members.create({
        data: {
          camporee_club_id: enrollment.camporee_club_id,
          camporee_id: order.local_camporee_id,
          camporee_type: 'local',
          user_id: line.beneficiary_user_id,
          club_name: club?.name ?? null,
          local_field_id: camporee.local_field_id,
          insurance_verified: true,
          insurance_id: bridgeByUser.get(line.beneficiary_user_id) ?? null,
          status: 'approved',
          approved_by: actor.userId,
          active: true,
          modified_at: now,
        },
      });
      await db.field_payment_order_lines.update({
        where: {
          field_payment_order_line_id: line.field_payment_order_line_id,
        },
        data: { camporee_member_id: member.camporee_member_id },
      });
    }
  }

  /**
   * Prechecks compartidos create/approve: sección inscrita al camporee,
   * beneficiarios miembros activos de la sección, seguro vigente (assignment
   * activa del capacity model o legacy member_insurances) y sin registro
   * previo activo en el camporee.
   */
  private async assertEligibility(
    db: EligibilityDb,
    camporeeId: number,
    clubSectionId: number,
    userIds: string[],
  ): Promise<{ camporee_club_id: number }> {
    const enrollment = await db.camporee_clubs.findFirst({
      where: {
        camporee_id: camporeeId,
        club_section_id: clubSectionId,
        active: true,
        status: { in: VALID_SECTION_STATUSES },
      },
      select: { camporee_club_id: true },
    });
    if (!enrollment) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
        { reason: 'section_not_enrolled' },
      );
    }

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
    const notMembers = userIds.filter((userId) => !memberSet.has(userId));
    if (notMembers.length > 0) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED,
        { reason: 'not_section_members', user_ids: notMembers },
      );
    }

    const alreadyRegistered = await db.camporee_members.findMany({
      where: {
        camporee_id: camporeeId,
        user_id: { in: userIds },
        active: true,
      },
      select: { user_id: true },
    });
    if (alreadyRegistered.length > 0) {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
        { user_ids: alreadyRegistered.map((row) => row.user_id) },
      );
    }

    await this.assertValidInsurance(db, userIds);
    return enrollment;
  }

  private async assertValidInsurance(
    db: EligibilityDb,
    userIds: string[],
  ): Promise<void> {
    const today = new Date();
    const [assignments, legacyPolicies] = await Promise.all([
      db.insurance_assignments.findMany({
        where: {
          user_id: { in: userIds },
          status: 'ACTIVE',
          valid_until: { gte: today },
        },
        select: { user_id: true },
      }),
      db.member_insurances.findMany({
        where: {
          user_id: { in: userIds },
          active: true,
          end_date: { gte: today },
        },
        select: { user_id: true },
      }),
    ]);
    const insured = new Set([
      ...assignments.map((row) => row.user_id),
      ...legacyPolicies.map((row) => row.user_id),
    ]);
    const uninsured = userIds.filter((userId) => !insured.has(userId));
    if (uninsured.length > 0) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED,
        { reason: 'no_valid_insurance', user_ids: uninsured },
      );
    }
  }

  /** camporee_members.insurance_id references the legacy/bridge policy. */
  private async loadBridgeInsurance(
    db: EligibilityDb,
    userIds: string[],
  ): Promise<Map<string, number>> {
    const today = new Date();
    const policies = await db.member_insurances.findMany({
      where: {
        user_id: { in: userIds },
        active: true,
        end_date: { gte: today },
      },
      orderBy: { end_date: 'desc' },
      select: { insurance_id: true, user_id: true },
    });
    const byUser = new Map<string, number>();
    for (const policy of policies) {
      if (!byUser.has(policy.user_id)) {
        byUser.set(policy.user_id, policy.insurance_id);
      }
    }
    return byUser;
  }
}
