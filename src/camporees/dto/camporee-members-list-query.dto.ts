import { IsOptional, IsInt, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Merged query DTO for `GET /camporees/:camporeeId/members`.
 *
 * Combines the status filter with pagination so the handler can bind a single
 * `@Query()` object. Having two separate `@Query()` bindings against different
 * DTOs while the global `ValidationPipe` runs with `forbidNonWhitelisted: true`
 * makes each DTO reject the other's properties (e.g. `status` rejects
 * `page`/`limit` and vice versa), producing spurious 400 errors.
 *
 * Overrides the parent `limit` default from 20 to 50 to match the spec
 * for the local camporee members list endpoint.
 */
export class CamporeeMembersListQueryDto extends PaginationDto {
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
    description: 'Elementos por página, máximo 100 (default: 50)',
    minimum: 1,
    maximum: 100,
    default: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 50;
}
