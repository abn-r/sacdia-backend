import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateRequirementProgressDto {
  @ApiProperty({ description: 'ID del requisito del honor' })
  @IsInt()
  requirementId: number;

  @ApiProperty({ description: 'Indica si el requisito fue completado' })
  @IsBoolean()
  completed: boolean;

  @ApiPropertyOptional({
    description: 'Notas opcionales del miembro sobre el requisito',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class BulkUpdateRequirementProgressDto {
  @ApiProperty({
    description: 'Lista de actualizaciones de progreso por requisito',
    type: [UpdateRequirementProgressDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => UpdateRequirementProgressDto)
  requirements: UpdateRequirementProgressDto[];
}
