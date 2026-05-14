import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListInventarioQueryDto } from './dto/list-inventario.query.dto';
import type { CreateProductDto } from './dto/create-product.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import type { UpdateVariantStockDto } from './dto/update-variant-stock.dto';
import type {
  InventarioProductDto,
  PaginatedInventarioProductDto,
  VariantStockUpdateResponseDto,
} from './dto/inventario-product.dto';

// Non-terminal order states: stock has been (or is about to be) decremented.
// Cast to string[] so Prisma accepts them in { in: [...] } enum filter without
// needing the generated $Enums namespace (which may not be pre-compiled locally).
const OPEN_ORDER_ESTADOS: string[] = ['en_revision', 'aprobada', 'pagada'];

@Injectable()
export class InventarioService {
  private readonly logger = new Logger(InventarioService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // LIST — REQ-INV-001
  // Paginated, includes inactive products. Filters: cat, q (title or sku).
  // ---------------------------------------------------------------------------

  async list(
    query: ListInventarioQueryDto,
  ): Promise<PaginatedInventarioProductDto> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where: Prisma.MaterialProductWhereInput = {};

    if (query.cat) {
      where.material_category_id = query.cat;
    }

    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
        { sku: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
      ];
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
          _count: { select: { variants: true } },
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
  // CREATE — REQ-INV-002
  // Validates category + club_type exist. SKU uniqueness via DB constraint → 409.
  // ---------------------------------------------------------------------------

  async create(dto: CreateProductDto): Promise<InventarioProductDto> {
    // Validate category exists
    const category = await this.prisma.materialCategory.findUnique({
      where: { id: dto.material_category_id },
    });
    if (!category) {
      throw new BadRequestException('material_category_id not found');
    }

    // Validate club_type exists
    const clubType = await this.prisma.club_types.findUnique({
      where: { club_type_id: dto.club_type_id },
    });
    if (!clubType) {
      throw new BadRequestException('club_type_id not found');
    }

    try {
      const product = await this.prisma.materialProduct.create({
        data: {
          sku: dto.sku,
          title: dto.title,
          material_category_id: dto.material_category_id,
          club_type_id: dto.club_type_id,
          price_centavos: dto.price_centavos,
          description: dto.description,
          stock: dto.stock ?? 0,
          active: dto.active ?? true,
        },
        include: {
          category: { select: { id: true, slug: true, label: true } },
          club_type: { select: { club_type_id: true, name: true } },
          variants: {
            include: {
              options: { select: { id: true, label: true, stock: true } },
            },
          },
          _count: { select: { variants: true } },
        },
      });

      this.logger.log(`Created product id=${product.id} sku=${product.sku}`);
      return this.mapProduct(product);
    } catch (err: unknown) {
      // Prisma unique constraint violation (sku unique index)
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({ code: 'sku_duplicate', sku: dto.sku });
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE — REQ-INV-003
  // Partial patch. If active=false, check for open orders → 409 has_open_orders.
  // Price change does NOT retroactively modify existing order line snapshots.
  // ---------------------------------------------------------------------------

  async update(
    id: string,
    dto: UpdateProductDto,
  ): Promise<InventarioProductDto> {
    const product = await this.prisma.materialProduct.findUnique({
      where: { id },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // If deactivating: check for open (non-terminal) orders
    if (dto.active === false) {
      const openLine = await this.prisma.materialOrderLine.findFirst({
        where: {
          product_id: id,
          order: {
            estado: { in: OPEN_ORDER_ESTADOS as any },
          },
        },
      });
      if (openLine) {
        throw new ConflictException({ code: 'has_open_orders' });
      }
    }

    const updated = await this.prisma.materialProduct.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.price_centavos !== undefined && {
          price_centavos: dto.price_centavos,
        }),
        ...(dto.stock !== undefined && { stock: dto.stock }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
      include: {
        category: { select: { id: true, slug: true, label: true } },
        club_type: { select: { club_type_id: true, name: true } },
        variants: {
          include: {
            options: { select: { id: true, label: true, stock: true } },
          },
        },
        _count: { select: { variants: true } },
      },
    });

    return this.mapProduct(updated);
  }

  // ---------------------------------------------------------------------------
  // SOFT DELETE — REQ-INV-003
  // Alias for update(id, { active: false }). Same open-orders check applies.
  // Returns { id, active: false } per spec.
  // ---------------------------------------------------------------------------

  async softDelete(id: string): Promise<{ id: string; active: false }> {
    await this.update(id, { active: false });
    return { id, active: false };
  }

  // ---------------------------------------------------------------------------
  // UPDATE VARIANT STOCK — REQ-INV-006, SC-17
  // variantOptionId is the leaf material_variant_option.id.
  // Atomic: update option.stock → recompute product.stock = SUM(all options for this product).
  // ---------------------------------------------------------------------------

  async updateVariantStock(
    productId: string,
    variantOptionId: string,
    dto: UpdateVariantStockDto,
  ): Promise<VariantStockUpdateResponseDto> {
    // Validate product exists
    const product = await this.prisma.materialProduct.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Validate that the variant option exists AND belongs to this product
    // Path: material_variant_option.id → variant.product_id = productId
    const option = await this.prisma.materialVariantOption.findFirst({
      where: {
        id: variantOptionId,
        variant: { product_id: productId },
      },
      include: { variant: { select: { id: true, product_id: true } } },
    });

    if (!option) {
      throw new NotFoundException(
        'Variant option not found or does not belong to this product',
      );
    }

    if (dto.stock < 0) {
      // Already guarded by DTO @Min(0), but defensive check for programmatic calls
      throw new BadRequestException('stock must be >= 0');
    }

    // Atomic transaction: update option stock + recompute product.stock
    const [updatedOption, updatedProduct] = await this.prisma.$transaction(
      async (tx) => {
        // 1. Update the variant option's stock
        const newOption = await tx.materialVariantOption.update({
          where: { id: variantOptionId },
          data: { stock: dto.stock },
          select: { id: true, label: true, stock: true },
        });

        // 2. Recompute product.stock = SUM of all options across all variants for this product
        const aggregate = await tx.materialVariantOption.aggregate({
          where: {
            variant: { product_id: productId },
          },
          _sum: { stock: true },
        });

        const newProductStock = aggregate._sum.stock ?? 0;

        // 3. Update product row with new aggregate stock
        const newProduct = await tx.materialProduct.update({
          where: { id: productId },
          data: { stock: newProductStock },
          include: {
            category: { select: { id: true, slug: true, label: true } },
            club_type: { select: { club_type_id: true, name: true } },
            variants: {
              include: {
                options: { select: { id: true, label: true, stock: true } },
              },
            },
            _count: { select: { variants: true } },
          },
        });

        return [newOption, newProduct] as const;
      },
    );

    this.logger.log(
      `Updated variant option id=${updatedOption.id} stock=${updatedOption.stock}; ` +
        `product id=${productId} aggregate stock=${updatedProduct.stock}`,
    );

    return {
      option: {
        id: updatedOption.id,
        label: updatedOption.label,
        stock: updatedOption.stock,
      },
      product: this.mapProduct(updatedProduct),
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE MAPPER
  // ---------------------------------------------------------------------------

  private mapProduct(product: {
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
    _count: { variants: number };
  }): InventarioProductDto {
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
      variant_count: product._count.variants,
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
