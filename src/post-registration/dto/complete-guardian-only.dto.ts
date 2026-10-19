import { IsInt, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** All fields are optional: the guardian may skip the geography entirely. */
export class CompleteGuardianOnlyDto {
  @ApiPropertyOptional({ example: 1, description: 'ID del país' })
  @IsOptional()
  @IsInt()
  declare country_id?: number;

  @ApiPropertyOptional({ example: 1, description: 'ID de la unión' })
  @IsOptional()
  @IsInt()
  declare union_id?: number;

  @ApiPropertyOptional({ example: 1, description: 'ID del campo local' })
  @IsOptional()
  @IsInt()
  declare local_field_id?: number;
}
