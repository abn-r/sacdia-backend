import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  Matches,
  ValidateIf,
  IsArray,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

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
  @Matches(DATE_ONLY_PATTERN)
  declare start_date: string;

  @ApiProperty({
    description: 'Fecha de finalización del camporee (formato ISO 8601)',
    example: '2024-09-22',
  })
  @Matches(DATE_ONLY_PATTERN)
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
    description: 'Zona horaria IANA del camporee',
    example: 'America/Mexico_City',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Apertura de inscripción de clubes con Z u offset explícito',
    example: '2024-09-01T08:00:00-06:00',
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  club_registration_opens_at?: string | null;

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
    example: '2024-09-01T23:59:59Z',
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  club_registration_deadline?: string;

  @ApiPropertyOptional({
    description: 'Fecha límite de inscripción de miembros (formato ISO 8601)',
    example: '2024-09-05T23:59:59Z',
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  member_registration_deadline?: string;

  @ApiPropertyOptional({
    description: 'Fecha límite de pago (formato ISO 8601)',
    example: '2024-09-10T23:59:59Z',
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  payment_deadline?: string;

  @ApiPropertyOptional({
    description:
      'Fecha/hora desde la cual la agenda completa será visible para clubes. Si se omite, se libera al iniciar el camporee.',
    example: '2024-09-18T08:00:00.000Z',
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
    description: 'Hora local de corte para editar insumos del día siguiente (HH:MM)',
    example: '21:00',
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  supply_edit_cutoff_local_time?: string;

  @ApiPropertyOptional({
    description: 'Apertura de pedidos con Z u offset explícito',
    example: '2026-09-01T08:00:00-06:00',
    nullable: true,
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  orders_opens_at?: string | null;

  @ApiPropertyOptional({
    description: 'Cierre de pedidos con Z u offset explícito',
    example: '2026-09-22T23:59:59-06:00',
    nullable: true,
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  orders_deadline?: string | null;
}
