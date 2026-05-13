import { ApiProperty } from '@nestjs/swagger';

export class AttendanceDataPointDto {
  @ApiProperty({ description: 'Year of the record' })
  declare year: number;

  @ApiProperty({ description: 'Week number (1-52)' })
  declare week: number;

  @ApiProperty({ description: 'Average attendance percentage (0-100)' })
  declare avg_pct: number;
}

export class ScoreBreakdownItemDto {
  @ApiProperty()
  declare label: string;

  @ApiProperty({ description: 'Actual value percentage (0-100)' })
  declare value_pct: number;

  @ApiProperty({ description: 'Weight in total score formula (0-1)' })
  declare weight: number;
}

export class ClubScoreDto {
  @ApiProperty({ description: 'Composite score 0-100' })
  declare value: number;

  @ApiProperty({ description: 'Letter grade: A, B+, B, C+, C, D, F' })
  declare grade: string;

  @ApiProperty({ type: [ScoreBreakdownItemDto] })
  declare breakdown: ScoreBreakdownItemDto[];
}

export class UpcomingEventDto {
  @ApiProperty()
  declare activity_id: number;

  @ApiProperty()
  declare name: string;

  @ApiProperty({ nullable: true, type: String })
  declare kind: string | null;

  @ApiProperty({ nullable: true, type: String })
  declare activity_date: string | null;

  @ApiProperty({ nullable: true, type: String })
  declare section_name: string | null;
}

export class ClubFunnelDto {
  @ApiProperty({ description: 'Pending role assignment requests' })
  declare pending_requests: number;

  @ApiProperty({ description: 'Active unit members across all sections' })
  declare active_members: number;

  @ApiProperty({ description: 'Placeholder — investiture data not yet available' })
  declare investidos_year: number;
}

export class ClubOverviewResponseDto {
  @ApiProperty({
    nullable: true,
    type: [AttendanceDataPointDto],
    description: 'Attendance series last 12 months (week-level averages), null if no data',
  })
  declare attendance: AttendanceDataPointDto[] | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Numeric attendance average 0-100, null if no records',
  })
  declare attendance_average: number | null;

  @ApiProperty({ type: ClubScoreDto })
  declare score: ClubScoreDto;

  @ApiProperty({ type: [UpcomingEventDto] })
  declare upcoming_events: UpcomingEventDto[];

  @ApiProperty({ type: ClubFunnelDto })
  declare funnel: ClubFunnelDto;
}
