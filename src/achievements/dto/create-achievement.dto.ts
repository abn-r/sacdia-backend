import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { achievement_scope, achievement_tier, achievement_type } from '@prisma/client';

export class CreateAchievementDto {
  @ApiProperty({ description: 'Nombre del logro', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ description: 'Descripción del logro', maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  description: string;

  @ApiProperty({ description: 'ID de la categoría a la que pertenece el logro' })
  @IsInt()
  category_id: number;

  @ApiProperty({
    description: 'Tipo de logro',
    enum: achievement_type,
  })
  @IsEnum(achievement_type)
  type: achievement_type;

  @ApiPropertyOptional({
    description: 'Alcance del logro',
    enum: achievement_scope,
    default: achievement_scope.GLOBAL,
  })
  @IsOptional()
  @IsEnum(achievement_scope)
  scope?: achievement_scope;

  @ApiPropertyOptional({
    description: 'Nivel del logro',
    enum: achievement_tier,
    default: achievement_tier.BRONZE,
  })
  @IsOptional()
  @IsEnum(achievement_tier)
  tier?: achievement_tier;

  @ApiPropertyOptional({ description: 'Puntos que otorga el logro', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  points?: number;

  @ApiProperty({ description: 'Criterios de evaluación del logro (JSON)' })
  @IsObject()
  criteria: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Logro secreto (no visible hasta desbloquearse)', default: false })
  @IsOptional()
  @IsBoolean()
  secret?: boolean;

  @ApiPropertyOptional({ description: 'El logro puede obtenerse más de una vez', default: false })
  @IsOptional()
  @IsBoolean()
  repeatable?: boolean;

  @ApiPropertyOptional({ description: 'Número máximo de veces que se puede obtener (null = sin límite)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  max_repeats?: number;

  @ApiPropertyOptional({ description: 'ID del tipo de club al que aplica (solo si scope = CLUB_TYPE)' })
  @IsOptional()
  @IsInt()
  club_type_id?: number;

  @ApiPropertyOptional({ description: 'ID del logro que se requiere obtener antes de este' })
  @IsOptional()
  @IsInt()
  prerequisite_id?: number;

  @ApiPropertyOptional({ description: 'Clave del badge en R2 storage', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  badge_image_key?: string;

  @ApiPropertyOptional({ description: 'Estado activo del logro', default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
