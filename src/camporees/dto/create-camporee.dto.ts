import {
  IsString,
  IsDateString,
  IsInt,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating a new camporee
 * Supports both local field and union-level camporees
 */
export class CreateCamporeeDto {
  @ApiProperty({
    description: 'Nombre del camporee',
    example: 'Camporee de Primavera 2024',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description: 'Descripción detallada del camporee',
    example: 'Evento anual de primavera con actividades para todas las edades',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({
    description: 'Fecha de inicio del camporee (formato ISO 8601)',
    example: '2024-05-15',
  })
  @IsDateString()
  start_date: string;

  @ApiProperty({
    description: 'Fecha de finalización del camporee (formato ISO 8601)',
    example: '2024-05-17',
  })
  @IsDateString()
  end_date: string;

  @ApiProperty({
    description: 'ID del campo local organizador',
    example: 1,
  })
  @IsInt()
  local_field_id: number;

  @ApiProperty({
    description: 'Indica si incluye participantes de Aventureros',
    example: true,
  })
  @IsBoolean()
  includes_adventurers: boolean;

  @ApiProperty({
    description: 'Indica si incluye participantes de Conquistadores',
    example: true,
  })
  @IsBoolean()
  includes_pathfinders: boolean;

  @ApiProperty({
    description: 'Indica si incluye participantes de Guías Mayores',
    example: true,
  })
  @IsBoolean()
  includes_master_guides: boolean;

  @ApiProperty({
    description: 'Lugar donde se realizará el camporee',
    example: 'Centro Recreacional La Montaña, Bogotá',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  local_camporee_place: string;

  @ApiPropertyOptional({
    description: 'Costo de inscripción al camporee (en moneda local)',
    example: 50000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  registration_cost?: number;

  @ApiPropertyOptional({
    description: 'Fecha límite de inscripción de clubes (formato ISO 8601)',
    example: '2024-05-01',
  })
  @IsOptional()
  @IsDateString()
  club_registration_deadline?: string;

  @ApiPropertyOptional({
    description: 'Fecha límite de inscripción de miembros (formato ISO 8601)',
    example: '2024-05-05',
  })
  @IsOptional()
  @IsDateString()
  member_registration_deadline?: string;

  @ApiPropertyOptional({
    description: 'Fecha límite de pago (formato ISO 8601)',
    example: '2024-05-10',
  })
  @IsOptional()
  @IsDateString()
  payment_deadline?: string;
}
