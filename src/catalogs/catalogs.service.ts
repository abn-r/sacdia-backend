import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, role_category } from '@prisma/client';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from './catalog-cache.service';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

type GetUnionsFilters = {
  countryId?: number;
  divisionId?: number;
};

@Injectable()
export class CatalogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogCache: CatalogCacheService,
  ) {}

  // ========================================
  // CLUB TYPES
  // ========================================
  async getClubTypes() {
    return this.catalogCache.getOrSet(CATALOG_CACHE_KEYS.CLUB_TYPES, () =>
      this.prisma.club_types.findMany({
        where: { active: true },
        select: {
          club_type_id: true,
          name: true,
        },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async getActivityTypes() {
    return this.catalogCache.getOrSet(CATALOG_CACHE_KEYS.ACTIVITY_TYPES, () =>
      this.prisma.activity_types.findMany({
        where: { active: true },
        select: {
          activity_type_id: true,
          code: true,
          name: true,
          description: true,
        },
        orderBy: { activity_type_id: 'asc' },
      }),
    );
  }

  async getRelationshipTypes() {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.RELATIONSHIP_TYPES,
      () =>
        this.prisma.relationship_types.findMany({
          where: { active: true },
          select: {
            relationship_type_id: true,
            name: true,
            description: true,
          },
          orderBy: { name: 'asc' },
        }),
    );
  }

  // ========================================
  // COUNTRIES
  // ========================================
  async getCountries() {
    return this.catalogCache.getOrSet(CATALOG_CACHE_KEYS.COUNTRIES, () =>
      this.prisma.countries.findMany({
        where: { active: true },
        select: {
          country_id: true,
          name: true,
          abbreviation: true,
        },
        orderBy: { name: 'asc' },
      }),
    );
  }

  // ========================================
  // DIVISIONS
  // ========================================
  async getDivisions() {
    return this.catalogCache.getOrSet(CATALOG_CACHE_KEYS.DIVISIONS, () =>
      this.prisma.$queryRaw<
        Array<{
          division_id: number;
          code: string;
          name: string;
          abbreviation: string;
        }>
      >(Prisma.sql`
        SELECT division_id, code, name, abbreviation
        FROM divisions
        WHERE active = TRUE
        ORDER BY name ASC
      `),
    );
  }

  // ========================================
  // UNIONS
  // ========================================
  async getUnions(
    countryIdOrFilters?: number | GetUnionsFilters,
    divisionId?: number,
  ) {
    const filters =
      typeof countryIdOrFilters === 'object'
        ? countryIdOrFilters
        : { countryId: countryIdOrFilters, divisionId };

    if (filters.countryId && !filters.divisionId) {
      await this.ensureCountryAliasUnambiguous(filters.countryId);
    }

    return this.catalogCache.getOrSet(CATALOG_CACHE_KEYS.UNIONS(filters), () =>
      this.queryUnions(filters),
    );
  }

  private async ensureCountryAliasUnambiguous(
    countryId: number,
  ): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ division_id: number }>>(
      Prisma.sql`
        SELECT DISTINCT division_id
        FROM unions
        WHERE country_id = ${countryId}
          AND active = TRUE
      `,
    );

    if (rows.length > 1) {
      throw new AppBadRequestException(
        ErrorCode.HIERARCHY_COUNTRY_DIVISION_AMBIGUOUS,
        { countryId },
      );
    }
  }

  private async queryUnions(filters: GetUnionsFilters) {
    const conditions = [Prisma.sql`active = TRUE`];

    if (filters.countryId) {
      conditions.push(Prisma.sql`country_id = ${filters.countryId}`);
    }
    if (filters.divisionId) {
      conditions.push(Prisma.sql`division_id = ${filters.divisionId}`);
    }

    return this.prisma.$queryRaw<
      Array<{
        union_id: number;
        name: string;
        country_id: number;
        division_id: number;
      }>
    >(Prisma.sql`
      SELECT union_id, name, country_id, division_id
      FROM unions
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY name ASC
    `);
  }

  // ========================================
  // LOCAL FIELDS (Campos Locales)
  // ========================================
  async getLocalFields(unionId?: number) {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.LOCAL_FIELDS(unionId),
      () =>
        this.prisma.local_fields.findMany({
          where: {
            active: true,
            ...(unionId && { union_id: unionId }),
          },
          select: {
            local_field_id: true,
            name: true,
            union_id: true,
          },
          orderBy: { name: 'asc' },
        }),
    );
  }

  // ========================================
  // DISTRICTS
  // ========================================

  /** Shapes a raw Prisma row into the canonical API response shape.
   * The DB PK is `districlub_type_id` (legacy name with existing FKs) —
   * the public contract exposes it as `district_id`. */
  private mapDistrict(row: {
    districlub_type_id: number;
    name: string;
    local_field_id: number;
  }) {
    return {
      district_id: row.districlub_type_id,
      name: row.name,
      local_field_id: row.local_field_id,
    };
  }

  async getDistricts(localFieldId?: number) {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.DISTRICTS(localFieldId),
      async () => {
        const rows = await this.prisma.districts.findMany({
          where: {
            active: true,
            ...(localFieldId && { local_field_id: localFieldId }),
          },
          select: {
            districlub_type_id: true,
            name: true,
            local_field_id: true,
          },
          orderBy: { name: 'asc' },
        });
        return rows.map((r) => this.mapDistrict(r));
      },
    );
  }

  // ========================================
  // CHURCHES
  // ========================================

  /** Shapes a raw Prisma row into the canonical API response shape.
   * The DB FK to districts is `districlub_type_id` (legacy name inherited from
   * the districts PK) — the public contract exposes it as `district_id`,
   * consistent with what mapDistrict already exposes as the district PK. */
  private mapChurch(row: {
    church_id: number;
    name: string;
    districlub_type_id: number;
  }) {
    return {
      church_id: row.church_id,
      name: row.name,
      district_id: row.districlub_type_id,
    };
  }

  async getChurches(districtId?: number) {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.CHURCHES(districtId),
      async () => {
        const rows = await this.prisma.churches.findMany({
          where: {
            active: true,
            ...(districtId && { districlub_type_id: districtId }),
          },
          select: {
            church_id: true,
            name: true,
            districlub_type_id: true,
          },
          orderBy: { name: 'asc' },
        });
        return rows.map((r) => this.mapChurch(r));
      },
    );
  }

  // ========================================
  // ROLES
  // ========================================

  /** Shapes a raw Prisma row into the canonical API response shape.
   * The DB column is `role_name` — the public contract exposes it as `name`
   * to match Flutter's RoleModel.fromJson expectation. */
  private mapRole(row: {
    role_id: string;
    role_name: string;
    role_category: role_category;
  }) {
    return {
      role_id: row.role_id,
      name: row.role_name,
      role_category: row.role_category,
    };
  }

  async getRoles(category?: string) {
    const whereClause: { active: boolean; role_category?: role_category } = {
      active: true,
    };

    if (category && (category === 'GLOBAL' || category === 'CLUB')) {
      whereClause.role_category = category;
    }

    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.ROLES(category),
      async () => {
        const rows = await this.prisma.roles.findMany({
          where: whereClause,
          select: {
            role_id: true,
            role_name: true,
            role_category: true,
          },
          orderBy: { role_name: 'asc' },
        });
        return rows.map((r) => this.mapRole(r));
      },
    );
  }

  // ========================================
  // ECCLESIASTICAL YEARS
  // ========================================

  /** Shapes a raw Prisma row into the canonical API response shape. */
  private mapEcclesiasticalYear(row: {
    year_id: number;
    start_date: Date;
    end_date: Date;
    active: boolean;
  }) {
    const startYear = row.start_date.getFullYear();
    const endYear = row.end_date.getFullYear();
    // "2025-2026" — adventist ecclesiastical years run Oct → Sep, so start/end
    // years always differ. When they coincide (data edge-case) the label stays
    // readable (e.g. "2025").
    const name =
      startYear !== endYear ? `${startYear}-${endYear}` : `${startYear}`;

    return {
      ecclesiastical_year_id: row.year_id,
      name,
      start_date: row.start_date,
      end_date: row.end_date,
      active: row.active,
    };
  }

  async getEcclesiasticalYears() {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS,
      async () => {
        const rows = await this.prisma.ecclesiastical_years.findMany({
          select: {
            year_id: true,
            start_date: true,
            end_date: true,
            active: true,
          },
          orderBy: { start_date: 'desc' },
        });
        return rows.map((r) => this.mapEcclesiasticalYear(r));
      },
    );
  }

  async getCurrentEcclesiasticalYear() {
    const today = new Date();

    // Current year changes once a year — 24h TTL is safe.
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS_CURRENT,
      async () => {
        const row = await this.prisma.ecclesiastical_years.findFirst({
          where: {
            start_date: { lte: today },
            end_date: { gte: today },
          },
          select: {
            year_id: true,
            start_date: true,
            end_date: true,
            active: true,
          },
        });
        return row ? this.mapEcclesiasticalYear(row) : null;
      },
      86_400_000, // 24 hours
    );
  }

  // ========================================
  // CLUB IDEALS (Ley, Voto, Lema, etc.)
  // ========================================
  async getClubIdeals(clubTypeId?: number) {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.CLUB_IDEALS(clubTypeId),
      () =>
        this.prisma.club_ideals.findMany({
          where: {
            active: true,
            ...(clubTypeId && { club_type_id: clubTypeId }),
          },
          select: {
            club_ideal_id: true,
            name: true,
            ideal: true,
            ideal_order: true,
            club_type_id: true,
          },
          orderBy: [{ club_type_id: 'asc' }, { ideal_order: 'asc' }],
        }),
    );
  }

  // ========================================
  // ALLERGIES
  // ========================================
  async getAllergies() {
    return this.catalogCache.getOrSet(CATALOG_CACHE_KEYS.ALLERGIES, () =>
      this.prisma.allergies.findMany({
        where: { active: true },
        select: {
          allergy_id: true,
          name: true,
          description: true,
        },
        orderBy: { name: 'asc' },
      }),
    );
  }

  // ========================================
  // DISEASES
  // ========================================
  async getDiseases() {
    return this.catalogCache.getOrSet(CATALOG_CACHE_KEYS.DISEASES, () =>
      this.prisma.diseases.findMany({
        where: { active: true },
        select: {
          disease_id: true,
          name: true,
          description: true,
        },
        orderBy: { name: 'asc' },
      }),
    );
  }

  // ========================================
  // MEDICINES
  // ========================================
  async getMedicines() {
    return this.catalogCache.getOrSet(CATALOG_CACHE_KEYS.MEDICINES, () =>
      this.prisma.medicines.findMany({
        where: { active: true },
        select: {
          medicine_id: true,
          name: true,
          description: true,
        },
        orderBy: { name: 'asc' },
      }),
    );
  }
}
