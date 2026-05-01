import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Pagination DTO for camporee member list endpoints.
 * Overrides the parent limit default from 20 to 50 to match
 * the spec for GET /camporees/:id/members.
 */
export class CamporeeMembersPaginationDto extends PaginationDto {
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
