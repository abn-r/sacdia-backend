import { Injectable, Logger } from '@nestjs/common';
import {
  AppNotFoundException,
  AppForbiddenException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CoordinationService } from '../coordination/coordination.service';
import { AchievementsService } from '../achievements/achievements.service';
import { ACHIEVEMENT_EVENTS } from '../achievements/events/achievement-events';

const COORDINATOR_ROLES = new Set([
  'coordinator',
  'zone-coordinator',
  'general-coordinator',
]);

export interface MemberResult {
  user_id: string;
  total_points: number;
}

@Injectable()
export class MemberOfMonthService {
  private readonly logger = new Logger(MemberOfMonthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly achievementsService: AchievementsService,
    private readonly coordinationService: CoordinationService,
  ) {}

  // ============================================================
  // Queries
  // ============================================================

  async getCurrentMemberOfMonth(clubId: number, sectionId: number) {
    await this.validateClubSection(clubId, sectionId);

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const entries = await this.prisma.member_of_month.findMany({
      where: { club_section_id: sectionId, month, year },
      include: {
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            user_image: true,
          },
        },
      },
    });

    if (entries.length === 0) {
      return { month, year, members: null };
    }

    return {
      month,
      year,
      members: entries.map((e) => ({
        user_id: e.user_id,
        name: `${e.users.name ?? ''} ${e.users.paternal_last_name ?? ''}`.trim(),
        photo_url: e.users.user_image ?? null,
        total_points: e.total_points,
      })),
    };
  }

  async getMemberOfMonthHistory(
    clubId: number,
    sectionId: number,
    page: number = 1,
    limit: number = 12,
  ) {
    await this.validateClubSection(clubId, sectionId);

    // H5: clamp pagination params server-side
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const skip = (safePage - 1) * safeLimit;

    // H7: paginate over distinct (year, month) periods, then fetch all rows for those periods
    const distinctPeriods = await this.prisma.$queryRaw<
      Array<{ year: number; month: number }>
    >`
      SELECT DISTINCT year, month
      FROM member_of_month
      WHERE club_section_id = ${sectionId}
      ORDER BY year DESC, month DESC
      LIMIT ${safeLimit} OFFSET ${skip}
    `;

    const totalResult = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT (year, month)) AS count
      FROM member_of_month
      WHERE club_section_id = ${sectionId}
    `;

    const total = Number(totalResult[0]?.count ?? 0);

    if (distinctPeriods.length === 0) {
      return {
        data: [],
        pagination: { page: safePage, limit: safeLimit, total },
      };
    }

    // Fetch all entries for those specific periods using Prisma ORM (safe)
    const periodFilters = distinctPeriods.map((p) => ({
      club_section_id: sectionId,
      year: p.year,
      month: p.month,
    }));

    const entries = await this.prisma.member_of_month.findMany({
      where: {
        OR: periodFilters,
      },
      include: {
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            user_image: true,
          },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    // Group entries by month/year in the same order as distinctPeriods
    const grouped = new Map<string, typeof entries>();
    for (const entry of entries) {
      const key = `${entry.year}-${entry.month}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(entry);
    }

    const data = distinctPeriods.map((period) => {
      const key = `${period.year}-${period.month}`;
      const group = grouped.get(key) ?? [];
      return {
        month: period.month,
        year: period.year,
        members: group.map((e) => ({
          user_id: e.user_id,
          name: `${e.users.name ?? ''} ${e.users.paternal_last_name ?? ''}`.trim(),
          photo_url: e.users.user_image ?? null,
          total_points: e.total_points,
        })),
      };
    });

    return {
      data,
      pagination: { page: safePage, limit: safeLimit, total },
    };
  }

  async listForAdmin(
    userId: string,
    filters: {
      clubTypeId?: number;
      localFieldId?: number;
      clubId?: number;
      sectionId?: number;
      year?: number;
      month?: number;
      notified?: boolean;
      page?: number;
      limit?: number;
    },
  ) {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);

    const globalRoles = new Set(
      resolved.authorization.grants.global_roles.map(
        (g: { role_name: string }) => g.role_name.toLowerCase(),
      ),
    );
    const isAdmin = globalRoles.has('admin') || globalRoles.has('super-admin');
    const isCoordinator =
      !isAdmin &&
      [...COORDINATOR_ROLES].some((role) => globalRoles.has(role));

    let coordinatorSectionIds: number[] | undefined;
    if (isCoordinator) {
      coordinatorSectionIds =
        await this.coordinationService.getEffectiveCoordinatorSectionIds(
          userId,
        );
      if (coordinatorSectionIds.length === 0) {
        throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
      }
    }

    const userLocalFieldId = resolved.authorization.effective.scope.global
      .local_field?.id as number | undefined;

    const scopedLocalFieldId: number | undefined = isCoordinator
      ? undefined
      : isAdmin
        ? filters.localFieldId
        : userLocalFieldId;

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(Math.max(1, filters.limit ?? 20), 100);
    const skip = (page - 1) * limit;

    if (coordinatorSectionIds) {
      const allowedSectionIds =
        filters.sectionId !== undefined
          ? coordinatorSectionIds.filter((id) => id === filters.sectionId)
          : coordinatorSectionIds;

      if (allowedSectionIds.length === 0) {
        return { total: 0, page, limit, items: [] };
      }

      const where: Prisma.member_of_monthWhereInput = {
        ...(filters.year !== undefined && { year: filters.year }),
        ...(filters.month !== undefined && { month: filters.month }),
        ...(filters.notified !== undefined && { notified: filters.notified }),
        club_section: {
          club_section_id: { in: allowedSectionIds },
          ...(filters.clubTypeId !== undefined && {
            club_type_id: filters.clubTypeId,
          }),
          clubs: {
            ...(filters.clubId !== undefined && { club_id: filters.clubId }),
          },
        },
      };

      return this.findAdminList(where, page, limit, skip);
    }

    const where: Prisma.member_of_monthWhereInput = {
      ...(filters.year !== undefined && { year: filters.year }),
      ...(filters.month !== undefined && { month: filters.month }),
      ...(filters.notified !== undefined && { notified: filters.notified }),
      club_section: {
        ...(filters.sectionId !== undefined && {
          club_section_id: filters.sectionId,
        }),
        ...(filters.clubTypeId !== undefined && {
          club_type_id: filters.clubTypeId,
        }),
        clubs: {
          ...(filters.clubId !== undefined && { club_id: filters.clubId }),
          ...(scopedLocalFieldId !== undefined && {
            local_field_id: scopedLocalFieldId,
          }),
        },
      },
    };

    return this.findAdminList(where, page, limit, skip);
  }

  private async findAdminList(
    where: Prisma.member_of_monthWhereInput,
    page: number,
    limit: number,
    skip: number,
  ) {
    const [total, rows] = await Promise.all([
      this.prisma.member_of_month.count({ where }),
      this.prisma.member_of_month.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        include: {
          users: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
              user_image: true,
            },
          },
          club_section: {
            include: {
              club_types: { select: { name: true } },
              clubs: {
                select: {
                  club_id: true,
                  name: true,
                  local_field_id: true,
                  local_fields: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const items = rows.map((r) => {
      const fullName =
        `${r.users.name ?? ''} ${r.users.paternal_last_name ?? ''}`.trim();
      return {
        member_of_month_id: r.member_of_month_id,
        user_id: r.user_id,
        user_name: fullName || null,
        user_image: r.users.user_image ?? null,
        club_section_id: r.club_section_id,
        section_name:
          r.club_section.name ?? r.club_section.club_types?.name ?? null,
        club_type: r.club_section.club_types?.name ?? null,
        club_id: r.club_section.clubs?.club_id ?? null,
        club_name: r.club_section.clubs?.name ?? null,
        local_field: r.club_section.clubs?.local_fields?.name ?? null,
        local_field_id: r.club_section.clubs?.local_field_id ?? null,
        month: r.month,
        year: r.year,
        total_points: r.total_points,
        notified: r.notified,
        created_at: r.created_at,
      };
    });

    return { total, page, limit, items };
  }

  // ============================================================
  // Evaluation
  // ============================================================

  async evaluateMemberOfMonth(
    clubId: number,
    sectionId: number,
    month: number,
    year: number,
    requestingUserId: string,
  ) {
    await this.validateClubSection(clubId, sectionId);
    // C6: Only directors of the section may trigger evaluation
    await this.assertIsDirector(requestingUserId, sectionId);
    return this.runEvaluation(sectionId, month, year);
  }

  /**
   * Core evaluation algorithm. Can be called by the cron job or the manual endpoint.
   * Idempotent: deletes existing rows for the section/month/year before inserting new ones.
   */
  async runEvaluation(
    sectionId: number,
    month: number,
    year: number,
  ): Promise<{
    winners: MemberResult[];
    section_id: number;
    month: number;
    year: number;
  }> {
    // 1. Calculate ISO week range for the given month/year
    const weekRange = this.getWeekRangeForMonth(year, month);

    // 2. Aggregate points per user for that section and week range.
    // H9: With the `year` column on weekly_records, we filter by exact year
    // to correctly handle the December cross-year edge case where startWeek > endWeek.
    // Path: weekly_record_scores -> weekly_records (week in range, year = target year)
    //       -> unit_members (user_id) -> units (club_section_id = sectionId)
    const scores = await this.prisma.$queryRaw<MemberResult[]>`
      SELECT
        um.user_id,
        COALESCE(SUM(wrs.points), 0)::int AS total_points
      FROM unit_members um
      JOIN units u ON um.unit_id = u.unit_id
        AND u.club_section_id = ${sectionId}
        AND u.active = true
      JOIN weekly_records wr ON wr.user_id = um.user_id
        AND wr.year = ${year}
        AND wr.week >= ${weekRange.startWeek}
        AND wr.week <= ${weekRange.endWeek}
        AND wr.active = true
        AND (
          wr.unit_id = u.unit_id
          OR (
            wr.unit_id IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM weekly_records wr_specific
              WHERE wr_specific.user_id = wr.user_id
                AND wr_specific.unit_id = u.unit_id
                AND wr_specific.year = wr.year
                AND wr_specific.week = wr.week
                AND wr_specific.active = true
            )
          )
        )
      LEFT JOIN weekly_record_scores wrs ON wrs.record_id = wr.record_id
      WHERE um.active = true
      GROUP BY um.user_id
      HAVING COALESCE(SUM(wrs.points), 0) > 0
    `;

    if (!scores || scores.length === 0) {
      this.logger.log(
        `No scores found for section ${sectionId}, month ${month}/${year}`,
      );
      await this.prisma.member_of_month.deleteMany({
        where: { club_section_id: sectionId, month, year },
      });
      return { winners: [], section_id: sectionId, month, year };
    }

    // 3. Find max points and all tied winners
    const maxPoints = Math.max(...scores.map((s) => Number(s.total_points)));
    const winners = scores.filter((s) => Number(s.total_points) === maxPoints);

    // 4. Delete + Insert in a transaction (idempotency)
    await this.prisma.$transaction(async (tx) => {
      await tx.member_of_month.deleteMany({
        where: { club_section_id: sectionId, month, year },
      });

      await tx.member_of_month.createMany({
        data: winners.map((w) => ({
          club_section_id: sectionId,
          user_id: w.user_id,
          month,
          year,
          total_points: Number(w.total_points),
          notified: false,
        })),
      });
    });

    // 5. Emit achievement event for each winner — fire-and-forget, never blocks
    for (const winner of winners) {
      try {
        await this.achievementsService.emitEvent({
          userId: winner.user_id,
          eventType: ACHIEVEMENT_EVENTS.MEMBER_OF_MONTH,
          payload: {
            section_id: sectionId,
            month,
            year,
            total_points: Number(winner.total_points),
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to emit ${ACHIEVEMENT_EVENTS.MEMBER_OF_MONTH} for user ${winner.user_id}: ${(err as Error).message}`,
        );
      }
    }

    // 6. Send notifications (non-blocking)
    this.sendMemberOfMonthNotifications(sectionId, winners, month, year).catch(
      (err) => {
        this.logger.warn(
          `Failed to send member-of-month notifications: ${err.message}`,
        );
      },
    );

    return { winners, section_id: sectionId, month, year };
  }

  // ============================================================
  // Notifications
  // ============================================================

  private async sendMemberOfMonthNotifications(
    sectionId: number,
    winners: MemberResult[],
    month: number,
    year: number,
  ) {
    // Fetch section + club info for notification messages
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      include: {
        clubs: { select: { club_id: true, name: true } },
        club_types: { select: { name: true } },
      },
    });

    if (!section) return;

    const sectionName = section.name ?? section.club_types?.name ?? 'Sección';
    const clubName = section.clubs?.name ?? 'Club';
    const clubId = section.clubs?.club_id;

    for (const winner of winners) {
      try {
        // Notify the elected member
        await this.notificationsService.notifySafe(
          winner.user_id,
          '¡Reconocimiento del mes!',
          `Tu constancia destacó en ${sectionName} de ${clubName}. ¡Fuiste elegido miembro del mes!`,
          {
            type: 'member_of_month',
            club_id: String(clubId ?? ''),
            section_id: String(sectionId),
            month: String(month),
            year: String(year),
          },
          'units:member_of_month',
        );

        // Mark as notified
        await this.prisma.member_of_month.updateMany({
          where: {
            club_section_id: sectionId,
            user_id: winner.user_id,
            month,
            year,
          },
          data: { notified: true },
        });
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to notify winner ${winner.user_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Notify club directors
    if (clubId) {
      const winnerNames = await this.getWinnerNames(
        winners.map((w) => w.user_id),
      );
      const pointsLabel = winners[0]
        ? ` con ${winners[0].total_points} puntos`
        : '';

      // Get all director role assignments for this section
      const directorAssignments =
        await this.prisma.club_role_assignments.findMany({
          where: {
            club_section_id: sectionId,
            active: true,
            status: 'active',
            roles: {
              role_name: { in: ['director', 'sub-director', 'directora'] },
            },
          },
          select: { user_id: true },
        });

      const directorIds = [
        ...new Set(directorAssignments.map((a) => a.user_id)),
      ];

      for (const directorId of directorIds) {
        try {
          await this.notificationsService.notifySafe(
            directorId,
            '¡Reconocimiento del mes!',
            `${winnerNames} destacó en ${sectionName}${pointsLabel}`,
            {
              type: 'member_of_month_director',
              club_id: String(clubId),
              section_id: String(sectionId),
              month: String(month),
              year: String(year),
            },
            'units:member_of_month_director',
          );
        } catch (err: unknown) {
          this.logger.warn(
            `Failed to notify director ${directorId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  private async getWinnerNames(userIds: string[]): Promise<string> {
    const users = await this.prisma.users.findMany({
      where: { user_id: { in: userIds } },
      select: { name: true, paternal_last_name: true },
    });

    return users
      .map((u) => `${u.name ?? ''} ${u.paternal_last_name ?? ''}`.trim())
      .join(', ');
  }

  // ============================================================
  // Week calculation helpers
  // ============================================================

  /**
   * Returns the ISO week range (start and end week numbers) that fall
   * within the given calendar month.
   * Strategy: find weeks where the Thursday falls in the target month
   * (ISO 8601 standard: a week belongs to the month containing its Thursday).
   */
  private getWeekRangeForMonth(
    year: number,
    month: number,
  ): { startWeek: number; endWeek: number } {
    const weeks: number[] = [];

    // Iterate through all days of the month
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      // Only count each week once — use Monday to anchor
      if (date.getDay() === 1) {
        // Monday
        const weekNum = this.getISOWeekNumber(date);
        weeks.push(weekNum);
      }
    }

    // Edge: if the month starts on non-Monday, include the week of the 1st
    const firstDay = new Date(year, month - 1, 1);
    if (firstDay.getDay() !== 1) {
      weeks.unshift(this.getISOWeekNumber(firstDay));
    }

    const uniqueWeeks = [...new Set(weeks)].sort((a, b) => a - b);

    if (uniqueWeeks.length === 0) {
      return { startWeek: 1, endWeek: 52 };
    }

    return {
      startWeek: Math.min(...uniqueWeeks),
      endWeek: Math.max(...uniqueWeeks),
    };
  }

  private getISOWeekNumber(date: Date): number {
    const target = new Date(date.valueOf());
    const dayNumber = (date.getDay() + 6) % 7; // Mon=0, Sun=6
    target.setDate(target.getDate() - dayNumber + 3); // Move to Thursday
    const firstThursday = new Date(target.getFullYear(), 0, 4); // First Thursday of year is always in week 1
    const weekNumber =
      1 +
      Math.round(
        (target.getTime() - firstThursday.getTime()) /
          (7 * 24 * 60 * 60 * 1000),
      );
    return weekNumber;
  }

  // ============================================================
  // Validation helpers
  // ============================================================

  /**
   * C6: Ensures the requesting user holds a director-level role in the given section.
   * Throws ForbiddenException if no matching active assignment is found.
   */
  private async assertIsDirector(
    userId: string,
    sectionId: number,
  ): Promise<void> {
    const directorAssignment =
      await this.prisma.club_role_assignments.findFirst({
        where: {
          user_id: userId,
          club_section_id: sectionId,
          active: true,
          status: 'active',
          roles: {
            role_name: { in: ['director', 'sub-director', 'directora'] },
          },
        },
        select: { assignment_id: true },
      });

    if (!directorAssignment) {
      throw new AppForbiddenException(ErrorCode.MOM_FORBIDDEN);
    }
  }

  private async validateClubSection(
    clubId: number,
    sectionId: number,
  ): Promise<void> {
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { main_club_id: true },
    });

    if (!section) {
      throw new AppNotFoundException(ErrorCode.MOM_SECTION_NOT_FOUND);
    }

    if (section.main_club_id !== clubId) {
      throw new AppNotFoundException(ErrorCode.MOM_SECTION_NOT_FOUND);
    }
  }
}
