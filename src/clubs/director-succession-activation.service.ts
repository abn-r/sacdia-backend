import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { CriticalAuditWriterService } from '../audit-logs/critical-audit-writer.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';
import {
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

type LockedPlan = {
  succession_id: string;
  club_section_id: number;
  outgoing_assignment_id: string;
  successor_user_id: string;
  target_ecclesiastical_year_id: number;
  status: string;
  effective_date: Date;
  scheduled_by_id: string;
  scheduled_by_role: string;
  scheduled_local_field_id: number;
  version: number;
};

@Injectable()
export class DirectorSuccessionActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly criticalAudit: CriticalAuditWriterService,
    private readonly authorizationContextVersion: AuthorizationContextVersionService,
  ) {}

  async activateDue(now: Date): Promise<{ activated: number }> {
    const due = await this.prisma.director_succession_plans.findMany({
      where: {
        status: 'scheduled',
        effective_date: { lte: now },
      },
      select: { succession_id: true },
      orderBy: { effective_date: 'asc' },
      take: 50,
    });

    let activated = 0;
    for (const row of due) {
      const did = await this.activateOne(row.succession_id, now);
      if (did) activated += 1;
    }
    return { activated };
  }

  private async activateOne(
    successionId: string,
    now: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const [plan] = await tx.$queryRaw<LockedPlan[]>(Prisma.sql`
        SELECT succession_id, club_section_id, outgoing_assignment_id,
               successor_user_id, target_ecclesiastical_year_id, status::text AS status,
               effective_date, scheduled_by_id, scheduled_by_role,
               scheduled_local_field_id, version
        FROM director_succession_plans
        WHERE succession_id = ${successionId}::uuid
        FOR UPDATE
      `);

      if (
        !plan ||
        plan.status !== 'scheduled' ||
        new Date(plan.effective_date).getTime() > now.getTime()
      ) {
        return false;
      }

      const directorRole = await tx.roles.findFirst({
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

      const current = await tx.club_role_assignments.findUnique({
        where: { assignment_id: plan.outgoing_assignment_id },
        select: {
          assignment_id: true,
          user_id: true,
          club_section_id: true,
          role_id: true,
          active: true,
          roles: { select: { role_name: true } },
        },
      });

      if (
        !current ||
        current.club_section_id !== plan.club_section_id ||
        !current.active ||
        current.roles.role_name.toLowerCase() !== 'director'
      ) {
        throw new AppNotFoundException(ErrorCode.GUARD_ASSIGNMENT_NOT_FOUND);
      }

      const startDate = plan.effective_date;
      const token = randomUUID();

      await tx.director_succession_plans.update({
        where: { succession_id: plan.succession_id },
        data: {
          processing_token: token,
          last_attempt_at: now,
          attempt_count: { increment: 1 },
        },
      });

      const ended = await tx.club_role_assignments.update({
        where: { assignment_id: plan.outgoing_assignment_id },
        data: {
          active: false,
          status: 'ended',
          end_date: startDate,
          modified_at: now,
        },
        select: {
          assignment_id: true,
          user_id: true,
        },
      });

      const existingActiveDirectorCount = await tx.club_role_assignments.count({
        where: {
          club_section_id: plan.club_section_id,
          role_id: directorRole.role_id,
          active: true,
          assignment_id: { not: plan.outgoing_assignment_id },
        },
      });
      if (existingActiveDirectorCount > 0) {
        throw new AppConflictException(ErrorCode.CLUB_ROLE_SLOT_LIMIT_REACHED);
      }

      const created = await tx.club_role_assignments.create({
        data: {
          user_id: plan.successor_user_id,
          role_id: directorRole.role_id,
          ecclesiastical_year_id: plan.target_ecclesiastical_year_id,
          start_date: startDate,
          active: true,
          status: 'active',
          club_section_id: plan.club_section_id,
        },
        select: {
          assignment_id: true,
          user_id: true,
        },
      });

      await tx.director_succession_plans.update({
        where: { succession_id: plan.succession_id },
        data: {
          status: 'activated',
          activated_assignment_id: created.assignment_id,
          activated_at: now,
          processing_token: null,
          processing_expires_at: null,
        },
      });

      await this.criticalAudit.write(tx, {
        entityType: 'director_succession',
        entityId: plan.succession_id,
        action: 'DIRECTOR_SUCCESSION_ACTIVATED',
        eventKey: `director-succession.activated:${plan.succession_id}`,
        actor: {
          kind: 'system',
          userId: null,
          roleName: 'succession-activator',
          scope: {
            scheduled_by_id: plan.scheduled_by_id,
            scheduled_by_role: plan.scheduled_by_role,
            scheduled_local_field_id: plan.scheduled_local_field_id,
          },
        },
        target: {
          userId: plan.successor_user_id,
          scope: {
            club_section_id: plan.club_section_id,
            outgoing_assignment_id: plan.outgoing_assignment_id,
            activated_assignment_id: created.assignment_id,
          },
        },
        before: {
          status: 'scheduled',
          outgoing_assignment_id: plan.outgoing_assignment_id,
          outgoing_user_id: ended.user_id,
        },
        after: {
          status: 'activated',
          activated_assignment_id: created.assignment_id,
          successor_user_id: created.user_id,
        },
        effectiveAt: startDate,
        result: 'succeeded',
      });

      await this.authorizationContextVersion.bumpOrdered(tx, [
        ended.user_id,
        created.user_id,
      ]);

      return true;
    });
  }
}
