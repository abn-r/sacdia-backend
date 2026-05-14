import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsPublisher } from '../shared/events.publisher';
import { assertTransition } from '../orders/state-machine';
import type { FileStorageService } from '../../common/services/file-storage.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../../common/services/file-storage.service';
import type { ApproveComprobanteDto } from './dto/approve-comprobante.dto';
import type { RejectComprobanteDto } from './dto/reject-comprobante.dto';
import type { UploadComprobanteDto } from './dto/upload-comprobante.dto';
import type {
  ComprobanteDto,
  ApproveComprobanteResponseDto,
  ListComprobantesDto,
} from './dto/comprobante.dto';
import {
  extensionFromMime,
  type ReceiptMime,
} from './receipt-file-validation.pipe';
import type { OrderDto } from '../orders/dto/order.dto';

// ---------------------------------------------------------------------------
// Bucket alias used for all receipt uploads
// ---------------------------------------------------------------------------
const COMPROBANTES_BUCKET = StorageBucketAlias.MATERIALES_COMPROBANTES;

// ---------------------------------------------------------------------------
// Internal: identifier resolution (mirrors orders.service.ts)
// ---------------------------------------------------------------------------
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function orderIdentifierWhere(folioOrId: string) {
  return isUuid(folioOrId)
    ? { id: folioOrId }
    : { folio_referencia: folioOrId };
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------
function mapComprobante(
  row: {
    id: string;
    order_id: string;
    r2_key: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    monto_centavos: number;
    ref_bancaria_declarada: string | null;
    fecha_pago: Date | null;
    status: string;
    uploaded_by: string;
    validated_by: string | null;
    reject_reason: string | null;
    created_at: Date;
    validated_at: Date | null;
  },
  signedUrl: string | null,
): ComprobanteDto {
  return {
    id: row.id,
    order_id: row.order_id,
    status: row.status,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    monto_centavos: row.monto_centavos,
    ref_bancaria_declarada: row.ref_bancaria_declarada,
    fecha_pago: row.fecha_pago,
    signed_url: signedUrl,
    uploaded_by: row.uploaded_by,
    validated_by: row.validated_by,
    reject_reason: row.reject_reason,
    created_at: row.created_at,
    validated_at: row.validated_at,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsPublisher,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  // -------------------------------------------------------------------------
  // T4.3 — upload  (REQ-CMP-001, REQ-CMP-002, REQ-CMP-003, SC-05, SC-12, SC-13)
  // POST /materials/receipts/:folio
  // -------------------------------------------------------------------------

  async upload(
    folioOrId: string,
    file: Express.Multer.File,
    dto: UploadComprobanteDto,
    actor: { id: string },
  ): Promise<ComprobanteDto> {
    // Load order
    const order = await this.prisma.materialOrder.findFirst({
      where: orderIdentifierWhere(folioOrId),
      select: {
        id: true,
        local_field_id: true,
        folio_referencia: true,
        estado: true,
        created_by: true,
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'order_not_found',
        message: `Order '${folioOrId}' not found`,
      });
    }

    // REQ-CMP-001: director may only upload to own orders
    if (order.created_by !== actor.id) {
      throw new ForbiddenException({
        code: 'order_access_denied',
        message: 'You may only upload comprobantes for your own orders',
      });
    }

    // REQ-CMP-003, SC-05: upload only allowed when order is aprobada
    if (order.estado !== 'aprobada') {
      throw new UnprocessableEntityException({
        code: 'state_machine_violation',
        message: `Upload is only allowed when the order is in 'aprobada' state (current: '${order.estado}')`,
      });
    }

    // Derive safe file extension from MIME — never from originalname (security)
    const mime = file.mimetype as ReceiptMime;
    const ext = extensionFromMime(mime);

    // Build R2 key: lf-{local_field_id}/{folio_or_id}/{uuid}.{ext}
    // The LF prefix scopes the bucket so two local_fields can have the same
    // folio number without colliding on key. folio_referencia is guaranteed
    // non-null because order is aprobada; fallback to UUID is a safety net.
    const pathSegment = order.folio_referencia ?? order.id;
    const objectUuid = randomUUID();
    const r2Key = `lf-${order.local_field_id}/${pathSegment}/${objectUuid}.${ext}`;

    // Step 1: Upload to R2 (failure → 502 via service, no DB write)
    const uploadResult = await this.fileStorage.upload(
      COMPROBANTES_BUCKET,
      r2Key,
      file.buffer,
      { contentType: mime, overwrite: false },
    );

    // Persist the original file name from multipart upload (not trusted for extension derivation)
    const originalFileName = file.originalname ?? `${objectUuid}.${ext}`;

    // Step 2: Insert comprobante row
    // If this fails, the R2 object is orphaned — log for manual cleanup (v1 design decision §6)
    const comprobante = await this.prisma.materialComprobante
      .create({
        data: {
          order_id: order.id,
          r2_key: uploadResult.key,
          file_name: originalFileName,
          mime_type: mime,
          size_bytes: file.size,
          monto_centavos: dto.monto_centavos,
          ref_bancaria_declarada: dto.ref_bancaria_declarada,
          fecha_pago: dto.fecha_pago ? new Date(dto.fecha_pago) : null,
          status: 'pendiente',
          uploaded_by: actor.id,
        },
      })
      .catch((err: unknown) => {
        // DB insert failed AFTER successful R2 upload → orphaned object
        this.logger.error({
          event: 'r2_orphan',
          r2_key: uploadResult.key,
          folio: folioOrId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      });

    this.events.logEvent('comprobante.uploaded', {
      comprobante_id: comprobante.id,
      order_id: order.id,
      uploaded_by: actor.id,
    });

    return mapComprobante(comprobante, null);
  }

  // -------------------------------------------------------------------------
  // T4.4 — list  (REQ-CMP-004)
  // GET /materials/receipts/:folio
  // -------------------------------------------------------------------------

  async list(
    folioOrId: string,
    actor: { id: string; canValidate: boolean },
  ): Promise<ListComprobantesDto> {
    // Load order (visibility check)
    const order = await this.prisma.materialOrder.findFirst({
      where: orderIdentifierWhere(folioOrId),
      select: { id: true, created_by: true },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'order_not_found',
        message: `Order '${folioOrId}' not found`,
      });
    }

    // Visibility: director must own the order; validator (campo) can read any
    if (!actor.canValidate && order.created_by !== actor.id) {
      throw new ForbiddenException({
        code: 'order_access_denied',
        message: 'You are not authorized to view comprobantes for this order',
      });
    }

    // Fetch all comprobantes for this order, sorted ASC by created_at
    const rows = await this.prisma.materialComprobante.findMany({
      where: { order_id: order.id },
      orderBy: { created_at: 'asc' },
    });

    // Mint signed read URLs for each row (TTL = 15 min = 900 seconds)
    const data: ComprobanteDto[] = await Promise.all(
      rows.map(async (row) => {
        let signedUrl: string | null = null;
        try {
          signedUrl = await this.fileStorage.getSignedDownloadUrl(
            COMPROBANTES_BUCKET,
            row.r2_key,
            { expiresInSeconds: 900 },
          );
        } catch (err) {
          this.logger.error({
            event: 'signed_url_failed',
            r2_key: row.r2_key,
            comprobante_id: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
          // Return null rather than failing the entire list
        }
        return mapComprobante(row, signedUrl);
      }),
    );

    return { data };
  }

  // -------------------------------------------------------------------------
  // T4.5 — approve  (REQ-CMP-006, SC-06, SC-14)
  // POST /materials/receipts/:folio/approve
  // -------------------------------------------------------------------------

  async approve(
    folioOrId: string,
    dto: ApproveComprobanteDto,
    actor: { id: string },
  ): Promise<ApproveComprobanteResponseDto> {
    // Load order
    const order = await this.prisma.materialOrder.findFirst({
      where: orderIdentifierWhere(folioOrId),
      select: { id: true, estado: true },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'order_not_found',
        message: `Order '${folioOrId}' not found`,
      });
    }

    // Load target comprobante — must belong to this order
    const comprobante = await this.prisma.materialComprobante.findFirst({
      where: { id: dto.comprobante_id, order_id: order.id },
    });

    if (!comprobante) {
      throw new NotFoundException({
        code: 'comprobante_not_found',
        message: `Comprobante '${dto.comprobante_id}' not found for this order`,
      });
    }

    // 422 if comprobante is not pendiente
    if (comprobante.status !== 'pendiente') {
      throw new UnprocessableEntityException({
        code: 'state_machine_violation',
        message: `Comprobante status is '${comprobante.status}', expected 'pendiente'`,
      });
    }

    // SC-14: pre-check for already-approved comprobante (DB partial index is the safety net;
    // this gives a cleaner error before hitting the unique constraint)
    const existingApproved = await this.prisma.materialComprobante.findFirst({
      where: { order_id: order.id, status: 'aprobado' },
      select: { id: true },
    });
    if (existingApproved) {
      throw new ConflictException({
        code: 'already_approved_comprobante',
        message: `Another comprobante (${existingApproved.id}) is already approved for this order`,
      });
    }

    // REQ-CMP-006: assert order state transition aprobada → pagada
    assertTransition(order.estado, 'pagada');

    const now = new Date();

    // Atomic transaction: update comprobante + update order to pagada
    const { updatedComprobante, updatedOrder } = await this.prisma.$transaction(
      async (tx) => {
        const updatedComp = await tx.materialComprobante.update({
          where: { id: comprobante.id },
          data: {
            status: 'aprobado',
            validated_by: actor.id,
            validated_at: now,
          },
        });

        const updatedOrd = await tx.materialOrder.update({
          where: { id: order.id },
          data: {
            estado: 'pagada',
            paid_at: now,
            validated_by: actor.id,
          },
          include: {
            lines: true,
            _count: { select: { comprobantes: true } },
          },
        });

        return { updatedComprobante: updatedComp, updatedOrder: updatedOrd };
      },
    );

    this.events.logEvent('comprobante.validated', {
      comprobante_id: updatedComprobante.id,
      order_id: order.id,
      validated_by: actor.id,
    });
    this.events.logEvent('order.paid', {
      order_id: order.id,
      paid_at: now,
    });

    // Mint a signed URL for the approved comprobante
    let signedUrl: string | null = null;
    try {
      signedUrl = await this.fileStorage.getSignedDownloadUrl(
        COMPROBANTES_BUCKET,
        updatedComprobante.r2_key,
        { expiresInSeconds: 900 },
      );
    } catch (err) {
      this.logger.error({
        event: 'signed_url_failed',
        r2_key: updatedComprobante.r2_key,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      comprobante: mapComprobante(updatedComprobante, signedUrl),
      order: this.mapOrderForResponse(updatedOrder),
    };
  }

  // -------------------------------------------------------------------------
  // T4.6 — reject  (REQ-CMP-007, SC-10)
  // POST /materials/receipts/:folio/reject
  // -------------------------------------------------------------------------

  async reject(
    folioOrId: string,
    dto: RejectComprobanteDto,
    actor: { id: string },
  ): Promise<ComprobanteDto> {
    // Load order
    const order = await this.prisma.materialOrder.findFirst({
      where: orderIdentifierWhere(folioOrId),
      select: { id: true, estado: true },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'order_not_found',
        message: `Order '${folioOrId}' not found`,
      });
    }

    // Load target comprobante
    const comprobante = await this.prisma.materialComprobante.findFirst({
      where: { id: dto.comprobante_id, order_id: order.id },
    });

    if (!comprobante) {
      throw new NotFoundException({
        code: 'comprobante_not_found',
        message: `Comprobante '${dto.comprobante_id}' not found for this order`,
      });
    }

    // 422 if comprobante is not pendiente
    if (comprobante.status !== 'pendiente') {
      throw new UnprocessableEntityException({
        code: 'state_machine_violation',
        message: `Comprobante status is '${comprobante.status}', expected 'pendiente'`,
      });
    }

    // SC-10: order state UNCHANGED (remains aprobada)
    const now = new Date();

    const updated = await this.prisma.materialComprobante.update({
      where: { id: comprobante.id },
      data: {
        status: 'rechazado',
        reject_reason: dto.reject_reason,
        validated_by: actor.id,
        validated_at: now,
      },
    });

    this.events.logEvent('comprobante.rejected', {
      comprobante_id: updated.id,
      order_id: order.id,
      rejected_by: actor.id,
      reject_reason: dto.reject_reason,
    });

    // Mint signed URL for response
    let signedUrl: string | null = null;
    try {
      signedUrl = await this.fileStorage.getSignedDownloadUrl(
        COMPROBANTES_BUCKET,
        updated.r2_key,
        { expiresInSeconds: 900 },
      );
    } catch (err) {
      this.logger.error({
        event: 'signed_url_failed',
        r2_key: updated.r2_key,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return mapComprobante(updated, signedUrl);
  }

  // -------------------------------------------------------------------------
  // Private: map order for approve response (avoids importing OrdenDto shape)
  // -------------------------------------------------------------------------

  private mapOrderForResponse(order: {
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
  }): OrderDto {
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
