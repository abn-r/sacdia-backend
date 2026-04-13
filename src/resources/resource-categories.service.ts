import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateResourceCategoryDto } from './dto/create-resource-category.dto';
import { UpdateResourceCategoryDto } from './dto/update-resource-category.dto';

@Injectable()
export class ResourceCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateResourceCategoryDto) {
    return this.prisma.resource_categories.create({
      data: { name: dto.name, description: dto.description },
    });
  }

  async findAll() {
    return this.prisma.resource_categories.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const category = await this.prisma.resource_categories.findUnique({
      where: { resource_category_id: id },
    });
    if (!category) {
      throw new NotFoundException('Categoría de recurso no encontrada');
    }
    return category;
  }

  async update(id: number, dto: UpdateResourceCategoryDto) {
    await this.findOne(id);
    return this.prisma.resource_categories.update({
      where: { resource_category_id: id },
      data: dto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    const resourceCount = await this.prisma.resources.count({
      where: { resource_category_id: id, active: true },
    });
    if (resourceCount > 0) {
      throw new BadRequestException(
        `No se puede eliminar la categoría porque tiene ${resourceCount} recurso(s) activo(s)`,
      );
    }
    return this.prisma.resource_categories.update({
      where: { resource_category_id: id },
      data: { active: false },
    });
  }
}
