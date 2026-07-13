import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateUnionCamporeeDto } from './create-union-camporee.dto';
import { IsOptional, IsBoolean, NotEquals } from 'class-validator';
import { Transform } from 'class-transformer';

const NULL_TIMEZONE_SENTINEL = '__invalid_null_timezone__';

/**
 * DTO for updating an existing union-level camporee
 * All fields are optional - inherits from CreateUnionCamporeeDto
 */
export class UpdateUnionCamporeeDto extends PartialType(
  CreateUnionCamporeeDto,
) {
  @Transform(({ value }) => (value === null ? NULL_TIMEZONE_SENTINEL : value))
  @NotEquals(NULL_TIMEZONE_SENTINEL)
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Estado activo del camporee de unión',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
