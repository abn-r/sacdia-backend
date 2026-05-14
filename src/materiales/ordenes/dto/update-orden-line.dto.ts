import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

/**
 * DTO for PATCH /materiales/ordenes/:folio/lineas/:lineId
 * REQ-ORD-006, REQ-ORD-009, R-arch-4 (auto-set semantics for disponibilidad)
 */
export class UpdateOrdenLineDto {
  @ApiProperty({
    enum: ['disponible', 'parcial', 'agotado'],
    description:
      "'disponible' → service auto-sets qty_disponible = qty. " +
      "'agotado' → service auto-sets qty_disponible = 0. " +
      "'parcial' → qty_disponible must be provided and be >= 1.",
  })
  @IsIn(['disponible', 'parcial', 'agotado'])
  declare disponibilidad: 'disponible' | 'parcial' | 'agotado';

  @ApiPropertyOptional({
    type: Number,
    description:
      'Required when disponibilidad = parcial. ' +
      'Must be >= 1 and <= qty. Ignored when disponibilidad is disponible or agotado.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  qty_disponible?: number;
}
