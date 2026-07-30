import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { classifyLocalFieldTimezone } from '../common/validators/iana-timezone.validator';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from '../catalogs/catalog-cache.service';
import { TranslationService } from '../common/services/translation.service';
import {
  CreateChurchDto,
  CreateCountryDto,
  CreateDivisionDto,
  CreateDistrictDto,
  CreateLocalFieldDto,
  CreateUnionDto,
  UpdateChurchDto,
  UpdateCountryDto,
  UpdateDivisionDto,
  UpdateDistrictDto,
  UpdateLocalFieldDto,
  UpdateUnionDto,
} from './dto';

type DivisionRow = {
  division_id: number;
  code: string;
  name: string;
  abbreviation: string;
  active: boolean;
  created_at: Date | null;
  modified_at: Date | null;
  translations?: unknown[];
};

type UnionRow = {
  union_id: number;
  name: string;
  abbreviation: string;
  active: boolean;
  country_id: number;
  division_id: number;
  created_at: Date | null;
  modified_at: Date | null;
  translations?: unknown[];
};

type ListUnionFilters = {
  countryId?: number;
  divisionId?: number;
};

@Injectable()
export class AdminGeographyService {
  private readonly logger = new Logger(AdminGeographyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogCache: CatalogCacheService,
    private readonly translationService: TranslationService,
  ) {}

  private normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private normalizeAbbreviation(value: string): string {
    return value.trim().toUpperCase();
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase().replace(/\s+/g, '-');
  }

  private logMutation(
    action: string,
    resource: string,
    resourceId: string | number,
    actorId: string,
  ) {
    this.logger.log(
      JSON.stringify({
        action,
        resource,
        resourceId,
        actorId,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  // ─── DIVISIONS ─────────────────────────────────────────────────────────────

  async listDivisions() {
    return this.queryDivisions();
  }

  async createDivision(dto: CreateDivisionDto, actorId: string) {
    const code = this.normalizeCode(dto.code);
    const name = this.normalizeName(dto.name);
    const abbreviation = this.normalizeAbbreviation(dto.abbreviation);

    this.translationService.validateTranslations(dto.translations);
    await this.ensureDivisionUnique({ code, name, abbreviation });

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<DivisionRow[]>(Prisma.sql`
        INSERT INTO divisions (code, name, abbreviation, active, created_at, modified_at)
        VALUES (${code}, ${name}, ${abbreviation}, ${dto.active ?? true}, NOW(), NOW())
        RETURNING division_id, code, name, abbreviation, active, created_at, modified_at
      `);
      const created = this.requireSingleRow(
        rows,
        ErrorCode.ADMIN_DIVISION_NOT_FOUND,
      );

      await this.translationService.upsertTranslations(
        tx,
        'divisions_translations',
        'division_id',
        'divisions_translations_unique_locale',
        created.division_id,
        dto.translations,
        ['name'],
      );

      return created;
    });

    this.logMutation('create', 'divisions', result.division_id, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.DIVISIONS);

    return result;
  }

  async updateDivision(
    divisionId: number,
    dto: UpdateDivisionDto,
    actorId: string,
  ) {
    await this.ensureDivisionExists(divisionId);

    const code = dto.code ? this.normalizeCode(dto.code) : undefined;
    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    const abbreviation = dto.abbreviation
      ? this.normalizeAbbreviation(dto.abbreviation)
      : undefined;

    if (code || name || abbreviation) {
      await this.ensureDivisionUnique({ code, name, abbreviation }, divisionId);
    }

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const setClauses = [
        ...(code ? [Prisma.sql`code = ${code}`] : []),
        ...(name ? [Prisma.sql`name = ${name}`] : []),
        ...(abbreviation ? [Prisma.sql`abbreviation = ${abbreviation}`] : []),
        ...(typeof dto.active === 'boolean'
          ? [Prisma.sql`active = ${dto.active}`]
          : []),
        Prisma.sql`modified_at = NOW()`,
      ];

      const rows = await tx.$queryRaw<DivisionRow[]>(Prisma.sql`
        UPDATE divisions
        SET ${Prisma.join(setClauses, ', ')}
        WHERE division_id = ${divisionId}
        RETURNING division_id, code, name, abbreviation, active, created_at, modified_at
      `);
      const updated = this.requireSingleRow(
        rows,
        ErrorCode.ADMIN_DIVISION_NOT_FOUND,
      );

      await this.translationService.upsertTranslations(
        tx,
        'divisions_translations',
        'division_id',
        'divisions_translations_unique_locale',
        divisionId,
        dto.translations,
        ['name'],
      );

      return updated;
    });

    this.logMutation('update', 'divisions', divisionId, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.DIVISIONS);

    return result;
  }

  async deleteDivision(divisionId: number, actorId: string) {
    await this.ensureDivisionExists(divisionId);

    const activeUnions = await this.countActiveUnionsForDivision(divisionId);

    if (activeUnions > 0) {
      throw new AppConflictException(
        ErrorCode.ADMIN_DIVISION_HAS_ACTIVE_UNIONS,
        { id: divisionId },
      );
    }

    const rows = await this.prisma.$queryRaw<DivisionRow[]>(Prisma.sql`
      UPDATE divisions
      SET active = FALSE,
          modified_at = NOW()
      WHERE division_id = ${divisionId}
      RETURNING division_id, code, name, abbreviation, active, created_at, modified_at
    `);
    const division = this.requireSingleRow(
      rows,
      ErrorCode.ADMIN_DIVISION_NOT_FOUND,
    );

    this.logMutation('delete', 'divisions', divisionId, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.DIVISIONS);

    return division;
  }

  // ─── COUNTRIES ─────────────────────────────────────────────────────────────

  async listCountries() {
    // Geography catalog: bounded by number of countries in the system (~250 max).
    return this.prisma.countries.findMany({
      orderBy: { name: 'asc' },
      take: 300,
      include: { translations: true },
    });
  }

  async createCountry(dto: CreateCountryDto, actorId: string) {
    const name = this.normalizeName(dto.name);
    const abbreviation = this.normalizeAbbreviation(dto.abbreviation);

    this.translationService.validateTranslations(dto.translations);
    await this.ensureCountryUnique(name, abbreviation);

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.countries.create({
        data: {
          name,
          abbreviation,
          active: dto.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'countries_translations',
        'country_id',
        'countries_translations_unique_locale',
        created.country_id,
        dto.translations,
        ['name'],
      );

      return created;
    });

    this.logMutation('create', 'countries', result.country_id, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.COUNTRIES);

    return result;
  }

  async updateCountry(
    countryId: number,
    dto: UpdateCountryDto,
    actorId: string,
  ) {
    await this.ensureCountryExists(countryId);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    const abbreviation = dto.abbreviation
      ? this.normalizeAbbreviation(dto.abbreviation)
      : undefined;

    if (name || abbreviation) {
      await this.ensureCountryUnique(name, abbreviation, countryId);
    }

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.countries.update({
        where: { country_id: countryId },
        data: {
          ...(name ? { name } : {}),
          ...(abbreviation ? { abbreviation } : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'countries_translations',
        'country_id',
        'countries_translations_unique_locale',
        countryId,
        dto.translations,
        ['name'],
      );

      return updated;
    });

    this.logMutation('update', 'countries', countryId, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.COUNTRIES);

    return result;
  }

  async deleteCountry(countryId: number, actorId: string) {
    await this.ensureCountryExists(countryId);

    const activeUnions = await this.prisma.unions.count({
      where: {
        country_id: countryId,
        active: true,
      },
    });

    if (activeUnions > 0) {
      throw new AppConflictException(
        ErrorCode.ADMIN_COUNTRY_HAS_ACTIVE_UNIONS,
        { id: countryId },
      );
    }

    const country = await this.prisma.countries.update({
      where: { country_id: countryId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'countries', countryId, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.COUNTRIES);

    return country;
  }

  // ─── UNIONS ────────────────────────────────────────────────────────────────

  async listUnions(filters: ListUnionFilters = {}) {
    const { countryId, divisionId } = filters;
    if (countryId && !divisionId) {
      await this.ensureCountryAliasUnambiguous(countryId);
    }

    // Geography catalog: unions per country are in the tens at most.
    return this.queryUnions({ countryId, divisionId });
  }

  async createUnion(dto: CreateUnionDto, actorId: string) {
    await this.ensureCountryExists(dto.country_id);
    await this.ensureDivisionExists(dto.division_id);

    const name = this.normalizeName(dto.name);
    const abbreviation = this.normalizeAbbreviation(dto.abbreviation);
    await this.ensureUnionUnique(name, abbreviation);

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<UnionRow[]>(Prisma.sql`
        INSERT INTO unions (
          name,
          abbreviation,
          country_id,
          division_id,
          active,
          created_at,
          modified_at
        )
        VALUES (
          ${name},
          ${abbreviation},
          ${dto.country_id},
          ${dto.division_id},
          ${dto.active ?? true},
          NOW(),
          NOW()
        )
        RETURNING union_id, name, abbreviation, active, country_id, division_id, created_at, modified_at
      `);
      const created = this.requireSingleRow(
        rows,
        ErrorCode.ADMIN_UNION_NOT_FOUND,
      );

      await this.openUnionDivisionHistory(
        tx,
        created.union_id,
        dto.division_id,
        actorId,
      );

      await this.translationService.upsertTranslations(
        tx,
        'unions_translations',
        'union_id',
        'unions_translations_unique_locale',
        created.union_id,
        dto.translations,
        ['name'],
      );

      return created;
    });

    this.logMutation('create', 'unions', result.union_id, actorId);

    // Invalidate both the unfiltered list and the country-filtered variant
    await this.catalogCache.invalidateMany(
      this.unionCacheKeys({
        countryIds: [dto.country_id],
        divisionIds: [dto.division_id],
      }),
    );

    return result;
  }

  async updateUnion(unionId: number, dto: UpdateUnionDto, actorId: string) {
    const existing = await this.ensureUnionExists(unionId);

    if (dto.country_id) {
      await this.ensureCountryExists(dto.country_id);
    }
    if (dto.division_id) {
      await this.ensureDivisionExists(dto.division_id);
    }

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    const abbreviation = dto.abbreviation
      ? this.normalizeAbbreviation(dto.abbreviation)
      : undefined;

    if (name || abbreviation) {
      await this.ensureUnionUnique(name, abbreviation, unionId);
    }

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const setClauses = [
        ...(name ? [Prisma.sql`name = ${name}`] : []),
        ...(abbreviation ? [Prisma.sql`abbreviation = ${abbreviation}`] : []),
        ...(dto.country_id ? [Prisma.sql`country_id = ${dto.country_id}`] : []),
        ...(dto.division_id
          ? [Prisma.sql`division_id = ${dto.division_id}`]
          : []),
        ...(typeof dto.active === 'boolean'
          ? [Prisma.sql`active = ${dto.active}`]
          : []),
        Prisma.sql`modified_at = NOW()`,
      ];

      const rows = await tx.$queryRaw<UnionRow[]>(Prisma.sql`
        UPDATE unions
        SET ${Prisma.join(setClauses, ', ')}
        WHERE union_id = ${unionId}
        RETURNING union_id, name, abbreviation, active, country_id, division_id, created_at, modified_at
      `);
      const updated = this.requireSingleRow(
        rows,
        ErrorCode.ADMIN_UNION_NOT_FOUND,
      );

      if (dto.division_id && dto.division_id !== existing.division_id) {
        await this.reassignUnionDivisionHistory(
          tx,
          unionId,
          dto.division_id,
          actorId,
        );
      }

      await this.translationService.upsertTranslations(
        tx,
        'unions_translations',
        'union_id',
        'unions_translations_unique_locale',
        unionId,
        dto.translations,
        ['name'],
      );

      return updated;
    });

    this.logMutation('update', 'unions', unionId, actorId);

    // Invalidate all union variants (original country, new country if changed)
    await this.catalogCache.invalidateMany(
      this.unionCacheKeys({
        countryIds: [existing.country_id, dto.country_id],
        divisionIds: [existing.division_id, dto.division_id],
      }),
    );

    return result;
  }

  async deleteUnion(unionId: number, actorId: string) {
    const existing = await this.ensureUnionExists(unionId);

    const activeLocalFields = await this.prisma.local_fields.count({
      where: {
        union_id: unionId,
        active: true,
      },
    });

    if (activeLocalFields > 0) {
      throw new AppConflictException(
        ErrorCode.ADMIN_UNION_HAS_ACTIVE_LOCAL_FIELDS,
        { id: unionId },
      );
    }

    const union = await this.prisma.unions.update({
      where: { union_id: unionId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'unions', unionId, actorId);

    await this.catalogCache.invalidateMany([
      CATALOG_CACHE_KEYS.UNIONS(),
      CATALOG_CACHE_KEYS.UNIONS(existing.country_id),
      CATALOG_CACHE_KEYS.UNIONS({ divisionId: existing.division_id }),
      CATALOG_CACHE_KEYS.UNIONS({
        countryId: existing.country_id,
        divisionId: existing.division_id,
      }),
    ]);

    return union;
  }

  // ─── LOCAL FIELDS ──────────────────────────────────────────────────────────

  async listLocalFields(unionId?: number) {
    // Geography catalog: local fields per union are in the tens to low hundreds.
    return this.prisma.local_fields.findMany({
      where: unionId ? { union_id: unionId } : undefined,
      orderBy: { name: 'asc' },
      take: 1000,
      include: { translations: true },
    });
  }

  async createLocalField(dto: CreateLocalFieldDto, actorId: string) {
    await this.ensureUnionExists(dto.union_id);

    const name = this.normalizeName(dto.name);
    const abbreviation = this.normalizeAbbreviation(dto.abbreviation);
    const active = dto.active ?? true;
    const timezone = this.requireLocalFieldTimezone(dto.timezone, active);
    await this.ensureLocalFieldUnique(name, abbreviation);

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.local_fields.create({
        data: {
          name,
          abbreviation,
          union_id: dto.union_id,
          active,
          timezone,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'local_fields_translations',
        'local_field_id',
        'local_fields_translations_unique_locale',
        created.local_field_id,
        dto.translations,
        ['name'],
      );

      return created;
    });

    this.logMutation('create', 'local_fields', result.local_field_id, actorId);

    await this.catalogCache.invalidateMany([
      CATALOG_CACHE_KEYS.LOCAL_FIELDS(),
      CATALOG_CACHE_KEYS.LOCAL_FIELDS(dto.union_id),
    ]);

    return result;
  }

  async updateLocalField(
    localFieldId: number,
    dto: UpdateLocalFieldDto,
    actorId: string,
  ) {
    const existing = await this.ensureLocalFieldExists(localFieldId);

    if (dto.union_id) {
      await this.ensureUnionExists(dto.union_id);
    }

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    const abbreviation = dto.abbreviation
      ? this.normalizeAbbreviation(dto.abbreviation)
      : undefined;
    const timezoneWasProvided = Object.hasOwn(dto, 'timezone');
    const timezone = timezoneWasProvided
      ? dto.timezone ?? null
      : existing.timezone;
    const active = dto.active ?? existing.active;
    const validTimezone = this.requireLocalFieldTimezone(timezone, active);

    if (name || abbreviation) {
      await this.ensureLocalFieldUnique(name, abbreviation, localFieldId);
    }

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.local_fields.update({
        where: { local_field_id: localFieldId },
        data: {
          ...(name ? { name } : {}),
          ...(abbreviation ? { abbreviation } : {}),
          ...(dto.union_id ? { union_id: dto.union_id } : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          ...(timezoneWasProvided ? { timezone: validTimezone } : {}),
          modified_at: new Date(),
        },
      });

      if (timezoneWasProvided && validTimezone !== existing.timezone) {
        await this.bumpAuthorizationContextVersions(tx, localFieldId);
      }

      await this.translationService.upsertTranslations(
        tx,
        'local_fields_translations',
        'local_field_id',
        'local_fields_translations_unique_locale',
        localFieldId,
        dto.translations,
        ['name'],
      );

      return updated;
    });

    this.logMutation('update', 'local_fields', localFieldId, actorId);

    const keysToInvalidate = [CATALOG_CACHE_KEYS.LOCAL_FIELDS()];
    keysToInvalidate.push(CATALOG_CACHE_KEYS.LOCAL_FIELDS(existing.union_id));
    if (dto.union_id && dto.union_id !== existing.union_id) {
      keysToInvalidate.push(CATALOG_CACHE_KEYS.LOCAL_FIELDS(dto.union_id));
    }
    await this.catalogCache.invalidateMany(keysToInvalidate);

    return result;
  }

  async deleteLocalField(localFieldId: number, actorId: string) {
    const existing = await this.ensureLocalFieldExists(localFieldId);

    const activeDistricts = await this.prisma.districts.count({
      where: {
        local_field_id: localFieldId,
        active: true,
      },
    });

    if (activeDistricts > 0) {
      throw new AppConflictException(
        ErrorCode.ADMIN_LOCAL_FIELD_HAS_ACTIVE_DISTRICTS,
        { id: localFieldId },
      );
    }

    const localField = await this.prisma.local_fields.update({
      where: { local_field_id: localFieldId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'local_fields', localFieldId, actorId);

    await this.catalogCache.invalidateMany([
      CATALOG_CACHE_KEYS.LOCAL_FIELDS(),
      CATALOG_CACHE_KEYS.LOCAL_FIELDS(existing.union_id),
    ]);

    return localField;
  }

  // ─── DISTRICTS ─────────────────────────────────────────────────────────────

  async listDistricts(localFieldId?: number) {
    // Geography catalog: districts per local field are in the tens.
    return this.prisma.districts.findMany({
      where: localFieldId ? { local_field_id: localFieldId } : undefined,
      orderBy: { name: 'asc' },
      take: 2000,
      include: { translations: true },
    });
  }

  async createDistrict(dto: CreateDistrictDto, actorId: string) {
    await this.ensureLocalFieldExists(dto.local_field_id);
    const name = this.normalizeName(dto.name);

    const existing = await this.prisma.districts.findFirst({
      where: {
        local_field_id: dto.local_field_id,
        name: { equals: name, mode: 'insensitive' },
        active: true,
      },
    });

    if (existing) {
      throw new AppConflictException(ErrorCode.ADMIN_DISTRICT_NAME_CONFLICT);
    }

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.districts.create({
        data: {
          name,
          local_field_id: dto.local_field_id,
          active: dto.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'districts_translations',
        'districlub_type_id',
        'districts_translations_unique_locale',
        created.districlub_type_id,
        dto.translations,
        ['name'],
      );

      return created;
    });

    this.logMutation('create', 'districts', result.districlub_type_id, actorId);

    await this.catalogCache.invalidateMany([
      CATALOG_CACHE_KEYS.DISTRICTS(),
      CATALOG_CACHE_KEYS.DISTRICTS(dto.local_field_id),
    ]);

    return result;
  }

  async updateDistrict(
    districtId: number,
    dto: UpdateDistrictDto,
    actorId: string,
  ) {
    const current = await this.ensureDistrictExists(districtId);

    if (dto.local_field_id) {
      await this.ensureLocalFieldExists(dto.local_field_id);
    }

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    const nextLocalFieldId = dto.local_field_id ?? current.local_field_id;

    if (name) {
      const existingDistrict = await this.prisma.districts.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          local_field_id: nextLocalFieldId,
          NOT: { districlub_type_id: districtId },
          active: true,
        },
      });

      if (existingDistrict) {
        throw new AppConflictException(ErrorCode.ADMIN_DISTRICT_NAME_CONFLICT);
      }
    }

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.districts.update({
        where: { districlub_type_id: districtId },
        data: {
          ...(name ? { name } : {}),
          ...(dto.local_field_id ? { local_field_id: dto.local_field_id } : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'districts_translations',
        'districlub_type_id',
        'districts_translations_unique_locale',
        districtId,
        dto.translations,
        ['name'],
      );

      return updated;
    });

    this.logMutation('update', 'districts', districtId, actorId);

    const keysToInvalidate = [CATALOG_CACHE_KEYS.DISTRICTS()];
    keysToInvalidate.push(CATALOG_CACHE_KEYS.DISTRICTS(current.local_field_id));
    if (dto.local_field_id && dto.local_field_id !== current.local_field_id) {
      keysToInvalidate.push(CATALOG_CACHE_KEYS.DISTRICTS(dto.local_field_id));
    }
    await this.catalogCache.invalidateMany(keysToInvalidate);

    return result;
  }

  async deleteDistrict(districtId: number, actorId: string) {
    const existing = await this.ensureDistrictExists(districtId);

    const activeChurches = await this.prisma.churches.count({
      where: {
        districlub_type_id: districtId,
        active: true,
      },
    });

    if (activeChurches > 0) {
      throw new AppConflictException(
        ErrorCode.ADMIN_DISTRICT_HAS_ACTIVE_CHURCHES,
        { id: districtId },
      );
    }

    const district = await this.prisma.districts.update({
      where: { districlub_type_id: districtId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'districts', districtId, actorId);

    await this.catalogCache.invalidateMany([
      CATALOG_CACHE_KEYS.DISTRICTS(),
      CATALOG_CACHE_KEYS.DISTRICTS(existing.local_field_id),
    ]);

    return district;
  }

  // ─── CHURCHES ──────────────────────────────────────────────────────────────

  async listChurches(districtId?: number) {
    // Geography catalog: churches per district are in the tens to low hundreds.
    return this.prisma.churches.findMany({
      where: districtId ? { districlub_type_id: districtId } : undefined,
      orderBy: { name: 'asc' },
      take: 5000,
      include: { translations: true },
    });
  }

  async createChurch(dto: CreateChurchDto, actorId: string) {
    await this.ensureDistrictExists(dto.district_id);
    const name = this.normalizeName(dto.name);

    const existing = await this.prisma.churches.findFirst({
      where: {
        districlub_type_id: dto.district_id,
        name: { equals: name, mode: 'insensitive' },
        active: true,
      },
    });

    if (existing) {
      throw new AppConflictException(ErrorCode.ADMIN_CHURCH_NAME_CONFLICT);
    }

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.churches.create({
        data: {
          name,
          districlub_type_id: dto.district_id,
          active: dto.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'churches_translations',
        'church_id',
        'churches_translations_unique_locale',
        created.church_id,
        dto.translations,
        ['name'],
      );

      return created;
    });

    this.logMutation('create', 'churches', result.church_id, actorId);

    await this.catalogCache.invalidateMany([
      CATALOG_CACHE_KEYS.CHURCHES(),
      CATALOG_CACHE_KEYS.CHURCHES(dto.district_id),
    ]);

    return result;
  }

  async updateChurch(churchId: number, dto: UpdateChurchDto, actorId: string) {
    const current = await this.ensureChurchExists(churchId);

    if (dto.district_id) {
      await this.ensureDistrictExists(dto.district_id);
    }

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    const nextDistrictId = dto.district_id ?? current.districlub_type_id;

    if (name) {
      const existingChurch = await this.prisma.churches.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          districlub_type_id: nextDistrictId,
          NOT: { church_id: churchId },
          active: true,
        },
      });

      if (existingChurch) {
        throw new AppConflictException(ErrorCode.ADMIN_CHURCH_NAME_CONFLICT);
      }
    }

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.churches.update({
        where: { church_id: churchId },
        data: {
          ...(name ? { name } : {}),
          ...(dto.district_id ? { districlub_type_id: dto.district_id } : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'churches_translations',
        'church_id',
        'churches_translations_unique_locale',
        churchId,
        dto.translations,
        ['name'],
      );

      return updated;
    });

    this.logMutation('update', 'churches', churchId, actorId);

    const keysToInvalidate = [CATALOG_CACHE_KEYS.CHURCHES()];
    keysToInvalidate.push(
      CATALOG_CACHE_KEYS.CHURCHES(current.districlub_type_id),
    );
    if (dto.district_id && dto.district_id !== current.districlub_type_id) {
      keysToInvalidate.push(CATALOG_CACHE_KEYS.CHURCHES(dto.district_id));
    }
    await this.catalogCache.invalidateMany(keysToInvalidate);

    return result;
  }

  async deleteChurch(churchId: number, actorId: string) {
    const existing = await this.ensureChurchExists(churchId);

    const church = await this.prisma.churches.update({
      where: { church_id: churchId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'churches', churchId, actorId);

    await this.catalogCache.invalidateMany([
      CATALOG_CACHE_KEYS.CHURCHES(),
      CATALOG_CACHE_KEYS.CHURCHES(existing.districlub_type_id),
    ]);

    return church;
  }

  // ─── PRIVATE GUARDS ────────────────────────────────────────────────────────

  private requireSingleRow<T>(rows: T[], code: ErrorCode): T {
    const row = rows[0];
    if (!row) {
      throw new AppNotFoundException(code);
    }
    return row;
  }

  private async queryDivisions(): Promise<DivisionRow[]> {
    return this.prisma.$queryRaw<DivisionRow[]>(Prisma.sql`
      SELECT
        d.division_id,
        d.code,
        d.name,
        d.abbreviation,
        d.active,
        d.created_at,
        d.modified_at,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', dt.id,
              'division_id', dt.division_id,
              'locale', dt.locale,
              'name', dt.name,
              'created_at', dt.created_at,
              'updated_at', dt.updated_at
            )
            ORDER BY dt.locale
          ) FILTER (WHERE dt.id IS NOT NULL),
          '[]'::jsonb
        ) AS translations
      FROM divisions d
      LEFT JOIN divisions_translations dt ON dt.division_id = d.division_id
      GROUP BY d.division_id
      ORDER BY d.name ASC
      LIMIT 300
    `);
  }

  private async queryUnions(
    filters: ListUnionFilters = {},
  ): Promise<UnionRow[]> {
    const conditions = [Prisma.sql`u.active = TRUE`];

    if (filters.countryId) {
      conditions.push(Prisma.sql`u.country_id = ${filters.countryId}`);
    }
    if (filters.divisionId) {
      conditions.push(Prisma.sql`u.division_id = ${filters.divisionId}`);
    }

    return this.prisma.$queryRaw<UnionRow[]>(Prisma.sql`
      SELECT
        u.union_id,
        u.name,
        u.abbreviation,
        u.active,
        u.country_id,
        u.division_id,
        u.created_at,
        u.modified_at,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', ut.id,
              'union_id', ut.union_id,
              'locale', ut.locale,
              'name', ut.name,
              'created_at', ut.created_at,
              'updated_at', ut.updated_at
            )
            ORDER BY ut.locale
          ) FILTER (WHERE ut.id IS NOT NULL),
          '[]'::jsonb
        ) AS translations
      FROM unions u
      LEFT JOIN unions_translations ut ON ut.union_id = u.union_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY u.union_id
      ORDER BY u.name ASC
      LIMIT 500
    `);
  }

  private async countActiveUnionsForDivision(
    divisionId: number,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint | number }>>(
      Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM unions
        WHERE division_id = ${divisionId}
          AND active = TRUE
      `,
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async ensureDivisionUnique(
    values: {
      code?: string;
      name?: string;
      abbreviation?: string;
    },
    divisionId?: number,
  ): Promise<void> {
    if (values.code) {
      const rows = await this.prisma.$queryRaw<Array<{ division_id: number }>>(
        Prisma.sql`
          SELECT division_id
          FROM divisions
          WHERE LOWER(code) = LOWER(${values.code})
            ${divisionId ? Prisma.sql`AND division_id <> ${divisionId}` : Prisma.empty}
          LIMIT 1
        `,
      );
      if (rows.length > 0) {
        throw new AppConflictException(ErrorCode.ADMIN_DIVISION_CODE_CONFLICT);
      }
    }

    if (values.name) {
      const rows = await this.prisma.$queryRaw<Array<{ division_id: number }>>(
        Prisma.sql`
          SELECT division_id
          FROM divisions
          WHERE LOWER(name) = LOWER(${values.name})
            ${divisionId ? Prisma.sql`AND division_id <> ${divisionId}` : Prisma.empty}
          LIMIT 1
        `,
      );
      if (rows.length > 0) {
        throw new AppConflictException(ErrorCode.ADMIN_DIVISION_NAME_CONFLICT);
      }
    }

    if (values.abbreviation) {
      const rows = await this.prisma.$queryRaw<Array<{ division_id: number }>>(
        Prisma.sql`
          SELECT division_id
          FROM divisions
          WHERE LOWER(abbreviation) = LOWER(${values.abbreviation})
            ${divisionId ? Prisma.sql`AND division_id <> ${divisionId}` : Prisma.empty}
          LIMIT 1
        `,
      );
      if (rows.length > 0) {
        throw new AppConflictException(
          ErrorCode.ADMIN_DIVISION_ABBREVIATION_CONFLICT,
        );
      }
    }
  }

  private async ensureDivisionExists(divisionId: number): Promise<DivisionRow> {
    const rows = await this.prisma.$queryRaw<DivisionRow[]>(Prisma.sql`
      SELECT division_id, code, name, abbreviation, active, created_at, modified_at
      FROM divisions
      WHERE division_id = ${divisionId}
      LIMIT 1
    `);

    if (rows.length === 0) {
      throw new AppNotFoundException(ErrorCode.ADMIN_DIVISION_NOT_FOUND, {
        id: divisionId,
      });
    }

    return rows[0];
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

  private async openUnionDivisionHistory(
    tx: Pick<PrismaService, '$queryRaw' | '$executeRaw'>,
    unionId: number,
    divisionId: number,
    actorId: string,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO union_division_history (
        union_id,
        division_id,
        valid_from,
        valid_to,
        precision,
        created_by
      )
      VALUES (
        ${unionId},
        ${divisionId},
        CURRENT_DATE,
        NULL,
        'exact',
        ${actorId}::uuid
      )
      ON CONFLICT DO NOTHING
    `);
  }

  private async reassignUnionDivisionHistory(
    tx: Pick<PrismaService, '$queryRaw' | '$executeRaw'>,
    unionId: number,
    divisionId: number,
    actorId: string,
  ): Promise<void> {
    const openRows = await tx.$queryRaw<Array<{ valid_from: Date | string }>>(
      Prisma.sql`
        SELECT valid_from
        FROM union_division_history
        WHERE union_id = ${unionId}
          AND valid_to IS NULL
        LIMIT 1
      `,
    );

    const validFrom = openRows[0]?.valid_from
      ? new Date(openRows[0].valid_from)
      : null;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    if (validFrom && validFrom >= today) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE union_division_history
        SET division_id = ${divisionId},
            precision = 'exact',
            created_by = ${actorId}::uuid
        WHERE union_id = ${unionId}
          AND valid_to IS NULL
      `);
      return;
    }

    await tx.$executeRaw(Prisma.sql`
      UPDATE union_division_history
      SET valid_to = CURRENT_DATE
      WHERE union_id = ${unionId}
        AND valid_to IS NULL
    `);

    await this.openUnionDivisionHistory(tx, unionId, divisionId, actorId);
  }

  private unionCacheKeys({
    countryIds,
    divisionIds,
  }: {
    countryIds: Array<number | undefined>;
    divisionIds: Array<number | undefined>;
  }): string[] {
    const keys = new Set<string>([CATALOG_CACHE_KEYS.UNIONS()]);
    const countries = Array.from(
      new Set(countryIds.filter((id): id is number => typeof id === 'number')),
    );
    const divisions = Array.from(
      new Set(divisionIds.filter((id): id is number => typeof id === 'number')),
    );

    for (const countryId of countries) {
      keys.add(CATALOG_CACHE_KEYS.UNIONS(countryId));
    }
    for (const divisionId of divisions) {
      keys.add(CATALOG_CACHE_KEYS.UNIONS({ divisionId }));
    }
    for (const countryId of countries) {
      for (const divisionId of divisions) {
        keys.add(CATALOG_CACHE_KEYS.UNIONS({ countryId, divisionId }));
      }
    }

    return Array.from(keys);
  }

  private async ensureCountryUnique(
    name?: string,
    abbreviation?: string,
    countryId?: number,
  ) {
    if (name) {
      const existingByName = await this.prisma.countries.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          ...(countryId ? { NOT: { country_id: countryId } } : {}),
        },
      });

      if (existingByName) {
        throw new AppConflictException(ErrorCode.ADMIN_COUNTRY_NAME_CONFLICT);
      }
    }

    if (abbreviation) {
      const existingByAbbreviation = await this.prisma.countries.findFirst({
        where: {
          abbreviation: { equals: abbreviation, mode: 'insensitive' },
          ...(countryId ? { NOT: { country_id: countryId } } : {}),
        },
      });

      if (existingByAbbreviation) {
        throw new AppConflictException(
          ErrorCode.ADMIN_COUNTRY_ABBREVIATION_CONFLICT,
        );
      }
    }
  }

  private async ensureUnionUnique(
    name?: string,
    abbreviation?: string,
    unionId?: number,
  ) {
    if (name) {
      const existingByName = await this.prisma.unions.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          ...(unionId ? { NOT: { union_id: unionId } } : {}),
        },
      });

      if (existingByName) {
        throw new AppConflictException(ErrorCode.ADMIN_UNION_NAME_CONFLICT);
      }
    }

    if (abbreviation) {
      const existingByAbbreviation = await this.prisma.unions.findFirst({
        where: {
          abbreviation: { equals: abbreviation, mode: 'insensitive' },
          ...(unionId ? { NOT: { union_id: unionId } } : {}),
        },
      });

      if (existingByAbbreviation) {
        throw new AppConflictException(
          ErrorCode.ADMIN_UNION_ABBREVIATION_CONFLICT,
        );
      }
    }
  }

  private async ensureLocalFieldUnique(
    name?: string,
    abbreviation?: string,
    localFieldId?: number,
  ) {
    if (name) {
      const existingByName = await this.prisma.local_fields.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          ...(localFieldId ? { NOT: { local_field_id: localFieldId } } : {}),
        },
      });

      if (existingByName) {
        throw new AppConflictException(
          ErrorCode.ADMIN_LOCAL_FIELD_NAME_CONFLICT,
        );
      }
    }

    if (abbreviation) {
      const existingByAbbreviation = await this.prisma.local_fields.findFirst({
        where: {
          abbreviation: { equals: abbreviation, mode: 'insensitive' },
          ...(localFieldId ? { NOT: { local_field_id: localFieldId } } : {}),
        },
      });

      if (existingByAbbreviation) {
        throw new AppConflictException(
          ErrorCode.ADMIN_LOCAL_FIELD_ABBREVIATION_CONFLICT,
        );
      }
    }
  }

  private async ensureCountryExists(countryId: number) {
    const country = await this.prisma.countries.findUnique({
      where: { country_id: countryId },
    });

    if (!country) {
      throw new AppNotFoundException(ErrorCode.ADMIN_COUNTRY_NOT_FOUND, {
        id: countryId,
      });
    }

    return country;
  }

  private async ensureUnionExists(unionId: number) {
    const rows = await this.prisma.$queryRaw<UnionRow[]>(Prisma.sql`
      SELECT union_id, name, abbreviation, active, country_id, division_id, created_at, modified_at
      FROM unions
      WHERE union_id = ${unionId}
      LIMIT 1
    `);
    const union = rows[0];

    if (!union) {
      throw new AppNotFoundException(ErrorCode.ADMIN_UNION_NOT_FOUND, {
        id: unionId,
      });
    }

    return union;
  }

  private async ensureLocalFieldExists(localFieldId: number) {
    const localField = await this.prisma.local_fields.findUnique({
      where: { local_field_id: localFieldId },
    });

    if (!localField) {
      throw new AppNotFoundException(ErrorCode.ADMIN_LOCAL_FIELD_NOT_FOUND, {
        id: localFieldId,
      });
    }

    return localField;
  }

  private requireLocalFieldTimezone(
    timezone: string | null | undefined,
    active: boolean,
  ): string | null {
    if (!active && (timezone === null || timezone === undefined)) {
      return null;
    }

    const classification = classifyLocalFieldTimezone(timezone);
    if (!classification.ok) {
      throw new AppBadRequestException(
        ErrorCode.LOCAL_FIELD_TIMEZONE_UNAVAILABLE,
        { reason: classification.reason },
      );
    }

    return classification.value;
  }

  private async bumpAuthorizationContextVersions(
    tx: Prisma.TransactionClient,
    localFieldId: number,
  ) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO authorization_context_versions (user_id, version, modified_at)
      SELECT DISTINCT assignment.user_id, 1, NOW()
      FROM club_role_assignments AS assignment
      INNER JOIN club_sections AS section
        ON section.club_section_id = assignment.club_section_id
      INNER JOIN clubs AS club ON club.club_id = section.main_club_id
      WHERE club.local_field_id = ${localFieldId}
      ON CONFLICT (user_id) DO UPDATE
      SET version = authorization_context_versions.version + 1,
          modified_at = EXCLUDED.modified_at
    `);
  }

  private async ensureDistrictExists(districtId: number) {
    const district = await this.prisma.districts.findUnique({
      where: { districlub_type_id: districtId },
    });

    if (!district) {
      throw new AppNotFoundException(ErrorCode.ADMIN_DISTRICT_NOT_FOUND, {
        id: districtId,
      });
    }

    return district;
  }

  private async ensureChurchExists(churchId: number) {
    const church = await this.prisma.churches.findUnique({
      where: { church_id: churchId },
    });

    if (!church) {
      throw new AppNotFoundException(ErrorCode.ADMIN_CHURCH_NOT_FOUND, {
        id: churchId,
      });
    }

    return church;
  }
}
