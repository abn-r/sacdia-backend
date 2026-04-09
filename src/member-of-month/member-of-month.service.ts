import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

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

    const skip = (page - 1) * limit;

    const entries = await this.prisma.member_of_month.findMany({
      where: { club_section_id: sectionId },
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
      skip,
      take: limit,
    });

    const total = await this.prisma.member_of_month.count({
      where: { club_section_id: sectionId },
    });

    // Group entries by month/year
    const grouped = new Map<string, typeof entries>();
    for (const entry of entries) {
      const key = `${entry.year}-${entry.month}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(entry);
    }

    const data = Array.from(grouped.entries()).map(([_key, group]) => ({
      month: group[0].month,
      year: group[0].year,
      members: group.map((e) => ({
        user_id: e.user_id,
        name: `${e.users.name ?? ''} ${e.users.paternal_last_name ?? ''}`.trim(),
        photo_url: e.users.user_image ?? null,
        total_points: e.total_points,
      })),
    }));

    return {
      data,
      pagination: { page, limit, total },
    };
  }

  // ============================================================
  // Evaluation
  // ============================================================

  async evaluateMemberOfMonth(
    clubId: number,
    sectionId: number,
    month: number,
    year: number,
  ) {
    await this.validateClubSection(clubId, sectionId);
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
  ): Promise<{ winners: MemberResult[]; section_id: number; month: number; year: number }> {
    // 1. Calculate ISO week range for the given month/year
    const weekRange = this.getWeekRangeForMonth(year, month);

    // 2. Aggregate points per user for that section and week range
    // Path: weekly_record_scores -> weekly_records (week in range)
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
        AND wr.week >= ${weekRange.startWeek}
        AND wr.week <= ${weekRange.endWeek}
        AND wr.active = true
      LEFT JOIN weekly_record_scores wrs ON wrs.record_id = wr.record_id
      WHERE um.active = true
      GROUP BY um.user_id
      HAVING COALESCE(SUM(wrs.points), 0) > 0
    `;

    if (!scores || scores.length === 0) {
      this.logger.log(
        `No scores found for section ${sectionId}, month ${month}/${year}`,
      );
      return { winners: [], section_id: sectionId, month, year };
    }

    // 3. Find max points and all tied winners
    const maxPoints = Math.max(...scores.map((s) => Number(s.total_points)));
    const winners = scores.filter(
      (s) => Number(s.total_points) === maxPoints,
    );

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

    // 5. Send notifications (non-blocking)
    this.sendMemberOfMonthNotifications(
      sectionId,
      winners,
      month,
      year,
    ).catch((err) => {
      this.logger.warn(
        `Failed to send member-of-month notifications: ${err.message}`,
      );
    });

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
          '¡Felicidades!',
          `Fuiste elegido Miembro del Mes de ${sectionName} en ${clubName}`,
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
      } catch (err) {
        this.logger.warn(
          `Failed to notify winner ${winner.user_id}: ${err.message}`,
        );
      }
    }

    // Notify club directors
    if (clubId) {
      const winnerNames = await this.getWinnerNames(winners.map((w) => w.user_id));
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

      const directorIds = [...new Set(directorAssignments.map((a) => a.user_id))];

      for (const directorId of directorIds) {
        try {
          await this.notificationsService.notifySafe(
            directorId,
            'Miembro del Mes',
            `${winnerNames} fue elegido Miembro del Mes de ${sectionName}${pointsLabel}`,
            {
              type: 'member_of_month_director',
              club_id: String(clubId),
              section_id: String(sectionId),
              month: String(month),
              year: String(year),
            },
            'units:member_of_month_director',
          );
        } catch (err) {
          this.logger.warn(
            `Failed to notify director ${directorId}: ${err.message}`,
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

  private async validateClubSection(
    clubId: number,
    sectionId: number,
  ): Promise<void> {
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { main_club_id: true },
    });

    if (!section) {
      throw new NotFoundException(`Section ${sectionId} not found`);
    }

    if (section.main_club_id !== clubId) {
      throw new NotFoundException(
        `Section ${sectionId} does not belong to club ${clubId}`,
      );
    }
  }
}
