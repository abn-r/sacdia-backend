import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsPublisher } from '../shared/events.publisher';
import { computeLineTotal, computeSubtotal, computeTotal } from './totals.calculator';
import { assertTransition, MaterialOrderEstado } from './state-machine';
import { FolioService } from './folio.service';
import { StockService } from './stock.service';
import type { CancelOrdenDto } from './dto/cancel-orden.dto';
import type { CreateOrdenDto } from './dto/create-orden.dto';
import type { ListOrdenesQueryDto } from './dto/list-ordenes.query.dto';
import type { OrdenDto } from './dto/orden.dto';
import type { OrdenSummaryDto, PaginatedOrdenesDto } from './dto/orden-summary.dto';
import type { UpdateOrdenLineDto } from './dto/update-orden-line.dto';

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
    private readonly folioService: FolioService,
    private readonly stockService: StockService,
  ) {}

  // -------------------------------------------------------------------------
  // Identifier resolution
  // -------------------------------------------------------------------------
  // en_revision orders have folio_referencia = NULL (allocated on approval).
  // Admin UI must still address them — so we accept either folio_referencia
  // (e.g. SOL20260001) or the order UUID in the :folio path segment.
  // Order matters: try folio_referencia first (cheap UNIQUE), then UUID.
  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private orderIdentifierWhere(folioOrId: string) {
    return this.isUuid(folioOrId)
      ? { id: folioOrId }
      : { folio_referencia: folioOrId };
  }

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
  // T3b.3 — patchLine  (REQ-ORD-006, REQ-ORD-009, R-arch-4, SC-15, SC-16)
  // PATCH /materiales/ordenes/:folio/lineas/:lineId
  // -------------------------------------------------------------------------

  async patchLine(
    folio: string,
    lineId: string,
    dto: UpdateOrdenLineDto,
    actor: { id: string },
  ): Promise<OrdenDto> {
    // R-arch-4 auto-set: resolve qty_disponible before touching the DB
    // 'disponible' and 'agotado' are fully determined — qty_disponible from body is ignored.
    // 'parcial' requires qty_disponible in range [1, line.qty].
    // For 'parcial' we must know line.qty first, so validation happens after load.

    // Load order by folio_referencia OR by UUID (en_revision orders have folio=NULL)
    const order = await this.prisma.materialOrder.findFirst({
      where: this.orderIdentifierWhere(folio),
      include: {
        lines: true,
        _count: { select: { comprobantes: true } },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'order_not_found',
        message: `Order '${folio}' not found`,
      });
    }

    // REQ-ORD-009, SC-15: lines are frozen unless order is in en_revision
    if (order.estado !== 'en_revision') {
      throw new UnprocessableEntityException({
        code: 'lines_frozen',
        message: `Order lines are frozen — order must be in 'en_revision' to edit lines (current: '${order.estado}')`,
      });
    }

    // Find the target line
    const line = order.lines.find((l) => l.id === lineId);
    if (!line) {
      throw new NotFoundException({
        code: 'line_not_found',
        message: `Line '${lineId}' does not belong to order '${folio}'`,
      });
    }

    // R-arch-4 auto-set semantics
    let resolvedQtyDisponible: number;
    if (dto.disponibilidad === 'disponible') {
      resolvedQtyDisponible = line.qty; // auto-set to full qty
    } else if (dto.disponibilidad === 'agotado') {
      resolvedQtyDisponible = 0; // auto-set to 0
    } else {
      // 'parcial' — qty_disponible is required and must be in [1, line.qty]
      if (dto.qty_disponible === undefined || dto.qty_disponible === null) {
        throw new BadRequestException({
          code: 'qty_disponible_required',
          message: "qty_disponible is required when disponibilidad = 'parcial'",
        });
      }
      if (dto.qty_disponible < 1 || dto.qty_disponible > line.qty) {
        throw new BadRequestException({
          code: 'qty_disponible_out_of_range',
          message: `qty_disponible must be >= 1 and <= qty (${line.qty})`,
        });
      }
      resolvedQtyDisponible = dto.qty_disponible;
    }

    const newLineTotal = computeLineTotal(line.price_centavos, resolvedQtyDisponible);

    // Atomic transaction: update line, recompute and update order totals
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // Update the target line
      await tx.materialOrderLine.update({
        where: { id: lineId },
        data: {
          disponibilidad: dto.disponibilidad,
          qty_disponible: resolvedQtyDisponible,
          line_total_centavos: newLineTotal,
        },
      });

      // Read all lines (including the just-updated one) within the same tx — read-after-write
      const freshLines = await tx.materialOrderLine.findMany({
        where: { order_id: order.id },
        select: { line_total_centavos: true },
      });

      const subtotal_centavos = computeSubtotal(freshLines);
      const total_centavos = computeTotal(subtotal_centavos, order.envio_centavos);

      // Update order totals
      const updated = await tx.materialOrder.update({
        where: { id: order.id },
        data: { subtotal_centavos, total_centavos },
        include: {
          lines: true,
          _count: { select: { comprobantes: true } },
        },
      });

      return updated;
    });

    this.events.logEvent('order.line_patched', {
      order_id: order.id,
      line_id: lineId,
      actor_id: actor.id,
      disponibilidad: dto.disponibilidad,
      qty_disponible: resolvedQtyDisponible,
    });

    return this.mapOrder(updatedOrder);
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
    const order = await this.prisma.materialOrder.findFirst({
      where: this.orderIdentifierWhere(folio),
      include: {
        lines: true,
        _count: { select: { comprobantes: true } },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'order_not_found',
        message: `Order '${folio}' not found`,
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
  // T3b.4 — approve  (REQ-ORD-007, REQ-ORD-008, REQ-INV-004, REQ-CFG-003,
  //                    SC-03, SC-04, SC-07, SC-18)
  // POST /materiales/ordenes/:folio/aprobar
  // -------------------------------------------------------------------------

  async approve(
    folioOrId: string,
    actor: { id: string },
  ): Promise<OrdenDto> {
    // Load order + lines
    const order = await this.prisma.materialOrder.findFirst({
      where: this.orderIdentifierWhere(folioOrId),
      include: {
        lines: true,
        _count: { select: { comprobantes: true } },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'order_not_found',
        message: `Order '${folioOrId}' not found`,
      });
    }

    // REQ-ORD-012: assert valid state transition en_revision → aprobada
    assertTransition(order.estado as MaterialOrderEstado, 'aprobada');

    // REQ-ORD-007, SC-04: all lines must have a resolved disponibilidad (not 'pendiente')
    const unresolvedLines = order.lines.filter(
      (l) => l.disponibilidad === 'pendiente',
    );
    if (unresolvedLines.length > 0) {
      throw new UnprocessableEntityException({
        code: 'unresolved_lines',
        message: 'All lines must be resolved before approval',
        line_ids: unresolvedLines.map((l) => l.id),
      });
    }

    // Fetch config snapshot at approval time (REQ-CFG-003)
    const config = await this.prisma.materialConfig.findUnique({
      where: { id: 1 },
      select: {
        envio_centavos_default: true,
        bank_name: true,
        bank_account_clabe: true,
        account_holder: true,
        pickup_address: true,
      },
    });
    const envio_centavos = config?.envio_centavos_default ?? 0;

    const now = new Date();

    // Atomic transaction: lock products + allocate folio + decrement stock + update order
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // REQ-INV-004: decrement stock (throws 409 insufficient_stock on failure)
      await this.stockService.decrementForApproval(tx, order.lines);

      // REQ-ORD-008: allocate folio with FOR UPDATE row lock on the counter
      const { folio_referencia } = await this.folioService.allocate(tx, now);

      // Recompute totals using the line_total_centavos already on record
      const subtotal_centavos = computeSubtotal(order.lines);
      const total_centavos = computeTotal(subtotal_centavos, envio_centavos);

      // Persist state transition + folio + bank snapshot + totals
      const updated = await tx.materialOrder.update({
        where: { id: order.id },
        data: {
          estado: 'aprobada',
          folio_referencia,
          approved_at: now,
          approved_by: actor.id,
          envio_centavos,
          subtotal_centavos,
          total_centavos,
          // Bank config snapshot (REQ-CFG-003, ADR-4)
          bank_name: config?.bank_name ?? null,
          bank_account_clabe: config?.bank_account_clabe ?? null,
          account_holder: config?.account_holder ?? null,
          pickup_address: config?.pickup_address ?? null,
        },
        include: {
          lines: true,
          _count: { select: { comprobantes: true } },
        },
      });

      return updated;
    });

    this.events.logEvent('order.approved', {
      order_id: order.id,
      folio_referencia: updatedOrder.folio_referencia,
      approved_by: actor.id,
    });

    return this.mapOrder(updatedOrder);
  }

  // -------------------------------------------------------------------------
  // T3b.5 — cancel  (REQ-ORD-010, REQ-INV-005, SC-08, SC-09)
  // POST /materiales/ordenes/:folio/cancelar
  // -------------------------------------------------------------------------

  async cancel(
    folioOrId: string,
    dto: CancelOrdenDto,
    actor: ActorContext,
  ): Promise<OrdenDto> {
    // Load order + lines (stock restore needs lines)
    const order = await this.prisma.materialOrder.findFirst({
      where: this.orderIdentifierWhere(folioOrId),
      include: {
        lines: true,
        _count: { select: { comprobantes: true } },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'order_not_found',
        message: `Order '${folioOrId}' not found`,
      });
    }

    const currentEstado = order.estado as MaterialOrderEstado;

    // REQ-ORD-012: assert valid transition (throws 422 state_machine_violation for terminal states)
    assertTransition(currentEstado, 'cancelada');

    // Permission rules (spec §3 state machine table):
    //   en_revision  → director (own) OR campo
    //   aprobada     → campo only
    //   pagada       → campo only
    if (currentEstado === 'en_revision') {
      // Director can cancel own en_revision order; campo (canApprove) can cancel any
      if (!actor.canApprove && order.created_by !== actor.id) {
        throw new ForbiddenException({
          code: 'cancel_forbidden',
          message: 'You are not authorized to cancel this order',
        });
      }
    } else {
      // aprobada or pagada — campo only
      if (!actor.canApprove) {
        throw new ForbiddenException({
          code: 'cancel_forbidden',
          message: 'Only campo local (materiales:approve) can cancel an approved or paid order',
        });
      }
    }

    const now = new Date();
    const needsStockRestore = currentEstado === 'aprobada' || currentEstado === 'pagada';
    const refund_pending = currentEstado === 'pagada';

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // REQ-INV-005: restore stock if order had been approved (stock was decremented)
      if (needsStockRestore) {
        await this.stockService.restoreForCancel(tx, order.lines);
      }

      const updated = await tx.materialOrder.update({
        where: { id: order.id },
        data: {
          estado: 'cancelada',
          cancelled_at: now,
          cancelled_by: actor.id,
          cancel_reason: dto.cancel_reason,
          ...(refund_pending ? { refund_pending: true } : {}),
        },
        include: {
          lines: true,
          _count: { select: { comprobantes: true } },
        },
      });

      return updated;
    });

    this.events.logEvent('order.cancelled', {
      order_id: order.id,
      previous_state: currentEstado,
      cancel_reason: dto.cancel_reason,
    });

    return this.mapOrder(updatedOrder);
  }

  // -------------------------------------------------------------------------
  // T3b.6 — deliver  (REQ-ORD-011, SC — terminal transition)
  // POST /materiales/ordenes/:folio/entregar
  // -------------------------------------------------------------------------

  async deliver(
    folioOrId: string,
    actor: { id: string },
  ): Promise<OrdenDto> {
    // Load order (no lines needed — terminal transition, no concurrent dependency)
    const order = await this.prisma.materialOrder.findFirst({
      where: this.orderIdentifierWhere(folioOrId),
      include: {
        lines: true,
        _count: { select: { comprobantes: true } },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'order_not_found',
        message: `Order '${folioOrId}' not found`,
      });
    }

    // REQ-ORD-012: assert pagada → entregada (throws 422 for any other current state)
    assertTransition(order.estado as MaterialOrderEstado, 'entregada');

    const now = new Date();

    const updatedOrder = await this.prisma.materialOrder.update({
      where: { id: order.id },
      data: {
        estado: 'entregada',
        delivered_at: now,
        delivered_by: actor.id,
      },
      include: {
        lines: true,
        _count: { select: { comprobantes: true } },
      },
    });

    this.events.logEvent('order.delivered', { order_id: order.id });

    return this.mapOrder(updatedOrder);
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
