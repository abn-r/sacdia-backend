import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { ClassRequirementEligibilityService } from '../classes/class-requirement-eligibility.service';

export interface UpcomingActivityDto {
  id: number;
  title: string;
  /** @deprecated Use `activity_date` + `activity_time` instead. Will be removed in a future version. */
  date: string;
  activity_date: string | null;
  activity_time: string | null;
  location: string | null;
}

export interface DashboardSummaryDto {
  user_name: string;
  user_avatar: string | null;
  club_name: string | null;
  club_type: string | null;
  user_role: string | null;
  current_class_name: string | null;
  current_class_id: number | null;
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
    private readonly requirementEligibility: ClassRequirementEligibilityService,
  ) {}

  async getSummary(userId: string): Promise<DashboardSummaryDto> {
    // One Prisma round-trip for identity + active context + honors + class.
    // Club pick is in-memory from users_pr.active_club_assignment_id (same
    // canon as AuthorizationContextService / PATCH /auth/me/context).
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        user_image: true,
        users_pr: { select: { active_club_assignment_id: true } },
        users_honors: {
          where: { active: true },
          select: { validate: true },
        },
        enrollments: {
          where: { active: true },
          orderBy: { created_at: 'desc' },
          take: 1,
          select: {
            enrollment_id: true,
            user_id: true,
            class_id: true,
            ecclesiastical_year_id: true,
            classes: {
              select: {
                class_id: true,
                name: true,
                club_type_id: true,
                advanced_enabled: true,
              },
            },
            ecclesiastical_year: {
              select: {
                year_id: true,
                start_date: true,
              },
            },
          },
        },
        club_role_assignments: {
          where: { active: true, status: 'active' },
          orderBy: { start_date: 'desc' },
          select: {
            assignment_id: true,
            club_sections: {
              select: {
                club_section_id: true,
                club_types: { select: { name: true } },
                clubs: { select: { name: true } },
              },
            },
            roles: { select: { role_name: true } },
          },
        },
      },
    });

    const enrollment = user?.enrollments[0] ?? null;
    const honors = user?.users_honors ?? [];
    const clubAssignment = this.pickActiveClubAssignment(
      userId,
      user?.users_pr?.active_club_assignment_id,
      user?.club_role_assignments ?? [],
    );

    const nameParts = [
      user?.name,
      user?.paternal_last_name,
      user?.maternal_last_name,
    ].filter(Boolean);
    const userName = nameParts.length > 0 ? nameParts.join(' ') : 'Usuario';

    const honorsCompleted = honors.filter((h) => h.validate).length;
    const honorsInProgress = honors.filter((h) => !h.validate).length;

    const section = clubAssignment?.club_sections;
    const clubName = section?.clubs?.name ?? null;
    const clubType = section?.club_types?.name ?? null;
    const userRole = clubAssignment?.roles?.role_name ?? null;
    const clubSectionId = section?.club_section_id ?? null;

    const [eligibility, upcomingActivities, userAvatar] = await Promise.all([
      enrollment
        ? this.requirementEligibility.calculateForEnrollmentRecord(enrollment)
        : Promise.resolve(null),
      this.loadUpcomingActivities(clubSectionId),
      this.resolveAvatarUrl(user?.user_image),
    ]);

    return {
      user_name: userName,
      user_avatar: userAvatar,
      club_name: clubName,
      club_type: clubType,
      user_role: userRole,
      current_class_name: enrollment?.classes.name ?? null,
      current_class_id: enrollment?.class_id ?? null,
      class_progress: eligibility?.overall_progress ?? 0,
      honors_completed: honorsCompleted,
      honors_in_progress: honorsInProgress,
      upcoming_activities: upcomingActivities,
    };
  }

  // ----------------------------------------
  // Private helpers
  // ----------------------------------------

  private pickActiveClubAssignment<
    T extends { assignment_id: string },
  >(
    userId: string,
    storedAssignmentId: string | null | undefined,
    activeAssignments: T[],
  ): T | null {
    if (storedAssignmentId) {
      const explicit = activeAssignments.find(
        (assignment) => assignment.assignment_id === storedAssignmentId,
      );
      if (explicit) return explicit;

      this.logger.warn(
        `Dashboard: stored active_club_assignment_id ${storedAssignmentId} is no longer active for user ${userId}. Falling back to most recent.`,
      );
    }

    return activeAssignments[0] ?? null;
  }

  private async loadUpcomingActivities(
    clubSectionId: number | null,
  ): Promise<UpcomingActivityDto[]> {
    if (clubSectionId === null) return [];

    const activities = await this.prisma.activities.findMany({
      where: {
        activity_instances: {
          some: {
            active: true,
            club_section_id: clubSectionId,
          },
        },
        active: true,
        activity_date: { gte: new Date() },
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

    return activities.map((a) => {
      // Extract date-only string (YYYY-MM-DD) directly from the UTC midnight
      // Date value stored in the DB (@db.Date). Using split('T')[0] on the
      // ISO string is safe because Prisma stores @db.Date as UTC midnight,
      // so the date component is always correct regardless of the server TZ.
      const activityDateOnly = a.activity_date
        ? a.activity_date.toISOString().split('T')[0]
        : null;

      // Build the deprecated combined field using the date-only string to
      // avoid the UTC-offset bug that treated local HH:mm as if it were UTC.
      // Kept for backwards-compat — consumers should migrate to activity_date
      // + activity_time fields.
      const legacyDate = activityDateOnly
        ? `${activityDateOnly}T${a.activity_time ?? '00:00'}:00`
        : new Date().toISOString();

      return {
        id: a.activity_id,
        title: a.name,
        date: legacyDate,
        activity_date: activityDateOnly,
        activity_time: a.activity_time ?? null,
        location: a.activity_place ?? null,
      };
    });
  }

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
