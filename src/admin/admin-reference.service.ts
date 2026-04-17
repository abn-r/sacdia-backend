import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

type HonorCategoryRecord = Prisma.honors_categoriesGetPayload<{
  include: { _count: { select: { honors: true } } };
}>;

@Injectable()
export class AdminReferenceService {
  private readonly logger = new Logger(AdminReferenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogCache: CatalogCacheService,
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
    });
  }

  async createActivityType(dto: CreateActivityTypeDto, actorId: string) {
    const name = this.normalizeName(dto.name);
    const code = dto.code.trim();

    await this.ensureActivityTypeUnique(name, code);

    const activityType = await this.prisma.activity_types.create({
      data: {
        code,
        name,
        description: dto.description,
        active: dto.active ?? true,
      },
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

    const activityType = await this.prisma.activity_types.update({
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

    this.logMutation(
      'update',
      'activity_types',
      activityTypeId,
      actorId,
    );

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.ACTIVITY_TYPES);

    return activityType;
  }

  async deleteActivityType(activityTypeId: number, actorId: string) {
    await this.ensureActivityTypeExists(activityTypeId);

    const inUseCount = await this.prisma.activities.count({
      where: { activity_type_id: activityTypeId, active: true },
    });

    if (inUseCount > 0) {
      throw new ConflictException(
        'Cannot deactivate activity type because it is in use by active activities',
      );
    }

    const activityType = await this.prisma.activity_types.update({
      where: { activity_type_id: activityTypeId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation(
      'delete',
      'activity_types',
      activityTypeId,
      actorId,
    );

    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.ACTIVITY_TYPES);

    return activityType;
  }

  private async ensureActivityTypeExists(activityTypeId: number) {
    const entity = await this.prisma.activity_types.findUnique({
      where: { activity_type_id: activityTypeId },
    });

    if (!entity) {
      throw new NotFoundException(
        `Activity type ${activityTypeId} not found`,
      );
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
        throw new ConflictException('Activity type name already exists');
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
        throw new ConflictException('Activity type code already exists');
      }
    }
  }

  async listRelationshipTypes() {
    // Small catalog table: expected to remain well under 100 rows.
    return this.prisma.relationship_types.findMany({
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  async createRelationshipType(
    dto: CreateRelationshipTypeDto,
    actorId: string,
  ) {
    const name = this.normalizeName(dto.name);
    await this.ensureRelationshipTypeUnique(name);

    const relationshipType = await this.prisma.relationship_types.create({
      data: {
        name,
        description: dto.description,
        active: dto.active ?? true,
      },
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

    const relationshipType = await this.prisma.relationship_types.update({
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
      throw new ConflictException(
        'Cannot deactivate relationship type because it is in use',
      );
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
    });
  }

  async createAllergy(dto: CreateAllergyDto, actorId: string) {
    const name = this.normalizeName(dto.name);
    await this.ensureAllergyUnique(name);

    const allergy = await this.prisma.allergies.create({
      data: {
        name,
        description: dto.description,
        active: dto.active ?? true,
      },
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

    const allergy = await this.prisma.allergies.update({
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
      throw new ConflictException(
        'Cannot deactivate allergy because it is in use',
      );
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
    });
  }

  async createDisease(dto: CreateDiseaseDto, actorId: string) {
    const name = this.normalizeName(dto.name);
    await this.ensureDiseaseUnique(name);

    const disease = await this.prisma.diseases.create({
      data: {
        name,
        description: dto.description,
        active: dto.active ?? true,
      },
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

    const disease = await this.prisma.diseases.update({
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
      throw new ConflictException(
        'Cannot deactivate disease because it is in use',
      );
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
    });
  }

  async createMedicine(dto: CreateMedicineDto, actorId: string) {
    const name = this.normalizeName(dto.name);
    await this.ensureMedicineUnique(name);

    const medicine = await this.prisma.medicines.create({
      data: {
        name,
        description: dto.description,
        active: dto.active ?? true,
      },
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

    const medicine = await this.prisma.medicines.update({
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
      throw new ConflictException(
        'Cannot deactivate medicine because it is in use',
      );
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
    return this.prisma.ecclesiastical_years.findMany({
      orderBy: { start_date: 'desc' },
      take: 100,
    });
  }

  async listClubIdeals() {
    // Static catalog defined per club type: expected to remain under 200 rows.
    return this.prisma.club_ideals.findMany({
      orderBy: [{ club_type_id: 'asc' }, { ideal_order: 'asc' }],
      take: 200,
    });
  }

  // ========================================
  // CLUB TYPES
  // ========================================

  async listClubTypes() {
    return this.prisma.club_types.findMany({
      orderBy: { name: 'asc' },
      take: 50,
    });
  }

  async createClubType(dto: CreateClubTypeDto, actorId: string) {
    const name = this.normalizeName(dto.name);
    await this.ensureClubTypeUnique(name);

    const clubType = await this.prisma.club_types.create({
      data: {
        name,
        active: dto.active ?? true,
      },
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

    const clubType = await this.prisma.club_types.update({
      where: { club_type_id: clubTypeId },
      data: {
        ...(name ? { name } : {}),
        ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
        modified_at: new Date(),
      },
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
      throw new ConflictException(
        'Cannot deactivate club type because it has active club sections',
      );
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
      throw new NotFoundException(`Club type ${clubTypeId} not found`);
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
      throw new ConflictException('Club type name already exists');
    }
  }

  // ========================================
  // CLUB IDEALS (admin CRUD)
  // ========================================

  async createClubIdeal(dto: CreateClubIdealDto, actorId: string) {
    const name = this.normalizeName(dto.name);

    // Ensure referenced club type exists
    await this.ensureClubTypeExists(dto.club_type_id);

    const clubIdeal = await this.prisma.club_ideals.create({
      data: {
        name,
        club_type_id: dto.club_type_id,
        ideal_order: dto.ideal_order,
        ideal: dto.ideal ?? null,
        active: dto.active ?? true,
      },
    });

    this.logMutation(
      'create',
      'club_ideals',
      clubIdeal.club_ideal_id,
      actorId,
    );
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

    const clubIdeal = await this.prisma.club_ideals.update({
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

    this.logMutation(
      'update',
      'club_ideals',
      clubIdealId,
      actorId,
    );
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

    this.logMutation(
      'delete',
      'club_ideals',
      clubIdealId,
      actorId,
    );
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
      throw new NotFoundException(`Club ideal ${clubIdealId} not found`);
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
      throw new ConflictException(
        'Cannot deactivate ecclesiastical year with active role assignments',
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
    const name = this.normalizeName(dto.name);
    await this.ensureHonorCategoryUnique(name);

    const category = await this.prisma.honors_categories.create({
      data: {
        name,
        description: dto.description,
        icon: dto.icon ?? null,
        active: dto.active ?? true,
      },
      include: {
        _count: {
          select: { honors: true },
        },
      },
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
    await this.ensureHonorCategoryExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureHonorCategoryUnique(name, id);
    }

    const category = await this.prisma.honors_categories.update({
      where: { honor_category_id: id },
      data: {
        ...(name ? { name } : {}),
        ...(typeof dto.description === 'string'
          ? { description: dto.description }
          : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
        modified_at: new Date(),
      },
      include: {
        _count: {
          select: { honors: true },
        },
      },
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
      throw new ConflictException(
        'Cannot deactivate honor category because it is in use',
      );
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
      throw new BadRequestException('Invalid date format');
    }

    if (startDate >= endDate) {
      throw new BadRequestException('start_date must be before end_date');
    }
  }

  private async ensureRelationshipTypeExists(relationshipTypeId: string) {
    const entity = await this.prisma.relationship_types.findUnique({
      where: { relationship_type_id: relationshipTypeId },
    });

    if (!entity) {
      throw new NotFoundException(
        `Relationship type ${relationshipTypeId} not found`,
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
      throw new ConflictException('Relationship type name already exists');
    }
  }

  private async ensureAllergyExists(allergyId: number) {
    const entity = await this.prisma.allergies.findUnique({
      where: { allergy_id: allergyId },
    });

    if (!entity) {
      throw new NotFoundException(`Allergy ${allergyId} not found`);
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
      throw new ConflictException('Allergy name already exists');
    }
  }

  private async ensureDiseaseExists(diseaseId: number) {
    const entity = await this.prisma.diseases.findUnique({
      where: { disease_id: diseaseId },
    });

    if (!entity) {
      throw new NotFoundException(`Disease ${diseaseId} not found`);
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
      throw new ConflictException('Disease name already exists');
    }
  }

  private async ensureMedicineExists(medicineId: number) {
    const entity = await this.prisma.medicines.findUnique({
      where: { medicine_id: medicineId },
    });

    if (!entity) {
      throw new NotFoundException(`Medicine ${medicineId} not found`);
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
      throw new ConflictException('Medicine name already exists');
    }
  }

  private async ensureEcclesiasticalYearExists(yearId: number) {
    const entity = await this.prisma.ecclesiastical_years.findUnique({
      where: { year_id: yearId },
    });

    if (!entity) {
      throw new NotFoundException(`Ecclesiastical year ${yearId} not found`);
    }

    return entity;
  }

  private async ensureHonorCategoryExists(honorCategoryId: number) {
    const entity = await this.prisma.honors_categories.findUnique({
      where: { honor_category_id: honorCategoryId },
    });

    if (!entity) {
      throw new NotFoundException(
        `Honor category ${honorCategoryId} not found`,
      );
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
      throw new ConflictException('Honor category name already exists');
    }
  }
}
