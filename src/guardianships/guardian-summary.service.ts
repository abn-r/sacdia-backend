import { Injectable, Logger } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { fireEvent } from '../auth/supervised/supervised-login-events.port';
import { ageToday, calendarDateIn } from '../common/age/age.util';
import { CountryAgePolicyService } from '../common/age/country-age-policy.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { ClassRequirementEligibilityService } from '../classes/class-requirement-eligibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { GuardianPowersPolicy } from './guardian-powers.policy';

export interface GuardianSummary {
  dependent: {
    user_id: string;
    name: string | null;
    age: number;
    access_mode: 'guardian_managed' | 'supervised_login';
  };
  classes: Array<{
    class_id: number;
    name: string;
    status: string;
    progress_percent: number;
    sections_completed: number;
    sections_total: number;
  }>;
  honors: { completed: number; in_progress: number };
  attendance: {
    from: string | null;
    to: string | null;
    activities_total: number;
    activities_attended: number;
    last_attended_on: string | null;
  };
  /** No member-dues ledger is wired in Phase 3. */
  dues: null;
  generated_at: string;
}

const HONORS_IN_PROGRESS = ['IN_PROGRESS', 'PENDING_REVIEW'] as const;

function notFound(): AppException {
  return new AppException(ErrorCode.GUARDIANSHIP_NOT_FOUND, 404);
}

/** `attendees` is a JSON array of user ids; anything else counts as nobody. */
function attendeeIds(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [],
  );
}

/**
 * What a VERIFIED guardian may see about a minor's progress (Phase 3a, FP3-26).
 * The payload is a closed allowlist: class progress, honor counts, attendance of
 * the current ecclesiastical year and (never yet) dues. It NEVER carries health
 * data (allergies, diseases, medicines, emergency contacts), evidence files or
 * images, counselor notes, other members' data, contact data, location or
 * messages. It works for every access mode (managed child, linked device, own
 * login): the guardian reads it as themself.
 *
 * Errors: a pending guardian is 409 GUARDIANSHIP_CONSENT_NOT_VERIFIED; a
 * stranger, the guardian of another child, a custodian and anyone past the age of
 * majority are the same 404 GUARDIANSHIP_NOT_FOUND. Every read is audited.
 */
@Injectable()
export class GuardianSummaryService {
  private readonly logger = new Logger(GuardianSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly powers: GuardianPowersPolicy,
    private readonly eligibility: ClassRequirementEligibilityService,
    private readonly ecclesiasticalYear: EcclesiasticalYearService,
    private readonly countryAgePolicy: CountryAgePolicyService,
    private readonly audit: AuditLogsService,
  ) {}

  async getSummary(
    guardianId: string,
    dependentId: string,
  ): Promise<GuardianSummary> {
    const guardianship = await this.powers.assertVerifiedGuardian(
      guardianId,
      dependentId,
      { pending: 'conflict' },
    );

    const dependent = await this.prisma.users.findUnique({
      where: { user_id: dependentId },
      select: {
        user_id: true,
        name: true,
        birthday: true,
        country_id: true,
        account: { select: { id: true }, take: 1 },
        supervised_login: { select: { origin: true, disabled_at: true } },
      },
    });
    if (!dependent || !dependent.birthday) throw notFound();

    const policy = await this.countryAgePolicy.getPolicy(dependent.country_id);
    const age = ageToday(dependent.birthday, policy.timeZone);
    if (age >= policy.ageOfMajority) throw notFound();

    const login = dependent.supervised_login;
    const guardianManaged =
      dependent.account.length === 0 ||
      (login?.origin === 'guardian_enabled' && login.disabled_at !== null);

    const now = new Date();
    const [classes, honors, attendance] = await Promise.all([
      this.classProgress(dependentId),
      this.honorCounts(dependentId),
      this.attendanceOf(dependentId, calendarDateIn(policy.timeZone, now)),
    ]);

    // Audited like every read of a minor's data; never blocks the read.
    void fireEvent(
      () =>
        this.audit.recordEvent({
          entity_type: 'guardianship',
          entity_id: guardianship.guardianship_id,
          action: 'summary_viewed',
          actor_user_id: guardianId,
          target_user_id: dependentId,
          summary: 'Resumen del menor consultado por su tutor',
        }),
      (error) =>
        this.logger.warn(
          `summary_viewed audit failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );

    return {
      dependent: {
        user_id: dependent.user_id,
        name: dependent.name,
        age,
        access_mode: guardianManaged ? 'guardian_managed' : 'supervised_login',
      },
      classes,
      honors,
      attendance,
      dues: null,
      generated_at: now.toISOString(),
    };
  }

  private async classProgress(
    dependentId: string,
  ): Promise<GuardianSummary['classes']> {
    const enrollments = await this.prisma.enrollments.findMany({
      where: {
        user_id: dependentId,
        active: true,
        record_kind: 'OPERATIONAL',
      },
      orderBy: [{ ecclesiastical_year_id: 'desc' }, { enrollment_id: 'desc' }],
      select: {
        enrollment_id: true,
        class_id: true,
        investiture_status: true,
        classes: { select: { name: true } },
      },
    });

    // The newest enrollment of each class.
    const seen = new Set<number>();
    const latest = enrollments.filter((row) => {
      if (seen.has(row.class_id)) return false;
      seen.add(row.class_id);
      return true;
    });

    const rows: GuardianSummary['classes'] = [];
    for (const enrollment of latest) {
      const result = await this.eligibility.calculateForEnrollment(
        enrollment.enrollment_id,
      );
      rows.push({
        class_id: enrollment.class_id,
        name: enrollment.classes.name,
        status: enrollment.investiture_status,
        progress_percent: result?.overall_progress ?? 0,
        sections_completed: result?.investiture_progress.completed ?? 0,
        sections_total: result?.investiture_progress.total ?? 0,
      });
    }
    return rows;
  }

  private async honorCounts(
    dependentId: string,
  ): Promise<GuardianSummary['honors']> {
    const [completed, inProgress] = await Promise.all([
      this.prisma.users_honors.count({
        where: {
          user_id: dependentId,
          active: true,
          validation_status: 'APPROVED',
        },
      }),
      this.prisma.users_honors.count({
        where: {
          user_id: dependentId,
          active: true,
          validation_status: { in: [...HONORS_IN_PROGRESS] },
        },
      }),
    ]);
    return { completed, in_progress: inProgress };
  }

  /**
   * Activities of the child's active section from the start of the current
   * ecclesiastical year up to today, against the ones that list the child as
   * attendee. No names of other attendees ever leave this method.
   */
  private async attendanceOf(
    dependentId: string,
    today: Date,
  ): Promise<GuardianSummary['attendance']> {
    const empty = {
      from: null,
      to: null,
      activities_total: 0,
      activities_attended: 0,
      last_attended_on: null,
    };

    let year: { year_id: number; start_date: Date };
    try {
      year = await this.ecclesiasticalYear.getCurrentYear();
    } catch (error) {
      this.logger.warn(
        `No current ecclesiastical year for the summary: ${error instanceof Error ? error.message : String(error)}`,
      );
      return empty;
    }

    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: dependentId,
        active: true,
        status: 'active',
        ecclesiastical_year_id: year.year_id,
        club_section_id: { not: null },
      },
      select: { club_section_id: true },
    });
    const from = year.start_date.toISOString().slice(0, 10);
    const to = today.toISOString().slice(0, 10);
    if (!assignment?.club_section_id) {
      return { ...empty, from, to };
    }

    const activities = await this.prisma.activities.findMany({
      where: {
        club_section_id: assignment.club_section_id,
        active: true,
        activity_date: { gte: year.start_date, lte: today },
      },
      select: { activity_date: true, attendees: true },
    });

    let attended = 0;
    let last: Date | null = null;
    for (const activity of activities) {
      if (!attendeeIds(activity.attendees).has(dependentId)) continue;
      attended += 1;
      if (activity.activity_date && (!last || activity.activity_date > last)) {
        last = activity.activity_date;
      }
    }
    return {
      from,
      to,
      activities_total: activities.length,
      activities_attended: attended,
      last_attended_on: last ? last.toISOString().slice(0, 10) : null,
    };
  }
}
