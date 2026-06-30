import {
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  IsUUID,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateUnitDto {
  @ApiProperty({ description: 'Nombre de la unidad' })
  @IsString()
  declare name: string;

  @ApiProperty({ description: 'UUID del capitán de la unidad' })
  @IsUUID()
  declare captain_id: string;

  @ApiProperty({ description: 'UUID del secretario de la unidad' })
  @IsUUID()
  declare secretary_id: string;

  @ApiProperty({ description: 'UUID del consejero/asesor de la unidad' })
  @IsUUID()
  declare advisor_id: string;

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
  declare club_type_id: number;

  @ApiProperty({ description: 'ID de la sección del club' })
  @Type(() => Number)
  @IsInt()
  declare club_section_id: number;
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
  declare user_id: string;
}

export class ScoreEntryDto {
  @ApiProperty({ description: 'ID de la categoría de puntuación' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare category_id: number;

  @ApiProperty({ description: 'Puntos para esta categoría', minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  declare points: number;
}

export class CreateWeeklyRecordDto {
  @ApiProperty({ description: 'UUID del usuario' })
  @IsUUID()
  declare user_id: string;

  @ApiProperty({ description: 'Número de semana' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(53)
  declare week: number;

  @ApiProperty({ description: 'Año del registro (ej: 2026)' })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  declare year: number;

  @ApiPropertyOptional({
    description:
      'Campo legacy de asistencia. Ya no suma puntos; configura asistencia como categoría si debe puntuar.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  attendance?: number;

  @ApiPropertyOptional({
    description:
      'Campo legacy de puntualidad. Ya no suma puntos; configura puntualidad como categoría si debe puntuar.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
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

export class BulkWeeklyRecordEntryDto {
  @ApiProperty({ description: 'UUID del usuario' })
  @IsUUID()
  declare user_id: string;

  @ApiPropertyOptional({
    description:
      'Campo legacy de asistencia. Ya no suma puntos; configura asistencia como categoría si debe puntuar.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  attendance?: number;

  @ApiPropertyOptional({
    description:
      'Campo legacy de puntualidad. Ya no suma puntos; configura puntualidad como categoría si debe puntuar.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
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

export class BulkUpsertWeeklyRecordsDto {
  @ApiProperty({ description: 'Número de semana ISO' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(53)
  declare week: number;

  @ApiProperty({ description: 'Año ISO del registro (ej: 2026)' })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  declare year: number;

  @ApiProperty({
    description: 'Registros por miembro a crear/actualizar atómicamente',
    type: [BulkWeeklyRecordEntryDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkWeeklyRecordEntryDto)
  declare records: BulkWeeklyRecordEntryDto[];
}

export class UpdateWeeklyRecordDto {
  @ApiPropertyOptional({
    description:
      'Campo legacy de asistencia. Ya no suma puntos; configura asistencia como categoría si debe puntuar.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  attendance?: number;

  @ApiPropertyOptional({
    description:
      'Campo legacy de puntualidad. Ya no suma puntos; configura puntualidad como categoría si debe puntuar.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
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
