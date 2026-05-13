import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListCatalogoQueryDto } from './dto/list-catalogo.query.dto';
import type {
  MaterialProductDto,
  MaterialCategoryWithCountDto,
  ProgramaDto,
  PaginatedMaterialProductDto,
} from './dto/material-product.dto';

@Injectable()
export class CatalogoService {
  private readonly logger = new Logger(CatalogoService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // LIST — REQ-CAT-001, REQ-CAT-005
  // ---------------------------------------------------------------------------

  async list(
    query: ListCatalogoQueryDto,
    includeInactive: boolean,
  ): Promise<PaginatedMaterialProductDto> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where: Prisma.MaterialProductWhereInput = {};

    // REQ-CAT-005: exclude inactive for non-manage-inventory callers
    if (!includeInactive) {
      where.active = true;
    }

    if (query.cat) {
      where.material_category_id = query.cat;
    }

    if (query.programa !== undefined) {
      where.club_type_id = query.programa;
    }

    if (query.q) {
      where.title = { contains: query.q, mode: Prisma.QueryMode.insensitive };
    }

    const [rows, total] = await Promise.all([
      this.prisma.materialProduct.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { title: 'asc' },
        include: {
          category: { select: { id: true, slug: true, label: true } },
          club_type: { select: { club_type_id: true, name: true } },
          variants: {
            include: {
              options: { select: { id: true, label: true, stock: true } },
            },
          },
        },
      }),
      this.prisma.materialProduct.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.mapProduct(r)),
      total,
      page,
      pageSize,
    };
  }

  // ---------------------------------------------------------------------------
  // GET BY ID — REQ-CAT-002
  // ---------------------------------------------------------------------------

  async getById(id: string, includeInactive: boolean): Promise<MaterialProductDto> {
    const product = await this.prisma.materialProduct.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, slug: true, label: true } },
        club_type: { select: { club_type_id: true, name: true } },
        variants: {
          include: {
            options: { select: { id: true, label: true, stock: true } },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Material product not found');
    }

    // REQ-CAT-005: inactive products are 404 for non-manage-inventory callers
    if (!includeInactive && !product.active) {
      throw new NotFoundException('Material product not found');
    }

    return this.mapProduct(product);
  }

  // ---------------------------------------------------------------------------
  // LIST CATEGORIAS — REQ-CAT-003
  // ---------------------------------------------------------------------------

  async listCategorias(): Promise<{ data: MaterialCategoryWithCountDto[] }> {
    const categories = await this.prisma.materialCategory.findMany({
      orderBy: { sort_order: 'asc' },
      include: {
        _count: {
          select: {
            products: { where: { active: true } },
          },
        },
      },
    });

    const data: MaterialCategoryWithCountDto[] = categories.map((c) => ({
      id: c.id,
      slug: c.slug,
      label: c.label,
      icon: c.icon,
      sort_order: c.sort_order,
      count: c._count.products,
    }));

    return { data };
  }

  // ---------------------------------------------------------------------------
  // LIST PROGRAMAS — REQ-CAT-004
  // ---------------------------------------------------------------------------

  async listProgramas(): Promise<{ data: ProgramaDto[] }> {
    const rows = await this.prisma.club_types.findMany({
      where: { active: true },
      select: { club_type_id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const data: ProgramaDto[] = rows.map((r) => ({
      id: r.club_type_id,
      label: r.name ?? '',
    }));

    return { data };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE MAPPER
  // ---------------------------------------------------------------------------

  private mapProduct(
    product: {
      id: string;
      sku: string;
      title: string;
      description: string | null;
      price_centavos: number;
      stock: number;
      active: boolean;
      category: { id: string; slug: string; label: string };
      club_type: { club_type_id: number; name: string | null };
      variants: Array<{
        type: string;
        options: Array<{ id: string; label: string; stock: number }>;
      }>;
    },
  ): MaterialProductDto {
    const variant = product.variants[0] ?? null;

    return {
      id: product.id,
      sku: product.sku,
      title: product.title,
      description: product.description,
      cat: {
        id: product.category.id,
        slug: product.category.slug,
        label: product.category.label,
      },
      programa: {
        id: product.club_type.club_type_id,
        label: product.club_type.name ?? '',
      },
      price_centavos: product.price_centavos,
      stock: product.stock,
      active: product.active,
      variants: variant
        ? {
            type: variant.type,
            options: variant.options.map((o) => ({
              id: o.id,
              label: o.label,
              stock: o.stock,
            })),
          }
        : null,
    };
  }
}
