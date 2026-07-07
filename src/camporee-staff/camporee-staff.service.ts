import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../common/services/authorization-context.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddCamporeeStaffMemberDto,
  CamporeeScopeType,
  CamporeeStaffCandidateResponseDto,
  CamporeeStaffCategory,
  CamporeeStaffMemberResponseDto,
  UpdateCamporeeStaffMemberDto,
} from './dto';

type CamporeeScope = { type: CamporeeScopeType; camporeeId: number };
type PrismaLike = Record<string, any>;

type ResolvedCamporeeScope =
  | { type: 'local'; camporeeId: number; localFieldId: number }
  | { type: 'union'; camporeeId: number; unionId: number };

const STAFF_CANDIDATE_LIMIT = 300;

@Injectable()
export class CamporeeStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  private db(tx?: PrismaLike): PrismaLike {
    return tx ?? this.prisma;
  }

  private fullName(user: any): string {
    return [user?.name, user?.paternal_last_name, user?.maternal_last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  private mapUser(user: any) {
    if (!user) return null;
    return {
      user_id: user.user_id,
      email: user.email ?? null,
      name: user.name ?? null,
      paternal_last_name: user.paternal_last_name ?? null,
      maternal_last_name: user.maternal_last_name ?? null,
      full_name: this.fullName(user),
      user_image: user.user_image ?? null,
      active: user.active,
      access_app: user.access_app ?? false,
      access_panel: user.access_panel ?? false,
      union: user.unions
        ? { union_id: user.unions.union_id, name: user.unions.name }
        : null,
      local_field: user.local_fields
        ? {
            local_field_id: user.local_fields.local_field_id,
            union_id: user.local_fields.union_id ?? null,
            name: user.local_fields.name,
          }
        : null,
    };
  }

  private mapStaff(row: any): CamporeeStaffMemberResponseDto {
    return {
      camporee_staff_member_id: row.camporee_staff_member_id,
      local_camporee_id: row.local_camporee_id ?? null,
      union_camporee_id: row.union_camporee_id ?? null,
      user_id: row.user_id,
      category: row.category as CamporeeStaffCategory,
      role_label: row.role_label ?? null,
      notes: row.notes ?? null,
      status: row.status,
      active: row.active,
      user: this.mapUser(row.user),
    };
  }

  private userInclude() {
    return {
      user: {
        select: {
          user_id: true,
          email: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
          user_image: true,
          active: true,
          access_app: true,
          access_panel: true,
          unions: { select: { union_id: true, name: true } },
          local_fields: {
            select: { local_field_id: true, union_id: true, name: true },
          },
        },
      },
    };
  }

  async resolveCamporeeScope(
    scope: CamporeeScope,
    tx?: PrismaLike,
  ): Promise<ResolvedCamporeeScope> {
    if (scope.type === 'local') {
      const camporee = await this.db(tx).local_camporees.findUnique({
        where: { local_camporee_id: scope.camporeeId },
        select: { local_camporee_id: true, local_field_id: true },
      });
      if (!camporee) {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_NOT_FOUND, {
          id: scope.camporeeId,
        });
      }
      return {
        type: 'local',
        camporeeId: scope.camporeeId,
        localFieldId: camporee.local_field_id,
      };
    }

    const camporee = await this.db(tx).union_camporees.findUnique({
      where: { union_camporee_id: scope.camporeeId },
      select: { union_camporee_id: true, union_id: true },
    });
    if (!camporee) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND,
        {
          id: scope.camporeeId,
        },
      );
    }
    return {
      type: 'union',
      camporeeId: scope.camporeeId,
      unionId: camporee.union_id,
    };
  }

  private staffWhere(scope: CamporeeScope, extra?: Record<string, unknown>) {
    return {
      ...(scope.type === 'local'
        ? { local_camporee_id: scope.camporeeId }
        : { union_camporee_id: scope.camporeeId }),
      ...(extra ?? {}),
    };
  }

  private userScopeWhere(scope: ResolvedCamporeeScope) {
    if (scope.type === 'local') {
      return { local_field_id: scope.localFieldId };
    }

    return {
      OR: [
        { union_id: scope.unionId },
        { local_fields: { union_id: scope.unionId } },
      ],
    };
  }

  private hasPermission(
    resolved: ResolvedAuthorizationProfile,
    permission: string,
  ): boolean {
    return resolved.authorization.effective.permissions.includes(permission);
  }

  private async canManageResolvedScope(
    resolvedScope: ResolvedCamporeeScope,
    actorUserId: string,
  ): Promise<boolean> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorUserId);
    if (!this.hasPermission(resolved, 'camporee_events:update')) {
      return false;
    }

    if (resolvedScope.type === 'local') {
      return this.authorizationContext.canAccessHierarchyScope(
        resolved,
        { local_field_id: resolvedScope.localFieldId },
        'current-write',
      );
    }

    return this.authorizationContext.canAccessHierarchyScope(
      resolved,
      { union_id: resolvedScope.unionId },
      'current-write',
    );
  }

  private async assertCanManageStaffMember(
    staffMember: any,
    actorUserId: string,
  ): Promise<void> {
    const resolvedScope = staffMember.local_camporee_id
      ? await this.resolveCamporeeScope({
          type: 'local',
          camporeeId: staffMember.local_camporee_id,
        })
      : await this.resolveCamporeeScope({
          type: 'union',
          camporeeId: staffMember.union_camporee_id,
        });

    if (!(await this.canManageResolvedScope(resolvedScope, actorUserId))) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_EVENT_ACCESS_DENIED);
    }
  }

  async listStaff(
    scope: CamporeeScope,
  ): Promise<CamporeeStaffMemberResponseDto[]> {
    await this.resolveCamporeeScope(scope);
    const rows = await this.db().camporee_staff_members.findMany({
      where: this.staffWhere(scope, { active: true }),
      include: this.userInclude(),
      orderBy: [
        { category: 'asc' },
        { role_label: 'asc' },
        { created_at: 'asc' },
      ],
    });

    return rows.map((row: any) => this.mapStaff(row));
  }

  async listStaffCandidates(
    scope: CamporeeScope,
  ): Promise<CamporeeStaffCandidateResponseDto[]> {
    const resolvedScope = await this.resolveCamporeeScope(scope);
    const existingRows = await this.db().camporee_staff_members.findMany({
      where: this.staffWhere(scope, { active: true }),
      select: { camporee_staff_member_id: true, user_id: true },
    });
    const existingByUserId = new Map(
      existingRows.map((row: any) => [
        row.user_id,
        row.camporee_staff_member_id,
      ]),
    );

    const users = await this.db().users.findMany({
      where: {
        active: true,
        ...this.userScopeWhere(resolvedScope),
      },
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        user_image: true,
        active: true,
        access_app: true,
        access_panel: true,
        unions: { select: { union_id: true, name: true } },
        local_fields: {
          select: { local_field_id: true, union_id: true, name: true },
        },
      },
      orderBy: [
        { name: 'asc' },
        { paternal_last_name: 'asc' },
        { email: 'asc' },
      ],
      take: STAFF_CANDIDATE_LIMIT,
    });

    return users.map((user: any) => ({
      ...this.mapUser(user)!,
      already_staff_member_id: existingByUserId.get(user.user_id) ?? null,
    }));
  }

  async addStaffMember(
    scope: CamporeeScope,
    dto: AddCamporeeStaffMemberDto,
    actorUserId: string,
  ): Promise<CamporeeStaffMemberResponseDto> {
    const resolvedScope = await this.resolveCamporeeScope(scope);
    const user = await this.db().users.findFirst({
      where: {
        user_id: dto.user_id,
        active: true,
        ...this.userScopeWhere(resolvedScope),
      },
      select: { user_id: true },
    });
    if (!user) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_USER_NOT_FOUND);
    }

    const existing = await this.db().camporee_staff_members.findFirst({
      where: this.staffWhere(scope, { user_id: dto.user_id, active: true }),
      include: this.userInclude(),
    });
    if (existing) {
      throw new AppConflictException(ErrorCode.CAMPOREE_STAFF_DUPLICATE);
    }

    const created = await this.db().camporee_staff_members.create({
      data: {
        ...(scope.type === 'local'
          ? { local_camporee_id: scope.camporeeId }
          : { union_camporee_id: scope.camporeeId }),
        user_id: dto.user_id,
        category: dto.category,
        role_label: dto.role_label ?? null,
        notes: dto.notes ?? null,
        created_by: actorUserId,
        modified_by: actorUserId,
      },
      include: this.userInclude(),
    });

    return this.mapStaff(created);
  }

  async ensureJudgeStaffMember(
    scope: CamporeeScope,
    userId: string,
    actorUserId: string,
    tx?: PrismaLike,
  ): Promise<string> {
    const db = this.db(tx);
    await this.resolveCamporeeScope(scope, tx);
    const existing = await db.camporee_staff_members.findFirst({
      where: this.staffWhere(scope, { user_id: userId, active: true }),
      select: { camporee_staff_member_id: true, category: true },
    });

    if (existing) {
      if (existing.category !== 'judge') {
        await db.camporee_staff_members.update({
          where: {
            camporee_staff_member_id: existing.camporee_staff_member_id,
          },
          data: {
            category: 'judge',
            modified_by: actorUserId,
            modified_at: new Date(),
          },
        });
      }
      return existing.camporee_staff_member_id;
    }

    const created = await db.camporee_staff_members.create({
      data: {
        ...(scope.type === 'local'
          ? { local_camporee_id: scope.camporeeId }
          : { union_camporee_id: scope.camporeeId }),
        user_id: userId,
        category: 'judge',
        role_label: 'Juez',
        created_by: actorUserId,
        modified_by: actorUserId,
      },
      select: { camporee_staff_member_id: true },
    });
    return created.camporee_staff_member_id;
  }

  async updateStaffMember(
    staffMemberId: string,
    dto: UpdateCamporeeStaffMemberDto,
    actorUserId: string,
  ): Promise<CamporeeStaffMemberResponseDto> {
    const existing = await this.db().camporee_staff_members.findUnique({
      where: { camporee_staff_member_id: staffMemberId },
    });
    if (!existing) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_STAFF_MEMBER_NOT_FOUND,
        {
          id: staffMemberId,
        },
      );
    }
    await this.assertCanManageStaffMember(existing, actorUserId);

    const updated = await this.db().camporee_staff_members.update({
      where: { camporee_staff_member_id: staffMemberId },
      data: {
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.role_label !== undefined ? { role_label: dto.role_label } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        modified_by: actorUserId,
        modified_at: new Date(),
      },
      include: this.userInclude(),
    });

    return this.mapStaff(updated);
  }

  async deactivateStaffMember(
    staffMemberId: string,
    actorUserId: string,
  ): Promise<CamporeeStaffMemberResponseDto> {
    return this.updateStaffMember(
      staffMemberId,
      { active: false, status: 'inactive' },
      actorUserId,
    );
  }

  async assertStaffBelongsToEventCamporee(
    event: {
      local_camporee_id?: number | null;
      union_camporee_id?: number | null;
    },
    staffMemberId: string,
  ): Promise<any> {
    const staff = await this.db().camporee_staff_members.findFirst({
      where: {
        camporee_staff_member_id: staffMemberId,
        active: true,
        status: 'active',
        ...(event.local_camporee_id
          ? { local_camporee_id: event.local_camporee_id }
          : { union_camporee_id: event.union_camporee_id }),
      },
      include: this.userInclude(),
    });

    if (!staff) {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_STAFF_SCOPE_MISMATCH);
    }

    return staff;
  }
}
