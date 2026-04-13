import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAwardCategoryDto } from './dto/create-award-category.dto';
import { UpdateAwardCategoryDto } from './dto/update-award-category.dto';

@Injectable()
export class AwardCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an award category.
   * Validates that club_type_id exists when provided.
   * club_type_id = null means the category applies to all club types.
   */
  async create(dto: CreateAwardCategoryDto) {
    if (
      dto.max_points !== undefined &&
      dto.max_points !== null &&
      dto.min_points > dto.max_points
    ) {
      throw new BadRequestException(
        `min_points (${dto.min_points}) cannot be greater than max_points (${dto.max_points})`,
      );
    }

    if (dto.club_type_id !== undefined && dto.club_type_id !== null) {
      const clubType = await this.prisma.club_types.findUnique({
        where: { club_type_id: dto.club_type_id },
      });

      if (!clubType) {
        throw new NotFoundException(
          `Club type with ID ${dto.club_type_id} not found`,
        );
      }
    }

    return this.prisma.award_categories.create({
      data: {
        name: dto.name,
        description: dto.description,
        club_type_id: dto.club_type_id ?? null,
        min_points: dto.min_points,
        max_points: dto.max_points ?? null,
        icon: dto.icon ?? null,
        order: dto.order ?? 0,
        active: true,
      },
      include: {
        club_type: dto.club_type_id
          ? { select: { club_type_id: true, name: true } }
          : false,
      },
    });
  }

  /**
   * List award categories with optional filters.
   * Results are sorted by order ASC, then name ASC.
   */
  async findAll(clubTypeId?: number, active?: boolean) {
    const activeFilter = active !== undefined ? active : true;

    return this.prisma.award_categories.findMany({
      where: {
        active: activeFilter,
        ...(clubTypeId !== undefined && { club_type_id: clubTypeId }),
      },
      include: {
        club_type: { select: { club_type_id: true, name: true } },
      },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Get a single award category by ID.
   * Throws 404 if not found.
   */
  async findOne(id: string) {
    const category = await this.prisma.award_categories.findUnique({
      where: { award_category_id: id },
      include: {
        club_type: { select: { club_type_id: true, name: true } },
      },
    });

    if (!category) {
      throw new NotFoundException(`Award category with ID ${id} not found`);
    }

    return category;
  }

  /**
   * Partially update an award category.
   * Validates club_type_id if it is being changed.
   */
  async update(id: string, dto: UpdateAwardCategoryDto) {
    const existing = await this.findOne(id);

    const effectiveMinPoints =
      dto.min_points !== undefined ? dto.min_points : existing.min_points;
    const effectiveMaxPoints =
      dto.max_points !== undefined ? dto.max_points : existing.max_points;

    if (
      effectiveMaxPoints !== null &&
      effectiveMaxPoints !== undefined &&
      effectiveMinPoints > effectiveMaxPoints
    ) {
      throw new BadRequestException(
        `min_points (${effectiveMinPoints}) cannot be greater than max_points (${effectiveMaxPoints})`,
      );
    }

    if (dto.club_type_id !== undefined && dto.club_type_id !== null) {
      const clubType = await this.prisma.club_types.findUnique({
        where: { club_type_id: dto.club_type_id },
      });

      if (!clubType) {
        throw new NotFoundException(
          `Club type with ID ${dto.club_type_id} not found`,
        );
      }
    }

    return this.prisma.award_categories.update({
      where: { award_category_id: id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.club_type_id !== undefined && {
          club_type_id: dto.club_type_id,
        }),
        ...(dto.min_points !== undefined && { min_points: dto.min_points }),
        ...(dto.max_points !== undefined && { max_points: dto.max_points }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
      include: {
        club_type: { select: { club_type_id: true, name: true } },
      },
    });
  }

  /**
   * Soft-delete an award category by setting active = false.
   * Never hard-deletes to preserve historical references.
   */
  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.award_categories.update({
      where: { award_category_id: id },
      data: { active: false },
    });

    return { message: 'Award category deactivated successfully' };
  }
}
