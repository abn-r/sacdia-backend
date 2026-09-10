import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  DirectorDesignationDto,
  ReplaceDirectorPlanDto,
} from './dto/role-assignment.dto';

const ALLOWED_DESIGNATION_ROLES = [
  'super-admin',
  'admin',
  'director-lf',
  'assistant-lf',
] as const;

const OPEN_PLAN_STATUSES = ['scheduled', 'activated', 'blocked'] as const;

export type DirectorPlanView = {
  succession_id: string;
  user_id: string;
  ecclesiastical_year_id: number;
  effective_date: Date;
  status: string;
  version: number;
  outgoing_assignment_id: string | null;
};

export type UnreconciledDesignatedRow = {
  assignment_id: string;
  user_id: string;
  club_section_id: number | null;
  ecclesiastical_year_id: number;
  reason: string;
};

export function hashDirectorDesignationRequest(input: {
  clubId: number;
  sectionId: number;
  userId: string;
  ecclesiasticalYearId: number;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        club_id: input.clubId,
        club_section_id: input.sectionId,
        user_id: input.userId.toLowerCase(),
        ecclesiastical_year_id: input.ecclesiasticalYearId,
      }),
    )
    .digest('hex');
}

type SectionScope = {
  clubId: number;
  localFieldId: number;
};

type PlanRow = {
  succession_id: string;
  successor_user_id: string;
  target_ecclesiastical_year_id: number;
  effective_date: Date;
  status: string;
  version: number;
  outgoing_assignment_id: string | null;
  request_hash?: string;
};

@Injectable()
export class DirectorDesignationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly ecclesiasticalYear: EcclesiasticalYearService,
  ) {}

  async designate(
    clubId: number,
    sectionId: number,
    dto: DirectorDesignationDto,
    actorUserId: string,
    idempotencyKey: string | undefined,
  ): Promise<DirectorPlanView> {
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey) {
      throw new AppBadRequestException(
        ErrorCode.CLUB_DIRECTOR_PLAN_IDEMPOTENCY_REQUIRED,
      );
    }

    const scope = await this.assertCanDesignateDirector(
      actorUserId,
      clubId,
      sectionId,
    );
    const requestedYear = await this.requireFutureYear(dto.ecclesiastical_year_id);
    const schedulerRole = await this.resolveSchedulerRole(actorUserId);
    const directorRoleId = await this.resolveDirectorRoleId();
    const requestHash = hashDirectorDesignationRequest({
      clubId,
      sectionId,
      userId: dto.user_id,
      ecclesiasticalYearId: dto.ecclesiastical_year_id,
    });
    const currentYear = await this.ecclesiasticalYear.getCurrentYear();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.director_succession_plans.findUnique({
          where: {
            scheduled_by_id_idempotency_key: {
              scheduled_by_id: actorUserId,
              idempotency_key: normalizedKey,
            },
          },
        });

        if (replay) {
          if (replay.request_hash !== requestHash) {
            throw new AppConflictException(ErrorCode.IDEMPOTENCY_KEY_REUSED);
          }
          return this.mapPlan(replay);
        }

        const existingOpen = await tx.director_succession_plans.findFirst({
          where: {
            club_section_id: sectionId,
            target_ecclesiastical_year_id: dto.ecclesiastical_year_id,
            status: { in: [...OPEN_PLAN_STATUSES] },
          },
        });

        if (existingOpen) {
          throw new AppConflictException(ErrorCode.CLUB_DIRECTOR_PLAN_CONFLICT);
        }

        const outgoing = await tx.club_role_assignments.findFirst({
          where: {
            club_section_id: sectionId,
            role_id: directorRoleId,
            ecclesiastical_year_id: currentYear.year_id,
            active: true,
            status: 'active',
          },
          select: { assignment_id: true },
        });

        const created = await tx.director_succession_plans.create({
          data: {
            club_section_id: sectionId,
            successor_user_id: dto.user_id,
            target_ecclesiastical_year_id: dto.ecclesiastical_year_id,
            effective_date: requestedYear.start_date,
            status: 'scheduled',
            outgoing_assignment_id: outgoing?.assignment_id ?? null,
            scheduled_by_id: actorUserId,
            scheduled_by_role: schedulerRole,
            scheduled_local_field_id: scope.localFieldId,
            idempotency_key: normalizedKey,
            request_hash: requestHash,
          },
        });

        return this.mapPlan(created);
      });
    } catch (error) {
      if (this.isUniqueViolation(error, ['scheduled_by_id', 'idempotency_key'])) {
        const replay = await this.prisma.director_succession_plans.findUnique({
          where: {
            scheduled_by_id_idempotency_key: {
              scheduled_by_id: actorUserId,
              idempotency_key: normalizedKey,
            },
          },
        });
        if (replay && replay.request_hash === requestHash) {
          return this.mapPlan(replay);
        }
        throw new AppConflictException(ErrorCode.IDEMPOTENCY_KEY_REUSED);
      }
      if (
        this.isUniqueViolation(error, [
          'club_section_id',
          'target_ecclesiastical_year_id',
        ])
      ) {
        throw new AppConflictException(ErrorCode.CLUB_DIRECTOR_PLAN_CONFLICT);
      }
      throw error;
    }
  }

  async getDesignation(
    clubId: number,
    sectionId: number,
    yearId: number,
    actorUserId: string,
  ): Promise<DirectorPlanView | null> {
    await this.assertCanDesignateDirector(actorUserId, clubId, sectionId);

    const plan = await this.prisma.director_succession_plans.findFirst({
      where: {
        club_section_id: sectionId,
        target_ecclesiastical_year_id: yearId,
        status: { in: [...OPEN_PLAN_STATUSES] },
      },
    });

    return plan ? this.mapPlan(plan) : null;
  }

  async replacePlan(
    clubId: number,
    sectionId: number,
    dto: ReplaceDirectorPlanDto,
    actorUserId: string,
  ): Promise<DirectorPlanView> {
    await this.assertCanDesignateDirector(actorUserId, clubId, sectionId);

    const existing = await this.prisma.director_succession_plans.findFirst({
      where: {
        succession_id: dto.succession_id,
        club_section_id: sectionId,
        status: 'scheduled',
      },
    });

    if (!existing) {
      throw new AppNotFoundException(ErrorCode.CLUB_DIRECTOR_PLAN_NOT_FOUND);
    }

    if (existing.version !== dto.version) {
      throw new AppConflictException(
        ErrorCode.CLUB_DIRECTOR_PLAN_VERSION_CONFLICT,
      );
    }

    const updated = await this.prisma.director_succession_plans.update({
      where: { succession_id: dto.succession_id },
      data: {
        successor_user_id: dto.successor_user_id,
        version: existing.version + 1,
        modified_at: new Date(),
      },
    });

    return this.mapPlan(updated);
  }

  async cancelPlan(
    clubId: number,
    sectionId: number,
    successionId: string,
    version: number,
    actorUserId: string,
  ): Promise<DirectorPlanView> {
    await this.assertCanDesignateDirector(actorUserId, clubId, sectionId);

    const existing = await this.prisma.director_succession_plans.findFirst({
      where: {
        succession_id: successionId,
        club_section_id: sectionId,
        status: 'scheduled',
      },
    });

    if (!existing) {
      throw new AppNotFoundException(ErrorCode.CLUB_DIRECTOR_PLAN_NOT_FOUND);
    }

    if (existing.version !== version) {
      throw new AppConflictException(
        ErrorCode.CLUB_DIRECTOR_PLAN_VERSION_CONFLICT,
      );
    }

    const updated = await this.prisma.director_succession_plans.update({
      where: { succession_id: successionId },
      data: {
        status: 'cancelled',
        version: existing.version + 1,
        modified_at: new Date(),
      },
    });

    return this.mapPlan(updated);
  }

  async reportUnreconciledDesignated(): Promise<UnreconciledDesignatedRow[]> {
    const rows = await this.prisma.club_role_assignments.findMany({
      where: { status: 'designated' },
      select: {
        assignment_id: true,
        user_id: true,
        club_section_id: true,
        ecclesiastical_year_id: true,
      },
    });

    return rows.map((row) => ({
      assignment_id: row.assignment_id,
      user_id: row.user_id,
      club_section_id: row.club_section_id,
      ecclesiastical_year_id: row.ecclesiastical_year_id,
      reason:
        'CRA designated without verifiable scheduled_by_id; administrative regularization required',
    }));
  }

  private async assertCanDesignateDirector(
    actorUserId: string,
    clubId: number,
    sectionId: number,
  ): Promise<SectionScope> {
    const hasAllowedGlobalRole =
      await this.authorizationContext.hasAnyGlobalRole(
        actorUserId,
        [...ALLOWED_DESIGNATION_ROLES],
      );

    if (!hasAllowedGlobalRole) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: {
        main_club_id: true,
        clubs: { select: { club_id: true, local_field_id: true } },
      },
    });

    if (!section || section.main_club_id == null) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    if (section.main_club_id !== clubId) {
      throw new AppForbiddenException(ErrorCode.GUARD_ASSIGNMENT_SCOPE_INVALID);
    }

    const canManageClub = await this.authorizationContext.canManageClub(
      actorUserId,
      section.main_club_id,
    );

    if (!canManageClub) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    const localFieldId = section.clubs?.local_field_id;
    if (localFieldId == null) {
      throw new AppNotFoundException(ErrorCode.CLUB_NOT_FOUND);
    }

    return { clubId: section.main_club_id, localFieldId };
  }

  private async requireFutureYear(ecclesiasticalYearId: number): Promise<{
    year_id: number;
    start_date: Date;
    end_date: Date;
  }> {
    const requestedYear = await this.prisma.ecclesiastical_years.findFirst({
      where: { year_id: ecclesiasticalYearId },
      select: { year_id: true, start_date: true, end_date: true },
    });

    if (!requestedYear) {
      throw new AppBadRequestException(
        ErrorCode.CLUB_DIRECTOR_PLAN_YEAR_INVALID,
      );
    }

    const currentYear = await this.ecclesiasticalYear.getCurrentYear();

    if (requestedYear.start_date <= currentYear.end_date) {
      throw new AppBadRequestException(
        ErrorCode.CLUB_DIRECTOR_PLAN_YEAR_INVALID,
      );
    }

    return requestedYear;
  }

  private async resolveDirectorRoleId(): Promise<string> {
    const directorRole = await this.prisma.roles.findFirst({
      where: {
        role_name: 'director',
        role_category: 'CLUB',
        active: true,
      },
      select: { role_id: true },
    });

    if (!directorRole) {
      throw new AppNotFoundException(ErrorCode.CLUB_ROLE_NOT_FOUND);
    }

    return directorRole.role_id;
  }

  private async resolveSchedulerRole(actorUserId: string): Promise<string> {
    const profile =
      await this.authorizationContext.resolveUserAuthorization(actorUserId);
    const match = profile.authorization.grants.global_roles.find((role) =>
      (ALLOWED_DESIGNATION_ROLES as readonly string[]).includes(role.role_name),
    );

    if (!match) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    return match.role_name;
  }

  private mapPlan(plan: PlanRow): DirectorPlanView {
    return {
      succession_id: plan.succession_id,
      user_id: plan.successor_user_id,
      ecclesiastical_year_id: plan.target_ecclesiastical_year_id,
      effective_date: plan.effective_date,
      status: plan.status,
      version: plan.version,
      outgoing_assignment_id: plan.outgoing_assignment_id,
    };
  }

  private isUniqueViolation(error: unknown, fields: string[]): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) &&
      !(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'P2002'
      )
    ) {
      return false;
    }

    const target = this.uniqueViolationFields(error);
    return fields.every((field) => target.includes(field));
  }

  private uniqueViolationFields(error: unknown): string[] {
    const meta = (error as { meta?: Record<string, unknown> }).meta;
    if (!meta) {
      return [];
    }

    if (Array.isArray(meta.target)) {
      return meta.target.filter((item): item is string => typeof item === 'string');
    }
    if (typeof meta.target === 'string') {
      return [meta.target];
    }

    const directConstraint = meta.constraint as { fields?: unknown } | undefined;
    if (Array.isArray(directConstraint?.fields)) {
      return directConstraint.fields.filter(
        (item): item is string => typeof item === 'string',
      );
    }

    const adapter = meta.driverAdapterError as
      | {
          cause?: {
            constraint?: { fields?: unknown };
          };
        }
      | undefined;
    const adapterFields = adapter?.cause?.constraint?.fields;
    if (Array.isArray(adapterFields)) {
      return adapterFields.filter((item): item is string => typeof item === 'string');
    }

    return [];
  }
}
