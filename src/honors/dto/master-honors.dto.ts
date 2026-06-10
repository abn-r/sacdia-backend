import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { user_master_honor_status_enum } from '@prisma/client';

export type UserMasterHonorStatus = 'AWARDED' | 'REVOKED' | 'RETIRED';

export type UserMasterHonorDisplayStatusLabel = 'Vigente' | 'No vigente';

export class UserMasterHonorDto {
  @ApiProperty({ type: Number })
  user_master_honor_id!: number;

  @ApiProperty({ type: Number })
  master_honor_id!: number;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  master_image?: string | null;

  @ApiProperty({ enum: user_master_honor_status_enum })
  status!: UserMasterHonorStatus;

  @ApiProperty({ type: Boolean })
  is_current!: boolean;

  @ApiProperty({ enum: ['Vigente', 'No vigente'] })
  display_status_label!: UserMasterHonorDisplayStatusLabel;

  @ApiPropertyOptional({ type: String, nullable: true })
  awarded_at?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  revoked_at?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  recovered_at?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  status_reason?: string | null;
}

export class UserMasterHonorDetailDto extends UserMasterHonorDto {
  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: true,
  })
  evaluation_snapshot?: unknown;
}

export class UserMasterHonorRoadmapOptionDto {
  @ApiProperty({ type: Number })
  option_id!: number;

  @ApiProperty({ type: String })
  label!: string;

  @ApiProperty({ type: Boolean })
  completed!: boolean;

  @ApiProperty({ type: [Number] })
  honor_ids!: number[];

  @ApiProperty({ type: [Number] })
  completed_honor_ids!: number[];
}

export class UserMasterHonorRoadmapGroupDto {
  @ApiProperty({ type: Number })
  group_id!: number;

  @ApiProperty({ enum: ['EXPLICIT_OPTIONS', 'CATEGORY_COUNT'] })
  group_type!: 'EXPLICIT_OPTIONS' | 'CATEGORY_COUNT';

  @ApiPropertyOptional({ type: String, nullable: true })
  title?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  description?: string | null;

  @ApiProperty({ type: Number })
  minimum_required!: number;

  @ApiProperty({ type: Number })
  current_count!: number;

  @ApiProperty({ type: Boolean })
  passed!: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true })
  honors_category_id?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  category_name?: string | null;

  @ApiProperty({ type: [Number] })
  matched_honor_ids!: number[];

  @ApiProperty({ type: [UserMasterHonorRoadmapOptionDto] })
  options!: UserMasterHonorRoadmapOptionDto[];
}

export class UserMasterHonorRoadmapDto {
  @ApiProperty({ type: Number })
  master_honor_id!: number;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  master_image?: string | null;

  @ApiPropertyOptional({ enum: user_master_honor_status_enum, nullable: true })
  status?: UserMasterHonorStatus | null;

  @ApiProperty({ type: Boolean })
  is_current!: boolean;

  @ApiProperty({ type: Boolean })
  is_awarded!: boolean;

  @ApiPropertyOptional({ enum: ['Vigente', 'No vigente'], nullable: true })
  display_status_label?: UserMasterHonorDisplayStatusLabel | null;

  @ApiProperty({ type: Number })
  completed_groups!: number;

  @ApiProperty({ type: Number })
  total_groups!: number;

  @ApiProperty({ type: Number })
  progress_percent!: number;

  @ApiProperty({ type: [UserMasterHonorRoadmapGroupDto] })
  requirement_groups!: UserMasterHonorRoadmapGroupDto[];
}
