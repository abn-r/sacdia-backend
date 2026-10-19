import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Every state a `club_role_assignments.status` can hold (the column is a free
 * VARCHAR, so the API is what keeps it in this set). `designated` stays here so
 * the service keeps answering it with its specific 400; making a row `active`
 * also passes the consent gate for dependents.
 */
export const CLUB_ROLE_ASSIGNMENT_STATUSES = [
  'active',
  'inactive',
  'pending',
  'rejected',
  'expired',
  'cancelled',
  'ended',
  'designated',
] as const;
export type ClubRoleAssignmentStatus =
  (typeof CLUB_ROLE_ASSIGNMENT_STATUSES)[number];

export class AssignRoleDto {
  @ApiProperty({ description: 'ID del usuario' })
  @IsUUID()
  declare user_id: string;

  @ApiPropertyOptional({
    description:
      'ID del rol a asignar (preferido, formato UUID). Solo roles CLUB activos; un role_id GLOBAL o inactivo responde 400 CLUB_ROLE_NOT_FOUND.',
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
    description:
      'Nuevo ID del rol asignado (preferido, formato UUID). Solo roles CLUB activos; un role_id GLOBAL o inactivo responde 400 CLUB_ROLE_NOT_FOUND.',
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

  @ApiPropertyOptional({
    description: 'Estado del rol',
    enum: CLUB_ROLE_ASSIGNMENT_STATUSES,
  })
  @IsOptional()
  @IsIn(CLUB_ROLE_ASSIGNMENT_STATUSES)
  status?: ClubRoleAssignmentStatus;
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

export class DirectorDesignationDto {
  @ApiProperty({
    description: 'Usuario que será preelegido como director para el año futuro',
  })
  @IsUUID()
  declare user_id: string;

  @ApiProperty({
    description: 'ID del año eclesiástico futuro para la programación',
  })
  @Type(() => Number)
  @IsInt()
  declare ecclesiastical_year_id: number;
}

export class ReplaceDirectorPlanDto {
  @ApiProperty({ description: 'ID de la programación a reemplazar' })
  @IsUUID()
  declare succession_id: string;

  @ApiProperty({
    description: 'Versión actual de la programación (control optimista)',
  })
  @Type(() => Number)
  @IsInt()
  declare version: number;

  @ApiProperty({ description: 'Usuario sucesor que reemplaza al programado' })
  @IsUUID()
  declare successor_user_id: string;
}

export class DirectorInitialAssignmentDto {
  @ApiProperty({
    description: 'Usuario que será asignado como director inicial',
  })
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
