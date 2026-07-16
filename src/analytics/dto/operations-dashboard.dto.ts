import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OperationsDashboardQueryDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ecclesiastical_year_id?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  division_id?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  union_id?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  local_field_id?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @ValidateIf(
    (value: OperationsDashboardQueryDto) =>
      value.report_month !== undefined || value.report_year !== undefined,
  )
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  report_year?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @ValidateIf(
    (value: OperationsDashboardQueryDto) =>
      value.report_year !== undefined || value.report_month !== undefined,
  )
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  report_month?: number;
}

export class OperationsDashboardScopePathNodeDto {
  @ApiProperty({ enum: ['division', 'union', 'local_field'] })
  level!: 'division' | 'union' | 'local_field';

  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;
}

export class OperationsDashboardScopeDto {
  @ApiProperty({ enum: ['all', 'division', 'union', 'local_field'] })
  level!: 'all' | 'division' | 'union' | 'local_field';

  @ApiProperty({ type: Number, nullable: true })
  id!: number | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [OperationsDashboardScopePathNodeDto] })
  path!: OperationsDashboardScopePathNodeDto[];
}

export class EcclesiasticalYearPeriodDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ format: 'date' })
  start_date!: string;

  @ApiProperty({ format: 'date' })
  end_date!: string;

  @ApiProperty()
  active!: boolean;
}

export class ReportingMonthPeriodDto {
  @ApiProperty()
  year!: number;

  @ApiProperty({ minimum: 1, maximum: 12 })
  month!: number;
}

export class OperationsDashboardPeriodDto {
  @ApiProperty({ type: EcclesiasticalYearPeriodDto })
  ecclesiastical_year!: EcclesiasticalYearPeriodDto;

  @ApiProperty({ type: ReportingMonthPeriodDto, nullable: true })
  reporting_month!: ReportingMonthPeriodDto | null;
}

export class OperationsDashboardMetaDto {
  @ApiProperty({ format: 'date-time' })
  computed_at!: string;

  @ApiProperty()
  cached!: boolean;

  @ApiProperty({ example: 60 })
  cache_ttl_seconds!: number;

  @ApiProperty({ example: '1' })
  definitions_version!: string;

  @ApiProperty({ type: OperationsDashboardScopeDto })
  scope!: OperationsDashboardScopeDto;

  @ApiProperty({ type: OperationsDashboardPeriodDto })
  period!: OperationsDashboardPeriodDto;
}

export class AdministrativeClubsMetricsDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  active!: number;

  @ApiProperty()
  inactive!: number;
}

export class OperationsMetricsDto {
  @ApiProperty()
  operational_clubs!: number;

  @ApiProperty()
  non_operational_clubs!: number;

  @ApiProperty()
  operational_sections!: number;

  @ApiProperty({ type: Number, nullable: true })
  operational_rate_pct!: number | null;
}

export class PlatformAccountsMetricsDto {
  @ApiProperty()
  active!: number;

  @ApiProperty()
  inactive!: number;
}

export class PeopleMetricsDto {
  @ApiProperty()
  institutionally_active!: number;

  @ApiProperty({ type: PlatformAccountsMetricsDto })
  platform_accounts!: PlatformAccountsMetricsDto;
}

export class ClassBreakdownItemDto {
  @ApiProperty()
  class_id!: number;

  @ApiProperty()
  class_name!: string;

  @ApiProperty()
  club_type_id!: number;

  @ApiProperty()
  club_type_name!: string;

  @ApiProperty()
  display_order!: number;

  @ApiProperty()
  enrollment_count!: number;
}

export class ClassesMetricsDto {
  @ApiProperty()
  total_enrollments!: number;

  @ApiProperty()
  distinct_people!: number;

  @ApiProperty({ type: [ClassBreakdownItemDto] })
  by_class!: ClassBreakdownItemDto[];
}

export class MonthlyReportsMetricsDto {
  @ApiProperty()
  expected_sections!: number;

  @ApiProperty()
  submitted_sections!: number;

  @ApiProperty()
  draft_sections!: number;

  @ApiProperty()
  generated_sections!: number;

  @ApiProperty()
  missing_sections!: number;

  @ApiProperty({ type: Number, nullable: true })
  coverage_pct!: number | null;
}

export class HonorsMetricsDto {
  @ApiProperty({ type: Number, nullable: true })
  in_progress!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  pending_review!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  approved!: number | null;

  @ApiProperty({ enum: ['current_affiliation', 'unavailable'] })
  attribution!: 'current_affiliation' | 'unavailable';
}

export class ActivitiesMetricsDto {
  @ApiProperty({
    description: 'Actividades registradas; no implica ejecución.',
  })
  registered!: number;

  @ApiProperty()
  joint_registered!: number;

  @ApiProperty()
  distinct_participating_sections!: number;
}

export class QueuesMetricsDto {
  @ApiProperty()
  role_assignments_pending!: number;

  @ApiProperty()
  transfers_pending!: number;

  @ApiProperty()
  class_validations_pending!: number;

  @ApiProperty({ type: Number, nullable: true })
  honors_review_pending!: number | null;

  @ApiProperty()
  annual_folders_pending_union!: number;
}

export class OperationsDashboardSummaryDto {
  @ApiProperty({ type: AdministrativeClubsMetricsDto })
  administrative_clubs!: AdministrativeClubsMetricsDto;

  @ApiProperty({ type: OperationsMetricsDto })
  operations!: OperationsMetricsDto;

  @ApiProperty({ type: PeopleMetricsDto })
  people!: PeopleMetricsDto;

  @ApiProperty({ type: ClassesMetricsDto })
  classes!: ClassesMetricsDto;

  @ApiProperty({ type: MonthlyReportsMetricsDto })
  monthly_reports!: MonthlyReportsMetricsDto;

  @ApiProperty({ type: HonorsMetricsDto })
  honors!: HonorsMetricsDto;

  @ApiProperty({ type: ActivitiesMetricsDto })
  activities!: ActivitiesMetricsDto;

  @ApiProperty({ type: QueuesMetricsDto })
  queues!: QueuesMetricsDto;
}

export class OperationsDashboardChildDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['division', 'union', 'local_field', 'club'] })
  level!: 'division' | 'union' | 'local_field' | 'club';

  @ApiProperty({ type: AdministrativeClubsMetricsDto })
  administrative_clubs!: AdministrativeClubsMetricsDto;

  @ApiProperty({ type: OperationsMetricsDto })
  operations!: OperationsMetricsDto;

  @ApiProperty({ type: PeopleMetricsDto })
  people!: PeopleMetricsDto;

  @ApiProperty({ type: ClassesMetricsDto })
  classes!: ClassesMetricsDto;

  @ApiProperty({ type: MonthlyReportsMetricsDto })
  monthly_reports!: MonthlyReportsMetricsDto;

  @ApiProperty({ type: HonorsMetricsDto })
  honors!: HonorsMetricsDto;

  @ApiProperty({ type: ActivitiesMetricsDto })
  activities!: ActivitiesMetricsDto;

  @ApiProperty({ type: QueuesMetricsDto })
  queues!: QueuesMetricsDto;
}

export class OperationsDashboardDataQualityDto {
  @ApiProperty()
  metric!: string;

  @ApiProperty({
    enum: ['exact', 'current_affiliation', 'unavailable', 'not_applicable'],
  })
  status!: 'exact' | 'current_affiliation' | 'unavailable' | 'not_applicable';

  @ApiProperty()
  note!: string;
}

export class OperationsDashboardDto {
  @ApiProperty({ type: OperationsDashboardMetaDto })
  meta!: OperationsDashboardMetaDto;

  @ApiProperty({ type: OperationsDashboardSummaryDto })
  summary!: OperationsDashboardSummaryDto;

  @ApiProperty({ type: [OperationsDashboardChildDto] })
  children!: OperationsDashboardChildDto[];

  @ApiProperty({ type: [OperationsDashboardDataQualityDto] })
  data_quality!: OperationsDashboardDataQualityDto[];
}
