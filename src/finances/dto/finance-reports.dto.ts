import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';

/** Query of `by-category` and `export`: calendar year, optional month and section. */
export class FinanceReportQueryDto {
  @ApiProperty({ description: 'Año calendario de los movimientos' })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  declare year: number;

  @ApiPropertyOptional({
    description: 'Mes (1-12). Sin mes se toma el año completo.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({
    description: 'Limita el resultado a una sección del club',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  club_section_id?: number;
}

/** Longest span the monthly series may cover. */
export const FINANCE_MONTHLY_MAX_MONTHS = 120;

const YEAR_MONTH_PATTERN = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;

/** Query of `monthly`: inclusive month range (`YYYY-MM`) and optional section. */
export class FinanceMonthlyQueryDto {
  @ApiPropertyOptional({
    description:
      'Primer mes (YYYY-MM). Sin él arranca en el mes del primer movimiento activo (serie completa).',
    example: '2026-01',
  })
  @IsOptional()
  @Matches(YEAR_MONTH_PATTERN, { message: 'from must be YYYY-MM' })
  from?: string;

  @ApiPropertyOptional({
    description: 'Último mes (YYYY-MM). Por defecto el mes actual.',
    example: '2026-06',
  })
  @IsOptional()
  @Matches(YEAR_MONTH_PATTERN, { message: 'to must be YYYY-MM' })
  to?: string;

  @ApiPropertyOptional({
    description: 'Limita el resultado a una sección del club',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  club_section_id?: number;
}

export const FINANCE_EXPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type FinanceExportFormat = (typeof FINANCE_EXPORT_FORMATS)[number];

/** Query of `export`: the report filters plus the output format. */
export class FinanceExportQueryDto extends FinanceReportQueryDto {
  @ApiPropertyOptional({
    description: 'Formato del archivo (por defecto xlsx)',
    enum: FINANCE_EXPORT_FORMATS,
    default: 'xlsx',
  })
  @IsOptional()
  @IsIn(FINANCE_EXPORT_FORMATS)
  format?: FinanceExportFormat;
}

/** Query of `GET /finances/overview`. */
export class FinanceOverviewQueryDto {
  @ApiPropertyOptional({ description: 'Limita a un campo local' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  local_field_id?: number;

  @ApiPropertyOptional({
    description: 'Año calendario (por defecto, el año actual)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({
    description: 'Mes (1-12). Sin mes se toma el año completo.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({ description: 'Página (1-indexed)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Clubes por página (máximo 100)',
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Optional body of `DELETE /finances/:financeId`. */
export class RemoveFinanceDto {
  @ApiPropertyOptional({
    description:
      'Nota de cierre (5 a 500 caracteres). Obligatoria al eliminar un movimiento de un mes cerrado.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
  reason?: string;
}
