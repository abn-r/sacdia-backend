import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListCatalogQueryDto {
  /**
   * Local field to list. The handler reads it to scope the listing (required
   * for unscoped admins, inside the territory for union/division actors).
   * Declared here so the global `forbidNonWhitelisted` pipe does not reject it.
   */
  @ApiPropertyOptional({
    description: 'Local field to list (admins and territorial roles)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  local_field_id?: number;

  @ApiPropertyOptional({ description: 'Filter by category UUID' })
  @IsOptional()
  @IsUUID()
  cat?: string;

  @ApiPropertyOptional({ description: 'Filter by club_type_id (programa)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  programa?: number;

  @ApiPropertyOptional({ description: 'Free-text search on title' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Page number (1-indexed)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page size (max 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
