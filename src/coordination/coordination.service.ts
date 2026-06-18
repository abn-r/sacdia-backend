import { Injectable } from '@nestjs/common';
import { Prisma, coordinator_assignment_type } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCoordinationZoneDto,
  CreateCoordinatorAssignmentDto,
  UpdateCoordinationZoneDto,
  UpdateCoordinatorAssignmentDto,
} from './dto';

const COORDINATOR_ROLE_NAMES = [
  'coordinator',
  'zone-coordinator',
  'general-coordinator',
];

const DIRECTOR_ROLE_NAME = 'director';

type SectionScopeRow = {
  club_section_id: number;
  name: string | null;
  club_type_id: number;
  club_type_name: string | null;
  club_id: number | null;
  club_name: string | null;
  district_id: number | null;
  district_name: string | null;
  local_field_id: number | null;
  local_field_name: string | null;
};

@Injectable()
export class CoordinationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly hierarchy: InstitutionalHierarchyService,
  ) {}

  async listZones(actorUserId: string, localFieldId: number) {
    await this.ensureActorCanManageLocalField(actorUserId, localFieldId);

    return this.prisma.coordination_zones.findMany({
      where: { local_field_id: localFieldId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        districts: {
          orderBy: [{ active: 'desc' }, { created_at: 'asc' }],
          include: {
            districts: {
              select: {
                districlub_type_id: true,
                name: true,
                active: true,
                local_field_id: true,
              },
            },
          },
        },
      },
    });
  }

  async createZone(
    actorUserId: string,
    localFieldId: number,
    dto: CreateCoordinationZoneDto,
  ) {
    await this.ensureActorCanManageLocalField(actorUserId, localFieldId);
    await this.assertLocalFieldExists(localFieldId);

    try {
      return await this.prisma.coordination_zones.create({
        data: {
          local_field_id: localFieldId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          active: dto.active ?? true,
        },
      });
    } catch (error) {
      this.rethrowPrismaConflict(error);
      throw error;
    }
  }

  async updateZone(
    actorUserId: string,
    zoneId: number,
    dto: UpdateCoordinationZoneDto,
  ) {
    const zone = await this.getZoneOrThrow(zoneId);
    await this.ensureActorCanManageLocalField(actorUserId, zone.local_field_id);

    try {
      return await this.prisma.coordination_zones.update({
        where: { zone_id: zoneId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
    } catch (error) {
      this.rethrowPrismaConflict(error);
      throw error;
    }
  }

  async assignDistrictToZone(
    actorUserId: string,
    zoneId: number,
    districtId: number,
  ) {
    const zone = await this.getZoneOrThrow(zoneId);
    await this.ensureActorCanManageLocalField(actorUserId, zone.local_field_id);

    const district = await this.prisma.districts.findUnique({
      where: { districlub_type_id: districtId },
      select: { districlub_type_id: true, local_field_id: true },
    });

    if (!district) {
      throw new AppNotFoundException(ErrorCode.ADMIN_DISTRICT_NOT_FOUND);
    }

    if (district.local_field_id !== zone.local_field_id) {
      throw new AppBadRequestException(ErrorCode.RECORD_CONFLICT, {
        reason: 'district_local_field_mismatch',
      });
    }

    const activeMembership =
      await this.prisma.coordination_zone_districts.findFirst({
        where: {
          districlub_type_id: districtId,
          active: true,
          zone_id: { not: zoneId },
        },
      });

    if (activeMembership) {
      throw new AppConflictException(ErrorCode.RECORD_CONFLICT, {
        reason: 'district_already_in_active_zone',
      });
    }

    const existing = await this.prisma.coordination_zone_districts.findFirst({
      where: { zone_id: zoneId, districlub_type_id: districtId },
    });

    if (existing) {
      return this.prisma.coordination_zone_districts.update({
        where: { zone_district_id: existing.zone_district_id },
        data: { active: true },
      });
    }

    return this.prisma.coordination_zone_districts.create({
      data: {
        zone_id: zoneId,
        districlub_type_id: districtId,
        active: true,
      },
    });
  }

  async removeDistrictFromZone(
    actorUserId: string,
    zoneId: number,
    districtId: number,
  ) {
    const zone = await this.getZoneOrThrow(zoneId);
    await this.ensureActorCanManageLocalField(actorUserId, zone.local_field_id);

    const membership = await this.prisma.coordination_zone_districts.findFirst({
      where: { zone_id: zoneId, districlub_type_id: districtId, active: true },
    });

    if (!membership) {
      throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
    }

    return this.prisma.coordination_zone_districts.update({
      where: { zone_district_id: membership.zone_district_id },
      data: { active: false },
    });
  }

  async listAssignments(
    actorUserId: string,
    localFieldId: number,
    active?: boolean,
  ) {
    await this.ensureActorCanManageLocalField(actorUserId, localFieldId);

    return this.prisma.coordinator_assignments.findMany({
      where: {
        local_field_id: localFieldId,
        ...(active === undefined ? {} : { active }),
      },
      orderBy: [{ active: 'desc' }, { created_at: 'desc' }],
      include: {
        users: {
          select: {
            user_id: true,
            email: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
        coordination_zones: {
          select: { zone_id: true, name: true, active: true },
        },
        club_types: {
          select: { club_type_id: true, name: true, active: true },
        },
        club_sections: {
          select: {
            club_section_id: true,
            name: true,
            active: true,
            club_type_id: true,
            clubs: { select: { club_id: true, name: true } },
            club_types: { select: { club_type_id: true, name: true } },
          },
        },
      },
    });
  }

  async createAssignment(
    actorUserId: string,
    localFieldId: number,
    dto: CreateCoordinatorAssignmentDto,
  ) {
    await this.ensureActorCanManageLocalField(actorUserId, localFieldId);
    await this.assertLocalFieldExists(localFieldId);
    this.assertAssignmentShape(dto);
    this.assertValidDateRange(dto.start_date, dto.end_date);
    await this.assertUserCanReceiveCoordinatorAssignment(dto.user_id);
    await this.assertAssignmentReferencesMatchLocalField(localFieldId, dto);

    const sectionIds = await this.resolveSectionIdsForAssignmentInput(
      localFieldId,
      dto.assignment_type,
      dto.zone_id,
      dto.club_type_id,
      dto.club_section_id,
    );
    await this.assertNoDirectorConflict(dto.user_id, sectionIds);

    try {
      return await this.prisma.coordinator_assignments.create({
        data: {
          user_id: dto.user_id,
          local_field_id: localFieldId,
          assignment_type: dto.assignment_type,
          zone_id: dto.zone_id ?? null,
          club_type_id: dto.club_type_id ?? null,
          club_section_id: dto.club_section_id ?? null,
          active: dto.active ?? true,
          start_date: dto.start_date ? new Date(dto.start_date) : undefined,
          end_date: dto.end_date ? new Date(dto.end_date) : null,
          created_by: actorUserId,
        },
      });
    } catch (error) {
      this.rethrowPrismaConflict(error);
      throw error;
    }
  }

  async updateAssignment(
    actorUserId: string,
    assignmentId: string,
    dto: UpdateCoordinatorAssignmentDto,
  ) {
    const current = await this.prisma.coordinator_assignments.findUnique({
      where: { assignment_id: assignmentId },
    });

    if (!current) {
      throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
    }

    await this.ensureActorCanManageLocalField(
      actorUserId,
      current.local_field_id,
    );

    const next = {
      user_id: dto.user_id ?? current.user_id,
      assignment_type: dto.assignment_type ?? current.assignment_type,
      zone_id: dto.zone_id ?? current.zone_id ?? undefined,
      club_type_id: dto.club_type_id ?? current.club_type_id ?? undefined,
      club_section_id:
        dto.club_section_id ?? current.club_section_id ?? undefined,
      start_date:
        dto.start_date ?? current.start_date?.toISOString().slice(0, 10),
      end_date: dto.end_date ?? current.end_date?.toISOString().slice(0, 10),
    } satisfies CreateCoordinatorAssignmentDto;

    this.assertAssignmentShape(next);
    this.assertValidDateRange(next.start_date, next.end_date);
    await this.assertUserCanReceiveCoordinatorAssignment(next.user_id);
    await this.assertAssignmentReferencesMatchLocalField(
      current.local_field_id,
      next,
    );

    if (dto.active === true || current.active) {
      const sectionIds = await this.resolveSectionIdsForAssignmentInput(
        current.local_field_id,
        next.assignment_type,
        next.zone_id,
        next.club_type_id,
        next.club_section_id,
      );
      await this.assertNoDirectorConflict(next.user_id, sectionIds);
    }

    try {
      return await this.prisma.coordinator_assignments.update({
        where: { assignment_id: assignmentId },
        data: {
          ...(dto.user_id !== undefined ? { user_id: dto.user_id } : {}),
          ...(dto.assignment_type !== undefined
            ? { assignment_type: dto.assignment_type }
            : {}),
          ...(dto.zone_id !== undefined ? { zone_id: dto.zone_id } : {}),
          ...(dto.club_type_id !== undefined
            ? { club_type_id: dto.club_type_id }
            : {}),
          ...(dto.club_section_id !== undefined
            ? { club_section_id: dto.club_section_id }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.start_date !== undefined
            ? { start_date: new Date(dto.start_date) }
            : {}),
          ...(dto.end_date !== undefined
            ? { end_date: dto.end_date ? new Date(dto.end_date) : null }
            : {}),
        },
      });
    } catch (error) {
      this.rethrowPrismaConflict(error);
      throw error;
    }
  }

  async resolveCoordinatorScope(userId: string) {
    const assignments = await this.prisma.coordinator_assignments.findMany({
      where: {
        user_id: userId,
        ...this.activeAssignmentWindowWhere(),
      },
      orderBy: [{ assignment_type: 'asc' }, { created_at: 'asc' }],
    });

    const sectionIds = new Set<number>();

    for (const assignment of assignments) {
      const ids = await this.resolveSectionIdsForAssignmentInput(
        assignment.local_field_id,
        assignment.assignment_type,
        assignment.zone_id ?? undefined,
        assignment.club_type_id ?? undefined,
        assignment.club_section_id ?? undefined,
      );
      ids.forEach((id) => sectionIds.add(id));
    }

    const sections = await this.findSectionScopeRows([...sectionIds]);

    return {
      is_coordinator: assignments.length > 0 && sections.length > 0,
      club_section_ids: sections.map((section) => section.club_section_id),
      assignments: assignments.map((assignment) => ({
        assignment_id: assignment.assignment_id,
        assignment_type: assignment.assignment_type,
        local_field_id: assignment.local_field_id,
        zone_id: assignment.zone_id,
        club_type_id: assignment.club_type_id,
        club_section_id: assignment.club_section_id,
      })),
      sections,
    };
  }

  async getEffectiveCoordinatorSectionIds(userId: string): Promise<number[]> {
    const scope = await this.resolveCoordinatorScope(userId);
    return scope.club_section_ids;
  }

  private async ensureActorCanManageLocalField(
    actorUserId: string,
    localFieldId: number,
  ): Promise<void> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorUserId);
    const scope = await this.hierarchy.resolveCurrent({ localFieldId });

    if (
      !this.authorizationContext.canAccessHierarchyScope(
        resolved,
        scope,
        'current-write',
      )
    ) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }

  private async assertLocalFieldExists(localFieldId: number): Promise<void> {
    const exists = await this.prisma.local_fields.findUnique({
      where: { local_field_id: localFieldId },
      select: { local_field_id: true },
    });

    if (!exists) {
      throw new AppNotFoundException(ErrorCode.ADMIN_LOCAL_FIELD_NOT_FOUND);
    }
  }

  private async getZoneOrThrow(zoneId: number) {
    const zone = await this.prisma.coordination_zones.findUnique({
      where: { zone_id: zoneId },
    });

    if (!zone) {
      throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
    }

    return zone;
  }

  private assertAssignmentShape(dto: {
    assignment_type: coordinator_assignment_type;
    zone_id?: number | null;
    club_type_id?: number | null;
    club_section_id?: number | null;
  }): void {
    const hasZone = dto.zone_id !== undefined && dto.zone_id !== null;
    const hasClubType =
      dto.club_type_id !== undefined && dto.club_type_id !== null;
    const hasClubSection =
      dto.club_section_id !== undefined && dto.club_section_id !== null;

    if (
      dto.assignment_type === coordinator_assignment_type.GENERAL &&
      !hasZone &&
      !hasClubType &&
      !hasClubSection
    ) {
      return;
    }

    if (
      dto.assignment_type === coordinator_assignment_type.ZONE &&
      hasZone &&
      hasClubType &&
      !hasClubSection
    ) {
      return;
    }

    if (
      dto.assignment_type === coordinator_assignment_type.SECTION &&
      !hasZone &&
      !hasClubType &&
      hasClubSection
    ) {
      return;
    }

    throw new AppBadRequestException(ErrorCode.RECORD_CONFLICT, {
      reason: 'invalid_coordinator_assignment_shape',
    });
  }

  private assertValidDateRange(startDate?: string, endDate?: string): void {
    if (!startDate || !endDate) return;

    if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
      throw new AppBadRequestException(ErrorCode.RECORD_CONFLICT, {
        reason: 'invalid_date_range',
      });
    }
  }

  private async assertUserCanReceiveCoordinatorAssignment(
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        users_roles: {
          where: {
            active: true,
            roles: {
              active: true,
              role_name: { in: COORDINATOR_ROLE_NAMES },
            },
          },
          select: { role_id: true },
        },
      },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.RBAC_USER_NOT_FOUND);
    }

    if (user.users_roles.length === 0) {
      throw new AppBadRequestException(ErrorCode.RECORD_CONFLICT, {
        reason: 'user_missing_coordinator_role',
      });
    }
  }

  private async assertAssignmentReferencesMatchLocalField(
    localFieldId: number,
    dto: {
      assignment_type: coordinator_assignment_type;
      zone_id?: number | null;
      club_type_id?: number | null;
      club_section_id?: number | null;
    },
  ): Promise<void> {
    if (dto.assignment_type === coordinator_assignment_type.GENERAL) return;

    if (dto.assignment_type === coordinator_assignment_type.ZONE) {
      const zone = await this.prisma.coordination_zones.findUnique({
        where: { zone_id: dto.zone_id ?? 0 },
        select: { local_field_id: true },
      });

      if (!zone) {
        throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
      }

      if (zone.local_field_id !== localFieldId) {
        throw new AppBadRequestException(ErrorCode.RECORD_CONFLICT, {
          reason: 'zone_local_field_mismatch',
        });
      }

      const clubType = await this.prisma.club_types.findUnique({
        where: { club_type_id: dto.club_type_id ?? 0 },
        select: { club_type_id: true },
      });

      if (!clubType) {
        throw new AppNotFoundException(ErrorCode.ADMIN_CLUB_TYPE_NOT_FOUND);
      }

      return;
    }

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: dto.club_section_id ?? 0 },
      select: {
        club_section_id: true,
        clubs: { select: { local_field_id: true } },
      },
    });

    if (!section) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    if (section.clubs?.local_field_id !== localFieldId) {
      throw new AppBadRequestException(ErrorCode.RECORD_CONFLICT, {
        reason: 'section_local_field_mismatch',
      });
    }
  }

  private async resolveSectionIdsForAssignmentInput(
    localFieldId: number,
    assignmentType: coordinator_assignment_type,
    zoneId?: number | null,
    clubTypeId?: number | null,
    clubSectionId?: number | null,
  ): Promise<number[]> {
    if (assignmentType === coordinator_assignment_type.SECTION) {
      return clubSectionId ? [clubSectionId] : [];
    }

    if (assignmentType === coordinator_assignment_type.GENERAL) {
      const sections = await this.prisma.club_sections.findMany({
        where: {
          active: true,
          clubs: { is: { active: true, local_field_id: localFieldId } },
        },
        select: { club_section_id: true },
      });
      return sections.map((section) => section.club_section_id);
    }

    if (!zoneId || !clubTypeId) return [];

    const zoneDistricts =
      await this.prisma.coordination_zone_districts.findMany({
        where: { zone_id: zoneId, active: true },
        select: { districlub_type_id: true },
      });

    const districtIds = zoneDistricts.map(
      (membership) => membership.districlub_type_id,
    );

    if (districtIds.length === 0) return [];

    const sections = await this.prisma.club_sections.findMany({
      where: {
        active: true,
        club_type_id: clubTypeId,
        clubs: {
          is: {
            active: true,
            local_field_id: localFieldId,
            districlub_type_id: { in: districtIds },
          },
        },
      },
      select: { club_section_id: true },
    });

    return sections.map((section) => section.club_section_id);
  }

  private async assertNoDirectorConflict(
    userId: string,
    clubSectionIds: number[],
  ): Promise<void> {
    if (clubSectionIds.length === 0) return;

    const activeDirectorAssignment =
      await this.prisma.club_role_assignments.findFirst({
        where: {
          user_id: userId,
          active: true,
          status: 'active',
          club_section_id: { in: clubSectionIds },
          start_date: { lte: this.today() },
          OR: [{ end_date: null }, { end_date: { gte: this.today() } }],
          roles: {
            role_name: DIRECTOR_ROLE_NAME,
            active: true,
          },
        },
        select: { club_section_id: true },
      });

    if (activeDirectorAssignment) {
      throw new AppConflictException(ErrorCode.RECORD_CONFLICT, {
        reason: 'director_coordinator_same_section_conflict',
        club_section_id: activeDirectorAssignment.club_section_id,
      });
    }
  }

  private async findSectionScopeRows(
    clubSectionIds: number[],
  ): Promise<SectionScopeRow[]> {
    if (clubSectionIds.length === 0) return [];

    const sections = await this.prisma.club_sections.findMany({
      where: { club_section_id: { in: clubSectionIds }, active: true },
      orderBy: [{ main_club_id: 'asc' }, { club_type_id: 'asc' }],
      select: {
        club_section_id: true,
        name: true,
        club_type_id: true,
        club_types: { select: { name: true } },
        clubs: {
          select: {
            club_id: true,
            name: true,
            districlub_type_id: true,
            local_field_id: true,
            districts: { select: { name: true } },
            local_fields: { select: { name: true } },
          },
        },
      },
    });

    return sections.map((section) => ({
      club_section_id: section.club_section_id,
      name: section.name,
      club_type_id: section.club_type_id,
      club_type_name: section.club_types?.name ?? null,
      club_id: section.clubs?.club_id ?? null,
      club_name: section.clubs?.name ?? null,
      district_id: section.clubs?.districlub_type_id ?? null,
      district_name: section.clubs?.districts?.name ?? null,
      local_field_id: section.clubs?.local_field_id ?? null,
      local_field_name: section.clubs?.local_fields?.name ?? null,
    }));
  }

  private activeAssignmentWindowWhere(): Prisma.coordinator_assignmentsWhereInput {
    const today = this.today();

    return {
      active: true,
      start_date: { lte: today },
      OR: [{ end_date: null }, { end_date: { gte: today } }],
    };
  }

  private today(): Date {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today;
  }

  private rethrowPrismaConflict(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppConflictException(ErrorCode.RECORD_CONFLICT);
    }
  }
}
