import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';

export const ROLE_CANDIDATE_FILTERS = [
  'available',
  'with_role',
  'not_enrolled',
  'all',
] as const;
export type RoleCandidateFilter = (typeof ROLE_CANDIDATE_FILTERS)[number];

export const ROLE_CANDIDATES_MAX_LIMIT = 50;

export class RoleCandidatesQueryDto {
  @ApiPropertyOptional({
    description:
      'Texto a buscar en nombre o apellidos (nunca en correo ni teléfono), sin distinguir mayúsculas. Cada palabra debe coincidir.',
    maxLength: 100,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLengthIfString(100)
  search?: string;

  @ApiPropertyOptional({ enum: ROLE_CANDIDATE_FILTERS, default: 'all' })
  @IsOptional()
  @IsIn(ROLE_CANDIDATE_FILTERS)
  filter?: RoleCandidateFilter = 'all';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: ROLE_CANDIDATES_MAX_LIMIT,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROLE_CANDIDATES_MAX_LIMIT)
  limit?: number = 20;
}
