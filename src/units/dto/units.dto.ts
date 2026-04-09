import {
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  IsUUID,
  IsArray,
  ValidateNested,
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

export class ScoreEntryDto {
  @ApiProperty({ description: 'ID de la categoría de puntuación' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  category_id: number;

  @ApiProperty({ description: 'Puntos para esta categoría', minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  points: number;
}

export class CreateWeeklyRecordDto {
  @ApiProperty({ description: 'UUID del usuario' })
  @IsUUID()
  user_id: string;

  @ApiProperty({ description: 'Número de semana' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(53)
  week: number;

  @ApiPropertyOptional({ description: 'Asistencia (0 o 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  attendance?: number;

  @ApiPropertyOptional({ description: 'Puntualidad (puntos legacy)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  punctuality?: number;

  @ApiPropertyOptional({
    description: 'Array de puntos por categoría de puntuación',
    type: [ScoreEntryDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreEntryDto)
  scores?: ScoreEntryDto[];
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

  @ApiPropertyOptional({ description: 'Estado activo del registro' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Array de puntos por categoría de puntuación (upsert)',
    type: [ScoreEntryDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreEntryDto)
  scores?: ScoreEntryDto[];
}
