import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  achievement_scope,
  achievement_tier,
  achievement_type,
} from '@prisma/client';

export class AchievementResponseDto {
  @ApiProperty({ description: 'ID único del logro' })
  achievement_id: number;

  @ApiProperty({ description: 'ID de la categoría' })
  category_id: number;

  @ApiProperty({ description: 'Nombre del logro' })
  name: string;

  @ApiProperty({ description: 'Descripción del logro' })
  description: string;

  @ApiPropertyOptional({
    description: 'URL firmada del badge (generada desde badge_image_key)',
  })
  badge_image_url?: string | null;

  @ApiProperty({ description: 'Tipo de logro', enum: achievement_type })
  type: achievement_type;

  @ApiProperty({ description: 'Alcance del logro', enum: achievement_scope })
  scope: achievement_scope;

  @ApiProperty({ description: 'Nivel del logro', enum: achievement_tier })
  tier: achievement_tier;

  @ApiProperty({ description: 'Puntos que otorga el logro' })
  points: number;

  @ApiProperty({ description: 'Criterios de evaluación del logro' })
  criteria: Record<string, unknown>;

  @ApiProperty({ description: 'Logro secreto' })
  secret: boolean;

  @ApiProperty({ description: 'El logro puede obtenerse más de una vez' })
  repeatable: boolean;

  @ApiPropertyOptional({
    description: 'Número máximo de veces que se puede obtener',
  })
  max_repeats?: number | null;

  @ApiPropertyOptional({ description: 'ID del tipo de club al que aplica' })
  club_type_id?: number | null;

  @ApiPropertyOptional({ description: 'ID del logro prerequisito' })
  prerequisite_id?: number | null;

  @ApiProperty({ description: 'Estado activo' })
  active: boolean;

  @ApiProperty({ description: 'Fecha de creación' })
  created_at: Date;

  @ApiProperty({ description: 'Fecha de última modificación' })
  modified_at: Date;
}
