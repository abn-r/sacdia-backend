import {
  IsString,
  IsDateString,
  IsInt,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  IsArray,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating a new union-level camporee
 */
export class CreateUnionCamporeeDto {
  @ApiProperty({
    description: 'Nombre del camporee de unión',
    example: 'Camporee de Unión 2024',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  declare name: string;

  @ApiPropertyOptional({
    description: 'Descripción detallada del camporee de unión',
    example:
      'Gran camporee de unión con participación de todos los campos locales',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Fecha de inicio del camporee (formato ISO 8601)',
    example: '2024-09-20',
  })
  @IsDateString()
  declare start_date: string;

  @ApiProperty({
    description: 'Fecha de finalización del camporee (formato ISO 8601)',
    example: '2024-09-22',
  })
  @IsDateString()
  declare end_date: string;

  @ApiProperty({
    description: 'ID de la unión organizadora',
    example: 1,
  })
  @IsInt()
  declare union_id: number;

  @ApiProperty({
    description: 'Indica si incluye participantes de Aventureros',
    example: true,
  })
  @IsBoolean()
  declare includes_adventurers: boolean;

  @ApiProperty({
    description: 'Indica si incluye participantes de Conquistadores',
    example: true,
  })
  @IsBoolean()
  declare includes_pathfinders: boolean;

  @ApiProperty({
    description: 'Indica si incluye participantes de Guías Mayores',
    example: false,
  })
  @IsBoolean()
  declare includes_master_guides: boolean;

  @ApiProperty({
    description: 'Lugar donde se realizará el camporee de unión',
    example: 'Centro Recreacional Nacional, Ciudad de México',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  declare union_camporee_place: string;

  @ApiPropertyOptional({
    description: 'Latitud del lugar del camporee de unión',
    example: 19.1738,
    minimum: -90,
    maximum: 90,
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({
    description: 'Longitud del lugar del camporee de unión',
    example: -96.1342,
    minimum: -180,
    maximum: 180,
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  long?: number;

  @ApiPropertyOptional({
    description: 'Costo de inscripción al camporee (en moneda local)',
    example: 150000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  registration_cost?: number;

  @ApiPropertyOptional({
    description: 'IDs de los campos locales participantes',
    example: [1, 2, 3],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  local_field_ids?: number[];

  @ApiPropertyOptional({
    description: 'Fecha límite de inscripción de clubes (formato ISO 8601)',
    example: '2024-09-01',
  })
  @IsOptional()
  @IsDateString()
  club_registration_deadline?: string;

  @ApiPropertyOptional({
    description: 'Fecha límite de inscripción de miembros (formato ISO 8601)',
    example: '2024-09-05',
  })
  @IsOptional()
  @IsDateString()
  member_registration_deadline?: string;

  @ApiPropertyOptional({
    description: 'Fecha límite de pago (formato ISO 8601)',
    example: '2024-09-10',
  })
  @IsOptional()
  @IsDateString()
  payment_deadline?: string;
}
