import {
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  IsUUID,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateUnitDto {
  @ApiProperty({ description: 'Nombre de la unidad' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'UUID del capitán de la unidad' })
  @IsUUID()
  captain_id: string;

  @ApiProperty({ description: 'UUID del secretario de la unidad' })
  @IsUUID()
  secretary_id: string;

  @ApiProperty({ description: 'UUID del consejero/asesor de la unidad' })
  @IsUUID()
  advisor_id: string;

  @ApiPropertyOptional({
    description: 'UUID del consejero suplente (opcional)',
  })
  @IsOptional()
  @IsUUID()
  substitute_advisor_id?: string;

  @ApiProperty({
    description: 'ID del tipo de club (1=Aventureros, 2=Conquistadores, 3=GM)',
  })
  @Type(() => Number)
  @IsInt()
  club_type_id: number;

  @ApiPropertyOptional({ description: 'ID de la sección del club' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_section_id?: number;
}

export class UpdateUnitDto {
  @ApiPropertyOptional({ description: 'Nombre de la unidad' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'UUID del capitán' })
  @IsOptional()
  @IsUUID()
  captain_id?: string;

  @ApiPropertyOptional({ description: 'UUID del secretario' })
  @IsOptional()
  @IsUUID()
  secretary_id?: string;

  @ApiPropertyOptional({ description: 'UUID del consejero' })
  @IsOptional()
  @IsUUID()
  advisor_id?: string;

  @ApiPropertyOptional({ description: 'UUID del consejero suplente' })
  @IsOptional()
  @IsUUID()
  substitute_advisor_id?: string;

  @ApiPropertyOptional({ description: 'ID del tipo de club' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_type_id?: number;

  @ApiPropertyOptional({ description: 'ID de la sección del club' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_section_id?: number;

  @ApiPropertyOptional({ description: 'Estado activo de la unidad' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AddUnitMemberDto {
  @ApiProperty({ description: 'UUID del usuario a agregar como miembro' })
  @IsUUID()
  user_id: string;
}

export class CreateWeeklyRecordDto {
  @ApiProperty({ description: 'UUID del usuario' })
  @IsUUID()
  user_id: string;

  @ApiProperty({ description: 'Número de semana' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52)
  week: number;

  @ApiProperty({ description: 'Asistencia (puntos)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  attendance: number;

  @ApiProperty({ description: 'Puntualidad (puntos)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  punctuality: number;

  @ApiProperty({ description: 'Puntos totales' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  points: number;
}

export class UpdateWeeklyRecordDto {
  @ApiPropertyOptional({ description: 'Asistencia (puntos)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  attendance?: number;

  @ApiPropertyOptional({ description: 'Puntualidad (puntos)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  punctuality?: number;

  @ApiPropertyOptional({ description: 'Puntos totales' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  points?: number;

  @ApiPropertyOptional({ description: 'Estado activo del registro' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
