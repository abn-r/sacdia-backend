import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AchievementResponseDto } from './achievement-response.dto';

export class UserAchievementResponseDto {
  @ApiProperty({ description: 'ID único del progreso de logro del usuario' })
  user_achievement_id: number;

  @ApiProperty({ description: 'UUID del usuario' })
  user_id: string;

  @ApiProperty({ description: 'ID del logro' })
  achievement_id: number;

  @ApiProperty({ description: 'Valor de progreso actual' })
  progress_value: number;

  @ApiProperty({ description: 'Valor de progreso requerido para completar' })
  progress_target: number;

  @ApiPropertyOptional({ description: 'Metadatos adicionales de progreso' })
  progress_metadata?: Record<string, unknown> | null;

  @ApiProperty({ description: 'Indica si el logro fue completado' })
  completed: boolean;

  @ApiPropertyOptional({ description: 'Fecha y hora de completación' })
  completed_at?: Date | null;

  @ApiProperty({ description: 'Indica si el usuario fue notificado del logro' })
  notified: boolean;

  @ApiPropertyOptional({ description: 'ID del año eclesiástico al que pertenece (si aplica)' })
  ecclesiastical_year_id?: number | null;

  @ApiProperty({ description: 'Número de veces que el logro fue completado' })
  times_completed: number;

  @ApiProperty({ description: 'Estado activo del registro' })
  active: boolean;

  @ApiProperty({ description: 'Fecha de creación' })
  created_at: Date;

  @ApiProperty({ description: 'Fecha de última modificación' })
  modified_at: Date;

  @ApiPropertyOptional({ description: 'Detalle del logro', type: () => AchievementResponseDto })
  achievement?: AchievementResponseDto;
}
