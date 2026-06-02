import { IsOptional, IsInt, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Merged query DTO for `GET /camporees/union/:camporeeId/members`.
 *
 * Combines the status filter with pagination so the handler can bind a single
 * `@Query()` object. Having two separate `@Query()` bindings against different
 * DTOs while the global `ValidationPipe` runs with `forbidNonWhitelisted: true`
 * makes each DTO reject the other's properties (e.g. `status` rejects
 * `page`/`limit` and vice versa), producing spurious 400 errors.
 *
 * Overrides the parent `limit` cap from 100 to 200 to accommodate the larger
 * member counts typical of union-level events.
 */
export class UnionMembersListQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filtrar por estado de inscripción',
    example: 'approved',
    enum: [
      'registered',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ],
  })
  @IsOptional()
  @IsIn(['registered', 'pending_approval', 'approved', 'rejected', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({
    description:
      'Cantidad de elementos por página (máximo 200 para endpoints de unión)',
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
