import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const INVENTORY_CONDITIONS = ['bueno', 'regular', 'malo'] as const;
export type InventoryCondition = (typeof INVENTORY_CONDITIONS)[number];

/** DECIMAL(12,2): 10 integer digits + 2 decimals. */
export const INVENTORY_MAX_ESTIMATED_VALUE = 9_999_999_999.99;

/** Trim strings; a blank string means "no value" and is stored as null. */
const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Extended item fields shared by create and update.
 *
 * Every field is optional. On update, sending `null` clears a nullable field
 * (`@IsOptional()` lets null through), while omitting it leaves it untouched.
 * `condition` is NOT NULL in the DB, so null is rejected for it.
 */
export class InventoryExtendedFieldsDto {
  @ApiPropertyOptional({
    description: 'Estado físico del item (default: bueno)',
    enum: INVENTORY_CONDITIONS,
    example: 'bueno',
  })
  @ValidateIf((_obj, value) => value !== undefined)
  @Transform(trimString)
  @IsIn(INVENTORY_CONDITIONS)
  condition?: InventoryCondition;

  @ApiPropertyOptional({
    description: 'Número de serie del item. En update, null lo limpia.',
    example: 'SN-2024-0042',
    maxLength: 100,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  serial_number?: string | null;

  @ApiPropertyOptional({
    description:
      'Fecha de compra en formato ISO YYYY-MM-DD. En update, null la limpia.',
    example: '2025-03-15',
    format: 'date',
    nullable: true,
  })
  @IsOptional()
  @Transform(trimToNull)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'purchase_date must be a date in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true })
  purchase_date?: string | null;

  @ApiPropertyOptional({
    description:
      'Valor estimado (>= 0, hasta 2 decimales). En update, null lo limpia.',
    example: 1250.5,
    minimum: 0,
    nullable: true,
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(INVENTORY_MAX_ESTIMATED_VALUE)
  estimated_value?: number | null;

  @ApiPropertyOptional({
    description: 'Ubicación física del item. En update, null la limpia.',
    example: 'Bodega del templo',
    maxLength: 150,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(150)
  location?: string | null;

  @ApiPropertyOptional({
    description:
      'Nombre (texto libre) de la persona responsable. En update, null lo limpia.',
    example: 'Carlos Pérez',
    maxLength: 150,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(150)
  assigned_to?: string | null;

  @ApiPropertyOptional({
    description: 'Notas adicionales. En update, null las limpia.',
    example: 'Revisar costuras antes del campamento',
    maxLength: 2000,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
