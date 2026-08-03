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
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.materialCategory.findUnique({ where: { id } });
      this.requireExistingCategory(existing, id);
      assertActorCanAccessLocalField(scope, existing.local_field_id);
      this.assertLifecycleWrite(scope, existing.active, dto.active);

      if (dto.active === false) {
        const inUse = await tx.materialProduct.findFirst({
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

      const result = await tx.materialCategory.updateMany({
        where: {
          id,
          local_field_id: existing.local_field_id,
          ...(scope.scope === 'single' && { active: true }),
        },
        data,
      });
      if (result.count !== 1) {
        const current = await tx.materialCategory.findUnique({ where: { id } });
        this.requireExistingCategory(current, id);
        assertActorCanAccessLocalField(scope, current.local_field_id);
        this.assertLifecycleWrite(scope, current.active, dto.active);
        throw this.concurrentCategoryChange();
      }

      const current = await tx.materialCategory.findUnique({
        where: { id },
        include: { _count: { select: { products: true } } },
      });
      this.requireExistingCategory(current, id);
      return current;
    });

    this.logger.log({ event: 'category.updated', id });
    return this.mapRow(updated);
  }

  // ---------------------------------------------------------------------------
  // REACTIVATE — privileged lifecycle transition. Check authority before the
  // resource lookup so non-super-admin callers cannot probe category UUIDs.
  // ---------------------------------------------------------------------------

  async reactivate(
    id: string,
    scope: ActorLocalFieldScope,
  ): Promise<CategoryAdminDto> {
    if (scope.scope !== 'all') {
      throw new ForbiddenException({
        code: 'material_reactivation_requires_super_admin',
        message: 'Only super-admin may reactivate a material category.',
      });
    }

    return this.update(id, { active: true }, scope);
  }

  // ---------------------------------------------------------------------------
  // SOFT DELETE — sets active=false. Hard delete blocked if any product
  // references the category (Restrict FK).
  // ---------------------------------------------------------------------------

  async softDelete(
    id: string,
    scope: ActorLocalFieldScope,
  ): Promise<{ id: string; active: false }> {
    const deleted = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.materialCategory.findUnique({
        where: { id },
        include: { _count: { select: { products: true } } },
      });
      this.requireExistingCategory(existing, id);
      assertActorCanAccessLocalField(scope, existing.local_field_id);

      if (!existing.active) return { id, active: false as const };
      if (existing._count.products > 0) {
        throw new ConflictException({
          code: 'category_in_use',
          product_count: existing._count.products,
          message:
            'Cannot delete a category that has products. Reassign products first.',
        });
      }

      const result = await tx.materialCategory.updateMany({
        where: {
          id,
          local_field_id: existing.local_field_id,
          active: true,
        },
        data: { active: false },
      });
      if (result.count !== 1) {
        const current = await tx.materialCategory.findUnique({ where: { id } });
        this.requireExistingCategory(current, id);
        assertActorCanAccessLocalField(scope, current.local_field_id);
        if (!current.active) return { id, active: false as const };
        throw this.concurrentCategoryChange();
      }

      const current = await tx.materialCategory.findUnique({ where: { id } });
      this.requireExistingCategory(current, id);
      assertActorCanAccessLocalField(scope, current.local_field_id);
      if (current.active) throw this.concurrentCategoryChange();
      return { id: current.id, active: current.active };
    });

    this.logger.log({ event: 'category.deleted', id });
    return deleted;
  }

  private requireExistingCategory<T>(
    category: T | null,
    id: string,
  ): asserts category is T {
    if (!category) {
      throw new NotFoundException({
        code: 'category_not_found',
        message: `Category ${id} not found`,
      });
    }
  }

  private assertLifecycleWrite(
    scope: ActorLocalFieldScope,
    active: boolean,
    requestedActive: boolean | undefined,
  ): void {
    if (active || scope.scope === 'all') return;
    if (requestedActive === true) {
      throw new ForbiddenException({
        code: 'material_reactivation_requires_super_admin',
        message: 'Only super-admin may reactivate a material category.',
      });
    }
    throw new ConflictException({
      code: 'category_inactive',
      message: 'Inactive categories cannot be modified.',
    });
  }

  private concurrentCategoryChange(): ConflictException {
    return new ConflictException({
      code: 'category_concurrent_change',
      message: 'The category changed concurrently. Retry the operation.',
    });
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
