import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Camporee event status enum — mirrors Prisma CamporeeEventStatus
export enum CamporeeEventStatusDto {
  programado = 'programado',
  publicado = 'publicado',
  en_curso = 'en_curso',
  realizado = 'realizado',
  cancelado = 'cancelado',
}

export type CamporeeEventStaffAssignmentRole =
  | 'responsible'
  | 'assistant'
  | 'evaluator'
  | 'support';

export class CamporeeEventStaffAssignmentDto {
  @ApiProperty({ example: '0d8901fd-8c8f-4c1c-bd8a-d7c9b51f7777' })
  @IsUUID()
  declare camporee_staff_member_id: string;

  @ApiProperty({ enum: ['responsible', 'assistant', 'evaluator', 'support'] })
  @IsIn(['responsible', 'assistant', 'evaluator', 'support'])
  declare assignment_role: CamporeeEventStaffAssignmentRole;

  @ApiPropertyOptional({ example: 'Responsable de estación' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare title_override?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  declare display_order?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  declare notes?: string;
}

export class ReplaceCamporeeEventStaffAssignmentsDto {
  @ApiProperty({ type: [CamporeeEventStaffAssignmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CamporeeEventStaffAssignmentDto)
  declare assignments: CamporeeEventStaffAssignmentDto[];
}

export class CamporeeEventScheduleBlockAssignmentDto {
  @ApiPropertyOptional({ example: 123 })
  @IsOptional()
  @IsInt()
  @Min(1)
  camporee_club_id?: number;

  @ApiProperty({ example: 456 })
  @IsInt()
  @Min(1)
  declare club_section_id: number;
}

export class CamporeeEventScheduleBlockDto {
  @ApiPropertyOptional({ example: 'Primer bloque' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  declare day_number: number;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'starts_at must be in HH:MM format (e.g. 12:00)',
  })
  starts_at?: string;

  @ApiPropertyOptional({ example: '16:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'ends_at must be in HH:MM format (e.g. 16:00)',
  })
  ends_at?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  venue_id?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({ example: 17 })
  @IsOptional()
  @IsInt()
  @Min(0)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    type: [CamporeeEventScheduleBlockAssignmentDto],
    description:
      'Optional club-section assignments. Empty means the block is general for all eligible sections.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CamporeeEventScheduleBlockAssignmentDto)
  assignments?: CamporeeEventScheduleBlockAssignmentDto[];
}

export class ReplaceCamporeeEventScheduleBlocksDto {
  @ApiProperty({ type: [CamporeeEventScheduleBlockDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CamporeeEventScheduleBlockDto)
  declare blocks: CamporeeEventScheduleBlockDto[];
}

export class CreateCamporeeEventDto {
  @ApiPropertyOptional({
    example: 1,
    description:
      'FK to camporee_event_types. When omitted, the service resolves the "general" event type for agenda events.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  declare event_type_id?: number;

  @ApiProperty({ example: 'Orden Cerrado' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  declare title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requirements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  development?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prerequisites?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  materials?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  auxiliaries?: string;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(0)
  declare max_points: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_points?: number;

  @ApiPropertyOptional({ example: [] })
  @IsOptional()
  penalties?: object[];

  @ApiProperty({ example: 'count', enum: ['count', 'by_class'] })
  @IsString()
  @IsIn(['count', 'by_class'])
  declare participants_mode: string;

  @ApiPropertyOptional({ example: 8 })
  @ValidateIf((o) => o.participants_mode === 'count')
  @IsInt()
  @Min(1)
  participants_count?: number;

  @ApiPropertyOptional({ example: [{ class_id: 1, count: 4 }] })
  @ValidateIf((o) => o.participants_mode === 'by_class')
  participants_by_class?: object[];

  @ApiPropertyOptional({ example: 1800 })
  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // ── Agenda fields (camporee-agenda-events) ──────────────────────────────

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  day_number?: number;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'starts_at must be in HH:MM format (e.g. 09:00)',
  })
  starts_at?: string;

  @ApiPropertyOptional({ example: '10:30' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'ends_at must be in HH:MM format (e.g. 10:30)',
  })
  ends_at?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  venue_id?: number;

  @ApiPropertyOptional({ example: 'abc-123-uuid' })
  @IsOptional()
  @IsUUID()
  leader_user_id?: string;

  @ApiPropertyOptional({ example: 'Dr. Roberto Gimenez' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  leader_name_override?: string;

  @ApiPropertyOptional({ example: 'Director de Juegos' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  leader_role?: string;

  @ApiPropertyOptional({
    example: ['pathfinders'],
    enum: ['adventurers', 'pathfinders', 'master_guides'],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn(['adventurers', 'pathfinders', 'master_guides'], { each: true })
  sections?: string[];

  @ApiPropertyOptional({
    example: 'competencia',
    enum: [
      'espiritual',
      'competencia',
      'taller',
      'ceremonial',
      'social',
      'logistico',
    ],
  })
  @IsOptional()
  @IsIn([
    'espiritual',
    'competencia',
    'taller',
    'ceremonial',
    'social',
    'logistico',
  ])
  display_category?: string;

  @ApiPropertyOptional({ enum: CamporeeEventStatusDto })
  @IsOptional()
  @IsEnum(CamporeeEventStatusDto)
  status?: CamporeeEventStatusDto;

  @ApiPropertyOptional({ example: 40, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  capacity?: number;

  @ApiPropertyOptional({ example: 12, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  registered_count?: number;

  @ApiPropertyOptional({ type: [CamporeeEventScheduleBlockDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CamporeeEventScheduleBlockDto)
  schedule_blocks?: CamporeeEventScheduleBlockDto[];
}

export class CloneFromTemplateDto {
  @ApiPropertyOptional({ description: 'Override title from template' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({ description: 'Override max_points from template' })
  @IsOptional()
  @IsInt()
  @Min(0)
  max_points?: number;

  @ApiPropertyOptional({ description: 'Override display_order' })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;
}

export class UpdateCamporeeEventDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  event_type_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requirements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  development?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prerequisites?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  materials?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  auxiliaries?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  max_points?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_points?: number;

  @ApiPropertyOptional()
  @IsOptional()
  penalties?: object[];

  @ApiPropertyOptional({ enum: ['count', 'by_class'] })
  @IsOptional()
  @IsString()
  @IsIn(['count', 'by_class'])
  participants_mode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  participants_count?: number;

  @ApiPropertyOptional()
  @IsOptional()
  participants_by_class?: object[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // ── Agenda fields (camporee-agenda-events) ──────────────────────────────

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  day_number?: number;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'starts_at must be in HH:MM format',
  })
  starts_at?: string;

  @ApiPropertyOptional({ example: '10:30' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'ends_at must be in HH:MM format',
  })
  ends_at?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  venue_id?: number;

  @ApiPropertyOptional({ example: 'abc-123-uuid' })
  @IsOptional()
  @IsUUID()
  leader_user_id?: string;

  @ApiPropertyOptional({ example: 'Dr. Roberto Gimenez' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  leader_name_override?: string;

  @ApiPropertyOptional({ example: 'Director de Juegos' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  leader_role?: string;

  @ApiPropertyOptional({
    example: ['pathfinders'],
    enum: ['adventurers', 'pathfinders', 'master_guides'],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn(['adventurers', 'pathfinders', 'master_guides'], { each: true })
  sections?: string[];

  @ApiPropertyOptional({
    example: 'competencia',
    enum: [
      'espiritual',
      'competencia',
      'taller',
      'ceremonial',
      'social',
      'logistico',
    ],
  })
  @IsOptional()
  @IsIn([
    'espiritual',
    'competencia',
    'taller',
    'ceremonial',
    'social',
    'logistico',
  ])
  display_category?: string;

  @ApiPropertyOptional({ enum: CamporeeEventStatusDto })
  @IsOptional()
  @IsEnum(CamporeeEventStatusDto)
  status?: CamporeeEventStatusDto;

  @ApiPropertyOptional({ example: 40, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  capacity?: number;

  @ApiPropertyOptional({ example: 12, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  registered_count?: number;

  @ApiPropertyOptional({ type: [CamporeeEventScheduleBlockDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CamporeeEventScheduleBlockDto)
  schedule_blocks?: CamporeeEventScheduleBlockDto[];
}

export class ReorderCamporeeEventDto {
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(0)
  declare display_order: number;
}
