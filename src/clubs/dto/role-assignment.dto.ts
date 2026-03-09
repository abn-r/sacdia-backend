import {
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ClubInstanceType } from './instance.dto';

export class AssignRoleDto {
  @ApiProperty({ description: 'ID del usuario' })
  @IsUUID()
  user_id: string;

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

  @ApiProperty({
    enum: ClubInstanceType,
    description:
      'Tipo de instancia de club (se resuelve desde ruta en contrato assignment-first).',
  })
  @IsOptional()
  instance_type?: ClubInstanceType;

  @ApiPropertyOptional({
    description:
      'ID de la instancia de club (se resuelve desde ruta en contrato assignment-first).',
  })
  @IsOptional()
  @IsInt()
  instance_id?: number;

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
