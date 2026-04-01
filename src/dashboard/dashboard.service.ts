import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';

export interface UpcomingActivityDto {
  id: number;
  title: string;
  date: string;
  location: string | null;
}

export interface DashboardSummaryDto {
  user_name: string;
  user_avatar: string | null;
  club_name: string | null;
  club_type: string | null;
  user_role: string | null;
  current_class_name: string | null;
  class_progress: number;
  honors_completed: number;
  honors_in_progress: number;
  upcoming_activities: UpcomingActivityDto[];
}

// Signed URL TTL matches the one used by AuthService (5 minutes).
const AVATAR_SIGNED_URL_TTL_SECONDS = 300;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  async getSummary(userId: string): Promise<DashboardSummaryDto> {
    const [user, enrollment, honors, clubAssignment] = await Promise.all([
      this.prisma.users.findUnique({
        where: { user_id: userId },
        select: {
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
          user_image: true,
        },
      }),
      this.prisma.enrollments.findFirst({
        where: { user_id: userId, active: true },
        orderBy: { created_at: 'desc' },
        select: {
          enrollment_id: true,
          class_id: true,
          classes: { select: { name: true } },
        },
      }),
      this.prisma.users_honors.findMany({
        where: { user_id: userId, active: true },
        select: { validate: true },
      }),
      this.prisma.club_role_assignments.findFirst({
        where: { user_id: userId, active: true },
        orderBy: { created_at: 'desc' },
        select: {
          club_sections: {
            select: {
              club_section_id: true,
              club_types: { select: { name: true } },
              clubs: { select: { name: true } },
            },
          },
          roles: { select: { role_name: true } },
        },
      }),
    ]);

    // ----------------------------------------
    // User name
    // ----------------------------------------
    const nameParts = [
      user?.name,
      user?.paternal_last_name,
      user?.maternal_last_name,
    ].filter(Boolean);
    const userName = nameParts.length > 0 ? nameParts.join(' ') : 'Usuario';

    // ----------------------------------------
    // Class progress
    // ----------------------------------------
    let currentClassName: string | null = null;
    let classProgress = 0;

    if (enrollment) {
      currentClassName = enrollment.classes.name;

      const [completedSections, totalSections] = await Promise.all([
        // A section is considered complete only when score >= 70,
        // consistent with the business rule in ClassesService.
        this.prisma.class_section_progress.count({
          where: {
            enrollment_id: enrollment.enrollment_id,
            user_id: userId,
            active: true,
            score: { gte: 70 },
          },
        }),
        this.prisma.class_sections.count({
          where: {
            active: true,
            class_modules: {
              class_id: enrollment.class_id,
              active: true,
            },
          },
        }),
      ]);

      classProgress =
        totalSections > 0
          ? Math.round((completedSections / totalSections) * 100)
          : 0;
    }

    // ----------------------------------------
    // Honors
    // ----------------------------------------
    const honorsCompleted = honors.filter((h) => h.validate).length;
    const honorsInProgress = honors.filter((h) => !h.validate).length;

    // ----------------------------------------
    // Club info
    // ----------------------------------------
    let clubName: string | null = null;
    let clubType: string | null = null;
    let userRole: string | null = null;
    let clubSectionId: number | null = null;

    if (clubAssignment) {
      const section = clubAssignment.club_sections;
      clubName = section?.clubs?.name ?? null;
      clubType = section?.club_types?.name ?? null;
      userRole = clubAssignment.roles?.role_name ?? null;
      clubSectionId = section?.club_section_id ?? null;
    }

    // ----------------------------------------
    // Upcoming activities (next 5 from user's section)
    // ----------------------------------------
    const upcomingActivities: UpcomingActivityDto[] = [];

    if (clubSectionId !== null) {
      const now = new Date();

      const activities = await this.prisma.activities.findMany({
        where: {
          club_section_id: clubSectionId,
          active: true,
          activity_date: { gte: now },
        },
        orderBy: { activity_date: 'asc' },
        take: 5,
        select: {
          activity_id: true,
          name: true,
          activity_date: true,
          activity_time: true,
          activity_place: true,
          activity_types: { select: { name: true } },
        },
      });

      for (const a of activities) {
        // Combine activity_date (Date) with activity_time (HH:mm string) into a
        // single ISO timestamp so the Flutter widget can display both day and time.
        let activityDateTime: string;
        if (a.activity_date) {
          const dateStr = a.activity_date.toISOString().split('T')[0]; // YYYY-MM-DD
          const timeStr = a.activity_time ?? '00:00';
          activityDateTime = new Date(
            `${dateStr}T${timeStr}:00.000Z`,
          ).toISOString();
        } else {
          activityDateTime = new Date().toISOString();
        }

        upcomingActivities.push({
          id: a.activity_id,
          title: a.name,
          date: activityDateTime,
          location: a.activity_place ?? null,
        });
      }
    }

    return {
      user_name: userName,
      user_avatar: await this.resolveAvatarUrl(user?.user_image),
      club_name: clubName,
      club_type: clubType,
      user_role: userRole,
      current_class_name: currentClassName,
      class_progress: classProgress,
      honors_completed: honorsCompleted,
      honors_in_progress: honorsInProgress,
      upcoming_activities: upcomingActivities,
    };
  }

  // ----------------------------------------
  // Private helpers
  // ----------------------------------------

  /**
   * Generates a short-lived signed download URL for the user's profile picture
   * stored in R2. Returns null when no image is set. Falls back to returning
   * the stored value as-is if the signing step fails (avoids breaking the
   * dashboard for a non-critical asset).
   */
  private async resolveAvatarUrl(
    userImage: string | null | undefined,
  ): Promise<string | null> {
    if (!userImage) return null;

    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        userImage,
        { expiresInSeconds: AVATAR_SIGNED_URL_TTL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(
        'Failed to generate signed URL for dashboard avatar. Returning stored value.',
        error,
      );
      return userImage;
    }
  }
}
