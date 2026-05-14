import { ApiProperty } from '@nestjs/swagger';

/**
 * Full comprobante response DTO.
 * Returned by GET /comprobantes/:folio (list) and POST /aprobar, /rechazar.
 * The `signed_url` is only populated for list operations (TTL 15 min).
 * Upload response (POST /:folio) omits signed_url by leaving it null.
 */
export class ComprobanteDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    enum: ['pendiente', 'aprobado', 'rechazado'],
    description: 'Comprobante validation status',
  })
  status: string;

  @ApiProperty()
  file_name: string;

  @ApiProperty()
  mime_type: string;

  @ApiProperty()
  size_bytes: number;

  @ApiProperty({ description: 'Payment amount in centavos' })
  monto_centavos: number;

  @ApiProperty({ nullable: true })
  ref_bancaria_declarada: string | null;

  @ApiProperty({ nullable: true })
  fecha_pago: Date | null;

  @ApiProperty({ nullable: true, description: 'Signed read URL — 15 min TTL (null on upload response)' })
  signed_url: string | null;

  @ApiProperty({ description: 'User ID who uploaded this comprobante' })
  uploaded_by: string;

  @ApiProperty({ nullable: true, description: 'User ID who validated (approved/rejected) this comprobante' })
  validated_by: string | null;

  @ApiProperty({ nullable: true, description: 'Reject reason (only when status=rechazado)' })
  reject_reason: string | null;

  @ApiProperty()
  created_at: Date;

  @ApiProperty({ nullable: true })
  validated_at: Date | null;

  @ApiProperty({ description: 'Order ID this comprobante belongs to' })
  order_id: string;
}

/**
 * Paginated list response for GET /comprobantes/:folio.
 */
export class ListComprobantesDto {
  @ApiProperty({ type: [ComprobanteDto] })
  data: ComprobanteDto[];
}

/**
 * Response for approve endpoint — includes updated comprobante + order state.
 * The `order` field carries the full OrdenDto shape; typed as `object` to
 * avoid a circular import since OrdenDto lives in the ordenes sub-module.
 */
export class ApproveComprobanteResponseDto {
  @ApiProperty({ type: ComprobanteDto })
  comprobante: ComprobanteDto;

  // Typed as `object` (not Record<string,unknown>) to be structurally compatible
  // with OrdenDto which has specific typed properties rather than an index signature.
  @ApiProperty()
  order: object;
}
