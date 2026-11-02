import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { INT4_MAX } from '../../common/constants/int4.constants';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAnnualManualDataDto {
  @ApiPropertyOptional({
    description: 'Reuniones de planificación del año',
    example: 24,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  planning_meetings?: number;

  @ApiPropertyOptional({
    description: 'Reuniones de padres del año',
    example: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  parent_meetings?: number;

  @ApiPropertyOptional({ description: 'Bautizados en el año', example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  baptized_this_year?: number;

  @ApiPropertyOptional({
    description: 'Total de bautizados acumulado',
    example: 15,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  total_baptized?: number;

  @ApiPropertyOptional({
    description: 'Campamentos asistidos en el año',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  camporees_attended?: number;

  @ApiPropertyOptional({
    description: 'Descripción de logros anuales del club',
    example: 'Medalla de oro distrital',
  })
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  annual_achievements_description?: string;

  @ApiPropertyOptional({
    description: 'Descripción de servicio comunitario anual',
    example: 'Jornadas de limpieza trimestrales',
  })
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  community_service_description?: string;

  @ApiPropertyOptional({
    description: '¿Se realizaron todas las investiduras del año?',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  all_investitures_completed?: boolean;
}
