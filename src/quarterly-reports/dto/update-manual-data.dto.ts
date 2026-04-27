import { IsInt, IsBoolean, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateQuarterlyManualDataDto {
  @ApiPropertyOptional({ description: 'Reuniones de planificación del trimestre', example: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  planning_meetings?: number;

  @ApiPropertyOptional({ description: 'Reuniones de padres del trimestre', example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  parent_meetings?: number;

  @ApiPropertyOptional({ description: 'Asistencia al consejo de jóvenes', example: 9 })
  @IsOptional()
  @IsInt()
  @Min(0)
  youth_council_attendance?: number;

  @ApiPropertyOptional({ description: 'Asistencia a la junta de iglesia', example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  church_board_attendance?: number;

  @ApiPropertyOptional({ description: 'Meta de almas del trimestre', example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  soul_target?: number;

  @ApiPropertyOptional({ description: 'Bautizados en el trimestre', example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  baptized_this_quarter?: number;

  @ApiPropertyOptional({ description: 'Descripción de participación del club', example: 'Participación en campamento distrital' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  club_participation_description?: string;

  @ApiPropertyOptional({ description: 'Descripción de servicio comunitario del trimestre', example: 'Limpieza de parques' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  community_service_description?: string;

  @ApiPropertyOptional({ description: 'Campamentos asistidos en el trimestre', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  camporees_attended?: number;

  @ApiPropertyOptional({ description: '¿Se entregaron certificados en el trimestre?', example: true })
  @IsOptional()
  @IsBoolean()
  certificates_delivered?: boolean;
}
