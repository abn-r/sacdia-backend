import { IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class EvaluateMemberOfMonthDto {
  @ApiProperty({ description: 'Mes a evaluar (1-12)', minimum: 1, maximum: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({
    description: 'Año a evaluar (ej: 2026)',
    minimum: 2020,
    maximum: 2100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year: number;
}
