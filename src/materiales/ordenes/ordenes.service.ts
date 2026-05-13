import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsPublisher } from '../shared/events.publisher';
import { computeLineTotal, computeSubtotal, computeTotal } from './totals.calculator';
import type { CreateOrdenDto } from './dto/create-orden.dto';
import type { ListOrdenesQueryDto } from './dto/list-ordenes.query.dto';
import type { OrdenDto } from './dto/orden.dto';
import type { OrdenSummaryDto, PaginatedOrdenesDto } from './dto/orden-summary.dto';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface ActorContext {
  id: string;
  canApprove: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class OrdenesService {
  private readonly logger = new Logger(OrdenesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsPublisher,
  ) {}

  // -------------------------------------------------------------------------
  // T3a.4 — createOrder  (REQ-ORD-001, REQ-ORD-002, SC-01, SC-02)
  // -------------------------------------------------------------------------

  async createOrder(dto: CreateOrdenDto, userId: string): Promise<OrdenDto> {
    // Validate: at least 1 line (class-validator ArrayMinSize(1) also guards this,
    // but we keep a service-layer check so the service is independently correct)
    if (!dto.lines || dto.lines.length === 0) {
      throw new NotFoundException({
        code: 'validation_error',
        message: 'Order must have at least one line',
      });
    }

    // Collect product IDs + variant IDs for a single bulk fetch
    const productIds = dto.lines.map((l) => l.product_id);
    const variantOptionIds = dto.lines
      .map((l) => l.variant_option_id)
      .filter((id): id is string => !!id);

    // Fetch all referenced products in one query (REQ-ORD-001)
    const products = await this.prisma.materialProduct.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        price_centavos: true,
        active: true,
      },
    });

    // Fetch variant options (price precedence over product price)
    const variantOptions = variantOptionIds.length > 0
      ? await this.prisma.materialVariantOption.findMany({
          where: { id: { in: variantOptionIds } },
          select: {
            id: true,
            // Variant options don't have their own price; they share the parent product price.
            // Price lives on the product row. This fetch is just for existence validation.
          },
        })
      : [];

    // Build lookup maps
    const productMap = new Map(products.map((p) => [p.id, p]));
    const variantOptionSet = new Set(variantOptions.map((v) => v.id));

    // Validate: all products exist and are active
    const missingIds: string[] = [];
    for (const line of dto.lines) {
      const product = productMap.get(line.product_id);
      if (!product || !product.active) {
        missingIds.push(line.product_id);
      }
      if (line.variant_option_id && !variantOptionSet.has(line.variant_option_id)) {
        missingIds.push(line.variant_option_id);
      }
    }

    if (missingIds.length > 0) {
      throw new NotFoundException({
        code: 'product_not_found',
        message: 'One or more products not found or inactive',
        missing_ids: missingIds,
      });
    }

    // Read envio_centavos_default from material_config (always id=1)
    const config = await this.prisma.materialConfig.findUnique({
      where: { id: 1 },
      select: { envio_centavos_default: true },
    });
    const envio_centavos = config?.envio_centavos_default ?? 0;

    // Compute line totals (price snapshot from product)
    const computedLines = dto.lines.map((line) => {
      const product = productMap.get(line.product_id)!;
      const price_centavos = product.price_centavos; // variant_option does not carry price; product does
      const line_total_centavos = computeLineTotal(price_centavos, line.qty);

      return {
        product_id: line.product_id,
        variant_option_id: line.variant_option_id ?? null,
        qty: line.qty,
        price_centavos,
        line_total_centavos,
        disponibilidad: 'pendiente' as const,
        qty_disponible: null,
      };
    });

    const subtotal_centavos = computeSubtotal(computedLines);
    const total_centavos = computeTotal(subtotal_centavos, envio_centavos);

    // Atomic insert: order + lines via $transaction
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.materialOrder.create({
        data: {
          club_section_id: dto.club_section_id,
          created_by: userId,
          estado: 'en_revision',
          entrega: dto.entrega,
          notas: dto.notas ?? null,
          subtotal_centavos,
          envio_centavos,
          total_centavos,
          folio_referencia: null,
          lines: {
            createMany: {
              data: computedLines,
            },
          },
        },
        include: {
          lines: true,
          _count: { select: { comprobantes: true } },
        },
      });

      return created;
    });

    this.events.logEvent('order.created', { order_id: order.id, created_by: userId });

    return this.mapOrder(order);
  }

  // -------------------------------------------------------------------------
  // T3a.5 — list  (REQ-ORD-003, REQ-ORD-004, SC-11)
  // -------------------------------------------------------------------------

  async list(
    query: ListOrdenesQueryDto,
    actor: ActorContext,
  ): Promise<PaginatedOrdenesDto> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where: any = {};

    // REQ-ORD-003: Visibility is server-side.
    // If the caller does NOT have materiales:approve, force created_by filter.
    if (!actor.canApprove) {
      where.created_by = actor.id;
    }

    if (query.estado) {
      where.estado = query.estado;
    }

    if (query.club_section_id !== undefined) {
      where.club_section_id = query.club_section_id;
    }

    if (query.q) {
      where.OR = [
        {
          folio_referencia: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
        {
          creator: {
            name: {
              contains: query.q,
              mode: 'insensitive',
            },
          },
        },
        {
          creator: {
            paternal_last_name: {
              contains: query.q,
              mode: 'insensitive',
            },
          },
        },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.materialOrder.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          folio_referencia: true,
          estado: true,
          created_at: true,
          subtotal_centavos: true,
          total_centavos: true,
          creator: {
            select: {
              name: true,
              paternal_last_name: true,
            },
          },
          club_section: {
            select: {
              name: true,
            },
          },
        },
      }),
      this.prisma.materialOrder.count({ where }),
    ]);

    const data: OrdenSummaryDto[] = rows.map((r) => ({
      id: r.id,
      folio_referencia: r.folio_referencia,
      estado: r.estado,
      created_at: r.created_at,
      director: {
        nombre: [r.creator.name, r.creator.paternal_last_name].filter(Boolean).join(' '),
        club: r.club_section.name ?? '',
      },
      subtotal_centavos: r.subtotal_centavos,
      total_centavos: r.total_centavos,
    }));

    return { data, total, page, pageSize };
  }

  // -------------------------------------------------------------------------
  // T3a.6 — getByFolio + historial alias  (REQ-ORD-005, SC-11)
  // -------------------------------------------------------------------------

  /**
   * Returns the full order (with lines + comprobantes count).
   * Visibility: if actor.canApprove === false, order must belong to actor.id. Otherwise 403.
   * 404 if not found.
   */
  async getByFolio(folio: string, actor: ActorContext): Promise<OrdenDto> {
    const order = await this.prisma.materialOrder.findUnique({
      where: { folio_referencia: folio },
      include: {
        lines: true,
        _count: { select: { comprobantes: true } },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'order_not_found',
        message: `Order with folio '${folio}' not found`,
      });
    }

    // REQ-ORD-003 / SC-11: director cannot see another director's order
    if (!actor.canApprove && order.created_by !== actor.id) {
      throw new ForbiddenException({
        code: 'order_access_denied',
        message: 'You are not authorized to view this order',
      });
    }

    return this.mapOrder(order);
  }

  /**
   * getById — convenience for internal use or future routes that address by UUID.
   * Same visibility rules as getByFolio.
   */
  async getById(id: string, actor: ActorContext): Promise<OrdenDto> {
    const order = await this.prisma.materialOrder.findUnique({
      where: { id },
      include: {
        lines: true,
        _count: { select: { comprobantes: true } },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'order_not_found',
        message: `Order '${id}' not found`,
      });
    }

    if (!actor.canApprove && order.created_by !== actor.id) {
      throw new ForbiddenException({
        code: 'order_access_denied',
        message: 'You are not authorized to view this order',
      });
    }

    return this.mapOrder(order);
  }

  /**
   * historial — returns own orders for the caller, regardless of permissions.
   * REQ-ORD-005: created_by forced = actor.id even if actor has materiales:approve.
   */
  async historial(
    query: ListOrdenesQueryDto,
    userId: string,
  ): Promise<PaginatedOrdenesDto> {
    // Force created_by = userId regardless of any permission the caller may have
    return this.list(query, { id: userId, canApprove: false });
  }

  // -------------------------------------------------------------------------
  // Private mapper
  // -------------------------------------------------------------------------

  private mapOrder(
    order: {
      id: string;
      folio_referencia: string | null;
      estado: string;
      club_section_id: number;
      created_by: string;
      approved_by: string | null;
      validated_by: string | null;
      delivered_by: string | null;
      cancelled_by: string | null;
      subtotal_centavos: number;
      envio_centavos: number;
      total_centavos: number;
      entrega: string;
      notas: string | null;
      cancel_reason: string | null;
      refund_pending: boolean;
      bank_name: string | null;
      bank_account_clabe: string | null;
      account_holder: string | null;
      pickup_address: string | null;
      created_at: Date;
      approved_at: Date | null;
      paid_at: Date | null;
      delivered_at: Date | null;
      cancelled_at: Date | null;
      lines: Array<{
        id: string;
        product_id: string;
        variant_option_id: string | null;
        qty: number;
        price_centavos: number;
        disponibilidad: string;
        qty_disponible: number | null;
        line_total_centavos: number;
      }>;
      _count: { comprobantes: number };
    },
  ): OrdenDto {
    return {
      id: order.id,
      folio_referencia: order.folio_referencia,
      estado: order.estado,
      club_section_id: order.club_section_id,
      created_by: order.created_by,
      approved_by: order.approved_by,
      validated_by: order.validated_by,
      delivered_by: order.delivered_by,
      cancelled_by: order.cancelled_by,
      subtotal_centavos: order.subtotal_centavos,
      envio_centavos: order.envio_centavos,
      total_centavos: order.total_centavos,
      entrega: order.entrega,
      notas: order.notas,
      cancel_reason: order.cancel_reason,
      refund_pending: order.refund_pending,
      bank_name: order.bank_name,
      bank_account_clabe: order.bank_account_clabe,
      account_holder: order.account_holder,
      pickup_address: order.pickup_address,
      created_at: order.created_at,
      approved_at: order.approved_at,
      paid_at: order.paid_at,
      delivered_at: order.delivered_at,
      cancelled_at: order.cancelled_at,
      lines: order.lines.map((l) => ({
        id: l.id,
        product_id: l.product_id,
        variant_option_id: l.variant_option_id,
        qty: l.qty,
        price_centavos: l.price_centavos,
        disponibilidad: l.disponibilidad,
        qty_disponible: l.qty_disponible,
        line_total_centavos: l.line_total_centavos,
      })),
      comprobantes_count: order._count.comprobantes,
    };
  }
}
