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
  camporee_type?: 'local' | 'union';
  beneficiary_user_ids: string[];
}

const VALID_SECTION_STATUSES = ['registered', 'approved'];

/** Discriminador local/unión para las queries de enrolamiento y registro. */
type CamporeeRef =
  | { scope: 'local'; camporee_id: number }
  | { scope: 'union'; union_camporee_id: number };

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
 * El approve crea todos los camporee_members `approved` y un
 * camporee_payments de inscripción `approved` por línea, en la misma TX.
 */
@Injectable()
export class CamporeeFulfillmentService implements PurposeFulfillment {
  constructor(private readonly prisma: PrismaService) {}

  async prepareOrder(
    rawDto: unknown,
    actor: OrderActor,
  ): Promise<PreparedOrder> {
    const dto = rawDto as CamporeeOrderRequest;
    const scope = dto.camporee_type === 'union' ? 'union' : 'local';
    const section = actor.activeSection;
    if (!section) {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
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

    const camporee = await this.loadCamporeeForIssue(
      scope,
      dto.camporee_id,
      localFieldId,
    );

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
      this.refFor(scope, dto.camporee_id),
      section.club_section_id,
      dto.beneficiary_user_ids,
    );

    return {
      local_field_id: localFieldId,
      club_id: sectionRow.clubs?.club_id ?? section.club_id,
      club_section_id: section.club_section_id,
      purpose_ref_id: dto.camporee_id,
      camporee_scope: scope,
      unit_cost_centavos: unitCostCentavos,
      currency: 'MXN',
      concept: camporee.name,
      beneficiary_user_ids: dto.beneficiary_user_ids,
    };
  }

  private refFor(scope: 'local' | 'union', camporeeId: number): CamporeeRef {
    return scope === 'union'
      ? { scope: 'union', union_camporee_id: camporeeId }
      : { scope: 'local', camporee_id: camporeeId };
  }

  /**
   * Camporee local: debe pertenecer al LF de la sección emisora.
   * Camporee de unión (v1.1 opción A): el LF emisor debe estar entre los
   * campos participantes; el cobro sigue siendo del Campo Local.
   */
  private async loadCamporeeForIssue(
    scope: 'local' | 'union',
    camporeeId: number,
    localFieldId: number,
  ): Promise<{
    name: string;
    registration_cost: Prisma.Decimal | null;
    member_registration_deadline: Date | null;
  }> {
    if (scope === 'local') {
      const camporee = await this.prisma.local_camporees.findUnique({
        where: { local_camporee_id: camporeeId },
        select: {
          name: true,
          local_field_id: true,
          active: true,
          registration_cost: true,
          member_registration_deadline: true,
        },
      });
      if (!camporee?.active) {
        throw new AppBadRequestException(
          ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
          { reason: 'camporee_not_found_or_inactive' },
        );
      }
      if (camporee.local_field_id !== localFieldId) {
        throw new AppBadRequestException(
          ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
          { reason: 'camporee_outside_local_field' },
        );
      }
      return camporee;
    }

    const camporee = await this.prisma.union_camporees.findUnique({
      where: { union_camporee_id: camporeeId },
      select: {
        name: true,
        active: true,
        registration_cost: true,
        member_registration_deadline: true,
        union_camporee_local_fields: {
          where: { local_field_id: localFieldId, active: true },
          select: { local_field_id: true },
        },
      },
    });
    if (!camporee?.active) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
        { reason: 'camporee_not_found_or_inactive' },
      );
    }
    if (camporee.union_camporee_local_fields.length === 0) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
        { reason: 'camporee_outside_local_field' },
      );
    }
    return camporee;
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
    const scope = order.union_camporee_id ? 'union' : 'local';
    const camporeeId = order.union_camporee_id ?? order.local_camporee_id;
    if (!camporeeId) {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
        { reason: 'missing_camporee_reference' },
      );
    }

    const db = tx as unknown as EligibilityDb &
      Pick<
        PrismaService,
        | 'local_camporees'
        | 'union_camporees'
        | 'clubs'
        | 'field_payment_order_lines'
        | 'camporee_payments'
      >;

    await this.assertCamporeeStillActive(db, scope, camporeeId);

    const userIds = order.lines.map((line) => line.beneficiary_user_id);
    const enrollment = await this.assertEligibility(
      db,
      this.refFor(scope, camporeeId),
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
          camporee_id: scope === 'local' ? camporeeId : null,
          union_camporee_id: scope === 'union' ? camporeeId : null,
          camporee_type: scope,
          user_id: line.beneficiary_user_id,
          club_name: club?.name ?? null,
          // Opción A: el LF emisor cobra; para unión el miembro conserva su LF.
          local_field_id: order.local_field_id,
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
      const amountPesos = Number(
        ((order.unit_cost_centavos ?? 0) / 100).toFixed(2),
      );
      await db.camporee_payments.create({
        data: {
          camporee_member_id: member.camporee_member_id,
          amount: amountPesos,
          payment_type: 'inscription',
          reference: order.folio_reference,
          notes: `field_payment_order:${order.field_payment_order_id}`,
          registered_by: order.issued_by_id,
          approved_by: actor.userId,
          paid_at: now,
          status: 'approved',
        },
      });
    }
  }

  private async assertCamporeeStillActive(
    db: Pick<PrismaService, 'local_camporees' | 'union_camporees'>,
    scope: 'local' | 'union',
    camporeeId: number,
  ): Promise<void> {
    const camporee =
      scope === 'local'
        ? await db.local_camporees.findUnique({
            where: { local_camporee_id: camporeeId },
            select: { active: true },
          })
        : await db.union_camporees.findUnique({
            where: { union_camporee_id: camporeeId },
            select: { active: true },
          });
    if (!camporee?.active) {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
        { reason: 'camporee_not_found_or_inactive' },
      );
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
    ref: CamporeeRef,
    clubSectionId: number,
    userIds: string[],
  ): Promise<{ camporee_club_id: number }> {
    const refWhere =
      ref.scope === 'union'
        ? { union_camporee_id: ref.union_camporee_id }
        : { camporee_id: ref.camporee_id };
    const enrollment = await db.camporee_clubs.findFirst({
      where: {
        ...refWhere,
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
        ...refWhere,
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
