import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  achievement_scope,
  achievement_tier,
  achievement_type,
} from '@prisma/client';

export class AchievementResponseDto {
  @ApiProperty({ description: 'ID único del logro' })
  declare achievement_id: number;

  @ApiProperty({ description: 'ID de la categoría' })
  declare category_id: number;

  @ApiProperty({ description: 'Nombre del logro' })
  declare name: string;

  @ApiProperty({ description: 'Descripción del logro' })
  declare description: string;

  @ApiProperty({
    description:
      'URL pública del badge. Retorna la URL del CDN cuando badge_image_key está presente, ' +
      'o la imagen por defecto cuando no hay badge asignado.',
  })
  declare badge_image_url: string;

  @ApiProperty({ description: 'Tipo de logro', enum: achievement_type })
  declare type: achievement_type;

  @ApiProperty({ description: 'Alcance del logro', enum: achievement_scope })
  declare scope: achievement_scope;

  @ApiProperty({ description: 'Nivel del logro', enum: achievement_tier })
  declare tier: achievement_tier;

  @ApiProperty({ description: 'Puntos que otorga el logro' })
  declare points: number;

  @ApiProperty({ description: 'Criterios de evaluación del logro' })
  declare criteria: Record<string, unknown>;

  @ApiProperty({ description: 'Logro secreto' })
  declare secret: boolean;

  @ApiProperty({ description: 'El logro puede obtenerse más de una vez' })
  declare repeatable: boolean;

  @ApiPropertyOptional({
    description: 'Número máximo de veces que se puede obtener',
  })
  max_repeats?: number | null;

  @ApiPropertyOptional({ description: 'ID del tipo de club al que aplica' })
  club_type_id?: number | null;

  @ApiPropertyOptional({ description: 'ID del logro prerequisito' })
  prerequisite_id?: number | null;

  @ApiProperty({ description: 'Estado activo' })
  declare active: boolean;

  @ApiProperty({ description: 'Fecha de creación' })
  declare created_at: Date;

  @ApiProperty({ description: 'Fecha de última modificación' })
  declare modified_at: Date;
}
