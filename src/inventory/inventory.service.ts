import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { AppNotFoundException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { TranslationService } from '../common/services/translation.service';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly translationService: TranslationService,
  ) {}

  // ========================================
  // INVENTORY ITEMS
  // ========================================

  /**
   * Listar items del inventario de un club.
   *
   * @param clubId       ID del club (clubs.club_id). Los items se agrupan en
   *                     secciones cuyo main_club_id apunta a este club.
   * @param categoryId   Filtro opcional por categoría.
   * @param userSectionId
   *   - `null`    → admin / bypass: devuelve items de TODAS las secciones del club.
   *   - `number`  → miembro: filtra estrictamente a esa sección (RBAC).
   */
  async findAllByClub(
    clubId: number,
    categoryId?: number,
    userSectionId?: number | null,
  ) {
    // Construir el filtro de sección según el perfil del usuario.
    // club_inventory → club_sections (via club_section_id) → clubs (via main_club_id)
    let sectionFilter: any;

    if (userSectionId == null) {
      // Admin / bypass: todos los items de las secciones que pertenecen a este club.
      sectionFilter = {
        club_sections: {
          main_club_id: clubId,
        },
      };
    } else {
      // Miembro con sección asignada: solo items de su sección (y que ésta sea del club correcto).
      sectionFilter = {
        club_section_id: userSectionId,
        club_sections: {
          main_club_id: clubId,
        },
      };
    }

    const whereClause: any = {
      active: true,
      ...sectionFilter,
      ...(categoryId && { inventory_category_id: categoryId }),
    };

    const items = await this.prisma.club_inventory.findMany({
      where: whereClause,
      orderBy: [{ inventory_category_id: 'asc' }, { name: 'asc' }],
    });

    // Obtener categorías únicas
    const locale = this.translationService.getCurrentLocale();
    const categoryIds = [
      ...new Set(items.map((i) => i.inventory_category_id).filter(Boolean)),
    ];
    const categoriesRaw = await this.prisma.inventory_categories.findMany({
      where: { inventory_category_id: { in: categoryIds as number[] } },
      select: {
        inventory_category_id: true,
        name: true,
        translations: {
          where: { locale },
          select: { locale: true, name: true },
        },
      },
    });
    const translatedCategories = this.translationService.translateMany(
      categoriesRaw,
      locale,
      ['name'],
      'translations',
    );

    const categoryMap = new Map(
      translatedCategories.map((c) => [c.inventory_category_id, c]),
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
        club_id: clubId,
        ...(userSectionId != null && { club_section_id: userSectionId }),
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
      throw new AppNotFoundException(ErrorCode.INVENTORY_NOT_FOUND);
    }

    // Obtener categoría si existe
    const localeForItem = this.translationService.getCurrentLocale();
    let category: {
      category_id: number;
      name: string;
      description: null;
    } | null = null;
    if (item.inventory_category_id) {
      const cat = await this.prisma.inventory_categories.findUnique({
        where: { inventory_category_id: item.inventory_category_id },
        select: {
          inventory_category_id: true,
          name: true,
          translations: {
            where: { locale: localeForItem },
            select: { locale: true, name: true },
          },
        },
      });
      if (cat) {
        const translatedCat = this.translationService.translateMany(
          [cat],
          localeForItem,
          ['name'],
          'translations',
        )[0];
        category = {
          category_id: translatedCat.inventory_category_id,
          name: translatedCat.name,
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
      history: await this.getInventoryHistory(item.club_inventory_id),
    };
  }

  /**
   * Agregar nuevo item al inventario
   */
  async create(clubSectionId: number, dto: CreateItemDto, performedBy: string) {
    // Validar que la categoría existe
    const category = await this.prisma.inventory_categories.findUnique({
      where: { inventory_category_id: dto.inventory_category_id },
    });

    if (!category || !category.active) {
      throw new AppNotFoundException(ErrorCode.INVENTORY_CATEGORY_NOT_FOUND);
    }

    // Validar que la sección de club existe
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: clubSectionId },
    });

    if (!section) {
      throw new AppNotFoundException(ErrorCode.INVENTORY_SECTION_NOT_FOUND);
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

    await this.logInventoryChange(
      item.club_inventory_id,
      'CREATE',
      [
        { field: 'name', oldValue: null, newValue: dto.name },
        { field: 'amount', oldValue: null, newValue: String(dto.amount ?? 0) },
      ],
      performedBy,
    );

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
  async update(inventoryId: number, dto: UpdateItemDto, performedBy: string) {
    // Verificar que el item existe
    const existingItem = await this.prisma.club_inventory.findUnique({
      where: { club_inventory_id: inventoryId },
    });

    if (!existingItem) {
      throw new AppNotFoundException(ErrorCode.INVENTORY_NOT_FOUND);
    }

    // Si se actualiza la categoría, validar que existe
    if (dto.inventory_category_id) {
      const category = await this.prisma.inventory_categories.findUnique({
        where: { inventory_category_id: dto.inventory_category_id },
      });

      if (!category || !category.active) {
        throw new AppNotFoundException(ErrorCode.INVENTORY_CATEGORY_NOT_FOUND);
      }
    }

    // Calcular cambios antes de actualizar
    const changes: Array<{
      field: string;
      oldValue: string | null;
      newValue: string | null;
    }> = [];
    if (dto.name && dto.name !== existingItem.name) {
      changes.push({
        field: 'name',
        oldValue: existingItem.name,
        newValue: dto.name,
      });
    }
    if (
      dto.description !== undefined &&
      dto.description !== existingItem.description
    ) {
      changes.push({
        field: 'description',
        oldValue: existingItem.description ?? null,
        newValue: dto.description ?? null,
      });
    }
    if (
      dto.inventory_category_id &&
      dto.inventory_category_id !== existingItem.inventory_category_id
    ) {
      changes.push({
        field: 'inventory_category_id',
        oldValue: String(existingItem.inventory_category_id ?? ''),
        newValue: String(dto.inventory_category_id),
      });
    }
    if (dto.amount !== undefined && dto.amount !== existingItem.amount) {
      changes.push({
        field: 'amount',
        oldValue: String(existingItem.amount ?? 0),
        newValue: String(dto.amount),
      });
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

    if (changes.length > 0) {
      await this.logInventoryChange(
        inventoryId,
        'UPDATE',
        changes,
        performedBy,
      );
    }

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
  async delete(inventoryId: number, performedBy: string) {
    const item = await this.prisma.club_inventory.findUnique({
      where: { club_inventory_id: inventoryId },
    });

    if (!item) {
      throw new AppNotFoundException(ErrorCode.INVENTORY_NOT_FOUND);
    }

    await this.prisma.club_inventory.update({
      where: { club_inventory_id: inventoryId },
      data: { active: false },
    });

    await this.logInventoryChange(
      inventoryId,
      'DELETE',
      [{ field: 'active', oldValue: 'true', newValue: 'false' }],
      performedBy,
    );

    return {
      message: 'Inventory item deleted successfully',
    };
  }

  // ========================================
  // INVENTORY HISTORY
  // ========================================

  /**
   * Registrar un cambio en el historial de un item de inventario
   */
  private async logInventoryChange(
    inventoryId: number,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    changes: Array<{
      field: string;
      oldValue: string | null;
      newValue: string | null;
    }>,
    performedBy: string,
  ): Promise<void> {
    if (changes.length === 0) return;

    await this.prisma.inventory_history.createMany({
      data: changes.map((change) => ({
        inventory_id: inventoryId,
        action,
        field_changed: change.field,
        old_value: change.oldValue,
        new_value: change.newValue,
        performed_by: performedBy,
      })),
    });
  }

  /**
   * Obtener el historial de cambios de un item de inventario
   */
  async getInventoryHistory(inventoryId: number) {
    const item = await this.prisma.club_inventory.findUnique({
      where: { club_inventory_id: inventoryId },
    });

    if (!item) {
      throw new AppNotFoundException(ErrorCode.INVENTORY_NOT_FOUND);
    }

    const records = await this.prisma.inventory_history.findMany({
      where: { inventory_id: inventoryId },
      orderBy: { created_at: 'desc' },
      include: {
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
      },
    });

    return records.map((r) => ({
      history_id: r.history_id,
      action: r.action,
      field_changed: r.field_changed,
      old_value: r.old_value,
      new_value: r.new_value,
      performed_by: {
        user_id: r.users.user_id,
        name: r.users.name,
        paternal_last_name: r.users.paternal_last_name,
      },
      created_at: r.created_at,
    }));
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
