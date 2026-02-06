import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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
   * Listar items del inventario de un club específico
   */
  async findAllByClub(
    clubId: number,
    instanceType: 'adv' | 'pathf' | 'mg',
    categoryId?: number,
  ) {
    // Construir where clause según el tipo de instancia
    const whereClause = this.buildWhereClause(clubId, instanceType, categoryId);

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
          club_adv_id: item.club_adv_id,
          club_pathf_id: item.club_pathf_id,
          club_mg_id: item.club_mg_id,
          active: item.active,
          created_at: item.created_at,
          updated_at: item.modified_at,
        };
      }),
      meta: {
        total_items: items.length,
        total_value_estimated: null,
        club_instance: {
          [`club_${instanceType}_id`]: clubId,
          instance_type: instanceType,
        },
      },
    };
  }

  /**
   * Construir where clause según tipo de instancia
   */
  private buildWhereClause(
    clubId: number,
    instanceType: 'adv' | 'pathf' | 'mg',
    categoryId?: number,
  ) {
    const baseWhere: any = {
      active: true,
      ...(categoryId && { inventory_category_id: categoryId }),
    };

    switch (instanceType) {
      case 'adv':
        return { ...baseWhere, club_adv_id: clubId };
      case 'pathf':
        return { ...baseWhere, club_pathf_id: clubId };
      case 'mg':
        return { ...baseWhere, club_mg_id: clubId };
      default:
        throw new BadRequestException('Invalid instance type');
    }
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
      club_adv_id: item.club_adv_id,
      club_pathf_id: item.club_pathf_id,
      club_mg_id: item.club_mg_id,
      active: item.active,
      created_at: item.created_at,
      updated_at: item.modified_at,
      history: [], // TODO: Implementar sistema de historial
    };
  }

  /**
   * Agregar nuevo item al inventario
   */
  async create(clubId: number, dto: CreateItemDto) {
    // Validar que la categoría existe
    const category = await this.prisma.inventory_categories.findUnique({
      where: { inventory_category_id: dto.inventory_category_id },
    });

    if (!category || !category.active) {
      throw new NotFoundException('Inventory category not found');
    }

    // Validar que el club existe según el tipo de instancia
    await this.validateClubExists(clubId, dto.instanceType);

    // Determinar qué campo de club usar
    const clubFields = this.getClubFields(clubId, dto.instanceType);

    // Crear item
    const item = await this.prisma.club_inventory.create({
      data: {
        name: dto.name,
        description: dto.description,
        inventory_category_id: dto.inventory_category_id,
        amount: dto.amount,
        ...clubFields,
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
      club_adv_id: item.club_adv_id,
      club_pathf_id: item.club_pathf_id,
      club_mg_id: item.club_mg_id,
      active: item.active,
      created_at: item.created_at,
      updated_at: item.modified_at,
    };
  }

  /**
   * Validar que el club existe según el tipo de instancia
   */
  private async validateClubExists(
    clubId: number,
    instanceType: 'adv' | 'pathf' | 'mg',
  ) {
    let clubExists = false;

    switch (instanceType) {
      case 'adv':
        clubExists = !!(await this.prisma.club_adventurers.findUnique({
          where: { club_adv_id: clubId },
        }));
        break;
      case 'pathf':
        clubExists = !!(await this.prisma.club_pathfinders.findUnique({
          where: { club_pathf_id: clubId },
        }));
        break;
      case 'mg':
        clubExists = !!(await this.prisma.club_master_guilds.findUnique({
          where: { club_mg_id: clubId },
        }));
        break;
    }

    if (!clubExists) {
      throw new NotFoundException(
        `Club not found for instance type ${instanceType}`,
      );
    }
  }

  /**
   * Obtener campos de club según el tipo de instancia
   */
  private getClubFields(clubId: number, instanceType: 'adv' | 'pathf' | 'mg') {
    switch (instanceType) {
      case 'adv':
        return { club_adv_id: clubId, club_pathf_id: null, club_mg_id: null };
      case 'pathf':
        return { club_adv_id: null, club_pathf_id: clubId, club_mg_id: null };
      case 'mg':
        return { club_adv_id: null, club_pathf_id: null, club_mg_id: clubId };
      default:
        throw new BadRequestException('Invalid instance type');
    }
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
      club_adv_id: item.club_adv_id,
      club_pathf_id: item.club_pathf_id,
      club_mg_id: item.club_mg_id,
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
