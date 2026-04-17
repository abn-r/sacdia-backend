import {
  IsOptional,
  IsInt,
  IsString,
  IsIn,
  IsDateString,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class GetAllTransactionsDto {
  @ApiPropertyOptional({
    description: 'Número de página (1-indexed)',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Cantidad de elementos por página',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo: "income" (ingresos) o "expense" (egresos)',
    enum: ['income', 'expense'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['income', 'expense'])
  type?: 'income' | 'expense';

  @ApiPropertyOptional({
    description:
      'Búsqueda por descripción o nombre de categoría (case-insensitive)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description: 'Fecha de inicio del rango (YYYY-MM-DD, inclusive)',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Fecha de fin del rango (YYYY-MM-DD, inclusive)',
    example: '2026-03-31',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Campo de ordenamiento',
    enum: ['date', 'amount', 'category'],
    default: 'date',
  })
  @IsOptional()
  @IsString()
  @IsIn(['date', 'amount', 'category'])
  sortBy?: 'date' | 'amount' | 'category' = 'date';

  @ApiPropertyOptional({
    description: 'Dirección del ordenamiento',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  get skip(): number {
    return ((this.page ?? 1) - 1) * (this.limit ?? 20);
  }

  get take(): number {
    return this.limit ?? 20;
  }
}
