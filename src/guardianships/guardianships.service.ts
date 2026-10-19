import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import {
  ageAt,
  ageToday,
  calendarDateIn,
  isBirthdayInFuture,
  parseCalendarDate,
} from '../common/age/age.util';
import {
  CountryAgePolicyService,
  type CountryAgePolicy,
} from '../common/age/country-age-policy.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { LegalService } from '../legal/legal.service';
import { PrismaService } from '../prisma/prisma.service';
import type { SessionRequestContext } from '../better-auth/better-auth.service';
import type { CreateDependentDto } from './dto';
import {
  NOT_REVOKED,
  VISIBLE_DEPENDENT,
  displayName,
  loadClubMemberships,
  type Db,
} from './guardianship-queries';
import { MAX_DEPENDENTS_PER_GUARDIAN } from './guardianships.constants';
import type {
  DependentDetail,
  DependentGuardianEntry,
  DependentSummary,
} from './guardianships.types';

const SUMMARY_SELECT = {
  guardianship_id: true,
  dependent_user_id: true,
  is_primary: true,
  consent_status: true,
  verified_at: true,
  relationship_type: {
    select: { relationship_type_id: true, name: true },
  },
  dependent: {
    select: {
      // The signed form hangs on the dependent's consent row (the active
      // primary holder), so every guardian sees the same `evidence_uploaded`.
      guardianships_as_dependent: {
        where: { is_primary: true, is_test_data: false, ...NOT_REVOKED },
        take: 1,
        select: {
          consent_evidences: {
            where: { superseded_at: null, purged_at: null },
            select: { evidence_id: true },
            take: 1,
          },
        },
      },
      user_id: true,
      name: true,
      paternal_last_name: true,
      maternal_last_name: true,
      birthday: true,
      user_image: true,
      country_id: true,
      users_pr: { select: { complete: true } },
      dependent_profile: { select: { frozen_at: true } },
    },
  },
} satisfies Prisma.guardianshipsSelect;

type SummaryRow = Prisma.guardianshipsGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;

function unprocessable(code: ErrorCode): AppException {
  return new AppException(code, HttpStatus.UNPROCESSABLE_ENTITY);
}

/**
 * Dependents: minors with a profile but no account, managed by one or more
 * guardians. Every state change bumps the acting-for epoch AFTER it commits so
 * a revoked or newly linked guardian is honored on the very next request.
 */
@Injectable()
export class GuardianshipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countryAgePolicy: CountryAgePolicyService,
    private readonly legalService: LegalService,
    private readonly actingForCache: ActingForCache,
  ) {}

  /**
   * The guardian must be an adult with a birthday. The policy is the
   * GUARDIAN's country policy (ruling A3): the dependent has no country yet.
   */
  async assertAdult(
    userId: string,
    db: Db = this.prisma,
  ): Promise<{ countryId: number | null; policy: CountryAgePolicy }> {
    const user = await db.users.findUnique({
      where: { user_id: userId },
      select: { birthday: true, country_id: true },
    });
    if (!user?.birthday) {
      throw unprocessable(ErrorCode.GUARDIANSHIP_GUARDIAN_BIRTHDAY_REQUIRED);
    }
    const policy = await this.countryAgePolicy.getPolicy(user.country_id);
    if (ageToday(user.birthday, policy.timeZone) < policy.ageOfMajority) {
      throw unprocessable(ErrorCode.GUARDIANSHIP_GUARDIAN_NOT_ADULT);
    }
    return { countryId: user.country_id, policy };
  }

  /** Throws 400 when the relationship type does not exist or is inactive. */
  async assertRelationshipType(
    relationshipTypeId: string,
    db: Db = this.prisma,
  ): Promise<void> {
    const found = await db.relationship_types.findFirst({
      where: { relationship_type_id: relationshipTypeId, active: true },
      select: { relationship_type_id: true },
    });
    if (!found) {
      throw new AppBadRequestException(
        ErrorCode.GUARDIANSHIP_RELATIONSHIP_TYPE_INVALID,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Step 0: create a dependent
  // ---------------------------------------------------------------------------

  async createDependent(
    guardianId: string,
    dto: CreateDependentDto,
    context?: SessionRequestContext,
  ): Promise<DependentSummary> {
    // Stale legal versions first: cheapest check, and nothing was touched yet.
    const versions = {
      terms: dto.accepted_terms_version,
      privacy: dto.accepted_privacy_version,
    };
    this.legalService.assertCurrentVersions(versions);

    const { countryId, policy } = await this.assertAdult(guardianId);
    await this.assertRelationshipType(dto.relationship_type_id);

    const birthday = parseCalendarDate(dto.birthday);
    if (!birthday || isBirthdayInFuture(birthday, policy.timeZone)) {
      throw unprocessable(ErrorCode.GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE);
    }
    const age = ageAt(birthday, calendarDateIn(policy.timeZone));
    if (age < 0 || age >= policy.minSelfLoginAge) {
      // 13 and older get their own account (Phase 3), not a managed profile.
      throw unprocessable(ErrorCode.GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE);
    }

    const dependentId = randomUUID();
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent creates of the same guardian so the limit holds.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guardianships:create:${guardianId}`}))`;

      const activeDependents = await tx.guardianships.count({
        where: {
          guardian_user_id: guardianId,
          is_custodian: false,
          ...NOT_REVOKED,
          dependent: VISIBLE_DEPENDENT,
        },
      });
      if (activeDependents >= MAX_DEPENDENTS_PER_GUARDIAN) {
        throw new AppConflictException(
          ErrorCode.GUARDIANSHIP_DEPENDENT_LIMIT_REACHED,
        );
      }

      const userRole = await tx.roles.findFirst({
        where: { role_name: 'user', role_category: 'GLOBAL' },
        select: { role_id: true },
      });
      if (!userRole) {
        throw new AppBadRequestException(ErrorCode.AUTH_USER_ROLE_NOT_FOUND);
      }

      await tx.users.create({
        data: {
          user_id: dependentId,
          email: null,
          name: dto.name,
          paternal_last_name: dto.paternal_last_name,
          maternal_last_name: dto.maternal_last_name ?? null,
          birthday,
          country_id: countryId,
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
        data: { user_id: dependentId, created_by_user_id: guardianId },
      });
      await tx.guardianships.create({
        data: {
          dependent_user_id: dependentId,
          guardian_user_id: guardianId,
          relationship_type_id: dto.relationship_type_id,
          is_primary: true,
          consent_status: 'pending',
          sworn_declaration_at: now,
        },
      });
      await this.legalService.recordOnBehalf(
        tx,
        dependentId,
        versions,
        guardianId,
        context,
      );
    });

    await this.actingForCache.bump(dependentId);
    return this.getSummaryForGuardian(guardianId, dependentId);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async listForGuardian(guardianId: string): Promise<{
    dependents: DependentSummary[];
    limits: { max_dependents: number };
  }> {
    const rows = await this.prisma.guardianships.findMany({
      where: {
        guardian_user_id: guardianId,
        is_custodian: false,
        is_test_data: false,
        ...NOT_REVOKED,
        dependent: VISIBLE_DEPENDENT,
      },
      orderBy: { created_at: 'asc' },
      select: SUMMARY_SELECT,
    });
    return {
      dependents: await this.buildSummaries(rows),
      limits: { max_dependents: MAX_DEPENDENTS_PER_GUARDIAN },
    };
  }

  async getSummaryForGuardian(
    guardianId: string,
    dependentId: string,
  ): Promise<DependentSummary> {
    const row = await this.findGuardianRow(guardianId, dependentId);
    return (await this.buildSummaries([row]))[0];
  }

  async getDetailForGuardian(
    guardianId: string,
    dependentId: string,
  ): Promise<DependentDetail> {
    const row = await this.findGuardianRow(guardianId, dependentId);
    const [summary] = await this.buildSummaries([row]);

    const guardians = await this.prisma.guardianships.findMany({
      where: { dependent_user_id: dependentId, ...NOT_REVOKED },
      orderBy: { created_at: 'asc' },
      select: {
        guardianship_id: true,
        guardian_user_id: true,
        is_primary: true,
        is_custodian: true,
        consent_status: true,
        external_name: true,
        relationship_type: { select: { name: true } },
        guardian: { select: { name: true, paternal_last_name: true } },
        custodian_club: { select: { name: true } },
      },
    });

    return {
      ...summary,
      guardians: guardians.map((guardian): DependentGuardianEntry => ({
        guardianship_id: guardian.guardianship_id,
        user_id: guardian.guardian_user_id,
        display_name: guardian.is_custodian
          ? (guardian.custodian_club?.name ?? '')
          : guardian.guardian_user_id
            ? displayName(guardian.guardian)
            : (guardian.external_name ?? ''),
        relationship_type_name: guardian.relationship_type?.name ?? null,
        is_primary: guardian.is_primary,
        is_custodian: guardian.is_custodian,
        consent_status: guardian.consent_status as 'pending' | 'verified',
        is_me: guardian.guardian_user_id === guardianId,
      })),
    };
  }

  /** 404 for strangers, revoked guardians, custodians, frozen and purged. */
  private async findGuardianRow(
    guardianId: string,
    dependentId: string,
  ): Promise<SummaryRow> {
    const row = await this.prisma.guardianships.findFirst({
      where: {
        dependent_user_id: dependentId,
        guardian_user_id: guardianId,
        is_custodian: false,
        is_test_data: false,
        ...NOT_REVOKED,
        dependent: VISIBLE_DEPENDENT,
      },
      select: SUMMARY_SELECT,
    });
    if (!row) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }
    return row;
  }

  private async buildSummaries(
    rows: SummaryRow[],
  ): Promise<DependentSummary[]> {
    if (rows.length === 0) return [];

    const memberships = await loadClubMemberships(
      this.prisma,
      rows.map((row) => row.dependent_user_id),
    );

    const policies = new Map<number | null, CountryAgePolicy>();
    for (const row of rows) {
      const countryId = row.dependent.country_id;
      if (!policies.has(countryId)) {
        policies.set(
          countryId,
          await this.countryAgePolicy.getPolicy(countryId),
        );
      }
    }

    return rows.map((row) => {
      const { dependent } = row;
      const policy = policies.get(dependent.country_id) as CountryAgePolicy;
      return {
        user_id: dependent.user_id,
        name: dependent.name,
        paternal_last_name: dependent.paternal_last_name,
        maternal_last_name: dependent.maternal_last_name,
        birthday: dependent.birthday
          ? dependent.birthday.toISOString().slice(0, 10)
          : null,
        age: dependent.birthday
          ? ageToday(dependent.birthday, policy.timeZone)
          : null,
        user_image: dependent.user_image,
        access_mode: 'guardian_managed',
        post_register_complete: dependent.users_pr?.complete ?? false,
        frozen: dependent.dependent_profile?.frozen_at != null,
        guardianship: {
          guardianship_id: row.guardianship_id,
          is_primary: row.is_primary,
          relationship_type: row.relationship_type,
          consent_status: row.consent_status as 'pending' | 'verified',
          verified_at: row.verified_at ? row.verified_at.toISOString() : null,
          evidence_uploaded:
            (dependent.guardianships_as_dependent[0]?.consent_evidences
              .length ?? 0) > 0,
        },
        club_membership: memberships.get(dependent.user_id) ?? null,
      } satisfies DependentSummary;
    });
  }
}
