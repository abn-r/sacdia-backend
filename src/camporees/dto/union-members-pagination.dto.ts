import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Pagination DTO for union camporee member list endpoints.
 * Overrides the parent limit cap from 100 to 200 to accommodate
 * the larger member counts typical of union-level events.
 */
export class UnionMembersPaginationDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Cantidad de elementos por página (máximo 200 para endpoints de unión)',
    minimum: 1,
    maximum: 200,
    default: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number = 100;
}
