import { Injectable, Logger } from '@nestjs/common';
import {
  AppException,
  AppServiceUnavailableException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ageToday } from '../../common/age/age.util';
import { CountryAgePolicyService } from '../../common/age/country-age-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ActingForCache,
  type ActingDenyCause,
  type ActingResolution,
} from './acting-for.cache';
import {
  GUARDIAN_PENDING_SCOPES,
  GUARDIAN_VERIFIED_SCOPES,
} from './auth-principal';

/**
 * Decides whether `guardianId` may act for `dependentId` right now.
 *
 * Phase 2 cuts acting off at the AGE OF MAJORITY, not at 13: the 13 cutoff is
 * enforced only when a dependent is created, so a child who turns 13 before the
 * Phase 3 supervised login is not locked out. Once an `account` row exists for
 * the dependent, acting stops working.
 *
 * Failure policy: a Redis error falls back to the database; a database error is
 * a 503 (AUTH_REVOCATION_CHECK_UNAVAILABLE). It never fails open.
 */
@Injectable()
export class ActingForResolver {
  private readonly logger = new Logger(ActingForResolver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ActingForCache,
    private readonly countryAgePolicy: CountryAgePolicyService,
  ) {}

  async resolve(
    guardianId: string,
    dependentId: string,
  ): Promise<ActingResolution> {
    let epoch: number | null;
    try {
      epoch = await this.cache.getEpoch(dependentId);
      const cached = await this.cache.get(dependentId, epoch, guardianId);
      if (cached) {
        return cached;
      }
    } catch (error) {
      // No usable cache: skip the write-back below and decide from the database.
      epoch = null;
      this.logger.warn(
        JSON.stringify({
          event: 'acting_for_cache_unavailable',
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    const resolution = await this.loadFromDatabase(guardianId, dependentId);

    if (epoch !== null) {
      try {
        await this.cache.set(dependentId, epoch, guardianId, resolution);
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'acting_for_cache_write_failed',
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    return resolution;
  }

  private async loadFromDatabase(
    guardianId: string,
    dependentId: string,
  ): Promise<ActingResolution> {
    try {
      const guardianship = await this.prisma.guardianships.findFirst({
        where: {
          dependent_user_id: dependentId,
          guardian_user_id: guardianId,
          is_custodian: false,
          is_test_data: false,
          consent_status: { in: ['pending', 'verified'] },
          dependent: {
            active: true,
            account: { none: {} },
            dependent_profile: { is: { frozen_at: null, purged_at: null } },
          },
        },
        select: {
          guardianship_id: true,
          consent_status: true,
          dependent: { select: { birthday: true, country_id: true } },
        },
      });

      if (!guardianship) {
        return {
          granted: false,
          cause: await this.diagnoseDenial(guardianId, dependentId),
        };
      }

      const { birthday, country_id } = guardianship.dependent;
      if (!birthday) {
        return { granted: false, cause: 'birthday_missing' };
      }

      const policy = await this.countryAgePolicy.getPolicy(country_id);
      if (ageToday(birthday, policy.timeZone) >= policy.ageOfMajority) {
        return { granted: false, cause: 'over_age' };
      }

      const verified = guardianship.consent_status === 'verified';
      return {
        granted: true,
        grant: {
          guardianshipId: guardianship.guardianship_id,
          consentStatus: verified ? 'verified' : 'pending',
          scopes: verified ? GUARDIAN_VERIFIED_SCOPES : GUARDIAN_PENDING_SCOPES,
        },
      };
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this.logger.error(
        JSON.stringify({
          event: 'acting_for_lookup_failed',
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new AppServiceUnavailableException(
        ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
      );
    }
  }

  /**
   * Only runs after a denial (itself cached for 10s): works out WHY, for the
   * `acting_for_denied` log. The caller still gets the uniform 403.
   */
  private async diagnoseDenial(
    guardianId: string,
    dependentId: string,
  ): Promise<ActingDenyCause> {
    try {
      const row = await this.prisma.guardianships.findFirst({
        where: {
          dependent_user_id: dependentId,
          guardian_user_id: guardianId,
        },
        orderBy: { created_at: 'desc' },
        select: {
          consent_status: true,
          is_custodian: true,
          is_test_data: true,
          dependent: {
            select: {
              active: true,
              account: { select: { id: true }, take: 1 },
              dependent_profile: {
                select: { frozen_at: true, purged_at: true },
              },
            },
          },
        },
      });

      if (!row) return 'no_guardianship';
      if (row.is_custodian) return 'custodian_or_external';
      if (row.is_test_data) return 'test_data';
      if (row.consent_status === 'revoked') return 'revoked';
      if (!row.dependent.active) return 'dependent_inactive';
      if (row.dependent.account.length > 0) return 'has_account';
      if (!row.dependent.dependent_profile) return 'no_dependent_profile';
      if (
        row.dependent.dependent_profile.frozen_at ||
        row.dependent.dependent_profile.purged_at
      ) {
        return 'frozen';
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
