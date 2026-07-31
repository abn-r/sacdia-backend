import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertActorCanAccessLocalField,
  type ActorLocalFieldScope,
} from '../shared/actor-local-field';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';
import type { CategoryAdminDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // LIST — admin view; includes inactive + product_count
  // ---------------------------------------------------------------------------

  async list(localFieldId: number): Promise<CategoryAdminDto[]> {
    const rows = await this.prisma.materialCategory.findMany({
      where: {
        local_field_id: localFieldId,
      },
      orderBy: [{ sort_order: 'asc' }, { label: 'asc' }],
      include: {
        _count: {
          select: {
            products: { where: { local_field_id: localFieldId } },
          },
        },
      },
    });

    return rows.map((r) => this.mapRow(r));
  }

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------

  async create(
    dto: CreateCategoryDto,
    localFieldId: number,
  ): Promise<CategoryAdminDto> {
    try {
      const row = await this.prisma.materialCategory.create({
        data: {
          local_field_id: localFieldId,
          slug: dto.slug,
          label: dto.label,
          icon: dto.icon ?? null,
          sort_order: dto.sort_order ?? 0,
          active: dto.active ?? true,
        },
        include: { _count: { select: { products: true } } },
      });
      return this.mapRow(row);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({ code: 'slug_duplicate', slug: dto.slug });
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------

  async update(
    id: string,
    dto: UpdateCategoryDto,
    scope: ActorLocalFieldScope,
  ): Promise<CategoryAdminDto> {
    const existing = await this.prisma.materialCategory.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'category_not_found',
        message: `Category ${id} not found`,
      });
    }

    assertActorCanAccessLocalField(scope, existing.local_field_id);

    if (dto.active === true && !existing.active && scope.scope !== 'all') {
      throw new ForbiddenException({
        code: 'material_reactivation_requires_super_admin',
        message: 'Only super-admin may reactivate a material category.',
      });
    }

    // Deactivation guard: block if there are active products referencing it.
    if (dto.active === false) {
      const inUse = await this.prisma.materialProduct.findFirst({
        where: { material_category_id: id, active: true },
        select: { id: true },
      });
      if (inUse) {
        throw new ConflictException({
          code: 'category_in_use',
          message:
            'Cannot deactivate a category that still has active products. Reassign or deactivate those products first.',
        });
      }
    }

    const data: Prisma.MaterialCategoryUncheckedUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.sort_order !== undefined) data.sort_order = dto.sort_order;
    if (dto.active !== undefined) data.active = dto.active;

    const updated = await this.prisma.materialCategory.update({
      where: { id },
      data,
      include: { _count: { select: { products: true } } },
    });

    this.logger.log({ event: 'category.updated', id });
    return this.mapRow(updated);
  }

  // ---------------------------------------------------------------------------
  // SOFT DELETE — sets active=false. Hard delete blocked if any product
  // references the category (Restrict FK).
  // ---------------------------------------------------------------------------

  async softDelete(
    id: string,
    scope: ActorLocalFieldScope,
  ): Promise<{ id: string; active: false }> {
    const existing = await this.prisma.materialCategory.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'category_not_found',
        message: `Category ${id} not found`,
      });
    }

    assertActorCanAccessLocalField(scope, existing.local_field_id);

    if (existing._count.products > 0) {
      throw new ConflictException({
        code: 'category_in_use',
        product_count: existing._count.products,
        message:
          'Cannot delete a category that has products. Reassign products first.',
      });
    }

    await this.prisma.materialCategory.update({
      where: { id },
      data: { active: false },
    });

    this.logger.log({ event: 'category.deleted', id });
    return { id, active: false };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE MAPPER
  // ---------------------------------------------------------------------------

  private mapRow(row: {
    id: string;
    slug: string;
    label: string;
    icon: string | null;
    sort_order: number;
    active: boolean;
    created_at: Date;
    updated_at: Date;
    _count: { products: number };
  }): CategoryAdminDto {
    return {
      id: row.id,
      slug: row.slug,
      label: row.label,
      icon: row.icon,
      sort_order: row.sort_order,
      active: row.active,
      product_count: row._count.products,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
