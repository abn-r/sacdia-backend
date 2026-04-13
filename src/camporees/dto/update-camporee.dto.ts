import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateCamporeeDto } from './create-camporee.dto';
import { IsOptional, IsBoolean } from 'class-validator';

/**
 * DTO for updating an existing camporee
 * All fields are optional - inherits from CreateCamporeeDto
 */
export class UpdateCamporeeDto extends PartialType(CreateCamporeeDto) {
  @ApiPropertyOptional({
    description: 'Estado activo del camporee',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
