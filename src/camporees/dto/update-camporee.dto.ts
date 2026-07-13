import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateCamporeeDto } from './create-camporee.dto';
import { IsOptional, IsBoolean, NotEquals } from 'class-validator';
import { Transform } from 'class-transformer';

const NULL_TIMEZONE_SENTINEL = '__invalid_null_timezone__';

/**
 * DTO for updating an existing camporee
 * All fields are optional - inherits from CreateCamporeeDto
 */
export class UpdateCamporeeDto extends PartialType(CreateCamporeeDto) {
  @Transform(({ value }) => (value === null ? NULL_TIMEZONE_SENTINEL : value))
  @NotEquals(NULL_TIMEZONE_SENTINEL)
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Estado activo del camporee',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
