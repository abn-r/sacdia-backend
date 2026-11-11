import {
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
  IsArray,
  Min,
  Max,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MeetingScheduleItemDto {
  @ApiProperty({ example: 'Sábado', description: 'Día de la reunión' })
  @IsString()
  @IsNotEmpty()
  declare day: string;

  @ApiProperty({
    example: '09:00',
    description: 'Hora de inicio de la reunión (HH:mm)',
  })
  @IsString()
  @IsNotEmpty()
  declare time: string;
}

export class CreateClubEnrollmentDto {
  // ─── Backward-compatible fields ──────────────────────────────────────

  @ApiPropertyOptional({
    example: 'Av. Insurgentes 123, Col. Centro',
    description: 'Dirección de reunión del club para este año',
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(255)
  address?: string;

  @ApiPropertyOptional({
    example: 'Sábados y Domingos',
    description:
      'Días de reunión del club (campo legacy, usar meeting_schedule para datos estructurados)',
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(255)
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
}
