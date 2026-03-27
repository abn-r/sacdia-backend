import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { role_category } from '@prisma/client';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from './catalog-cache.service';

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
  // UNIONS
  // ========================================
  async getUnions(countryId?: number) {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.UNIONS(countryId),
      () =>
        this.prisma.unions.findMany({
          where: {
            active: true,
            ...(countryId && { country_id: countryId }),
          },
          select: {
            union_id: true,
            name: true,
            country_id: true,
          },
          orderBy: { name: 'asc' },
        }),
    );
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
  async getDistricts(localFieldId?: number) {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.DISTRICTS(localFieldId),
      () =>
        this.prisma.districts.findMany({
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
        }),
    );
  }

  // ========================================
  // CHURCHES
  // ========================================
  async getChurches(districtId?: number) {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.CHURCHES(districtId),
      () =>
        this.prisma.churches.findMany({
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
        }),
    );
  }

  // ========================================
  // ROLES
  // ========================================
  async getRoles(category?: string) {
    const whereClause: { active: boolean; role_category?: role_category } = {
      active: true,
    };

    if (category && (category === 'GLOBAL' || category === 'CLUB')) {
      whereClause.role_category = category as role_category;
    }

    return this.catalogCache.getOrSet(CATALOG_CACHE_KEYS.ROLES(category), () =>
      this.prisma.roles.findMany({
        where: whereClause,
        select: {
          role_id: true,
          role_name: true,
          role_category: true,
        },
        orderBy: { role_name: 'asc' },
      }),
    );
  }

  // ========================================
  // ECCLESIASTICAL YEARS
  // ========================================
  async getEcclesiasticalYears() {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS,
      () =>
        this.prisma.ecclesiastical_years.findMany({
          select: {
            year_id: true,
            start_date: true,
            end_date: true,
            active: true,
          },
          orderBy: { start_date: 'desc' },
        }),
    );
  }

  async getCurrentEcclesiasticalYear() {
    const today = new Date();

    // Current year changes once a year — 24h TTL is safe.
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS_CURRENT,
      () =>
        this.prisma.ecclesiastical_years.findFirst({
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
        }),
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
}
