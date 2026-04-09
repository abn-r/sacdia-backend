import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateScoringCategoryDto,
  UpdateScoringCategoryDto,
} from './dto/scoring-categories.dto';
import { origin_level_enum } from '@prisma/client';

export interface CategoryWithReadonly {
  scoring_category_id: number;
  name: string;
  max_points: number;
  origin_level: origin_level_enum;
  origin_id: number;
  active: boolean;
  created_at: Date;
  modified_at: Date;
  readonly: boolean;
  origin_badge?: string;
}

@Injectable()
export class ScoringCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // DIVISION level (origin_id = 0 represents global division)
  // ============================================================

  async findDivisionCategories(): Promise<CategoryWithReadonly[]> {
    const categories = await this.prisma.scoring_categories.findMany({
      where: { origin_level: 'DIVISION', active: true },
      orderBy: { name: 'asc' },
    });

    return categories.map((cat) => ({
      ...cat,
      readonly: false,
      origin_badge: 'Division',
    }));
  }

  async createDivisionCategory(dto: CreateScoringCategoryDto) {
    return this.prisma.scoring_categories.create({
      data: {
        name: dto.name,
        max_points: dto.max_points,
        origin_level: 'DIVISION',
        origin_id: 0, // 0 = global division (no divisions table in schema)
        active: true,
      },
    });
  }

  async updateDivisionCategory(id: number, dto: UpdateScoringCategoryDto) {
    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new NotFoundException(`Scoring category ${id} not found`);
    }

    if (category.origin_level !== 'DIVISION') {
      throw new ForbiddenException(
        'No puede modificar una categoría que no pertenece a este nivel',
      );
    }

    return this.prisma.scoring_categories.update({
      where: { scoring_category_id: id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.max_points !== undefined && { max_points: dto.max_points }),
      },
    });
  }

  async deleteDivisionCategory(id: number) {
    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new NotFoundException(`Scoring category ${id} not found`);
    }

    if (category.origin_level !== 'DIVISION') {
      throw new ForbiddenException(
        'No puede eliminar una categoría que no pertenece a este nivel',
      );
    }

    return this.prisma.scoring_categories.update({
      where: { scoring_category_id: id },
      data: { active: false },
    });
  }

  // ============================================================
  // UNION level
  // ============================================================

  async findUnionCategories(unionId: number): Promise<CategoryWithReadonly[]> {
    const categories = await this.prisma.scoring_categories.findMany({
      where: {
        active: true,
        OR: [
          { origin_level: 'DIVISION' },
          { origin_level: 'UNION', origin_id: unionId },
        ],
      },
      orderBy: [{ origin_level: 'asc' }, { name: 'asc' }],
    });

    return categories.map((cat) => ({
      ...cat,
      readonly: cat.origin_level !== 'UNION' || cat.origin_id !== unionId,
      origin_badge:
        cat.origin_level === 'DIVISION'
          ? 'Division'
          : cat.origin_level === 'UNION'
            ? 'Union'
            : 'Campo Local',
    }));
  }

  async createUnionCategory(unionId: number, dto: CreateScoringCategoryDto) {
    return this.prisma.scoring_categories.create({
      data: {
        name: dto.name,
        max_points: dto.max_points,
        origin_level: 'UNION',
        origin_id: unionId,
        active: true,
      },
    });
  }

  async updateUnionCategory(
    unionId: number,
    id: number,
    dto: UpdateScoringCategoryDto,
  ) {
    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new NotFoundException(`Scoring category ${id} not found`);
    }

    if (category.origin_level !== 'UNION' || category.origin_id !== unionId) {
      throw new ForbiddenException(
        'No puede modificar una categoría heredada o de otro nivel',
      );
    }

    return this.prisma.scoring_categories.update({
      where: { scoring_category_id: id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.max_points !== undefined && { max_points: dto.max_points }),
      },
    });
  }

  async deleteUnionCategory(unionId: number, id: number) {
    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new NotFoundException(`Scoring category ${id} not found`);
    }

    if (category.origin_level !== 'UNION' || category.origin_id !== unionId) {
      throw new ForbiddenException(
        'No puede eliminar una categoría heredada o de otro nivel',
      );
    }

    return this.prisma.scoring_categories.update({
      where: { scoring_category_id: id },
      data: { active: false },
    });
  }

  // ============================================================
  // LOCAL FIELD level
  // ============================================================

  async findLocalFieldCategories(
    fieldId: number,
  ): Promise<CategoryWithReadonly[]> {
    // Resolve the parent union (and via it, division) for this local field
    const localField = await this.prisma.local_fields.findUnique({
      where: { local_field_id: fieldId },
      select: { union_id: true },
    });

    if (!localField) {
      throw new NotFoundException(`Local field ${fieldId} not found`);
    }

    const unionId = localField.union_id;

    const categories = await this.prisma.scoring_categories.findMany({
      where: {
        active: true,
        OR: [
          { origin_level: 'DIVISION' },
          { origin_level: 'UNION', origin_id: unionId },
          { origin_level: 'LOCAL_FIELD', origin_id: fieldId },
        ],
      },
      orderBy: [{ origin_level: 'asc' }, { name: 'asc' }],
    });

    return categories.map((cat) => {
      const isOwn =
        cat.origin_level === 'LOCAL_FIELD' && cat.origin_id === fieldId;
      let origin_badge: string;
      if (cat.origin_level === 'DIVISION') origin_badge = 'Division';
      else if (cat.origin_level === 'UNION') origin_badge = 'Union';
      else origin_badge = 'Campo Local';

      return {
        ...cat,
        readonly: !isOwn,
        origin_badge,
      };
    });
  }

  async createLocalFieldCategory(
    fieldId: number,
    dto: CreateScoringCategoryDto,
  ) {
    const localField = await this.prisma.local_fields.findUnique({
      where: { local_field_id: fieldId },
      select: { local_field_id: true },
    });

    if (!localField) {
      throw new NotFoundException(`Local field ${fieldId} not found`);
    }

    return this.prisma.scoring_categories.create({
      data: {
        name: dto.name,
        max_points: dto.max_points,
        origin_level: 'LOCAL_FIELD',
        origin_id: fieldId,
        active: true,
      },
    });
  }

  async updateLocalFieldCategory(
    fieldId: number,
    id: number,
    dto: UpdateScoringCategoryDto,
  ) {
    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new NotFoundException(`Scoring category ${id} not found`);
    }

    if (
      category.origin_level !== 'LOCAL_FIELD' ||
      category.origin_id !== fieldId
    ) {
      throw new ForbiddenException(
        'No puede modificar una categoría heredada o de otro nivel',
      );
    }

    return this.prisma.scoring_categories.update({
      where: { scoring_category_id: id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.max_points !== undefined && { max_points: dto.max_points }),
      },
    });
  }

  async deleteLocalFieldCategory(fieldId: number, id: number) {
    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new NotFoundException(`Scoring category ${id} not found`);
    }

    if (
      category.origin_level !== 'LOCAL_FIELD' ||
      category.origin_id !== fieldId
    ) {
      throw new ForbiddenException(
        'No puede eliminar una categoría heredada o de otro nivel',
      );
    }

    return this.prisma.scoring_categories.update({
      where: { scoring_category_id: id },
      data: { active: false },
    });
  }

  // ============================================================
  // Helpers for other modules
  // ============================================================

  /**
   * Returns the merged active scoring categories visible to a given local field.
   * Used by the weekly records service to validate category_ids.
   */
  async getActiveCategiesForLocalField(fieldId: number) {
    const localField = await this.prisma.local_fields.findUnique({
      where: { local_field_id: fieldId },
      select: { union_id: true },
    });

    if (!localField) return [];

    return this.prisma.scoring_categories.findMany({
      where: {
        active: true,
        OR: [
          { origin_level: 'DIVISION' },
          { origin_level: 'UNION', origin_id: localField.union_id },
          { origin_level: 'LOCAL_FIELD', origin_id: fieldId },
        ],
      },
    });
  }
}
