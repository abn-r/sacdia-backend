import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export enum CamporeeOrderOwnerScopeDto {
  DIVISION = 'DIVISION',
  UNION = 'UNION',
  LOCAL_FIELD = 'LOCAL_FIELD',
}

export enum CamporeeOrderSizeSchemeDto {
  LETTER = 'LETTER',
  NUMERIC = 'NUMERIC',
  NONE = 'NONE',
}

export class CreateCamporeeOrderProductDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: CamporeeOrderSizeSchemeDto })
  @IsEnum(CamporeeOrderSizeSchemeDto)
  size_scheme!: CamporeeOrderSizeSchemeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  club_type_id?: number;

  @ApiPropertyOptional({
    enum: CamporeeOrderOwnerScopeDto,
    description:
      'Hint for admin/all actors. Ignored as authority for territorial roles.',
  })
  @IsOptional()
  @IsEnum(CamporeeOrderOwnerScopeDto)
  owner_scope?: CamporeeOrderOwnerScopeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  owner_division_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  owner_union_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  owner_local_field_id?: number;
}

export class ListCamporeeOrderProductsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}
