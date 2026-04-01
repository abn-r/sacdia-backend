import {
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
  IsArray,
  IsUUID,
  MaxLength,
  Min,
  Max,
  ArrayMaxSize,
  IsObject,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MeetingScheduleItemDto {
  @ApiProperty({ example: 'Sábado', description: 'Día de la reunión' })
  @IsString()
  @IsNotEmpty()
  day: string;

  @ApiProperty({
    example: '09:00',
    description: 'Hora de inicio de la reunión (HH:mm)',
  })
  @IsString()
  @IsNotEmpty()
  time: string;
}

export class CreateClubEnrollmentDto {
  // ─── Backward-compatible fields ──────────────────────────────────────

  @ApiPropertyOptional({
    example: 'Av. Insurgentes 123, Col. Centro',
    description: 'Dirección de reunión del club para este año',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({
    example: 'Sábados y Domingos',
    description:
      'Días de reunión del club (campo legacy, usar meeting_schedule para datos estructurados)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  meeting_days?: string;

  // ─── Location ────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: 19.4326,
    description: 'Latitud geográfica de la sede del club',
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    example: -99.1332,
    description: 'Longitud geográfica de la sede del club',
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  // ─── Schedule ────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    type: [MeetingScheduleItemDto],
    description: 'Horario estructurado de reuniones: array de { day, time }',
    example: [
      { day: 'Sábado', time: '09:00' },
      { day: 'Domingo', time: '10:30' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeetingScheduleItemDto)
  meeting_schedule?: MeetingScheduleItemDto[];

  // ─── Goals & Fees ────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: 30,
    description: 'Meta de almas / número objetivo de miembros para el año',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  souls_target?: number;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: 'Indica si el club cobra cuotas a sus miembros',
  })
  @IsOptional()
  @IsBoolean()
  fee?: boolean;

  @ApiPropertyOptional({
    description: 'Fee amount when fee is enabled',
    example: 50.0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fee_amount?: number;

  // ─── Leadership ──────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID del usuario asignado como Director del club',
  })
  @IsOptional()
  @IsUUID()
  director_id?: string;

  @ApiPropertyOptional({
    type: [String],
    example: [
      '550e8400-e29b-41d4-a716-446655440001',
      '550e8400-e29b-41d4-a716-446655440002',
    ],
    description: 'UUIDs de hasta 2 usuarios asignados como Subdirectores',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  deputy_director_ids?: string[];

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440003',
    description:
      'UUID del usuario asignado como Secretario. Mutuamente exclusivo con secretary_treasurer_id.',
  })
  @IsOptional()
  @IsUUID()
  secretary_id?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440004',
    description:
      'UUID del usuario asignado como Tesorero. Mutuamente exclusivo con secretary_treasurer_id.',
  })
  @IsOptional()
  @IsUUID()
  treasurer_id?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440005',
    description:
      'UUID del usuario que actúa como Secretario-Tesorero. Mutuamente exclusivo con secretary_id y treasurer_id.',
  })
  @IsOptional()
  @IsUUID()
  secretary_treasurer_id?: string;
}
