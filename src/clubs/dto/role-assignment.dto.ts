import {
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AssignRoleDto {
  @ApiProperty({ description: 'ID del usuario' })
  @IsUUID()
  declare user_id: string;

  @ApiPropertyOptional({
    description: 'ID del rol a asignar (preferido, formato UUID)',
  })
  @IsOptional()
  @IsUUID()
  role_id?: string;

  @ApiPropertyOptional({
    description:
      'Compatibilidad temporal: nombre del rol (ej. member, director).',
  })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({
    description: 'ID de la sección del club (FK a club_sections).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_section_id?: number;

  @ApiPropertyOptional({ description: 'ID del año eclesiástico' })
  @IsOptional()
  @IsInt()
  ecclesiastical_year_id?: number;

  @ApiPropertyOptional({ description: 'Fecha de inicio del rol' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  start_date?: Date;

  @ApiPropertyOptional({ description: 'Fecha de fin del rol' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  end_date?: Date;
}

export class UpdateRoleAssignmentDto {
  @ApiPropertyOptional({
    description: 'Nuevo ID del rol asignado (preferido, formato UUID)',
  })
  @IsOptional()
  @IsUUID()
  role_id?: string;

  @ApiPropertyOptional({
    description:
      'Compatibilidad temporal: nombre del rol a asignar (ej. member, director).',
  })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ description: 'ID del año eclesiástico' })
  @IsOptional()
  @IsInt()
  ecclesiastical_year_id?: number;

  @ApiPropertyOptional({ description: 'Fecha de inicio del rol' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  start_date?: Date;

  @ApiPropertyOptional({ description: 'Fecha de fin del rol' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  end_date?: Date;

  @ApiPropertyOptional({ description: 'Estado del rol' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class DirectorSuccessionDto {
  @ApiProperty({ description: 'Asignación activa del director actual' })
  @IsUUID()
  declare current_assignment_id: string;

  @ApiProperty({ description: 'Usuario que será asignado como nuevo director' })
  @IsUUID()
  declare successor_user_id: string;

  @ApiProperty({ description: 'ID del nuevo año eclesiástico' })
  @Type(() => Number)
  @IsInt()
  declare ecclesiastical_year_id: number;

  @ApiPropertyOptional({ description: 'Fecha de inicio del nuevo director' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  start_date?: Date;
}

/** Durable P0 schedule body — does not activate the successor. */
export class ScheduleDirectorSuccessionDto {
  @ApiProperty({ description: 'Asignación activa del director saliente' })
  @IsUUID()
  declare current_assignment_id: string;

  @ApiProperty({ description: 'Usuario sucesor' })
  @IsUUID()
  declare successor_user_id: string;

  @ApiProperty({ description: 'Año eclesiástico objetivo' })
  @Type(() => Number)
  @IsInt()
  declare ecclesiastical_year_id: number;

  @ApiProperty({ description: 'Clave de idempotencia del actor' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  declare idempotency_key: string;

  @ApiProperty({ description: 'Campo local del actor programador' })
  @Type(() => Number)
  @IsInt()
  declare scheduled_local_field_id: number;

  @ApiProperty({
    description: 'Rol exacto del actor (director-lf o assistant-lf)',
    example: 'director-lf',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  declare scheduled_by_role: string;
}

export class DirectorInitialAssignmentDto {
  @ApiProperty({ description: 'Usuario que será asignado como director inicial' })
  @IsUUID()
  declare user_id: string;

  @ApiProperty({ description: 'ID del año eclesiástico' })
  @Type(() => Number)
  @IsInt()
  declare ecclesiastical_year_id: number;

  @ApiPropertyOptional({ description: 'Fecha de inicio del director' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  start_date?: Date;
}
