import {
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  IsArray,
  Min,
  Max,
  IsIn,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ActivityInstanceSelectionDto {
  @ApiProperty({
    description: 'Tipo de instancia del club',
    enum: ['adventurers', 'pathfinders', 'master_guilds'],
    example: 'pathfinders',
  })
  @IsIn(['adventurers', 'pathfinders', 'master_guilds'])
  instance_type: 'adventurers' | 'pathfinders' | 'master_guilds';

  @ApiProperty({
    description: 'ID de la instancia seleccionada',
    example: 10,
  })
  @Type(() => Number)
  @IsInt()
  instance_id: number;
}

export class CreateActivityDto {
  @ApiProperty({ description: 'Nombre de la actividad' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Descripción de la actividad' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Tipo de club (1=Aventureros, 2=Conquistadores, 3=GM)',
  })
  @IsInt()
  club_type_id: number;

  @ApiProperty({ description: 'Latitud del lugar' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ description: 'Longitud del lugar' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  long: number;

  @ApiPropertyOptional({
    description: 'Hora de la actividad (HH:mm)',
    default: '09:00',
  })
  @IsOptional()
  @IsString()
  activity_time?: string;

  @ApiProperty({ description: 'Lugar de la actividad' })
  @IsString()
  activity_place: string;

  @ApiProperty({ description: 'URL de la imagen de la actividad' })
  @IsString()
  image: string;

  @ApiPropertyOptional({
    description: 'Plataforma (0=Presencial, 1=Virtual, 2=Híbrido)',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  platform?: number;

  @ApiProperty({
    description:
      'ID del tipo de actividad (catálogo activity_types: 1=Regular, 2=Especial, 3=Camporee)',
  })
  @IsInt()
  activity_type_id: number;

  @ApiPropertyOptional({ description: 'Link de reunión virtual' })
  @IsOptional()
  @IsString()
  link_meet?: string;

  @ApiPropertyOptional({ description: 'Datos adicionales en JSON' })
  @IsOptional()
  @IsString()
  additional_data?: string;

  @ApiPropertyOptional({ description: 'Clases invitadas (IDs)' })
  @IsOptional()
  @IsArray()
  classes?: number[];

  @ApiPropertyOptional({
    description:
      'Instancias destino de la actividad (permite compartir una actividad entre múltiples instancias del mismo club)',
    type: [ActivityInstanceSelectionDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ActivityInstanceSelectionDto)
  instances?: ActivityInstanceSelectionDto[];

  @ApiPropertyOptional({
    description:
      'ID de instancia de Aventureros (requerido cuando club_type_id corresponde a Aventureros)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_adv_id?: number;

  @ApiPropertyOptional({
    description:
      'ID de instancia de Conquistadores (requerido cuando club_type_id corresponde a Conquistadores)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_pathf_id?: number;

  @ApiPropertyOptional({
    description:
      'ID de instancia de Guías Mayores (requerido cuando club_type_id corresponde a Guías Mayores)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_mg_id?: number;
}

export class UpdateActivityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  long?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  activity_time?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  activity_place?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  platform?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  activity_type_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  link_meet?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  classes?: number[];
}

export class RecordAttendanceDto {
  @ApiProperty({ description: 'Lista de IDs de usuarios que asistieron' })
  @IsArray()
  user_ids: string[];
}

export class ActivityFiltersDto {
  @ApiPropertyOptional({ description: 'Filtrar por tipo de club' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  clubTypeId?: number;

  @ApiPropertyOptional({ description: 'Solo actividades activas' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Tipo de actividad' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  activityTypeId?: number;
}
