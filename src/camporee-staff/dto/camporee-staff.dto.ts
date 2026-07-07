import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export type CamporeeScopeType = 'local' | 'union';
export type CamporeeStaffCategory =
  | 'judge'
  | 'administrative'
  | 'kitchen'
  | 'support'
  | 'spiritual'
  | 'leadership'
  | 'other';

export const CAMPOREE_STAFF_CATEGORIES: CamporeeStaffCategory[] = [
  'judge',
  'administrative',
  'kitchen',
  'support',
  'spiritual',
  'leadership',
  'other',
];

export class AddCamporeeStaffMemberDto {
  @ApiProperty({ example: '0d8901fd-8c8f-4c1c-bd8a-d7c9b51f7777' })
  @IsUUID()
  declare user_id: string;

  @ApiProperty({ enum: CAMPOREE_STAFF_CATEGORIES })
  @IsIn(CAMPOREE_STAFF_CATEGORIES)
  declare category: CamporeeStaffCategory;

  @ApiPropertyOptional({ example: 'Coordinador de cocina' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare role_label?: string;

  @ApiPropertyOptional({ example: 'Disponible en turno de tarde.' })
  @IsOptional()
  @IsString()
  declare notes?: string;
}

export class UpdateCamporeeStaffMemberDto {
  @ApiPropertyOptional({ enum: CAMPOREE_STAFF_CATEGORIES })
  @IsOptional()
  @IsIn(CAMPOREE_STAFF_CATEGORIES)
  declare category?: CamporeeStaffCategory;

  @ApiPropertyOptional({ example: 'Responsable de logística' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare role_label?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  declare notes?: string | null;

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  declare status?: 'active' | 'inactive';

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  declare active?: boolean;
}

export type CamporeeStaffUserSummaryDto = {
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
};

export type CamporeeStaffMemberResponseDto = {
  camporee_staff_member_id: string;
  local_camporee_id: number | null;
  union_camporee_id: number | null;
  user_id: string;
  category: CamporeeStaffCategory;
  role_label: string | null;
  notes: string | null;
  status: string;
  active: boolean;
  user: CamporeeStaffUserSummaryDto | null;
};

export type CamporeeStaffCandidateResponseDto = CamporeeStaffUserSummaryDto & {
  already_staff_member_id: string | null;
};
