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

  @ApiProperty({ description: 'Año a evaluar (ej: 2026)' })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year: number;
}
