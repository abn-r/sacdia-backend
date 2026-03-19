import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

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
}

export class UpdateHonorCategoryDto extends PartialType(CreateHonorCategoryDto) {}
