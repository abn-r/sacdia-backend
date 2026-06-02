import { IsDate, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';
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
