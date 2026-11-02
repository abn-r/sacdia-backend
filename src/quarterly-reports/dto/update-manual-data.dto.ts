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

export class UpdateQuarterlyManualDataDto {
  @ApiPropertyOptional({
    description: 'Reuniones de planificación del trimestre',
    example: 6,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  planning_meetings?: number;

  @ApiPropertyOptional({
    description: 'Reuniones de padres del trimestre',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  parent_meetings?: number;

  @ApiPropertyOptional({
    description: 'Asistencia al consejo de jóvenes',
    example: 9,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  youth_council_attendance?: number;

  @ApiPropertyOptional({
    description: 'Asistencia a la junta de iglesia',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  church_board_attendance?: number;

  @ApiPropertyOptional({
    description: 'Meta de almas del trimestre',
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  soul_target?: number;

  @ApiPropertyOptional({
    description: 'Bautizados en el trimestre',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  baptized_this_quarter?: number;

  @ApiPropertyOptional({
    description: 'Descripción de participación del club',
    example: 'Participación en campamento distrital',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  club_participation_description?: string;

  @ApiPropertyOptional({
    description: 'Descripción de servicio comunitario del trimestre',
    example: 'Limpieza de parques',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  community_service_description?: string;

  @ApiPropertyOptional({
    description: 'Campamentos asistidos en el trimestre',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  camporees_attended?: number;

  @ApiPropertyOptional({
    description: '¿Se entregaron certificados en el trimestre?',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  certificates_delivered?: boolean;
}
