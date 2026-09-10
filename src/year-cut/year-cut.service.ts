import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { AnnualMembershipPolicyService } from '../annual-membership/annual-membership-policy.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

const BOARD_ROLE_NAMES = [
  'director',
  'deputy-director',
  'secretary',
  'treasurer',
  'secretary-treasurer',
] as const;

const AV_CQ_TYPE_NAMES = ['Aventureros', 'Conquistadores'] as const;

const EXPIRED_ASSIGNMENT_SELECT = {
  assignment_id: true,
  user_id: true,
  club_section_id: true,
  ecclesiastical_year_id: true,
  end_date: true,
  roles: { select: { role_name: true } },
  ecclesiastical_year: { select: { end_date: true } },
  club_sections: {
    select: {
      main_club_id: true,
      club_type_id: true,
      club_types: { select: { name: true } },
    },
  },
} as const;

type ExpiredAssignment = {
  assignment_id: string;
  user_id: string;
  club_section_id: number | null;
  ecclesiastical_year_id: number;
  end_date: Date | null;
  ecclesiastical_year: { end_date: Date };
  roles: { role_name: string } | null;
  club_sections: {
    main_club_id: number | null;
    club_type_id: number | null;
    club_types: { name: string } | null;
  } | null;
};

type CurrentYear = {
  year_id: number;
  start_date: Date;
  end_date: Date;
};

type DbClient = Prisma.TransactionClient;

export interface YearCutSummary {
  ended: number;
  activated: number;
  returnedNotEnrolled: number;
  usersInvalidated: number;
}

const EMPTY_SUMMARY: YearCutSummary = {
  ended: 0,
  activated: 0,
  returnedNotEnrolled: 0,
  usersInvalidated: 0,
};

/**
 * Ecclesiastical year cut: end expired club cargos, activate scheduled director
 * plans, and leave returning people as not-enrolled via AnnualMembershipPolicy.
 *
 * Does not activate leftover CRA `designated`. Does not create `member active`.
 */
@Injectable()
export class YearCutService {
  private readonly logger = new Logger(YearCutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ecclesiasticalYear: EcclesiasticalYearService,
    private readonly authorizationContextVersion: AuthorizationContextVersionService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly annualMembershipPolicy: AnnualMembershipPolicyService,
  ) {}

  async applyCut(now?: Date): Promise<YearCutSummary> {
    const currentYear = await this.ecclesiasticalYear.getCurrentYear(now);
    const avCqTypeIds = await this.loadAvCqTypeIds();
    const clubIds = await this.collectClubIds(currentYear);

    if (clubIds.length === 0) {
      this.logger.log('YearCut: nothing to process — already applied or no data.');
      return { ...EMPTY_SUMMARY };
    }

    const totals: YearCutSummary = { ...EMPTY_SUMMARY };
    const allAffected = new Set<string>();

    for (const clubId of clubIds) {
      const part = await this.cutClub(clubId, currentYear, avCqTypeIds);
      totals.ended += part.ended;
      totals.activated += part.activated;
      totals.returnedNotEnrolled += part.returnedNotEnrolled;
      for (const userId of part.affectedUserIds) {
        allAffected.add(userId);
      }
      await this.invalidateQuietly(part.affectedUserIds);
    }

    totals.usersInvalidated = allAffected.size;

    this.logger.log(
      `YearCut complete (year ${currentYear.year_id}): ` +
        `ended=${totals.ended}, activated=${totals.activated}, ` +
        `returnedNotEnrolled=${totals.returnedNotEnrolled}, ` +
        `usersInvalidated=${totals.usersInvalidated}`,
    );

    return totals;
  }

  private async loadAvCqTypeIds(): Promise<Set<number>> {
    const clubTypes = await this.prisma.club_types.findMany({
      where: { name: { in: [...AV_CQ_TYPE_NAMES] } },
      select: { club_type_id: true, name: true },
    });
    return new Set((clubTypes ?? []).map((type) => type.club_type_id));
  }

  private expiredWhere(currentYear: CurrentYear, clubId?: number) {
    return {
      status: 'active' as const,
      ecclesiastical_year: {
        end_date: { lt: currentYear.start_date },
      },
      ...(clubId != null
        ? { club_sections: { main_club_id: clubId } }
        : {}),
    };
  }

  private async collectClubIds(currentYear: CurrentYear): Promise<number[]> {
    const clubIds = new Set<number>();

    const expired = await this.prisma.club_role_assignments.findMany({
      where: this.expiredWhere(currentYear),
      select: {
        club_sections: { select: { main_club_id: true } },
      },
    });
    for (const row of expired) {
      const clubId = row.club_sections?.main_club_id;
      if (clubId != null) clubIds.add(clubId);
    }

    const plans = await this.prisma.director_succession_plans.findMany({
      where: {
        status: 'scheduled',
        target_ecclesiastical_year_id: currentYear.year_id,
        effective_date: { lte: currentYear.start_date },
      },
      select: {
        club_section: { select: { main_club_id: true } },
      },
    });
    for (const plan of plans) {
      const clubId = plan.club_section?.main_club_id;
      if (clubId != null) clubIds.add(clubId);
    }

    const pending = await this.prisma.club_year_transitions.findMany({
      where: {
        ecclesiastical_year_id: currentYear.year_id,
        status: { not: 'completed' },
      },
      select: { club_id: true },
    });
    for (const row of pending) {
      clubIds.add(row.club_id);
    }

    return [...clubIds].sort((a, b) => a - b);
  }

  private async cutClub(
    clubId: number,
    currentYear: CurrentYear,
    avCqTypeIds: Set<number>,
  ): Promise<
    Omit<YearCutSummary, 'usersInvalidated'> & { affectedUserIds: string[] }
  > {
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clubId}, ${currentYear.year_id})`;

        const existing = await tx.club_year_transitions.findUnique({
          where: {
            club_id_ecclesiastical_year_id: {
              club_id: clubId,
              ecclesiastical_year_id: currentYear.year_id,
            },
          },
          select: { transition_id: true, status: true },
        });

        if (existing?.status === 'completed') {
          return {
            ended: 0,
            activated: 0,
            returnedNotEnrolled: 0,
            affectedUserIds: [] as string[],
          };
        }

        await tx.club_year_transitions.upsert({
          where: {
            club_id_ecclesiastical_year_id: {
              club_id: clubId,
              ecclesiastical_year_id: currentYear.year_id,
            },
          },
          create: {
            club_id: clubId,
            ecclesiastical_year_id: currentYear.year_id,
            status: 'in_progress',
          },
          update: {
            status: 'in_progress',
          },
        });

        const expired = (await tx.club_role_assignments.findMany({
          where: this.expiredWhere(currentYear, clubId),
          select: EXPIRED_ASSIGNMENT_SELECT,
        })) as ExpiredAssignment[];

        const plans = await tx.director_succession_plans.findMany({
          where: {
            status: 'scheduled',
            target_ecclesiastical_year_id: currentYear.year_id,
            effective_date: { lte: currentYear.start_date },
            club_section: { main_club_id: clubId },
          },
          select: {
            succession_id: true,
            club_section_id: true,
            successor_user_id: true,
          },
        });

        let ended = 0;
        if (expired.length > 0) {
          ended = await this.closeAssignmentsAtOutgoingEnd(tx, expired);
        }

        const counselors = await tx.class_counselor_assignments.findMany({
          where: {
            active: true,
            club_sections: { main_club_id: clubId },
            ecclesiastical_year: {
              end_date: { lt: currentYear.start_date },
            },
          },
          select: {
            assignment_id: true,
            end_date: true,
            ecclesiastical_year: { select: { end_date: true } },
          },
        });
        await this.closeCounselorsAtOutgoingEnd(tx, counselors);

        const affectedUserIds = new Set<string>(expired.map((row) => row.user_id));
        const activated = await this.activateScheduledPlans(
          tx,
          clubId,
          currentYear,
          plans,
          affectedUserIds,
        );

        const returnedNotEnrolled = await this.applyNotEnrolled(
          tx,
          clubId,
          currentYear,
          avCqTypeIds,
          expired,
        );

        if (affectedUserIds.size > 0) {
          await this.authorizationContextVersion.bumpMany(
            tx,
            Array.from(affectedUserIds),
          );
        }

        await tx.club_year_transitions.update({
          where: {
            club_id_ecclesiastical_year_id: {
              club_id: clubId,
              ecclesiastical_year_id: currentYear.year_id,
            },
          },
          data: {
            status: 'completed',
            completed_at: new Date(),
          },
        });

        return {
          ended,
          activated,
          returnedNotEnrolled,
          affectedUserIds: Array.from(affectedUserIds),
        };
      },
      { timeout: 60_000 },
    );

    return result;
  }

  private outgoingCloseDate(row: {
    end_date: Date | null;
    ecclesiastical_year: { end_date: Date };
  }): Date {
    const outgoingEnd = row.ecclesiastical_year.end_date;
    if (row.end_date && row.end_date < outgoingEnd) {
      return row.end_date;
    }
    return outgoingEnd;
  }

  private groupIdsByCloseDate<T extends {
    assignment_id: string;
    end_date: Date | null;
    ecclesiastical_year: { end_date: Date };
  }>(rows: T[]): Map<number, string[]> {
    const groups = new Map<number, string[]>();
    for (const row of rows) {
      const key = this.outgoingCloseDate(row).getTime();
      const ids = groups.get(key);
      if (ids) {
        ids.push(row.assignment_id);
      } else {
        groups.set(key, [row.assignment_id]);
      }
    }
    return groups;
  }

  private async closeAssignmentsAtOutgoingEnd(
    tx: DbClient,
    expired: ExpiredAssignment[],
  ): Promise<number> {
    let ended = 0;
    for (const [time, ids] of this.groupIdsByCloseDate(expired)) {
      const result = await tx.club_role_assignments.updateMany({
        where: {
          assignment_id: { in: ids },
          status: 'active',
        },
        data: {
          active: false,
          status: 'ended',
          end_date: new Date(time),
          modified_at: new Date(),
        },
      });
      ended += result.count;
    }
    return ended;
  }

  private async closeCounselorsAtOutgoingEnd(
    tx: DbClient,
    counselors: Array<{
      assignment_id: string;
      end_date: Date | null;
      ecclesiastical_year: { end_date: Date };
    }>,
  ): Promise<void> {
    if (counselors.length === 0) {
      return;
    }
    for (const [time, ids] of this.groupIdsByCloseDate(counselors)) {
      await tx.class_counselor_assignments.updateMany({
        where: { assignment_id: { in: ids } },
        data: {
          active: false,
          end_date: new Date(time),
          modified_at: new Date(),
        },
      });
    }
  }

  private async activateScheduledPlans(
    tx: DbClient,
    clubId: number,
    currentYear: CurrentYear,
    plans: Array<{
      succession_id: string;
      club_section_id: number;
      successor_user_id: string;
    }>,
    affectedUserIds: Set<string>,
  ): Promise<number> {
    if (plans.length === 0) {
      return 0;
    }

    const directorRole = await tx.roles.findFirst({
      where: { role_name: 'director', role_category: 'CLUB', active: true },
      select: { role_id: true },
    });

    if (!directorRole) {
      this.logger.error(
        `YearCut: director role missing — cannot activate plans for club ${clubId}`,
      );
      return 0;
    }

    let activated = 0;

    for (const plan of plans) {
      const existingActive = await tx.club_role_assignments.findFirst({
        where: {
          club_section_id: plan.club_section_id,
          ecclesiastical_year_id: currentYear.year_id,
          role_id: directorRole.role_id,
          status: 'active',
        },
        select: { assignment_id: true },
      });

      if (existingActive) {
        this.logger.warn(
          `YearCut: section ${plan.club_section_id} already has an active director for year ${currentYear.year_id} — skipping plan ${plan.succession_id}`,
        );
        continue;
      }

      const created = await tx.club_role_assignments.create({
        data: {
          user_id: plan.successor_user_id,
          role_id: directorRole.role_id,
          club_section_id: plan.club_section_id,
          ecclesiastical_year_id: currentYear.year_id,
          start_date: currentYear.start_date,
          status: 'active',
          active: true,
        },
        select: { assignment_id: true },
      });

      await tx.director_succession_plans.update({
        where: { succession_id: plan.succession_id },
        data: {
          status: 'activated',
          activated_assignment_id: created.assignment_id,
          activated_at: new Date(),
        },
      });

      affectedUserIds.add(plan.successor_user_id);
      activated += 1;
    }

    return activated;
  }

  private async applyNotEnrolled(
    tx: DbClient,
    clubId: number,
    currentYear: CurrentYear,
    avCqTypeIds: Set<number>,
    expired: ExpiredAssignment[],
  ): Promise<number> {
    const previouslyEnded = (await tx.club_role_assignments.findMany({
      where: {
        status: 'ended',
        club_sections: { main_club_id: clubId },
        OR: [
          { end_date: currentYear.start_date },
          {
            ecclesiastical_year: {
              end_date: { lt: currentYear.start_date },
            },
          },
        ],
      },
      select: EXPIRED_ASSIGNMENT_SELECT,
    })) as ExpiredAssignment[];

    const sources = new Map<string, ExpiredAssignment>();
    for (const row of [...expired, ...previouslyEnded]) {
      sources.set(row.assignment_id, row);
    }

    const processed = new Set<string>();
    let returnedNotEnrolled = 0;

    for (const assignment of sources.values()) {
      if (assignment.club_section_id == null) continue;

      const destSectionId = await this.resolveNotEnrolledSection(
        tx,
        assignment,
        avCqTypeIds,
      );
      if (destSectionId == null) continue;

      const key = `${assignment.user_id}:${destSectionId}`;
      if (processed.has(key)) continue;
      processed.add(key);

      try {
        const result = await this.annualMembershipPolicy.ensureNotEnrolled(
          tx,
          assignment.user_id,
          destSectionId,
          currentYear,
        );
        if (result.created) {
          returnedNotEnrolled += 1;
        }
      } catch (error) {
        if (
          error instanceof AppException &&
          error.code === ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED
        ) {
          this.logger.warn(
            `YearCut: unresolved annual base for user ${assignment.user_id} in club ${clubId}`,
          );
          continue;
        }
        throw error;
      }
    }

    return returnedNotEnrolled;
  }

  private async resolveNotEnrolledSection(
    tx: DbClient,
    assignment: ExpiredAssignment,
    avCqTypeIds: Set<number>,
  ): Promise<number | null> {
    const roleName = assignment.roles?.role_name?.toLowerCase() ?? '';
    const isBoard = (BOARD_ROLE_NAMES as readonly string[]).includes(roleName);
    const isAvCq = this.isAvCqSection(assignment.club_sections, avCqTypeIds);

    if (isBoard && isAvCq) {
      const sourceClubId = assignment.club_sections?.main_club_id;
      if (sourceClubId == null || assignment.club_section_id == null) {
        return null;
      }

      try {
        const base = await this.annualMembershipPolicy.resolveBase(
          tx,
          assignment.user_id,
          {
            sourceClubId,
            sourceSectionId: assignment.club_section_id,
          },
        );
        return base.baseSectionId;
      } catch (error) {
        if (
          error instanceof AppException &&
          error.code === ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED
        ) {
          this.logger.warn(
            `YearCut: unresolved GM return base for user ${assignment.user_id}`,
          );
          return null;
        }
        throw error;
      }
    }

    return assignment.club_section_id;
  }

  private isAvCqSection(
    section: ExpiredAssignment['club_sections'],
    avCqTypeIds: Set<number>,
  ): boolean {
    const typeName = section?.club_types?.name;
    if (typeName) {
      return (AV_CQ_TYPE_NAMES as readonly string[]).includes(typeName);
    }
    return section?.club_type_id != null && avCqTypeIds.has(section.club_type_id);
  }

  private async invalidateQuietly(userIds: string[]): Promise<void> {
    for (const userId of userIds) {
      try {
        await this.authorizationContext.invalidateUserAuthorizationCache(userId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `YearCut: cache invalidation failed for ${userId}: ${message}`,
        );
      }
    }
  }
}
