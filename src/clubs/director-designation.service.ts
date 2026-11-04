import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import {
  ECCLESIASTICAL_YEAR_TIMEZONE,
  EcclesiasticalYearService,
} from '../common/services/ecclesiastical-year.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { SectionRoleMutationPolicy } from '../common/authorization/section-role-mutation.policy';
import { TemporalContextFactory } from '../common/clock/temporal-context.factory';
import { classifyLocalFieldTimezone } from '../common/validators/iana-timezone.validator';
import { ClubRoleEligibilityService } from '../club-role-eligibility/club-role-eligibility.service';
import { assertAssignmentActivationAllowed } from '../membership-requests/assignment-activation-gate';
import { CriticalAuditWriterService } from '../audit-logs/critical-audit-writer.service';
import type {
  AuditJson,
  CriticalAuditEvent,
} from '../audit-logs/critical-audit-writer.service';
import { getAuditCorrelationId } from '../audit-logs/audit-request-context';
import {
  DirectorDesignationDto,
  ReplaceDirectorPlanDto,
} from './dto/role-assignment.dto';
import { ClubRole, GlobalRole } from '../common/authorization/roles';

/** Global roles that can schedule a director plan; the first match is stored as `scheduled_by_role`. */
const SCHEDULER_ROLE_NAMES = [
  GlobalRole.SUPER_ADMIN,
  GlobalRole.ADMIN,
  GlobalRole.DIRECTOR_LF,
  GlobalRole.ASSISTANT_LF,
] as const;

/**
 * Calendar months (business date of the club's local field, inclusive) in
 * which a new director plan can be scheduled.
 */
export const DIRECTOR_DESIGNATION_WINDOW = {
  fromMonth: 10,
  toMonth: 12,
} as const;

const OPEN_PLAN_STATUSES = ['scheduled', 'activated', 'blocked'] as const;

export type DirectorPlanView = {
  succession_id: string;
  user_id: string;
  ecclesiastical_year_id: number;
  effective_date: Date;
  status: string;
  version: number;
  outgoing_assignment_id: string | null;
  attempt_count: number;
  last_attempt_at: Date | null;
  block_code: string | null;
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
  now: Date;
  businessMonth: number;
  temporal: NonNullable<CriticalAuditEvent['temporal']>;
};

type PlanRow = {
  succession_id: string;
  club_section_id?: number;
  successor_user_id: string;
  target_ecclesiastical_year_id: number;
  effective_date: Date;
  status: string;
  version: number;
  outgoing_assignment_id: string | null;
  attempt_count?: number;
  last_attempt_at?: Date | null;
  block_code?: string | null;
  request_hash?: string;
};

type PlanAuditAction =
  | 'DIRECTOR_SUCCESSION_SCHEDULED'
  | 'DIRECTOR_SUCCESSION_REPLACED'
  | 'DIRECTOR_SUCCESSION_CANCELLED';

@Injectable()
export class DirectorDesignationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly ecclesiasticalYear: EcclesiasticalYearService,
    private readonly sectionRoleMutation: SectionRoleMutationPolicy,
    private readonly roleEligibility: ClubRoleEligibilityService,
    private readonly criticalAudit: CriticalAuditWriterService,
    private readonly temporalContexts: TemporalContextFactory,
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

    const scope = await this.resolveSectionScope(clubId, sectionId);
    await this.sectionRoleMutation.assertCanMutate({
      actorUserId,
      clubSectionId: sectionId,
      targetRoleName: ClubRole.DIRECTOR,
      targetUserId: dto.user_id,
      mutation: 'assign',
    });

    const currentYear = await this.ecclesiasticalYear.getCurrentYear();
    const requestedYear =
      await this.ecclesiasticalYear.getNextYear(currentYear);
    if (dto.ecclesiastical_year_id !== requestedYear.year_id) {
      throw new AppBadRequestException(
        ErrorCode.CLUB_DIRECTOR_PLAN_YEAR_INVALID,
      );
    }
    if (
      scope.businessMonth < DIRECTOR_DESIGNATION_WINDOW.fromMonth ||
      scope.businessMonth > DIRECTOR_DESIGNATION_WINDOW.toMonth
    ) {
      throw new AppForbiddenException(
        ErrorCode.CLUB_DIRECTOR_PLAN_WINDOW_CLOSED,
      );
    }

    const schedulerRole = await this.resolveSchedulerRole(actorUserId);
    const directorRoleId = await this.resolveDirectorRoleId();
    const requestHash = hashDirectorDesignationRequest({
      clubId,
      sectionId,
      userId: dto.user_id,
      ecclesiasticalYearId: dto.ecclesiastical_year_id,
    });

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

        await this.assertSuccessorEligible(tx, dto.user_id, sectionId);

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

        await this.criticalAudit.write(
          tx,
          this.buildPlanEvent({
            action: 'DIRECTOR_SUCCESSION_SCHEDULED',
            eventKey: `director-succession:scheduled:${actorUserId}:${normalizedKey}`,
            actorUserId,
            actorRoleName: schedulerRole,
            scope,
            sectionId,
            targetUserId: dto.user_id,
            entityId: created.succession_id,
            before: {},
            after: this.planSnapshot({
              ...created,
              club_section_id: sectionId,
            }),
            idempotencyKey: normalizedKey,
            summary: `Sucesión de director programada para la sección ${sectionId}`,
          }),
        );

        return this.mapPlan(created);
      });
    } catch (error) {
      if (
        this.isUniqueViolation(error, ['scheduled_by_id', 'idempotency_key'])
      ) {
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
    await this.resolveSectionScope(clubId, sectionId);
    // Reading a plan needs the same authority as managing it. With the actor
    // as target, a section director (who cannot touch the director seat) is
    // rejected while admins and the same-field director-lf / assistant-lf pass.
    await this.sectionRoleMutation.assertCanMutate({
      actorUserId,
      clubSectionId: sectionId,
      targetRoleName: ClubRole.DIRECTOR,
      targetUserId: actorUserId,
      mutation: 'update',
    });

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
    const scope = await this.resolveSectionScope(clubId, sectionId);
    await this.sectionRoleMutation.assertCanMutate({
      actorUserId,
      clubSectionId: sectionId,
      targetRoleName: ClubRole.DIRECTOR,
      targetUserId: dto.successor_user_id,
      mutation: 'update',
    });

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

    return this.prisma.$transaction(async (tx) => {
      await this.assertSuccessorEligible(tx, dto.successor_user_id, sectionId);

      const updated = await tx.director_succession_plans.update({
        where: { succession_id: dto.succession_id },
        data: {
          successor_user_id: dto.successor_user_id,
          version: existing.version + 1,
          modified_at: new Date(),
        },
      });

      await this.criticalAudit.write(
        tx,
        this.buildPlanEvent({
          action: 'DIRECTOR_SUCCESSION_REPLACED',
          eventKey: `director-succession:replaced:${existing.succession_id}:v${existing.version + 1}`,
          actorUserId,
          scope,
          sectionId,
          targetUserId: dto.successor_user_id,
          entityId: existing.succession_id,
          before: this.planSnapshot({
            ...existing,
            club_section_id: sectionId,
          }),
          after: this.planSnapshot({ ...updated, club_section_id: sectionId }),
          summary: `Sucesión de director reemplazada en la sección ${sectionId}`,
        }),
      );

      return this.mapPlan(updated);
    });
  }

  async cancelPlan(
    clubId: number,
    sectionId: number,
    successionId: string,
    version: number,
    actorUserId: string,
  ): Promise<DirectorPlanView> {
    const scope = await this.resolveSectionScope(clubId, sectionId);

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

    await this.sectionRoleMutation.assertCanMutate({
      actorUserId,
      clubSectionId: sectionId,
      targetRoleName: ClubRole.DIRECTOR,
      targetUserId: existing.successor_user_id,
      mutation: 'revoke',
    });

    if (existing.version !== version) {
      throw new AppConflictException(
        ErrorCode.CLUB_DIRECTOR_PLAN_VERSION_CONFLICT,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.director_succession_plans.update({
        where: { succession_id: successionId },
        data: {
          status: 'cancelled',
          version: existing.version + 1,
          modified_at: new Date(),
        },
      });

      await this.criticalAudit.write(
        tx,
        this.buildPlanEvent({
          action: 'DIRECTOR_SUCCESSION_CANCELLED',
          eventKey: `director-succession:cancelled:${existing.succession_id}:v${existing.version + 1}`,
          actorUserId,
          scope,
          sectionId,
          targetUserId: existing.successor_user_id,
          entityId: existing.succession_id,
          before: this.planSnapshot({
            ...existing,
            club_section_id: sectionId,
          }),
          after: this.planSnapshot({ ...updated, club_section_id: sectionId }),
          summary: `Sucesión de director cancelada en la sección ${sectionId}`,
        }),
      );

      return this.mapPlan(updated);
    });
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

  private async assertSuccessorEligible(
    tx: Prisma.TransactionClient,
    userId: string,
    sectionId: number,
  ): Promise<void> {
    await this.roleEligibility.assertAssignment({
      userId,
      roleName: ClubRole.DIRECTOR,
      clubSectionId: sectionId,
      db: tx,
    });
    await assertAssignmentActivationAllowed(tx, userId);
  }

  /**
   * Section ↔ club validation plus the club's local-field business date.
   * Authority is NOT checked here (see SectionRoleMutationPolicy).
   */
  private async resolveSectionScope(
    clubId: number,
    sectionId: number,
  ): Promise<SectionScope> {
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: {
        main_club_id: true,
        clubs: {
          select: {
            club_id: true,
            local_field_id: true,
            local_fields: { select: { local_field_id: true, timezone: true } },
          },
        },
      },
    });

    if (!section || section.main_club_id == null) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    if (section.main_club_id !== clubId) {
      throw new AppForbiddenException(ErrorCode.GUARD_ASSIGNMENT_SCOPE_INVALID);
    }

    const localFieldId = section.clubs?.local_field_id;
    if (localFieldId == null) {
      throw new AppNotFoundException(ErrorCode.CLUB_NOT_FOUND);
    }

    const classified = classifyLocalFieldTimezone(
      section.clubs?.local_fields?.timezone,
    );
    const context = this.temporalContexts.forLocalField({
      local_field_id: localFieldId,
      timezone: classified.ok ? classified.value : ECCLESIASTICAL_YEAR_TIMEZONE,
    });

    return {
      clubId: section.main_club_id,
      localFieldId,
      now: context.now,
      businessMonth: Number(context.businessDate.slice(5, 7)),
      temporal: {
        businessDate: context.businessDate,
        businessTimezone: context.businessTimeZone,
      },
    };
  }

  private planSnapshot(plan: PlanRow): AuditJson {
    return {
      succession_id: plan.succession_id,
      club_section_id: plan.club_section_id ?? null,
      successor_user_id: plan.successor_user_id,
      target_ecclesiastical_year_id: plan.target_ecclesiastical_year_id,
      effective_date: plan.effective_date.toISOString(),
      status: plan.status,
      version: plan.version,
      outgoing_assignment_id: plan.outgoing_assignment_id,
    };
  }

  private buildPlanEvent(input: {
    action: PlanAuditAction;
    eventKey: string;
    actorUserId: string;
    actorRoleName?: string | null;
    scope: SectionScope;
    sectionId: number;
    targetUserId: string;
    entityId: string;
    before: AuditJson;
    after: AuditJson;
    idempotencyKey?: string;
    summary: string;
  }): CriticalAuditEvent {
    return {
      entityType: 'director_succession_plan',
      entityId: input.entityId,
      action: input.action,
      eventKey: input.eventKey,
      actor: {
        kind: 'user',
        userId: input.actorUserId,
        roleName: input.actorRoleName ?? null,
        scope: { club_section_id: input.sectionId },
      },
      target: {
        userId: input.targetUserId,
        scope: {
          club_section_id: input.sectionId,
          club_id: input.scope.clubId,
          local_field_id: input.scope.localFieldId,
        },
      },
      before: input.before,
      after: input.after,
      clubId: input.scope.clubId,
      summary: input.summary,
      effectiveAt: input.scope.now,
      temporal: input.scope.temporal,
      correlationId: getAuditCorrelationId() ?? randomUUID(),
      idempotencyKey: input.idempotencyKey,
      result: 'succeeded',
    };
  }

  private async resolveDirectorRoleId(): Promise<string> {
    const directorRole = await this.prisma.roles.findFirst({
      where: {
        role_name: ClubRole.DIRECTOR,
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
      (SCHEDULER_ROLE_NAMES as readonly string[]).includes(role.role_name),
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
      attempt_count: plan.attempt_count ?? 0,
      last_attempt_at: plan.last_attempt_at ?? null,
      block_code: plan.block_code ?? null,
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
      return meta.target.filter(
        (item): item is string => typeof item === 'string',
      );
    }
    if (typeof meta.target === 'string') {
      return [meta.target];
    }

    const directConstraint = meta.constraint as
      { fields?: unknown } | undefined;
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
      return adapterFields.filter(
        (item): item is string => typeof item === 'string',
      );
    }

    return [];
  }
}
