import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toTerritoryId } from '../common/authorization/actor-territory-scope';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { lockInvestitureAuthorizationPastor } from '../investiture-requests/investiture-request-lock';
import { displayName } from '../investiture-requests/investiture-communications.rules';
import {
  PASTOR_ELIGIBLE_USER_WHERE,
  pastorEligibility,
} from '../investiture-requests/investiture-pastor-eligibility';
import { PASTOR_CANDIDATE_QUERY_MIN } from './dto/search-pastor-candidates.dto';

const DEFAULT_SLOTS = 2;
const QUOTA_ID = 1;
const CANDIDATE_LIMIT = 20;

/** Identidad estable del candado. No depende de que exista la fila de cupo. */
export const INVESTITURE_PASTOR_QUOTA_LOCK = 'investiture-pastor-quota';

export type PastorQuotaView = {
  slots: number;
  configured: boolean;
  can_edit: boolean;
};

export type DistrictPastorView = {
  districlub_type_id: number;
  user_id: string;
  /** Nombre armado igual que en las solicitudes. `Sin nombre` si no hay datos. */
  user_name: string;
  email: string | null;
  can_authorize: boolean;
  /** Falta el rol global `pastor` activo. La asignación sigue ocupando cupo. */
  role_missing?: boolean;
  /** La cuenta está eliminada o inactiva (BCR-6). La asignación sigue ocupando cupo. */
  account_inactive?: boolean;
};

export type DistrictPastorList = {
  districlub_type_id: number;
  slots: number;
  can_assign: boolean;
  pastors: DistrictPastorView[];
};

export type PastorCandidateView = {
  user_id: string;
  user_name: string;
  email: string | null;
};

export type ClubAuthorizersView = {
  club_id: number;
  districlub_type_id: number;
  resolved_from: 'church';
  authorizers: DistrictPastorView[];
};

type PastorStore = Pick<
  PrismaService,
  | 'investiture_pastor_quota'
  | 'district_investiture_pastors'
  | 'users'
  | 'users_roles'
> & {
  $queryRaw: PrismaService['$queryRaw'];
  $executeRaw: PrismaService['$executeRaw'];
};

type AssignerAccess =
  | { kind: 'super-admin' }
  | { kind: 'union'; unionId: number }
  | { kind: 'field'; localFieldId: number };

@Injectable()
export class DistrictInvestiturePastorService {
  constructor(private readonly prisma: PrismaService) {}

  async getQuota(
    authorization: AuthorizationSnapshot,
  ): Promise<PastorQuotaView> {
    this.assertQuotaReader(authorization);
    const row = await this.prisma.investiture_pastor_quota.findUnique({
      where: { quota_id: QUOTA_ID },
      select: { slots: true },
    });
    return {
      slots: row?.slots ?? DEFAULT_SLOTS,
      configured: row != null,
      can_edit: this.isSuperAdmin(authorization),
    };
  }

  async updateQuota(
    authorization: AuthorizationSnapshot,
    slots: number,
    updatedById: string,
  ): Promise<PastorQuotaView> {
    if (!this.isSuperAdmin(authorization)) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
    if (!Number.isInteger(slots) || slots < 0) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_PASTOR_QUOTA_INVALID,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const store = tx as unknown as PastorStore;
      await this.lockPastorQuota(store);
      const grouped = await store.district_investiture_pastors.groupBy({
        by: ['districlub_type_id'],
        where: { active: true },
        _count: { user_id: true },
      });
      const busiest = grouped.reduce(
        (max, row) => Math.max(max, row._count.user_id),
        0,
      );
      if (slots < busiest) {
        throw new AppConflictException(
          ErrorCode.INVESTITURE_PASTOR_QUOTA_BELOW_ASSIGNMENTS,
        );
      }
      await store.investiture_pastor_quota.upsert({
        where: { quota_id: QUOTA_ID },
        create: { quota_id: QUOTA_ID, slots, updated_by_id: updatedById },
        update: { slots, updated_by_id: updatedById },
      });
      return { slots, configured: true, can_edit: true };
    });
  }

  async list(
    authorization: AuthorizationSnapshot,
    districtId: number,
  ): Promise<DistrictPastorList> {
    const actor = await this.loadDistrict(authorization, districtId, 'read');
    const slots = await this.currentSlots(this.prisma);
    const pastors = await this.activePastors(this.prisma, districtId);
    return {
      districlub_type_id: districtId,
      slots,
      can_assign: actor.kind !== 'super-admin' && pastors.length < slots,
      pastors,
    };
  }

  async assign(
    authorization: AuthorizationSnapshot,
    districtId: number,
    userId: string,
    assignedById: string,
  ): Promise<DistrictPastorView> {
    await this.loadDistrict(authorization, districtId, 'assign');
    return this.prisma.$transaction(async (tx) => {
      const store = tx as unknown as PastorStore;
      await this.lockPastorQuota(store);
      await store.$queryRaw(Prisma.sql`
        SELECT "districlub_type_id"
        FROM "districts"
        WHERE "districlub_type_id" = ${districtId}
        FOR UPDATE
      `);
      await this.assertPastorUser(store, userId);
      const existing = await store.district_investiture_pastors.findUnique({
        where: {
          districlub_type_id_user_id: {
            districlub_type_id: districtId,
            user_id: userId,
          },
        },
        select: { active: true },
      });
      if (existing?.active) {
        throw new AppConflictException(
          ErrorCode.INVESTITURE_PASTOR_ALREADY_ASSIGNED,
        );
      }
      const slots = await this.currentSlots(store);
      const count = await store.district_investiture_pastors.count({
        where: { districlub_type_id: districtId, active: true },
      });
      if (count >= slots) {
        throw new AppConflictException(ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL);
      }
      if (existing) {
        await store.district_investiture_pastors.update({
          where: {
            districlub_type_id_user_id: {
              districlub_type_id: districtId,
              user_id: userId,
            },
          },
          data: { active: true, assigned_by_id: assignedById },
        });
      } else {
        await store.district_investiture_pastors.create({
          data: {
            districlub_type_id: districtId,
            user_id: userId,
            active: true,
            assigned_by_id: assignedById,
          },
        });
      }
      return this.pastorView(
        districtId,
        userId,
        true,
        (await this.identities(store, [userId])).get(userId),
      );
    });
  }

  async remove(
    authorization: AuthorizationSnapshot,
    districtId: number,
    userId: string,
  ): Promise<DistrictPastorView> {
    await this.loadDistrict(authorization, districtId, 'assign');
    return this.prisma.$transaction(async (tx) => {
      await lockInvestitureAuthorizationPastor(tx, districtId, userId);
      const store = tx as unknown as PastorStore;
      await store.$queryRaw(Prisma.sql`
        SELECT "districlub_type_id"
        FROM "districts"
        WHERE "districlub_type_id" = ${districtId}
        FOR UPDATE
      `);
      const existing = await store.district_investiture_pastors.findUnique({
        where: {
          districlub_type_id_user_id: {
            districlub_type_id: districtId,
            user_id: userId,
          },
        },
        select: { active: true },
      });
      if (!existing?.active) {
        throw new AppNotFoundException(
          ErrorCode.INVESTITURE_PASTOR_NOT_ASSIGNED,
        );
      }
      await store.district_investiture_pastors.update({
        where: {
          districlub_type_id_user_id: {
            districlub_type_id: districtId,
            user_id: userId,
          },
        },
        data: { active: false },
      });
      return this.pastorView(
        districtId,
        userId,
        false,
        (await this.identities(store, [userId])).get(userId),
      );
    });
  }

  /**
   * Candidatos a pastor para quien puede asignar (director y asistente de
   * Campo o de unión). Usa la misma regla de elegibilidad que decide quién
   * puede autorizar: cuenta activa y rol global `pastor`.
   */
  async searchCandidates(
    authorization: AuthorizationSnapshot,
    query: string,
  ): Promise<PastorCandidateView[]> {
    if (!this.access(authorization, 'assign')) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
    const tokens = query
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (tokens.join(' ').length < PASTOR_CANDIDATE_QUERY_MIN) {
      return [];
    }
    const patterns = tokens.map(escapeLikeWildcards);
    const rows = await this.prisma.users.findMany({
      where: {
        AND: [
          PASTOR_ELIGIBLE_USER_WHERE,
          ...patterns.map((token): Prisma.usersWhereInput => ({
            OR: [
              { name: { contains: token, mode: 'insensitive' } },
              { paternal_last_name: { contains: token, mode: 'insensitive' } },
              { maternal_last_name: { contains: token, mode: 'insensitive' } },
              { email: { contains: token, mode: 'insensitive' } },
            ],
          })),
        ],
      },
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
      },
      orderBy: [
        { name: 'asc' },
        { paternal_last_name: 'asc' },
        { user_id: 'asc' },
      ],
      take: CANDIDATE_LIMIT,
    });
    return rows.map((row) => ({
      user_id: row.user_id,
      user_name: displayName(row),
      email: row.email,
    }));
  }

  async authorizersForClub(
    authorization: AuthorizationSnapshot,
    clubId: number,
  ): Promise<ClubAuthorizersView> {
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: { club_id: true, church_id: true },
    });
    if (!club) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_PASTOR_CLUB_NOT_FOUND,
      );
    }
    const church = await this.prisma.churches.findUnique({
      where: { church_id: club.church_id },
      select: { districlub_type_id: true },
    });
    if (!church) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_PASTOR_CHURCH_NOT_FOUND,
      );
    }
    await this.loadDistrict(authorization, church.districlub_type_id, 'read');
    return {
      club_id: club.club_id,
      districlub_type_id: church.districlub_type_id,
      resolved_from: 'church',
      authorizers: (
        await this.activePastors(this.prisma, church.districlub_type_id)
      ).filter((pastor) => pastor.can_authorize),
    };
  }

  private async loadDistrict(
    authorization: AuthorizationSnapshot,
    districtId: number,
    mode: 'read' | 'assign',
  ): Promise<AssignerAccess> {
    const actor = this.access(authorization, mode);
    if (!actor) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
    const district = await this.prisma.districts.findUnique({
      where: { districlub_type_id: districtId },
      select: { local_field_id: true },
    });
    if (!district) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_PASTOR_DISTRICT_NOT_FOUND,
      );
    }
    if (
      actor.kind === 'field' &&
      district.local_field_id !== actor.localFieldId
    ) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
    if (actor.kind === 'union') {
      const field = await this.prisma.local_fields.findUnique({
        where: { local_field_id: district.local_field_id },
        select: { union_id: true },
      });
      if (!field || field.union_id !== actor.unionId) {
        throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
      }
    }
    return actor;
  }

  private async assertPastorUser(
    store: PastorStore,
    userId: string,
  ): Promise<void> {
    const user = await store.users.findUnique({
      where: { user_id: userId },
      select: { active: true },
    });
    if (!user?.active) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_PASTOR_USER_NOT_FOUND,
      );
    }
    const eligibility = (await pastorEligibility(store, [userId])).get(userId);
    if (eligibility?.roleMissing !== false) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_PASTOR_ROLE_REQUIRED,
      );
    }
  }

  private async lockPastorQuota(store: PastorStore): Promise<void> {
    await store.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${INVESTITURE_PASTOR_QUOTA_LOCK}, 0))`,
    );
  }

  private async currentSlots(store: PastorStore): Promise<number> {
    const row = await store.investiture_pastor_quota.findUnique({
      where: { quota_id: QUOTA_ID },
      select: { slots: true },
    });
    return row?.slots ?? DEFAULT_SLOTS;
  }

  private async activePastors(
    store: PastorStore,
    districtId: number,
  ): Promise<DistrictPastorView[]> {
    const rows = await store.district_investiture_pastors.findMany({
      where: { districlub_type_id: districtId, active: true },
      select: { user_id: true },
      orderBy: { user_id: 'asc' },
    });
    const ids = rows.map((row) => row.user_id);
    const eligibility = await pastorEligibility(store, ids);
    const identities = await this.identities(store, ids);
    return rows.map((row) => {
      const state = eligibility.get(row.user_id);
      return this.pastorView(
        districtId,
        row.user_id,
        state?.canAuthorize === true,
        identities.get(row.user_id),
        state?.roleMissing !== false,
        state?.accountInactive !== false,
      );
    });
  }

  private async identities(
    store: PastorStore,
    userIds: string[],
  ): Promise<Map<string, { user_name: string; email: string | null }>> {
    const result = new Map<
      string,
      { user_name: string; email: string | null }
    >();
    if (userIds.length === 0) {
      return result;
    }
    const rows = await store.users.findMany({
      where: { user_id: { in: userIds } },
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
      },
    });
    for (const row of rows) {
      result.set(row.user_id, {
        user_name: displayName(row),
        email: row.email,
      });
    }
    return result;
  }

  private pastorView(
    districtId: number,
    userId: string,
    canAuthorize: boolean,
    identity: { user_name: string; email: string | null } | undefined,
    roleMissing = false,
    accountInactive = false,
  ): DistrictPastorView {
    return {
      districlub_type_id: districtId,
      user_id: userId,
      user_name: identity?.user_name ?? displayName({}),
      email: identity?.email ?? null,
      can_authorize: canAuthorize,
      ...(roleMissing ? { role_missing: true } : {}),
      ...(accountInactive ? { account_inactive: true } : {}),
    };
  }

  private assertQuotaReader(authorization: AuthorizationSnapshot): void {
    const roles = roleSet(authorization);
    const allowed =
      roles.has('super-admin') ||
      roles.has('director-union') ||
      roles.has('assistant-union') ||
      roles.has('director-lf') ||
      roles.has('assistant-lf');
    if (!allowed) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }

  private isSuperAdmin(authorization: AuthorizationSnapshot): boolean {
    return roleSet(authorization).has('super-admin');
  }

  private access(
    authorization: AuthorizationSnapshot,
    mode: 'read' | 'assign',
  ): AssignerAccess | null {
    const roles = roleSet(authorization);
    const global = authorization.effective?.scope?.global;
    const unionId = toTerritoryId(global?.union?.id);
    const localFieldId = toTerritoryId(global?.local_field?.id);
    if (mode === 'read' && roles.has('super-admin')) {
      return { kind: 'super-admin' };
    }
    if (roles.has('director-union') || roles.has('assistant-union')) {
      if (!unionId) {
        throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
      }
      return { kind: 'union', unionId };
    }
    if (roles.has('director-lf') || roles.has('assistant-lf')) {
      if (!localFieldId) {
        throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
      }
      return { kind: 'field', localFieldId };
    }
    return null;
  }
}

/**
 * Prisma no escapa `%`, `_` ni `\` en `contains`: sin esto, `%%%` listaría a
 * todos. PostgreSQL usa la barra invertida como escape por omisión en ILIKE.
 */
function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function roleSet(
  authorization: AuthorizationSnapshot | undefined,
): Set<string> {
  return new Set(
    (authorization?.grants?.global_roles ?? []).map((grant) =>
      grant.role_name.trim().toLowerCase(),
    ),
  );
}
