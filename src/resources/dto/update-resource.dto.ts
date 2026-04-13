import { PartialType } from '@nestjs/swagger';
import { CreateResourceDto } from './create-resource.dto';
import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateResourceDto extends PartialType(CreateResourceDto) {
  @ApiPropertyOptional({ description: 'Estado activo/inactivo del recurso' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
