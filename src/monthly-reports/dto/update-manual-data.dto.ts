import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { INT4_MAX } from '../../common/constants/int4.constants';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateManualDataDto {
  @ApiPropertyOptional({
    description: 'Reuniones de planificación realizadas',
    example: 2,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  planning_meetings?: number;

  @ApiPropertyOptional({
    description: 'Reuniones de padres realizadas',
    example: 1,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  parent_meetings?: number;

  @ApiPropertyOptional({
    description: 'Asistencia al consejo de jóvenes',
    example: 3,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  youth_council_attendance?: number;

  @ApiPropertyOptional({
    description: 'Asistencia a la junta de iglesia',
    example: 1,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  church_board_attendance?: number;

  @ApiPropertyOptional({
    description: 'Meta de almas',
    example: 5,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  soul_target?: number;

  @ApiPropertyOptional({
    description: 'Miembros no bautizados',
    example: 3,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  unbaptized_members?: number;

  @ApiPropertyOptional({
    description: 'Cantidad recibiendo estudios bíblicos',
    example: 4,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  bible_studies_receiving?: number;

  @ApiPropertyOptional({
    description: '¿Tiene instrucción bíblica semanal?',
    example: true,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsBoolean()
  has_weekly_bible_instruction?: boolean;

  @ApiPropertyOptional({
    description: '¿Se dieron estudios bíblicos?',
    example: true,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsBoolean()
  bible_studies_given?: boolean;

  @ApiPropertyOptional({
    description: '¿Se distribuyó literatura?',
    example: false,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsBoolean()
  literature_distributed?: boolean;

  @ApiPropertyOptional({
    description: 'Bautizados este mes',
    example: 1,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  baptized_this_month?: number;

  @ApiPropertyOptional({
    description: 'Total de bautizados acumulado',
    example: 3,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  total_baptized?: number;

  @ApiPropertyOptional({
    description: 'Descripción de participación del club',
    example: 'El club participó en el desfile de la ciudad',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  club_participation_description?: string | null;

  @ApiPropertyOptional({
    description: 'Descripción de servicio comunitario',
    example: 'Se realizó limpieza del parque municipal',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  community_service_description?: string | null;

  @ApiPropertyOptional({
    description: '¿Se entregaron certificados?',
    example: false,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsBoolean()
  certificates_delivered?: boolean;

  @ApiPropertyOptional({
    description: '¿Los miembros tienen libreta?',
    example: true,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsBoolean()
  members_have_booklet?: boolean;

  @ApiPropertyOptional({
    description: '¿Requisitos de libreta firmados?',
    example: false,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsBoolean()
  booklet_requirements_signed?: boolean;
}
