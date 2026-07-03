import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CamporeeEventTemplateRubricDto {
  @ApiProperty({ example: 'Técnica' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  declare title: string;

  @ApiPropertyOptional({ example: 'Ejecución correcta del procedimiento.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 30 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  declare max_points: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  display_order?: number;
}

export class CreateCamporeeEventTemplateDto {
  @ApiProperty({ example: 'union', enum: ['union', 'local_field'] })
  @IsString()
  @IsIn(['union', 'local_field'])
  declare scope: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Required when scope = union',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  union_id?: number;

  @ApiPropertyOptional({
    example: 2,
    description: 'Required when scope = local_field',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  local_field_id?: number;

  @ApiProperty({ example: 1, description: 'FK to camporee_event_types' })
  @IsInt()
  @Min(1)
  declare event_type_id: number;

  @ApiProperty({ example: 'Orden Cerrado' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  declare title: string;

  @ApiPropertyOptional({ example: 'Marcha en formación perfecta.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requirements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  development?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prerequisites?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  materials?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  auxiliaries?: string;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(0)
  declare max_points: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  scoring_enabled?: boolean;

  @ApiPropertyOptional({ type: [CamporeeEventTemplateRubricDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CamporeeEventTemplateRubricDto)
  rubrics?: CamporeeEventTemplateRubricDto[];

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_points?: number;

  @ApiPropertyOptional({
    example: [
      {
        description: 'Paso fuera de lugar',
        points_deducted: 5,
        time_seconds: null,
      },
    ],
  })
  @IsOptional()
  penalties?: object[];

  @ApiProperty({ example: 'count', enum: ['count', 'by_class'] })
  @IsString()
  @IsIn(['count', 'by_class'])
  declare participants_mode: string;

  @ApiPropertyOptional({
    example: 8,
    description: 'Required when participants_mode = count',
  })
  @ValidateIf((o) => o.participants_mode === 'count')
  @IsInt()
  @Min(1)
  participants_count?: number;

  @ApiPropertyOptional({
    example: [{ class_id: 1, count: 4 }],
    description: 'Required when participants_mode = by_class',
  })
  @ValidateIf((o) => o.participants_mode === 'by_class')
  participants_by_class?: object[];

  @ApiPropertyOptional({ example: 1800, description: 'Duration in seconds' })
  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCamporeeEventTemplateDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  event_type_id?: number;

  @ApiPropertyOptional({ example: 'Orden Cerrado Avanzado' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requirements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  development?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prerequisites?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  materials?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  auxiliaries?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  max_points?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  scoring_enabled?: boolean;

  @ApiPropertyOptional({ type: [CamporeeEventTemplateRubricDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CamporeeEventTemplateRubricDto)
  rubrics?: CamporeeEventTemplateRubricDto[];

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_points?: number;

  @ApiPropertyOptional()
  @IsOptional()
  penalties?: object[];

  @ApiPropertyOptional({ example: 'count', enum: ['count', 'by_class'] })
  @IsOptional()
  @IsString()
  @IsIn(['count', 'by_class'])
  participants_mode?: string;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  participants_count?: number;

  @ApiPropertyOptional()
  @IsOptional()
  participants_by_class?: object[];

  @ApiPropertyOptional({ example: 1800 })
  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListCamporeeEventTemplatesDto {
  @ApiPropertyOptional({ example: 'union', enum: ['union', 'local_field'] })
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  union_id?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  local_field_id?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  event_type_id?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
