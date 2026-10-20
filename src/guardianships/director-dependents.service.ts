import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  getAuditCorrelationId,
  markExplicitAuditRecorded,
} from '../audit-logs/audit-request-context';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import type { SessionRequestContext } from '../better-auth/better-auth.service';
import {
  ageAt,
  calendarDateIn,
  isBirthdayInFuture,
  parseCalendarDate,
} from '../common/age/age.util';
import { CountryAgePolicyService } from '../common/age/country-age-policy.service';
import {
  AppBadRequestException,
  AppException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { LegalService } from '../legal/legal.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDirectorDependentDto } from './dto';

/** Who sees the new request. The creator is never told about their own action. */
const REVIEWER_ROLES = [
  'director',
  'deputy-director',
  'secretary',
  'secretary-treasurer',
] as const;

/** Same stored base timeout post-registration gives a pending request. */
const PENDING_BASE_TIMEOUT_DAYS = 8;

const NEW_REQUEST_SOURCE = 'membership_requests:new_request';

export interface DirectorCreatedDependent {
  dependent: {
    user_id: string;
    name: string;
    birthday: string;
    age: number;
  };
  guardianship: {
    guardianship_id: string;
    is_custodian: true;
    consent_status: 'pending';
  };
  assignment: {
    assignment_id: string;
    status: 'pending';
    club_section_id: number;
  };
}

interface SectionScope {
  clubSectionId: number;
  mainClubId: number;
  countryId: number | null;
}

interface CreateInTransactionInput {
  directorId: string;
  section: SectionScope;
  dto: CreateDirectorDependentDto;
  birthday: Date;
  versions: { terms: string; privacy: string };
  context?: SessionRequestContext;
  now: Date;
}

interface CreatedRows {
  dependentId: string;
  guardianshipId: string;
  assignmentId: string;
}

function unprocessable(code: ErrorCode): AppException {
  return new AppException(code, HttpStatus.UNPROCESSABLE_ENTITY);
}

/**
 * A club director registers a minor from a club section (Phase 3c, FP3-61).
 *
 * The minor is a `users` row WITHOUT an account and without an email, held
 * under CLUB CUSTODY (a custodial guardianship, consent `pending`) and asked to
 * join the section through a PENDING membership request. Nothing here activates
 * a membership: the request is approved later, and only after somebody OTHER
 * than the creator verified the signed paper form (consent four-eyes, FP3-62).
 *
 * Everything is ONE transaction: the user, its flags, the profile, the custody
 * row, the pending assignment, the legal acceptances (recorded for the minor,
 * `accepted_by` = the director, R10) and the audit row commit or roll back
 * together. After the commit the acting-for epoch is bumped and the section's
 * reviewers are told (the creator excluded), best effort.
 *
 * The age rule is the SECTION's country policy: `0 <= age < ageOfMajority`. It
 * is wider than the guardian path on purpose (a 15-year-old is valid here).
 */
@Injectable()
export class DirectorDependentsService {
  private readonly logger = new Logger(DirectorDependentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly countryAgePolicy: CountryAgePolicyService,
    private readonly legalService: LegalService,
    private readonly actingForCache: ActingForCache,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    directorId: string,
    clubSectionId: number,
    dto: CreateDirectorDependentDto,
    context?: SessionRequestContext,
  ): Promise<DirectorCreatedDependent> {
    // Stale legal versions first: cheapest check and nothing was touched yet.
    const versions = {
      terms: dto.accepted_terms_version,
      privacy: dto.accepted_privacy_version,
    };
    this.legalService.assertCurrentVersions(versions);

    const section = await this.loadSection(clubSectionId);
    const policy = await this.countryAgePolicy.getPolicy(section.countryId);

    const birthday = parseCalendarDate(dto.birthday);
    if (!birthday || isBirthdayInFuture(birthday, policy.timeZone)) {
      throw unprocessable(ErrorCode.GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE);
    }
    const age = ageAt(birthday, calendarDateIn(policy.timeZone));
    if (age < 0 || age >= policy.ageOfMajority) {
      throw unprocessable(ErrorCode.GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE);
    }

    const now = new Date();
    const created = await this.prisma.$transaction((tx) =>
      this.createInTransaction(tx, {
        directorId,
        section,
        dto,
        birthday,
        versions,
        context,
        now,
      }),
    );

    // Never throws. The new principal resolves on its next request.
    await this.actingForCache.bump(created.dependentId);
    void this.notifyReviewers(directorId, section.clubSectionId, created);

    return {
      dependent: {
        user_id: created.dependentId,
        name: dto.name,
        birthday: dto.birthday,
        age,
      },
      guardianship: {
        guardianship_id: created.guardianshipId,
        is_custodian: true,
        consent_status: 'pending',
      },
      assignment: {
        assignment_id: created.assignmentId,
        status: 'pending',
        club_section_id: section.clubSectionId,
      },
    };
  }

  /** The country is the one of the section's club, never the director's. */
  private async loadSection(clubSectionId: number): Promise<SectionScope> {
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: clubSectionId },
      select: {
        club_section_id: true,
        main_club_id: true,
        clubs: {
          select: {
            local_fields: {
              select: { unions: { select: { country_id: true } } },
            },
          },
        },
      },
    });
    if (!section || section.main_club_id === null) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }
    return {
      clubSectionId: section.club_section_id,
      mainClubId: section.main_club_id,
      countryId: section.clubs?.local_fields?.unions?.country_id ?? null,
    };
  }

  private async createInTransaction(
    tx: Prisma.TransactionClient,
    input: CreateInTransactionInput,
  ): Promise<CreatedRows> {
    const { directorId, section, dto, birthday, versions, now } = input;

    // Nothing is created without a current ecclesiastical year (the same lookup
    // and code as club selection in post-registration).
    const year = await tx.ecclesiastical_years.findFirst({
      where: { start_date: { lte: now }, end_date: { gte: now } },
      select: { year_id: true, start_date: true },
    });
    if (!year) {
      throw new AppInternalServerErrorException(
        ErrorCode.POST_REG_NO_ACTIVE_YEAR,
      );
    }

    const memberRole = await tx.roles.findFirst({
      where: { role_name: 'member', role_category: 'CLUB' },
      select: { role_id: true },
    });
    if (!memberRole) {
      throw new AppInternalServerErrorException(
        ErrorCode.POST_REG_MEMBER_ROLE_NOT_FOUND,
      );
    }
    const userRole = await tx.roles.findFirst({
      where: { role_name: 'user', role_category: 'GLOBAL' },
      select: { role_id: true },
    });
    if (!userRole) {
      throw new AppBadRequestException(ErrorCode.AUTH_USER_ROLE_NOT_FOUND);
    }

    const dependentId = randomUUID();

    await tx.users.create({
      data: {
        user_id: dependentId,
        email: null,
        name: dto.name,
        paternal_last_name: dto.paternal_last_name,
        maternal_last_name: dto.maternal_last_name ?? null,
        gender: dto.gender ?? null,
        birthday,
        country_id: section.countryId,
      },
    });
    await tx.users_pr.create({
      data: {
        user_id: dependentId,
        complete: false,
        profile_picture_complete: false,
        personal_info_complete: false,
        club_selection_complete: false,
      },
    });
    await tx.users_roles.create({
      data: { user_id: dependentId, role_id: userRole.role_id },
    });
    await tx.dependent_profiles.create({
      data: { user_id: dependentId, created_by_user_id: directorId },
    });

    // Club custody: no guardian user, the club of the section holds the minor.
    const custody = await tx.guardianships.create({
      data: {
        dependent_user_id: dependentId,
        guardian_user_id: null,
        is_custodian: true,
        custodian_club_id: section.mainClubId,
        is_primary: true,
        consent_status: 'pending',
        sworn_declaration_at: now,
      },
      select: { guardianship_id: true },
    });

    // A REQUEST, never a membership: literal 'pending'. The activation gate
    // (inventory spec) classifies this site as no-activation.
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + PENDING_BASE_TIMEOUT_DAYS);
    const assignment = await tx.club_role_assignments.create({
      data: {
        user_id: dependentId,
        role_id: memberRole.role_id,
        club_section_id: section.clubSectionId,
        ecclesiastical_year_id: year.year_id,
        start_date: year.start_date,
        active: true,
        status: 'pending',
        expires_at: expiresAt,
      },
      select: { assignment_id: true },
    });

    // R10: terms and privacy accepted FOR the minor, by the director.
    await this.legalService.recordOnBehalf(
      tx,
      dependentId,
      versions,
      directorId,
      input.context,
    );

    // The domain row replaces the generic HTTP one for this request.
    markExplicitAuditRecorded();
    await tx.audit_logs.create({
      data: {
        entity_type: 'dependent',
        entity_id: dependentId,
        action: 'created_by_director',
        actor_user_id: directorId,
        actor_kind: 'user',
        target_user_id: dependentId,
        summary: 'Menor registrado por un director bajo custodia del club',
        changes: {
          club_section_id: section.clubSectionId,
          assignment_id: assignment.assignment_id,
          guardianship_id: custody.guardianship_id,
          custodian_club_id: section.mainClubId,
          ecclesiastical_year_id: year.year_id,
          sworn_declaration: true,
        },
        result: 'succeeded',
        source: 'service',
        correlation_id: getAuditCorrelationId() ?? null,
        effective_at: now,
      },
    });

    return {
      dependentId,
      guardianshipId: custody.guardianship_id,
      assignmentId: assignment.assignment_id,
    };
  }

  /**
   * "Minor - consent pending" to the section's reviewers, the creator excluded
   * (FP3-61). One notice per person through the normal user path, so each one's
   * preferences apply. Best effort: it never throws and never delays the
   * response.
   */
  private async notifyReviewers(
    creatorId: string,
    clubSectionId: number,
    created: CreatedRows,
  ): Promise<void> {
    try {
      const reviewers = await this.prisma.club_role_assignments.findMany({
        where: {
          club_section_id: clubSectionId,
          active: true,
          status: 'active',
          roles: { role_name: { in: [...REVIEWER_ROLES] } },
        },
        select: { user_id: true },
      });
      const recipients = [
        ...new Set(reviewers.map((row) => row.user_id)),
      ].filter((userId) => userId !== creatorId);

      await Promise.allSettled(
        recipients.map((userId) =>
          this.notifications.sendToUser(
            {
              userId,
              title: 'Menor · consentimiento pendiente',
              body: 'Hay una solicitud de un menor lista para revisar. Verifica la ficha de consentimiento firmada antes de aprobarla.',
              data: {
                type: 'membership_request_created',
                userId: created.dependentId,
                assignmentId: created.assignmentId,
                clubSectionId: String(clubSectionId),
              },
            },
            'system',
            NEW_REQUEST_SOURCE,
          ),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Reviewer notice for director-created minor ${created.dependentId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
