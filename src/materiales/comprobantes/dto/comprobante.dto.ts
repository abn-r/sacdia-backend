import { ApiProperty } from '@nestjs/swagger';

/**
 * Full comprobante response DTO.
 * Returned by GET /comprobantes/:folio (list) and POST /aprobar, /rechazar.
 * The `signed_url` is only populated for list operations (TTL 15 min).
 * Upload response (POST /:folio) omits signed_url by leaving it null.
 */
export class ComprobanteDto {
  @ApiProperty()
  declare id: string;

  @ApiProperty({
    enum: ['pendiente', 'aprobado', 'rechazado'],
    description: 'Comprobante validation status',
  })
  declare status: string;

  @ApiProperty()
  declare file_name: string;

  @ApiProperty()
  declare mime_type: string;

  @ApiProperty()
  declare size_bytes: number;

  @ApiProperty({ description: 'Payment amount in centavos' })
  declare monto_centavos: number;

  @ApiProperty({ nullable: true })
  declare ref_bancaria_declarada: string | null;

  @ApiProperty({ nullable: true })
  declare fecha_pago: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'Signed read URL — 15 min TTL (null on upload response)',
  })
  declare signed_url: string | null;

  @ApiProperty({ description: 'User ID who uploaded this comprobante' })
  declare uploaded_by: string;

  @ApiProperty({
    nullable: true,
    description: 'User ID who validated (approved/rejected) this comprobante',
  })
  declare validated_by: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Reject reason (only when status=rechazado)',
  })
  declare reject_reason: string | null;

  @ApiProperty()
  declare created_at: Date;

  @ApiProperty({ nullable: true })
  declare validated_at: Date | null;

  @ApiProperty({ description: 'Order ID this comprobante belongs to' })
  declare order_id: string;
}

/**
 * Paginated list response for GET /comprobantes/:folio.
 */
export class ListComprobantesDto {
  @ApiProperty({ type: [ComprobanteDto] })
  declare data: ComprobanteDto[];
}

/**
 * Response for approve endpoint — includes updated comprobante + order state.
 * The `order` field carries the full OrdenDto shape; typed as `object` to
 * avoid a circular import since OrdenDto lives in the ordenes sub-module.
 */
export class ApproveComprobanteResponseDto {
  @ApiProperty({ type: ComprobanteDto })
  declare comprobante: ComprobanteDto;

  // Typed as `object` (not Record<string,unknown>) to be structurally compatible
  // with OrdenDto which has specific typed properties rather than an index signature.
  @ApiProperty()
  declare order: object;
}
