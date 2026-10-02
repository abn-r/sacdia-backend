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

const DEFAULT_SLOTS = 2;
const QUOTA_ID = 1;

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
  can_authorize: boolean;
};

export type DistrictPastorList = {
  districlub_type_id: number;
  slots: number;
  can_assign: boolean;
  pastors: DistrictPastorView[];
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
      return this.pastorView(districtId, userId, true);
    });
  }

  async remove(
    authorization: AuthorizationSnapshot,
    districtId: number,
    userId: string,
  ): Promise<DistrictPastorView> {
    await this.loadDistrict(authorization, districtId, 'assign');
    return this.prisma.$transaction(async (tx) => {
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
      return this.pastorView(districtId, userId, false);
    });
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
      authorizers: await this.activePastors(
        this.prisma,
        church.districlub_type_id,
      ),
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
    const role = await store.users_roles.findFirst({
      where: {
        user_id: userId,
        active: true,
        roles: {
          role_name: { equals: 'pastor', mode: 'insensitive' },
          active: true,
          role_category: 'GLOBAL',
        },
      },
      select: { user_role_id: true },
    });
    if (!role) {
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
    return rows.map((row) => this.pastorView(districtId, row.user_id, true));
  }

  private pastorView(
    districtId: number,
    userId: string,
    canAuthorize: boolean,
  ): DistrictPastorView {
    return {
      districlub_type_id: districtId,
      user_id: userId,
      can_authorize: canAuthorize,
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

function roleSet(
  authorization: AuthorizationSnapshot | undefined,
): Set<string> {
  return new Set(
    (authorization?.grants?.global_roles ?? []).map((grant) =>
      grant.role_name.trim().toLowerCase(),
    ),
  );
}
