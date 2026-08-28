import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CamporeeOrderOwnerScopeDto,
  CamporeeOrderSizeSchemeDto,
} from './create-camporee-order-product.dto';

export class UpdateCamporeeOrderProductDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ enum: CamporeeOrderSizeSchemeDto })
  @IsOptional()
  @IsEnum(CamporeeOrderSizeSchemeDto)
  size_scheme?: CamporeeOrderSizeSchemeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  club_type_id?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Rejected by the service if present — owner is immutable after create. */
  @ApiPropertyOptional({ enum: CamporeeOrderOwnerScopeDto })
  @IsOptional()
  @IsEnum(CamporeeOrderOwnerScopeDto)
  owner_scope?: CamporeeOrderOwnerScopeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  owner_division_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  owner_union_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  owner_local_field_id?: number;
}
