import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ========================================
  // INVENTORY ITEMS
  // ========================================

  /**
   * Listar items del inventario de una sección de club específica
   */
  async findAllByClub(
    clubSectionId: number,
    categoryId?: number,
  ) {
    const whereClause: any = {
      active: true,
      club_section_id: clubSectionId,
      ...(categoryId && { inventory_category_id: categoryId }),
    };

    const items = await this.prisma.club_inventory.findMany({
      where: whereClause,
      orderBy: [{ inventory_category_id: 'asc' }, { name: 'asc' }],
    });

    // Obtener categorías únicas
    const categoryIds = [
      ...new Set(items.map((i) => i.inventory_category_id).filter(Boolean)),
    ];
    const categories = await this.prisma.inventory_categories.findMany({
      where: { inventory_category_id: { in: categoryIds as number[] } },
    });

    const categoryMap = new Map(
      categories.map((c) => [c.inventory_category_id, c]),
    );

    return {
      data: items.map((item) => {
        const category = item.inventory_category_id
          ? categoryMap.get(item.inventory_category_id)
          : null;
        return {
          inventory_id: item.club_inventory_id,
          name: item.name,
          description: item.description,
          inventory_category_id: item.inventory_category_id,
          category: category
            ? {
                category_id: category.inventory_category_id,
                name: category.name,
              }
            : null,
          amount: item.amount,
          club_section_id: item.club_section_id,
          active: item.active,
          created_at: item.created_at,
          updated_at: item.modified_at,
        };
      }),
      meta: {
        total_items: items.length,
        total_value_estimated: null,
        club_section_id: clubSectionId,
      },
    };
  }

  /**
   * Obtener detalles de un item específico
   */
  async findOne(inventoryId: number) {
    const item = await this.prisma.club_inventory.findUnique({
      where: { club_inventory_id: inventoryId },
    });

    if (!item) {
      throw new NotFoundException(
        `Inventory item with ID ${inventoryId} not found`,
      );
    }

    // Obtener categoría si existe
    let category: {
      category_id: number;
      name: string;
      description: null;
    } | null = null;
    if (item.inventory_category_id) {
      const cat = await this.prisma.inventory_categories.findUnique({
        where: { inventory_category_id: item.inventory_category_id },
      });
      if (cat) {
        category = {
          category_id: cat.inventory_category_id,
          name: cat.name,
          description: null,
        };
      }
    }

    return {
      inventory_id: item.club_inventory_id,
      name: item.name,
      description: item.description,
      inventory_category_id: item.inventory_category_id,
      category,
      amount: item.amount,
      club_section_id: item.club_section_id,
      active: item.active,
      created_at: item.created_at,
      updated_at: item.modified_at,
      history: [], // TODO: Implementar sistema de historial
    };
  }

  /**
   * Agregar nuevo item al inventario
   */
  async create(clubSectionId: number, dto: CreateItemDto) {
    // Validar que la categoría existe
    const category = await this.prisma.inventory_categories.findUnique({
      where: { inventory_category_id: dto.inventory_category_id },
    });

    if (!category || !category.active) {
      throw new NotFoundException('Inventory category not found');
    }

    // Validar que la sección de club existe
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: clubSectionId },
    });

    if (!section) {
      throw new NotFoundException('Club section not found');
    }

    // Crear item
    const item = await this.prisma.club_inventory.create({
      data: {
        name: dto.name,
        description: dto.description,
        inventory_category_id: dto.inventory_category_id,
        amount: dto.amount,
        club_section_id: clubSectionId,
        active: true,
      },
    });

    return {
      inventory_id: item.club_inventory_id,
      name: item.name,
      description: item.description,
      inventory_category_id: item.inventory_category_id,
      category: {
        category_id: category.inventory_category_id,
        name: category.name,
      },
      amount: item.amount,
      club_section_id: item.club_section_id,
      active: item.active,
      created_at: item.created_at,
      updated_at: item.modified_at,
    };
  }

  /**
   * Actualizar un item del inventario
   */
  async update(inventoryId: number, dto: UpdateItemDto) {
    // Verificar que el item existe
    const existingItem = await this.prisma.club_inventory.findUnique({
      where: { club_inventory_id: inventoryId },
    });

    if (!existingItem) {
      throw new NotFoundException(
        `Inventory item with ID ${inventoryId} not found`,
      );
    }

    // Si se actualiza la categoría, validar que existe
    if (dto.inventory_category_id) {
      const category = await this.prisma.inventory_categories.findUnique({
        where: { inventory_category_id: dto.inventory_category_id },
      });

      if (!category || !category.active) {
        throw new NotFoundException('Inventory category not found');
      }
    }

    // Actualizar item
    const item = await this.prisma.club_inventory.update({
      where: { club_inventory_id: inventoryId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.inventory_category_id && {
          inventory_category_id: dto.inventory_category_id,
        }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
      },
    });

    // Obtener categoría si existe
    let category: { category_id: number; name: string } | null = null;
    if (item.inventory_category_id) {
      const cat = await this.prisma.inventory_categories.findUnique({
        where: { inventory_category_id: item.inventory_category_id },
      });
      if (cat) {
        category = {
          category_id: cat.inventory_category_id,
          name: cat.name,
        };
      }
    }

    return {
      inventory_id: item.club_inventory_id,
      name: item.name,
      description: item.description,
      inventory_category_id: item.inventory_category_id,
      category,
      amount: item.amount,
      club_section_id: item.club_section_id,
      active: item.active,
      created_at: item.created_at,
      updated_at: item.modified_at,
    };
  }

  /**
   * Eliminar un item del inventario (soft delete)
   */
  async delete(inventoryId: number) {
    const item = await this.prisma.club_inventory.findUnique({
      where: { club_inventory_id: inventoryId },
    });

    if (!item) {
      throw new NotFoundException(
        `Inventory item with ID ${inventoryId} not found`,
      );
    }

    await this.prisma.club_inventory.update({
      where: { club_inventory_id: inventoryId },
      data: { active: false },
    });

    return {
      message: 'Inventory item deleted successfully',
    };
  }

  // ========================================
  // INVENTORY CATEGORIES
  // ========================================

  /**
   * Listar todas las categorías de inventario
   * Nota: Este endpoint debería estar en CatalogsService pero lo incluyo aquí por completitud
   */
  async findAllCategories() {
    const categories = await this.prisma.inventory_categories.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });

    return categories;
  }
}
