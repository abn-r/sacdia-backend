import { Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from '../catalogs/catalog-cache.service';
import {
  CreateActivityTypeDto,
  CreateAllergyDto,
  CreateClubIdealDto,
  CreateClubTypeDto,
  CreateDiseaseDto,
  CreateEcclesiasticalYearDto,
  CreateHonorCategoryDto,
  CreateMedicineDto,
  HonorCategoryListQueryDto,
  CreateRelationshipTypeDto,
  UpdateActivityTypeDto,
  UpdateAllergyDto,
  UpdateClubIdealDto,
  UpdateClubTypeDto,
  UpdateDiseaseDto,
  UpdateEcclesiasticalYearDto,
  UpdateHonorCategoryDto,
  UpdateMedicineDto,
  UpdateRelationshipTypeDto,
} from './dto';
import { TranslationService } from '../common/services/translation.service';

type HonorCategoryRecord = Prisma.honors_categoriesGetPayload<{
  include: { _count: { select: { honors: true } } };
}>;

@Injectable()
export class AdminReferenceService {
  private readonly logger = new Logger(AdminReferenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogCache: CatalogCacheService,
    private readonly translationService: TranslationService,
  ) {}

  private normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
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

  // ========================================
  // ACTIVITY TYPES
  // ========================================

  async listActivityTypes() {
    // Small catalog table: expected to remain well under 50 rows.
    return this.prisma.activity_types.findMany({
      orderBy: { activity_type_id: 'asc' },
      take: 200,
      include: { translations: true },
    });
  }

  async createActivityType(dto: CreateActivityTypeDto, actorId: string) {
    const name = this.normalizeName(dto.name);
    const code = dto.code.trim();

    this.translationService.validateTranslations(dto.translations);
    await this.ensureActivityTypeUnique(name, code);

    const activityType = await this.prisma.$transaction(async (tx) => {
      const created = await tx.activity_types.create({
        data: {
          code,
          name,
          description: dto.description,
          active: dto.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'activity_types_translations',
        'activity_type_id',
        'activity_types_translations_unique_locale',
        created.activity_type_id,
        dto.translations,
        ['name', 'description'],
      );

      return created;
    });

    this.logMutation(
      'create',
      'activity_types',
      activityType.activity_type_id,
      actorId,
    );

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.ACTIVITY_TYPES);

    return activityType;
  }

  async updateActivityType(
    activityTypeId: number,
    dto: UpdateActivityTypeDto,
    actorId: string,
  ) {
    await this.ensureActivityTypeExists(activityTypeId);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    const code = dto.code ? dto.code.trim() : undefined;

    if (name || code) {
      await this.ensureActivityTypeUnique(
        name ?? undefined,
        code ?? undefined,
        activityTypeId,
      );
    }

    this.translationService.validateTranslations(dto.translations);

    const activityType = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.activity_types.update({
        where: { activity_type_id: activityTypeId },
        data: {
          ...(code ? { code } : {}),
          ...(name ? { name } : {}),
          ...(typeof dto.description === 'string'
            ? { description: dto.description }
            : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'activity_types_translations',
        'activity_type_id',
        'activity_types_translations_unique_locale',
        activityTypeId,
        dto.translations,
        ['name', 'description'],
      );

      return updated;
    });

    this.logMutation('update', 'activity_types', activityTypeId, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.ACTIVITY_TYPES);

    return activityType;
  }

  async deleteActivityType(activityTypeId: number, actorId: string) {
    await this.ensureActivityTypeExists(activityTypeId);

    const inUseCount = await this.prisma.activities.count({
      where: { activity_type_id: activityTypeId, active: true },
    });

    if (inUseCount > 0) {
      throw new AppConflictException(ErrorCode.ADMIN_ACTIVITY_TYPE_IN_USE, {
        id: activityTypeId,
      });
    }

    const activityType = await this.prisma.activity_types.update({
      where: { activity_type_id: activityTypeId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'activity_types', activityTypeId, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.ACTIVITY_TYPES);

    return activityType;
  }

  private async ensureActivityTypeExists(activityTypeId: number) {
    const entity = await this.prisma.activity_types.findUnique({
      where: { activity_type_id: activityTypeId },
    });

    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_ACTIVITY_TYPE_NOT_FOUND, {
        id: activityTypeId,
      });
    }

    return entity;
  }

  private async ensureActivityTypeUnique(
    name?: string,
    code?: string,
    excludeId?: number,
  ) {
    if (name) {
      const existingByName = await this.prisma.activity_types.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          ...(excludeId ? { NOT: { activity_type_id: excludeId } } : {}),
        },
      });

      if (existingByName) {
        throw new AppConflictException(
          ErrorCode.ADMIN_ACTIVITY_TYPE_NAME_CONFLICT,
        );
      }
    }

    if (code) {
      const existingByCode = await this.prisma.activity_types.findFirst({
        where: {
          code: { equals: code, mode: 'insensitive' },
          ...(excludeId ? { NOT: { activity_type_id: excludeId } } : {}),
        },
      });

      if (existingByCode) {
        throw new AppConflictException(
          ErrorCode.ADMIN_ACTIVITY_TYPE_CODE_CONFLICT,
        );
      }
    }
  }

  async listRelationshipTypes() {
    // Small catalog table: expected to remain well under 100 rows.
    return this.prisma.relationship_types.findMany({
      orderBy: { name: 'asc' },
      take: 200,
      include: { translations: true },
    });
  }

  async createRelationshipType(
    dto: CreateRelationshipTypeDto,
    actorId: string,
  ) {
    const name = this.normalizeName(dto.name);
    this.translationService.validateTranslations(dto.translations);
    await this.ensureRelationshipTypeUnique(name);

    const relationshipType = await this.prisma.$transaction(async (tx) => {
      const created = await tx.relationship_types.create({
        data: {
          name,
          description: dto.description,
          active: dto.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'relationship_types_translations',
        'relationship_type_id',
        'relationship_types_translations_unique_locale',
        created.relationship_type_id,
        dto.translations,
        ['name', 'description'],
      );

      return created;
    });

    this.logMutation(
      'create',
      'relationship_types',
      relationshipType.relationship_type_id,
      actorId,
    );

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.RELATIONSHIP_TYPES);

    return relationshipType;
  }

  async updateRelationshipType(
    relationshipTypeId: string,
    dto: UpdateRelationshipTypeDto,
    actorId: string,
  ) {
    await this.ensureRelationshipTypeExists(relationshipTypeId);
    const name = dto.name ? this.normalizeName(dto.name) : undefined;

    if (name) {
      await this.ensureRelationshipTypeUnique(name, relationshipTypeId);
    }

    this.translationService.validateTranslations(dto.translations);

    const relationshipType = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.relationship_types.update({
        where: { relationship_type_id: relationshipTypeId },
        data: {
          ...(name ? { name } : {}),
          ...(typeof dto.description === 'string'
            ? { description: dto.description }
            : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'relationship_types_translations',
        'relationship_type_id',
        'relationship_types_translations_unique_locale',
        relationshipTypeId,
        dto.translations,
        ['name', 'description'],
      );

      return updated;
    });

    this.logMutation(
      'update',
      'relationship_types',
      relationshipTypeId,
      actorId,
    );

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.RELATIONSHIP_TYPES);

    return relationshipType;
  }

  async deleteRelationshipType(relationshipTypeId: string, actorId: string) {
    await this.ensureRelationshipTypeExists(relationshipTypeId);

    const inUseCount = await this.prisma.legal_representatives.count({
      where: { relationship_type_id: relationshipTypeId },
    });

    if (inUseCount > 0) {
      throw new AppConflictException(ErrorCode.ADMIN_RELATIONSHIP_TYPE_IN_USE, {
        id: relationshipTypeId,
      });
    }

    const relationshipType = await this.prisma.relationship_types.update({
      where: { relationship_type_id: relationshipTypeId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation(
      'delete',
      'relationship_types',
      relationshipTypeId,
      actorId,
    );

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.RELATIONSHIP_TYPES);

    return relationshipType;
  }

  async listAllergies() {
    // Small catalog table: expected to remain well under 500 rows.
    return this.prisma.allergies.findMany({
      orderBy: { name: 'asc' },
      take: 500,
      include: { translations: true },
    });
  }

  async createAllergy(dto: CreateAllergyDto, actorId: string) {
    const name = this.normalizeName(dto.name);
    this.translationService.validateTranslations(dto.translations);
    await this.ensureAllergyUnique(name);

    const allergy = await this.prisma.$transaction(async (tx) => {
      const created = await tx.allergies.create({
        data: {
          name,
          description: dto.description,
          active: dto.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'allergies_translations',
        'allergy_id',
        'allergies_translations_unique_locale',
        created.allergy_id,
        dto.translations,
        ['name', 'description'],
      );

      return created;
    });

    this.logMutation('create', 'allergies', allergy.allergy_id, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.ALLERGIES);

    return allergy;
  }

  async updateAllergy(
    allergyId: number,
    dto: UpdateAllergyDto,
    actorId: string,
  ) {
    await this.ensureAllergyExists(allergyId);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureAllergyUnique(name, allergyId);
    }

    this.translationService.validateTranslations(dto.translations);

    const allergy = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.allergies.update({
        where: { allergy_id: allergyId },
        data: {
          ...(name ? { name } : {}),
          ...(typeof dto.description === 'string'
            ? { description: dto.description }
            : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'allergies_translations',
        'allergy_id',
        'allergies_translations_unique_locale',
        allergyId,
        dto.translations,
        ['name', 'description'],
      );

      return updated;
    });

    this.logMutation('update', 'allergies', allergyId, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.ALLERGIES);

    return allergy;
  }

  async deleteAllergy(allergyId: number, actorId: string) {
    await this.ensureAllergyExists(allergyId);

    const inUseCount = await this.prisma.users_allergies.count({
      where: {
        allergy_id: allergyId,
        active: true,
      },
    });

    if (inUseCount > 0) {
      throw new AppConflictException(ErrorCode.ADMIN_ALLERGY_IN_USE, {
        id: allergyId,
      });
    }

    const allergy = await this.prisma.allergies.update({
      where: { allergy_id: allergyId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'allergies', allergyId, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.ALLERGIES);

    return allergy;
  }

  async listDiseases() {
    // Small catalog table: expected to remain well under 500 rows.
    return this.prisma.diseases.findMany({
      orderBy: { name: 'asc' },
      take: 500,
      include: { translations: true },
    });
  }

  async createDisease(dto: CreateDiseaseDto, actorId: string) {
    const name = this.normalizeName(dto.name);
    this.translationService.validateTranslations(dto.translations);
    await this.ensureDiseaseUnique(name);

    const disease = await this.prisma.$transaction(async (tx) => {
      const created = await tx.diseases.create({
        data: {
          name,
          description: dto.description,
          active: dto.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'diseases_translations',
        'disease_id',
        'diseases_translations_unique_locale',
        created.disease_id,
        dto.translations,
        ['name', 'description'],
      );

      return created;
    });

    this.logMutation('create', 'diseases', disease.disease_id, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.DISEASES);

    return disease;
  }

  async updateDisease(
    diseaseId: number,
    dto: UpdateDiseaseDto,
    actorId: string,
  ) {
    await this.ensureDiseaseExists(diseaseId);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureDiseaseUnique(name, diseaseId);
    }

    this.translationService.validateTranslations(dto.translations);

    const disease = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.diseases.update({
        where: { disease_id: diseaseId },
        data: {
          ...(name ? { name } : {}),
          ...(typeof dto.description === 'string'
            ? { description: dto.description }
            : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'diseases_translations',
        'disease_id',
        'diseases_translations_unique_locale',
        diseaseId,
        dto.translations,
        ['name', 'description'],
      );

      return updated;
    });

    this.logMutation('update', 'diseases', diseaseId, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.DISEASES);

    return disease;
  }

  async deleteDisease(diseaseId: number, actorId: string) {
    await this.ensureDiseaseExists(diseaseId);

    const inUseCount = await this.prisma.users_diseases.count({
      where: {
        disease_id: diseaseId,
        active: true,
      },
    });

    if (inUseCount > 0) {
      throw new AppConflictException(ErrorCode.ADMIN_DISEASE_IN_USE, {
        id: diseaseId,
      });
    }

    const disease = await this.prisma.diseases.update({
      where: { disease_id: diseaseId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'diseases', diseaseId, actorId);

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.DISEASES);

    return disease;
  }

  async listMedicines() {
    // Small catalog table: expected to remain well under 500 rows.
    return this.prisma.medicines.findMany({
      orderBy: { name: 'asc' },
      take: 500,
      include: { translations: true },
    });
  }

  async createMedicine(dto: CreateMedicineDto, actorId: string) {
    const name = this.normalizeName(dto.name);
    this.translationService.validateTranslations(dto.translations);
    await this.ensureMedicineUnique(name);

    const medicine = await this.prisma.$transaction(async (tx) => {
      const created = await tx.medicines.create({
        data: {
          name,
          description: dto.description,
          active: dto.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'medicines_translations',
        'medicine_id',
        'medicines_translations_unique_locale',
        created.medicine_id,
        dto.translations,
        ['name', 'description'],
      );

      return created;
    });

    this.logMutation('create', 'medicines', medicine.medicine_id, actorId);
    return medicine;
  }

  async updateMedicine(
    medicineId: number,
    dto: UpdateMedicineDto,
    actorId: string,
  ) {
    await this.ensureMedicineExists(medicineId);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureMedicineUnique(name, medicineId);
    }

    this.translationService.validateTranslations(dto.translations);

    const medicine = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.medicines.update({
        where: { medicine_id: medicineId },
        data: {
          ...(name ? { name } : {}),
          ...(typeof dto.description === 'string'
            ? { description: dto.description }
            : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'medicines_translations',
        'medicine_id',
        'medicines_translations_unique_locale',
        medicineId,
        dto.translations,
        ['name', 'description'],
      );

      return updated;
    });

    this.logMutation('update', 'medicines', medicineId, actorId);
    return medicine;
  }

  async deleteMedicine(medicineId: number, actorId: string) {
    await this.ensureMedicineExists(medicineId);

    const inUseCount = await this.prisma.users_medicines.count({
      where: {
        medicine_id: medicineId,
        active: true,
      },
    });

    if (inUseCount > 0) {
      throw new AppConflictException(ErrorCode.ADMIN_MEDICINE_IN_USE, {
        id: medicineId,
      });
    }

    const medicine = await this.prisma.medicines.update({
      where: { medicine_id: medicineId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'medicines', medicineId, actorId);
    return medicine;
  }

  async listEcclesiasticalYears() {
    // One record per year: expected to grow by at most one row per year.
    // Filter to active=true so deactivated/historical years are not surfaced
    // for new administrative selections.
    return this.prisma.ecclesiastical_years.findMany({
      where: { active: true },
      orderBy: { start_date: 'desc' },
      take: 100,
    });
  }

  async listClubIdeals() {
    // Static catalog defined per club type: expected to remain under 200 rows.
    return this.prisma.club_ideals.findMany({
      orderBy: [{ club_type_id: 'asc' }, { ideal_order: 'asc' }],
      take: 200,
      include: { translations: true },
    });
  }

  // ========================================
  // CLUB TYPES
  // ========================================

  async listClubTypes() {
    return this.prisma.club_types.findMany({
      orderBy: { name: 'asc' },
      take: 50,
      include: { translations: true },
    });
  }

  async createClubType(dto: CreateClubTypeDto, actorId: string) {
    const name = this.normalizeName(dto.name);
    this.translationService.validateTranslations(dto.translations);
    await this.ensureClubTypeUnique(name);

    const clubType = await this.prisma.$transaction(async (tx) => {
      const created = await tx.club_types.create({
        data: {
          name,
          active: dto.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'club_types_translations',
        'club_type_id',
        'club_types_translations_unique_locale',
        created.club_type_id,
        dto.translations,
        ['name'],
      );

      return created;
    });

    this.logMutation('create', 'club_types', clubType.club_type_id, actorId);
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.CLUB_TYPES);

    return clubType;
  }

  async updateClubType(
    clubTypeId: number,
    dto: UpdateClubTypeDto,
    actorId: string,
  ) {
    await this.ensureClubTypeExists(clubTypeId);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureClubTypeUnique(name, clubTypeId);
    }

    this.translationService.validateTranslations(dto.translations);

    const clubType = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.club_types.update({
        where: { club_type_id: clubTypeId },
        data: {
          ...(name ? { name } : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'club_types_translations',
        'club_type_id',
        'club_types_translations_unique_locale',
        clubTypeId,
        dto.translations,
        ['name'],
      );

      return updated;
    });

    this.logMutation('update', 'club_types', clubTypeId, actorId);
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.CLUB_TYPES);

    return clubType;
  }

  async deleteClubType(clubTypeId: number, actorId: string) {
    await this.ensureClubTypeExists(clubTypeId);

    const inUseCount = await this.prisma.club_sections.count({
      where: { club_type_id: clubTypeId, active: true },
    });

    if (inUseCount > 0) {
      throw new AppConflictException(ErrorCode.ADMIN_CLUB_TYPE_IN_USE, {
        id: clubTypeId,
      });
    }

    const clubType = await this.prisma.club_types.update({
      where: { club_type_id: clubTypeId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'club_types', clubTypeId, actorId);
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.CLUB_TYPES);

    return clubType;
  }

  private async ensureClubTypeExists(clubTypeId: number) {
    const entity = await this.prisma.club_types.findUnique({
      where: { club_type_id: clubTypeId },
    });

    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_CLUB_TYPE_NOT_FOUND, {
        id: clubTypeId,
      });
    }

    return entity;
  }

  private async ensureClubTypeUnique(name: string, excludeId?: number) {
    const existing = await this.prisma.club_types.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { NOT: { club_type_id: excludeId } } : {}),
      },
    });

    if (existing) {
      throw new AppConflictException(ErrorCode.ADMIN_CLUB_TYPE_NAME_CONFLICT);
    }
  }

  // ========================================
  // CLUB IDEALS (admin CRUD)
  // ========================================

  async createClubIdeal(dto: CreateClubIdealDto, actorId: string) {
    const name = this.normalizeName(dto.name);

    // Ensure referenced club type exists
    await this.ensureClubTypeExists(dto.club_type_id);

    this.translationService.validateTranslations(dto.translations);

    const clubIdeal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.club_ideals.create({
        data: {
          name,
          club_type_id: dto.club_type_id,
          ideal_order: dto.ideal_order,
          ideal: dto.ideal ?? null,
          active: dto.active ?? true,
        },
      });

      // CRITICAL: club_ideals uses ['name', 'ideal'] — NOT the default ['name', 'description']
      await this.translationService.upsertTranslations(
        tx,
        'club_ideals_translations',
        'club_ideal_id',
        'club_ideals_translations_unique_locale',
        created.club_ideal_id,
        dto.translations,
        ['name', 'ideal'],
      );

      return created;
    });

    this.logMutation('create', 'club_ideals', clubIdeal.club_ideal_id, actorId);
    await this.catalogCache.invalidate(
      CATALOG_CACHE_KEYS.CLUB_IDEALS(dto.club_type_id),
    );
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.CLUB_IDEALS());

    return clubIdeal;
  }

  async updateClubIdeal(
    clubIdealId: number,
    dto: UpdateClubIdealDto,
    actorId: string,
  ) {
    const existing = await this.ensureClubIdealExists(clubIdealId);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;

    this.translationService.validateTranslations(dto.translations);

    const clubIdeal = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.club_ideals.update({
        where: { club_ideal_id: clubIdealId },
        data: {
          ...(name ? { name } : {}),
          ...(typeof dto.ideal_order === 'number'
            ? { ideal_order: dto.ideal_order }
            : {}),
          ...(typeof dto.ideal === 'string' ? { ideal: dto.ideal } : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

      // CRITICAL: club_ideals uses ['name', 'ideal'] — NOT the default ['name', 'description']
      await this.translationService.upsertTranslations(
        tx,
        'club_ideals_translations',
        'club_ideal_id',
        'club_ideals_translations_unique_locale',
        clubIdealId,
        dto.translations,
        ['name', 'ideal'],
      );

      return updated;
    });

    this.logMutation('update', 'club_ideals', clubIdealId, actorId);
    await this.catalogCache.invalidate(
      CATALOG_CACHE_KEYS.CLUB_IDEALS(existing.club_type_id),
    );
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.CLUB_IDEALS());

    return clubIdeal;
  }

  async deleteClubIdeal(clubIdealId: number, actorId: string) {
    const existing = await this.ensureClubIdealExists(clubIdealId);

    const clubIdeal = await this.prisma.club_ideals.update({
      where: { club_ideal_id: clubIdealId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'club_ideals', clubIdealId, actorId);
    await this.catalogCache.invalidate(
      CATALOG_CACHE_KEYS.CLUB_IDEALS(existing.club_type_id),
    );
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.CLUB_IDEALS());

    return clubIdeal;
  }

  private async ensureClubIdealExists(clubIdealId: number) {
    const entity = await this.prisma.club_ideals.findUnique({
      where: { club_ideal_id: clubIdealId },
    });

    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_CLUB_IDEAL_NOT_FOUND, {
        id: clubIdealId,
      });
    }

    return entity;
  }

  async createEcclesiasticalYear(
    dto: CreateEcclesiasticalYearDto,
    actorId: string,
  ) {
    const startDate = new Date(dto.start_date);
    const endDate = new Date(dto.end_date);
    this.validateDateRange(startDate, endDate);

    const data = {
      start_date: startDate,
      end_date: endDate,
      active: dto.active ?? false,
    };

    const year = await this.prisma.$transaction(async (tx) => {
      if (data.active) {
        await tx.ecclesiastical_years.updateMany({
          where: { active: true },
          data: { active: false, modified_at: new Date() },
        });
      }

      return tx.ecclesiastical_years.create({ data });
    });

    this.logMutation('create', 'ecclesiastical_years', year.year_id, actorId);

    await this.catalogCache.invalidateMany([
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS,
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS_CURRENT,
    ]);

    return year;
  }

  async updateEcclesiasticalYear(
    yearId: number,
    dto: UpdateEcclesiasticalYearDto,
    actorId: string,
  ) {
    const current = await this.ensureEcclesiasticalYearExists(yearId);

    const startDate = dto.start_date
      ? new Date(dto.start_date)
      : current.start_date;
    const endDate = dto.end_date ? new Date(dto.end_date) : current.end_date;
    this.validateDateRange(startDate, endDate);

    const year = await this.prisma.$transaction(async (tx) => {
      if (dto.active === true) {
        await tx.ecclesiastical_years.updateMany({
          where: { active: true, NOT: { year_id: yearId } },
          data: { active: false, modified_at: new Date() },
        });
      }

      return tx.ecclesiastical_years.update({
        where: { year_id: yearId },
        data: {
          ...(dto.start_date ? { start_date: startDate } : {}),
          ...(dto.end_date ? { end_date: endDate } : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });
    });

    this.logMutation('update', 'ecclesiastical_years', yearId, actorId);

    await this.catalogCache.invalidateMany([
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS,
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS_CURRENT,
    ]);

    return year;
  }

  async deleteEcclesiasticalYear(yearId: number, actorId: string) {
    await this.ensureEcclesiasticalYearExists(yearId);

    const activeAssignments = await this.prisma.club_role_assignments.count({
      where: {
        ecclesiastical_year_id: yearId,
        active: true,
      },
    });

    if (activeAssignments > 0) {
      throw new AppConflictException(
        ErrorCode.ADMIN_ECCLESIASTICAL_YEAR_HAS_ACTIVE_ASSIGNMENTS,
        { id: yearId },
      );
    }

    const year = await this.prisma.ecclesiastical_years.update({
      where: { year_id: yearId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', 'ecclesiastical_years', yearId, actorId);

    await this.catalogCache.invalidateMany([
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS,
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS_CURRENT,
    ]);

    return year;
  }

  async listHonorCategories(
    query: HonorCategoryListQueryDto = new HonorCategoryListQueryDto(),
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where: Prisma.honors_categoriesWhereInput = search
      ? {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.honors_categories.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { honors: true },
          },
        },
      }),
      this.prisma.honors_categories.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
    };
  }

  async getHonorCategory(id: number): Promise<HonorCategoryRecord> {
    return this.prisma.honors_categories.findUniqueOrThrow({
      where: { honor_category_id: id },
      include: {
        _count: {
          select: { honors: true },
        },
      },
    });
  }

  async createHonorCategory(
    dto: CreateHonorCategoryDto,
    actorId: string,
  ): Promise<HonorCategoryRecord> {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);
    await this.ensureHonorCategoryUnique(name);

    const { translations, ...mainData } = dto;

    const category = await this.prisma.$transaction(async (tx) => {
      const record = await tx.honors_categories.create({
        data: {
          name,
          description: mainData.description,
          icon: mainData.icon ?? null,
          active: mainData.active ?? true,
        },
        include: {
          _count: {
            select: { honors: true },
          },
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'honors_categories_translations',
        'honor_category_id',
        'honor_category_id_locale',
        record.honor_category_id,
        translations,
      );

      return record;
    });

    this.logMutation(
      'create',
      'honors_categories',
      category.honor_category_id,
      actorId,
    );
    return category;
  }

  async updateHonorCategory(
    id: number,
    dto: UpdateHonorCategoryDto,
    actorId: string,
  ): Promise<HonorCategoryRecord> {
    this.translationService.validateTranslations(dto.translations);
    await this.ensureHonorCategoryExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureHonorCategoryUnique(name, id);
    }

    const { translations, ...mainDto } = dto;

    const category = await this.prisma.$transaction(async (tx) => {
      const record = await tx.honors_categories.update({
        where: { honor_category_id: id },
        data: {
          ...(name ? { name } : {}),
          ...(typeof mainDto.description === 'string'
            ? { description: mainDto.description }
            : {}),
          ...(mainDto.icon !== undefined ? { icon: mainDto.icon } : {}),
          ...(typeof mainDto.active === 'boolean'
            ? { active: mainDto.active }
            : {}),
          modified_at: new Date(),
        },
        include: {
          _count: {
            select: { honors: true },
          },
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'honors_categories_translations',
        'honor_category_id',
        'honor_category_id_locale',
        id,
        translations,
      );

      return record;
    });

    this.logMutation('update', 'honors_categories', id, actorId);
    return category;
  }

  async deleteHonorCategory(
    id: number,
    actorId: string,
  ): Promise<HonorCategoryRecord> {
    await this.ensureHonorCategoryExists(id);

    const inUseCount = await this.prisma.honors.count({
      where: {
        honors_category_id: id,
        active: true,
      },
    });

    if (inUseCount > 0) {
      throw new AppConflictException(ErrorCode.ADMIN_HONOR_CATEGORY_IN_USE, {
        id,
      });
    }

    const category = await this.prisma.honors_categories.update({
      where: { honor_category_id: id },
      data: {
        active: false,
        modified_at: new Date(),
      },
      include: {
        _count: {
          select: { honors: true },
        },
      },
    });

    this.logMutation('delete', 'honors_categories', id, actorId);
    return category;
  }

  private validateDateRange(startDate: Date, endDate: Date) {
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new AppBadRequestException(
        ErrorCode.ADMIN_ECCLESIASTICAL_YEAR_DATE_INVALID,
      );
    }

    if (startDate >= endDate) {
      throw new AppBadRequestException(
        ErrorCode.ADMIN_ECCLESIASTICAL_YEAR_DATE_INVALID,
      );
    }
  }

  private async ensureRelationshipTypeExists(relationshipTypeId: string) {
    const entity = await this.prisma.relationship_types.findUnique({
      where: { relationship_type_id: relationshipTypeId },
    });

    if (!entity) {
      throw new AppNotFoundException(
        ErrorCode.ADMIN_RELATIONSHIP_TYPE_NOT_FOUND,
        { id: relationshipTypeId },
      );
    }

    return entity;
  }

  private async ensureRelationshipTypeUnique(
    name: string,
    relationshipTypeId?: string,
  ) {
    const existing = await this.prisma.relationship_types.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(relationshipTypeId
          ? { NOT: { relationship_type_id: relationshipTypeId } }
          : {}),
      },
    });

    if (existing) {
      throw new AppConflictException(
        ErrorCode.ADMIN_RELATIONSHIP_TYPE_NAME_CONFLICT,
      );
    }
  }

  private async ensureAllergyExists(allergyId: number) {
    const entity = await this.prisma.allergies.findUnique({
      where: { allergy_id: allergyId },
    });

    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_ALLERGY_NOT_FOUND, {
        id: allergyId,
      });
    }

    return entity;
  }

  private async ensureAllergyUnique(name: string, allergyId?: number) {
    const existing = await this.prisma.allergies.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(allergyId ? { NOT: { allergy_id: allergyId } } : {}),
      },
    });

    if (existing) {
      throw new AppConflictException(ErrorCode.ADMIN_ALLERGY_NAME_CONFLICT);
    }
  }

  private async ensureDiseaseExists(diseaseId: number) {
    const entity = await this.prisma.diseases.findUnique({
      where: { disease_id: diseaseId },
    });

    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_DISEASE_NOT_FOUND, {
        id: diseaseId,
      });
    }

    return entity;
  }

  private async ensureDiseaseUnique(name: string, diseaseId?: number) {
    const existing = await this.prisma.diseases.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(diseaseId ? { NOT: { disease_id: diseaseId } } : {}),
      },
    });

    if (existing) {
      throw new AppConflictException(ErrorCode.ADMIN_DISEASE_NAME_CONFLICT);
    }
  }

  private async ensureMedicineExists(medicineId: number) {
    const entity = await this.prisma.medicines.findUnique({
      where: { medicine_id: medicineId },
    });

    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_MEDICINE_NOT_FOUND, {
        id: medicineId,
      });
    }

    return entity;
  }

  private async ensureMedicineUnique(name: string, medicineId?: number) {
    const existing = await this.prisma.medicines.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(medicineId ? { NOT: { medicine_id: medicineId } } : {}),
      },
    });

    if (existing) {
      throw new AppConflictException(ErrorCode.ADMIN_MEDICINE_NAME_CONFLICT);
    }
  }

  private async ensureEcclesiasticalYearExists(yearId: number) {
    const entity = await this.prisma.ecclesiastical_years.findUnique({
      where: { year_id: yearId },
    });

    if (!entity) {
      throw new AppNotFoundException(
        ErrorCode.ADMIN_ECCLESIASTICAL_YEAR_NOT_FOUND,
        { id: yearId },
      );
    }

    return entity;
  }

  private async ensureHonorCategoryExists(honorCategoryId: number) {
    const entity = await this.prisma.honors_categories.findUnique({
      where: { honor_category_id: honorCategoryId },
    });

    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_HONOR_CATEGORY_NOT_FOUND, {
        id: honorCategoryId,
      });
    }

    return entity;
  }

  private async ensureHonorCategoryUnique(
    name: string,
    honorCategoryId?: number,
  ) {
    const existing = await this.prisma.honors_categories.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(honorCategoryId
          ? { NOT: { honor_category_id: honorCategoryId } }
          : {}),
      },
    });

    if (existing) {
      throw new AppConflictException(
        ErrorCode.ADMIN_HONOR_CATEGORY_NAME_CONFLICT,
      );
    }
  }
}
