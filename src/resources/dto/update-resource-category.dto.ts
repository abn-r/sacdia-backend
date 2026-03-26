import { PartialType } from '@nestjs/swagger';
import { CreateResourceCategoryDto } from './create-resource-category.dto';
import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateResourceCategoryDto extends PartialType(CreateResourceCategoryDto) {
  @ApiPropertyOptional({ description: 'Estado activo/inactivo de la categoría' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
