import { Injectable, Logger } from '@nestjs/common';
import {
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from '../catalogs/catalog-cache.service';
import { TranslationService } from '../common/services/translation.service';
import {
  CreateChurchDto,
  CreateCountryDto,
  CreateDistrictDto,
  CreateLocalFieldDto,
  CreateUnionDto,
  UpdateChurchDto,
  UpdateCountryDto,
  UpdateDistrictDto,
  UpdateLocalFieldDto,
  UpdateUnionDto,
} from './dto';

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

  async listUnions(countryId?: number) {
    // Geography catalog: unions per country are in the tens at most.
    return this.prisma.unions.findMany({
      where: countryId ? { country_id: countryId } : undefined,
      orderBy: { name: 'asc' },
      take: 500,
      include: { translations: true },
    });
  }

  async createUnion(dto: CreateUnionDto, actorId: string) {
    await this.ensureCountryExists(dto.country_id);

    const name = this.normalizeName(dto.name);
    const abbreviation = this.normalizeAbbreviation(dto.abbreviation);
    await this.ensureUnionUnique(name, abbreviation);

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.unions.create({
        data: {
          name,
          abbreviation,
          country_id: dto.country_id,
          active: dto.active ?? true,
        },
      });

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
    await this.catalogCache.invalidateMany([
      CATALOG_CACHE_KEYS.UNIONS(),
      CATALOG_CACHE_KEYS.UNIONS(dto.country_id),
    ]);

    return result;
  }

  async updateUnion(unionId: number, dto: UpdateUnionDto, actorId: string) {
    const existing = await this.ensureUnionExists(unionId);

    if (dto.country_id) {
      await this.ensureCountryExists(dto.country_id);
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
      const updated = await tx.unions.update({
        where: { union_id: unionId },
        data: {
          ...(name ? { name } : {}),
          ...(abbreviation ? { abbreviation } : {}),
          ...(dto.country_id ? { country_id: dto.country_id } : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

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
    const keysToInvalidate = [CATALOG_CACHE_KEYS.UNIONS()];
    keysToInvalidate.push(CATALOG_CACHE_KEYS.UNIONS(existing.country_id));
    if (dto.country_id && dto.country_id !== existing.country_id) {
      keysToInvalidate.push(CATALOG_CACHE_KEYS.UNIONS(dto.country_id));
    }
    await this.catalogCache.invalidateMany(keysToInvalidate);

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
    await this.ensureLocalFieldUnique(name, abbreviation);

    this.translationService.validateTranslations(dto.translations);

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.local_fields.create({
        data: {
          name,
          abbreviation,
          union_id: dto.union_id,
          active: dto.active ?? true,
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

    this.logMutation(
      'create',
      'local_fields',
      result.local_field_id,
      actorId,
    );

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
          modified_at: new Date(),
        },
      });

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

    this.logMutation(
      'create',
      'districts',
      result.districlub_type_id,
      actorId,
    );

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
    const union = await this.prisma.unions.findUnique({
      where: { union_id: unionId },
    });

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
