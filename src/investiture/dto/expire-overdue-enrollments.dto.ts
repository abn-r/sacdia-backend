import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class ExpireOverdueEnrollmentsDto {
  @ApiPropertyOptional({ description: 'ID del año eclesiástico destino' })
  @IsOptional()
  @IsInt()
  @Min(1)
  ecclesiastical_year_id?: number;

  @ApiPropertyOptional({
    description: 'Si es true, solo calcula qué enrollments vencerían',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;
}
