import { Injectable } from '@nestjs/common';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  investiture_status_enum,
  investiture_action_enum,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { pendingInvestitureAuthorization } from '../investiture-requests/investiture-request-lock';

const EXPIRABLE_STATUSES: investiture_status_enum[] = [
  investiture_status_enum.IN_PROGRESS,
  investiture_status_enum.REJECTED,
];

@Injectable()
export class InvestitureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  // ========================================
  // GET HISTORY
  // ========================================

  /**
   * Obtener historial de validación de un enrollment.
   * Autorización dual: admin/coordinator pueden ver cualquier historial;
   * director/consejero solo si tienen rol activo en el club del enrollment.
   *
   * MVP simplification: global roles (admin/coordinator/super-admin/assistant-admin) bypass
   * authorization entirely. Others may only view their own enrollment's history.
   */
  async getHistory(
    enrollmentId: number,
    actorId: string,
  ): Promise<{
    enrollment_id: number;
    history: Array<{
      history_id: number;
      action: string;
      performed_by: { name: string | null; paternal_last_name: string | null };
      comments: string | null;
      created_at: Date;
    }>;
  }> {
    // 1. Verify enrollment exists
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      select: { enrollment_id: true, user_id: true },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      );
    }

    // 2. Authorization check — query DB for actual global roles (JWT payload does NOT carry roles)
    const allowedGlobalRoles = [
      'admin',
      'coordinator',
      'super-admin',
      'assistant-admin',
    ];
    const hasGlobalAccess = await this.authorizationContext.hasAnyGlobalRole(
      actorId,
      allowedGlobalRoles,
    );

    if (!hasGlobalAccess) {
      // Club-role check: allow if actor is an active director or counselor
      // in any club_section where the enrollment's user also has an active assignment.
      const enrollmentUserSections = await this.prisma.club_role_assignments
        .findMany({
          where: { user_id: enrollment.user_id, active: true },
          select: { club_section_id: true },
        })
        .then((rows) =>
          rows
            .map((r) => r.club_section_id)
            .filter((id): id is number => id !== null),
        );

      const isClubStaff =
        enrollmentUserSections.length > 0
          ? await this.prisma.club_role_assignments.findFirst({
              where: {
                user_id: actorId,
                active: true,
                status: 'active',
                roles: {
                  role_name: { in: ['director', 'counselor'] },
                },
                club_section_id: { in: enrollmentUserSections },
              },
              select: { assignment_id: true },
            })
          : null;

      if (!isClubStaff) {
        // Fall through to enrollment owner check
        if (actorId !== enrollment.user_id) {
          throw new AppForbiddenException(ErrorCode.INVESTITURE_ACCESS_DENIED);
        }
      }
    }

    // 3. Query history ordered by created_at ASC (chronological)
    const history = await this.prisma.investiture_validation_history.findMany({
      where: { enrollment_id: enrollmentId },
      include: {
        users: {
          select: {
            name: true,
            paternal_last_name: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    // 4. Return shaped result
    return {
      enrollment_id: enrollmentId,
      history: history.map((entry) => ({
        history_id: entry.history_id,
        action: entry.action,
        performed_by: {
          name: entry.users.name,
          paternal_last_name: entry.users.paternal_last_name,
        },
        comments: entry.comments ?? null,
        created_at: entry.created_at,
      })),
    };
  }

  async expireOverdueEnrollments(
    actorId: string,
    params: { ecclesiastical_year_id?: number; dry_run?: boolean },
  ): Promise<{
    ecclesiastical_year_id: number;
    dry_run: boolean;
    scanned_count: number;
    expired_count: number;
    enrollment_ids: number[];
  }> {
    const targetYear = params.ecclesiastical_year_id
      ? await this.prisma.ecclesiastical_years.findFirst({
          where: { year_id: params.ecclesiastical_year_id },
          select: { year_id: true, start_date: true },
        })
      : await this.findCurrentEcclesiasticalYear();

    if (!targetYear) {
      throw new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND);
    }

    const candidates = await this.prisma.enrollments.findMany({
      where: {
        active: true,
        record_kind: 'OPERATIONAL',
        investiture_status: { in: EXPIRABLE_STATUSES },
      },
      select: {
        enrollment_id: true,
        investiture_status: true,
        ecclesiastical_year: { select: { start_date: true } },
        classes: { select: { max_duration_years: true } },
      },
    });

    const overdueIds: number[] = [];
    for (const candidate of candidates) {
      const elapsedYears = await this.countElapsedEcclesiasticalYears(
        candidate.ecclesiastical_year.start_date,
        targetYear.start_date,
      );

      if (elapsedYears > candidate.classes.max_duration_years) {
        overdueIds.push(candidate.enrollment_id);
      }
    }

    const dryRun = params.dry_run ?? false;
    let expiredEnrollmentIds = overdueIds;

    if (!dryRun && overdueIds.length > 0) {
      const now = new Date();
      const expiredIds = await this.prisma.$transaction(async (tx) => {
        const stillExpirable = await tx.enrollments.findMany({
          where: {
            enrollment_id: { in: overdueIds },
            active: true,
            record_kind: 'OPERATIONAL',
            investiture_status: { in: EXPIRABLE_STATUSES },
          },
          select: { enrollment_id: true },
        });
        const revalidatedIds: number[] = [];
        for (const enrollment of [...stillExpirable].sort(
          (left, right) => left.enrollment_id - right.enrollment_id,
        )) {
          if (
            await pendingInvestitureAuthorization(tx, enrollment.enrollment_id)
          ) {
            continue;
          }
          revalidatedIds.push(enrollment.enrollment_id);
        }

        if (revalidatedIds.length === 0) {
          return [];
        }

        const updateResult = await tx.enrollments.updateMany({
          where: {
            enrollment_id: { in: revalidatedIds },
            active: true,
            record_kind: 'OPERATIONAL',
            investiture_status: { in: EXPIRABLE_STATUSES },
          },
          data: {
            investiture_status: investiture_status_enum.EXPIRED,
            validated_by: actorId,
            validated_at: now,
            locked_for_validation: false,
            submitted_for_validation: false,
            rejection_reason: null,
          },
        });

        let auditIds = revalidatedIds;
        if (updateResult.count !== revalidatedIds.length) {
          const actuallyExpired = await tx.enrollments.findMany({
            where: {
              enrollment_id: { in: revalidatedIds },
              investiture_status: investiture_status_enum.EXPIRED,
              validated_by: actorId,
              validated_at: now,
            },
            select: { enrollment_id: true },
          });
          auditIds = actuallyExpired.map(
            (enrollment) => enrollment.enrollment_id,
          );
        }

        if (auditIds.length === 0) {
          return [];
        }

        await tx.investiture_validation_history.createMany({
          data: auditIds.map((enrollmentId) => ({
            enrollment_id: enrollmentId,
            action: investiture_action_enum.EXPIRED,
            performed_by: actorId,
            comments: 'Vencimiento manual de enrollment atrasado',
          })),
        });

        return auditIds;
      });
      expiredEnrollmentIds = expiredIds;
    }

    return {
      ecclesiastical_year_id: targetYear.year_id,
      dry_run: dryRun,
      scanned_count: candidates.length,
      expired_count: expiredEnrollmentIds.length,
      enrollment_ids: expiredEnrollmentIds,
    };
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  private async findCurrentEcclesiasticalYear(): Promise<{
    year_id: number;
    start_date: Date;
  }> {
    const now = new Date();
    const yearByCurrentDate = await this.prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: now },
        end_date: { gte: now },
      },
      select: {
        year_id: true,
        start_date: true,
      },
      orderBy: { start_date: 'desc' },
    });
    const year =
      yearByCurrentDate ??
      (await this.prisma.ecclesiastical_years.findFirst({
        where: { active: true },
        select: {
          year_id: true,
          start_date: true,
        },
        orderBy: { start_date: 'desc' },
      }));

    if (!year) {
      throw new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND);
    }

    return year;
  }

  private async countElapsedEcclesiasticalYears(
    fromStartDate: Date,
    toStartDate: Date,
  ): Promise<number> {
    return this.prisma.ecclesiastical_years.count({
      where: {
        start_date: {
          gte: fromStartDate,
          lte: toStartDate,
        },
      },
    });
  }
}
