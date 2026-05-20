import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateCamporeeEventDto {
  @ApiProperty({ example: 1, description: 'FK to camporee_event_types' })
  @IsInt()
  @Min(1)
  declare event_type_id: number;

  @ApiProperty({ example: 'Orden Cerrado' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  declare title: string;

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

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(0)
  declare max_points: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_points?: number;

  @ApiPropertyOptional({ example: [] })
  @IsOptional()
  penalties?: object[];

  @ApiProperty({ example: 'count', enum: ['count', 'by_class'] })
  @IsString()
  @IsIn(['count', 'by_class'])
  declare participants_mode: string;

  @ApiPropertyOptional({ example: 8 })
  @ValidateIf((o) => o.participants_mode === 'count')
  @IsInt()
  @Min(1)
  participants_count?: number;

  @ApiPropertyOptional({ example: [{ class_id: 1, count: 4 }] })
  @ValidateIf((o) => o.participants_mode === 'by_class')
  participants_by_class?: object[];

  @ApiPropertyOptional({ example: 1800 })
  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CloneFromTemplateDto {
  @ApiPropertyOptional({ description: 'Override title from template' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({ description: 'Override max_points from template' })
  @IsOptional()
  @IsInt()
  @Min(0)
  max_points?: number;

  @ApiPropertyOptional({ description: 'Override display_order' })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;
}

export class UpdateCamporeeEventDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  event_type_id?: number;

  @ApiPropertyOptional()
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

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_points?: number;

  @ApiPropertyOptional()
  @IsOptional()
  penalties?: object[];

  @ApiPropertyOptional({ enum: ['count', 'by_class'] })
  @IsOptional()
  @IsString()
  @IsIn(['count', 'by_class'])
  participants_mode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  participants_count?: number;

  @ApiPropertyOptional()
  @IsOptional()
  participants_by_class?: object[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ReorderCamporeeEventDto {
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(0)
  declare display_order: number;
}
