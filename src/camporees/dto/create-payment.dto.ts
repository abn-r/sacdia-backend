import {
  IsNumber,
  IsString,
  IsOptional,
  IsDateString,
  IsNotEmpty,
  IsIn,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for registering a payment for a camporee member
 */
export class CreatePaymentDto {
  @ApiProperty({
    description: 'Monto del pago',
    example: 150.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiProperty({
    description: 'Tipo de pago',
    example: 'inscription',
    enum: ['inscription', 'materials', 'other'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['inscription', 'materials', 'other'])
  payment_type: string;

  @ApiPropertyOptional({
    description: 'Referencia o número de recibo',
    example: 'REC-2026-001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({
    description: 'Notas adicionales del pago',
    example: 'Pago parcial de inscripción',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({
    description: 'Fecha en que se realizó el pago (formato ISO 8601)',
    example: '2026-03-20',
  })
  @IsDateString()
  paid_at: string;
}
