import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  Matches,
  ValidateIf,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

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
  declare name: string;

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
  @Matches(DATE_ONLY_PATTERN)
  declare start_date: string;

  @ApiProperty({
    description: 'Fecha de finalización del camporee (formato ISO 8601)',
    example: '2024-05-17',
  })
  @Matches(DATE_ONLY_PATTERN)
  declare end_date: string;

  @ApiProperty({
    description: 'ID del campo local organizador',
    example: 1,
  })
  @IsInt()
  declare local_field_id: number;

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
    example: true,
  })
  @IsBoolean()
  declare includes_master_guides: boolean;

  @ApiProperty({
    description: 'Lugar donde se realizará el camporee',
    example: 'Centro Recreacional La Montaña, Bogotá',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  declare local_camporee_place: string;

  @ApiPropertyOptional({
    description: 'Latitud del lugar del camporee',
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
    description: 'Longitud del lugar del camporee',
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
    example: 50000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  registration_cost?: number;

  @ApiPropertyOptional({
    description: 'Zona horaria IANA del camporee',
    example: 'America/Mexico_City',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Apertura de inscripción de clubes con Z u offset explícito',
    example: '2024-05-01T08:00:00-06:00',
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  club_registration_opens_at?: string | null;

  @ApiPropertyOptional({
    description: 'Fecha límite de inscripción de clubes (formato ISO 8601)',
    example: '2024-05-01T23:59:59Z',
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  club_registration_deadline?: string;

  @ApiPropertyOptional({
    description: 'Fecha límite de inscripción de miembros (formato ISO 8601)',
    example: '2024-05-05T23:59:59Z',
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  member_registration_deadline?: string;

  @ApiPropertyOptional({
    description: 'Fecha límite de pago (formato ISO 8601)',
    example: '2024-05-10T23:59:59Z',
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  payment_deadline?: string;

  @ApiPropertyOptional({
    description:
      'Fecha/hora desde la cual la agenda completa será visible para clubes. Si se omite, se libera al iniciar el camporee.',
    example: '2024-05-13T08:00:00.000Z',
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  agenda_visible_from?: string | null;

  @ApiPropertyOptional({
    description: 'Habilita pedidos de artículos para este camporee',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  orders_enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Apertura de pedidos con Z u offset explícito',
    example: '2026-08-01T08:00:00-06:00',
    nullable: true,
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  orders_opens_at?: string | null;

  @ApiPropertyOptional({
    description: 'Cierre de pedidos con Z u offset explícito',
    example: '2026-08-24T23:59:59-06:00',
    nullable: true,
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  orders_deadline?: string | null;
}
