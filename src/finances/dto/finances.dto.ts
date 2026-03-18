import {
  IsInt,
  IsOptional,
  IsString,
  IsDateString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateFinanceDto {
  @ApiProperty({ description: 'Año del movimiento' })
  @IsInt()
  year: number;

  @ApiProperty({ description: 'Mes del movimiento (1-12)' })
  @IsInt()
  @Min(1)
  month: number;

  @ApiProperty({ description: 'Monto del movimiento (en centavos)' })
  @IsInt()
  amount: number;

  @ApiPropertyOptional({ description: 'Descripción del movimiento' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Tipo de club (1=Aventureros, 2=Conquistadores, 3=GM)',
  })
  @IsInt()
  club_type_id: number;

  @ApiProperty({ description: 'ID de la categoría financiera' })
  @IsInt()
  finance_category_id: number;

  @ApiProperty({ description: 'Fecha del movimiento' })
  @IsDateString()
  finance_date: string;

  @ApiProperty({ description: 'ID de la sección del club (FK a club_sections)' })
  @IsInt()
  club_section_id: number;
}

export class UpdateFinanceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  finance_category_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  finance_date?: string;
}

export class FinanceFiltersDto {
  @ApiPropertyOptional({ description: 'Filtrar por año' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @ApiPropertyOptional({ description: 'Filtrar por mes (1-12)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  month?: number;

  @ApiPropertyOptional({ description: 'Filtrar por tipo de club' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  clubTypeId?: number;

  @ApiPropertyOptional({ description: 'Filtrar por categoría' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;
}
