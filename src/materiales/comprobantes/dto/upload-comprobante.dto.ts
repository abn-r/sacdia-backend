import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UploadComprobanteDto {
  /**
   * Payment amount in integer centavos (e.g. 150000 = $1,500.00 MXN).
   * Validated as integer >= 1. No floats.
   */
  @ApiProperty({
    description: 'Payment amount in centavos (integer)',
    example: 150000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  monto_centavos: number;

  /**
   * Bank reference number / transaction ID declared by the director.
   */
  @ApiProperty({
    description: 'Bank transaction reference or folio declared by director',
    example: 'TXN-2026-001234',
  })
  @IsString()
  ref_bancaria_declarada: string;

  /**
   * Date the payment was made (ISO date string, e.g. 2026-05-14).
   */
  @ApiProperty({
    description: 'Date the payment was made (ISO 8601 date)',
    example: '2026-05-14',
  })
  @IsDateString()
  fecha_pago: string;

  /**
   * Optional file name override — ignored by service (extension derived from MIME).
   * Kept for forward-compat with admin UI form field.
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  file_name?: string;
}
