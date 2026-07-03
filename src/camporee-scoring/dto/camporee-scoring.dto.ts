import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export type CamporeeScopeType = 'local' | 'union';
export type CamporeeJudgeRole = 'primary' | 'assistant';
export type CamporeeScoreSource =
  | 'judge_primary'
  | 'manual_lf'
  | 'admin_override';
export type CamporeeJudgeEligibilityReason =
  | 'adult'
  | 'pastor_role'
  | 'invested_master_guide';

export class CamporeeRubricItemDto {
  @ApiProperty({ example: 'Técnica' })
  @IsString()
  @MaxLength(120)
  declare title: string;

  @ApiPropertyOptional({ example: 'Ejecución correcta del procedimiento.' })
  @IsOptional()
  @IsString()
  declare description?: string;

  @ApiProperty({ example: 30 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  declare max_points: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  declare display_order?: number;
}

export class ReplaceCamporeeEventRubricsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  declare scoring_enabled: boolean;

  @ApiProperty({ type: [CamporeeRubricItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CamporeeRubricItemDto)
  declare items: CamporeeRubricItemDto[];
}

export class AddCamporeeJudgeDto {
  @ApiProperty({ example: '0d8901fd-8c8f-4c1c-bd8a-d7c9b51f7777' })
  @IsUUID()
  declare user_id: string;

  @ApiPropertyOptional({ example: 'Juez externo para nudos.' })
  @IsOptional()
  @IsString()
  declare notes?: string;
}

export class AssignCamporeeEventJudgeDto {
  @ApiProperty({ example: '0d8901fd-8c8f-4c1c-bd8a-d7c9b51f7777' })
  @IsUUID()
  declare camporee_judge_id: string;

  @ApiPropertyOptional({ example: 42 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare camporee_club_id?: number;

  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare club_section_id: number;

  @ApiProperty({ enum: ['primary', 'assistant'] })
  @IsIn(['primary', 'assistant'])
  declare judge_role: CamporeeJudgeRole;
}

export class UpdateCamporeeEventJudgeAssignmentDto {
  @ApiPropertyOptional({ enum: ['primary', 'assistant'] })
  @IsOptional()
  @IsIn(['primary', 'assistant'])
  declare judge_role?: CamporeeJudgeRole;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  declare active?: boolean;
}

export class SubmitCamporeeEventScoreItemDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare camporee_event_rubric_id: number;

  @ApiProperty({ example: 27.5 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  declare awarded_points: number;

  @ApiPropertyOptional({ example: 'Perdió puntos por tiempo.' })
  @IsOptional()
  @IsString()
  declare notes?: string;
}

export class SubmitCamporeeEventScoreDto {
  @ApiPropertyOptional({
    enum: ['judge_primary', 'manual_lf', 'admin_override'],
  })
  @IsOptional()
  @IsIn(['judge_primary', 'manual_lf', 'admin_override'])
  declare source?: CamporeeScoreSource;

  @ApiPropertyOptional({ example: 'Carga oficial por rúbrica.' })
  @IsOptional()
  @IsString()
  declare notes?: string;

  @ApiProperty({ type: [SubmitCamporeeEventScoreItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitCamporeeEventScoreItemDto)
  declare items: SubmitCamporeeEventScoreItemDto[];
}

export type CamporeeEventRubricResponseDto = {
  camporee_event_rubric_id: number;
  camporee_event_id: number;
  title: string;
  description: string | null;
  max_points: number;
  display_order: number;
  active: boolean;
};

export type CamporeeJudgeResponseDto = {
  camporee_judge_id: string;
  user_id: string;
  name: string | null;
  status: string;
  active: boolean;
};

export type CamporeeJudgeCandidateResponseDto = {
  user_id: string;
  email: string | null;
  name: string | null;
  paternal_last_name: string | null;
  maternal_last_name: string | null;
  full_name: string;
  user_image: string | null;
  active: boolean;
  access_app: boolean;
  access_panel: boolean;
  union: { union_id: number; name: string } | null;
  local_field: {
    local_field_id: number;
    union_id: number | null;
    name: string;
  } | null;
  roles: string[];
  camporee_judge_eligible: boolean;
  camporee_judge_eligibility_reasons: CamporeeJudgeEligibilityReason[];
};

export type CamporeeEventJudgeAssignmentResponseDto = {
  camporee_event_judge_assignment_id: string;
  camporee_event_id: number;
  camporee_judge_id: string;
  camporee_club_id: number | null;
  club_section_id: number;
  judge_role: CamporeeJudgeRole;
  active: boolean;
};

export type CamporeeEventSectionResultResponseDto = {
  camporee_event_section_result_id: string;
  camporee_event_id: number;
  camporee_club_id: number | null;
  club_section_id: number;
  source_submission_id: string;
  total_awarded_points: number;
  total_max_points: number;
  percentage: number;
  active: boolean;
};

export type CamporeeLeaderboardRowDto = {
  rank: number;
  camporee_club_id: number | null;
  club_section_id: number;
  club_name: string | null;
  section_name: string | null;
  total_awarded_points: number;
  total_max_points: number;
  percentage: number;
};

export type CamporeeLeaderboardResponseDto = {
  scope: { type: CamporeeScopeType; camporeeId: number };
  rows: CamporeeLeaderboardRowDto[];
};
