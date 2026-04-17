import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateUnionCamporeeDto } from './create-union-camporee.dto';
import { IsOptional, IsBoolean } from 'class-validator';

/**
 * DTO for updating an existing union-level camporee
 * All fields are optional - inherits from CreateUnionCamporeeDto
 */
export class UpdateUnionCamporeeDto extends PartialType(
  CreateUnionCamporeeDto,
) {
  @ApiPropertyOptional({
    description: 'Estado activo del camporee de unión',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
