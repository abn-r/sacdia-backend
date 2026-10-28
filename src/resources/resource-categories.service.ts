import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from '../catalogs/catalog-cache.service';
import { CreateResourceCategoryDto } from './dto/create-resource-category.dto';
import { UpdateResourceCategoryDto } from './dto/update-resource-category.dto';

@Injectable()
export class ResourceCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogCache: CatalogCacheService,
  ) {}

  async create(dto: CreateResourceCategoryDto) {
    const created = await this.prisma.resource_categories.create({
      data: {
        name: dto.name,
        description: dto.description,
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.RESOURCE_CATEGORIES);
    return created;
  }

  /**
   * Active categories by default (cached: the app and the resource forms read
   * them). `includeInactive` returns every category, uncached, so the admin
   * can find a deactivated one and reactivate it.
   */
  async findAll(options: { includeInactive?: boolean } = {}) {
    if (options.includeInactive) {
      return this.prisma.resource_categories.findMany({
        orderBy: { name: 'asc' },
      });
    }
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.RESOURCE_CATEGORIES,
      () =>
        this.prisma.resource_categories.findMany({
          where: { active: true },
          orderBy: { name: 'asc' },
        }),
    );
  }

  async findOne(id: number) {
    const category = await this.prisma.resource_categories.findUnique({
      where: { resource_category_id: id },
    });
    if (!category) {
      throw new AppNotFoundException(ErrorCode.RESOURCE_CATEGORY_NOT_FOUND);
    }
    return category;
  }

  async update(id: number, dto: UpdateResourceCategoryDto) {
    await this.findOne(id);
    const updated = await this.prisma.resource_categories.update({
      where: { resource_category_id: id },
      data: dto,
    });
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.RESOURCE_CATEGORIES);
    return updated;
  }

  async remove(id: number) {
    await this.findOne(id);
    const resourceCount = await this.prisma.resources.count({
      where: { resource_category_id: id, active: true },
    });
    if (resourceCount > 0) {
      throw new AppBadRequestException(ErrorCode.RESOURCE_CATEGORY_IN_USE);
    }
    const removed = await this.prisma.resource_categories.update({
      where: { resource_category_id: id },
      data: { active: false },
    });
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.RESOURCE_CATEGORIES);
    return removed;
  }
}
