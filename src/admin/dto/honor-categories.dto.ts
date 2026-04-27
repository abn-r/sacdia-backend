import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CatalogTranslationDto } from '../../common/dto/catalog-translation.dto';

export class HonorCategoryListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'Naturaleza' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateHonorCategoryDto {
  @ApiProperty({ example: 'Logro Misionero' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Categoría para honores de misión' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    example: 12,
    nullable: true,
    description: 'Ícono opcional para compatibilidad con datos legacy',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  icon?: number | null;

  @ApiPropertyOptional({
    description:
      'Non-es translations. Pass undefined to leave existing translations untouched, ' +
      '[] to delete all, or entries for pt-BR / en / fr to upsert them.',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateHonorCategoryDto extends PartialType(
  CreateHonorCategoryDto,
) {}
