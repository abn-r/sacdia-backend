import { Injectable } from '@nestjs/common';
import {
  CATALOG_CACHE_KEYS,
  CatalogCacheService,
} from '../../catalogs/catalog-cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_AGE_TIMEZONE } from './age.util';

/** Age rules of a country; the cutoffs are data, not code. */
export interface CountryAgePolicy {
  /** Minimum age to hold an account (dependents are created below it). */
  minSelfLoginAge: number;
  /** Age at which a person stops being a minor. */
  ageOfMajority: number;
  /** IANA zone whose calendar decides "today" for age checks. */
  timeZone: string;
}

/** Used when the country is unknown or has no policy of its own. */
export const DEFAULT_COUNTRY_AGE_POLICY: Readonly<CountryAgePolicy> =
  Object.freeze({
    minSelfLoginAge: 13,
    ageOfMajority: 18,
    timeZone: DEFAULT_AGE_TIMEZONE,
  });

/** One hour, the same TTL as the other catalog entries. */
const COUNTRY_AGE_POLICY_TTL_MS = 3_600_000;

@Injectable()
export class CountryAgePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogCache: CatalogCacheService,
  ) {}

  /**
   * Reads the age policy for a country. `null`/`undefined` (user without a
   * country) gets the code defaults. A Redis outage degrades to the database
   * inside `CatalogCacheService.getOrSet`.
   */
  async getPolicy(
    countryId: number | null | undefined,
  ): Promise<CountryAgePolicy> {
    if (countryId === null || countryId === undefined) {
      return { ...DEFAULT_COUNTRY_AGE_POLICY };
    }

    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.COUNTRY_AGE_POLICY(countryId),
      () => this.loadPolicy(countryId),
      COUNTRY_AGE_POLICY_TTL_MS,
    );
  }

  /** Drops the cached policy of a country (call after an admin update). */
  async invalidate(countryId: number): Promise<void> {
    await this.catalogCache.invalidate(
      CATALOG_CACHE_KEYS.COUNTRY_AGE_POLICY(countryId),
    );
  }

  private async loadPolicy(countryId: number): Promise<CountryAgePolicy> {
    const country = await this.prisma.countries.findUnique({
      where: { country_id: countryId },
      select: {
        minor_self_login_min_age: true,
        age_of_majority: true,
        age_reference_timezone: true,
      },
    });

    if (!country) {
      return { ...DEFAULT_COUNTRY_AGE_POLICY };
    }

    return {
      minSelfLoginAge: country.minor_self_login_min_age,
      ageOfMajority: country.age_of_majority,
      timeZone:
        country.age_reference_timezone ?? DEFAULT_COUNTRY_AGE_POLICY.timeZone,
    };
  }
}
