import { ApiProperty } from '@nestjs/swagger';

export class ClassMemberCountDto {
  @ApiProperty()
  class_id!: number;

  @ApiProperty()
  class_name!: string;

  @ApiProperty()
  display_order!: number;

  @ApiProperty()
  member_count!: number;
}

export class ClubTypeMemberBreakdownDto {
  @ApiProperty()
  club_type_id!: number;

  @ApiProperty()
  club_type_name!: string;

  @ApiProperty({ type: [ClassMemberCountDto] })
  classes!: ClassMemberCountDto[];
}

export class TimeWindowCountsDto {
  @ApiProperty()
  last_7_days!: number;

  @ApiProperty()
  last_30_days!: number;

  @ApiProperty()
  last_90_days!: number;
}

export class ActivityWindowCountsDto {
  @ApiProperty()
  last_7_days!: number;

  @ApiProperty()
  last_30_days!: number;

  @ApiProperty()
  last_365_days!: number;
}

export class ClubTypeHonorCountsDto {
  @ApiProperty()
  club_type_id!: number;

  @ApiProperty()
  club_type_name!: string;

  @ApiProperty({ type: TimeWindowCountsDto })
  completed!: TimeWindowCountsDto;
}

export class LocalFieldDashboardDto {
  @ApiProperty()
  local_field_id!: number;

  @ApiProperty()
  local_field_name!: string;

  @ApiProperty()
  ecclesiastical_year_id!: number;

  @ApiProperty({ nullable: true })
  ecclesiastical_year_label!: string | null;

  @ApiProperty()
  report_year!: number;

  @ApiProperty()
  report_month!: number;

  @ApiProperty()
  active_members!: number;

  @ApiProperty()
  active_clubs!: number;

  @ApiProperty()
  enrolled_clubs_this_year!: number;

  @ApiProperty()
  enrolled_sections_this_year!: number;

  @ApiProperty()
  clubs_with_monthly_report!: number;

  @ApiProperty()
  clubs_without_monthly_report!: number;

  @ApiProperty({ type: [ClubTypeMemberBreakdownDto] })
  members_by_club_type!: ClubTypeMemberBreakdownDto[];

  @ApiProperty({ type: [ClubTypeHonorCountsDto] })
  honors_completed_by_club_type!: ClubTypeHonorCountsDto[];

  @ApiProperty({ type: TimeWindowCountsDto })
  honors_completed_total!: TimeWindowCountsDto;

  @ApiProperty({ type: ActivityWindowCountsDto })
  activities!: ActivityWindowCountsDto;

  @ApiProperty()
  cached!: boolean;
}
