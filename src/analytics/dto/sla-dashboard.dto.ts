import { ApiProperty } from '@nestjs/swagger';

// ─── Investiture Pipeline ────────────────────────────────────────────────────

export class InvestiturePipelineItemDto {
  @ApiProperty({
    description: 'Investiture status value',
    example: 'SUBMITTED_FOR_VALIDATION',
  })
  declare status: string;

  @ApiProperty({
    description: 'Human-readable label',
    example: 'Enviado para validación',
  })
  declare label: string;

  @ApiProperty({
    description: 'Count of enrollments in this status',
    example: 42,
  })
  declare count: number;
}

export class InvestitureSummaryDto {
  @ApiProperty({
    description: 'Total active enrollments (non-invested, non-rejected)',
    example: 120,
  })
  declare total_pending: number;

  @ApiProperty({
    description: 'Enrollments submitted but not yet approved at any stage',
    example: 35,
  })
  declare in_review: number;

  @ApiProperty({
    description: 'Enrollments past submission deadline or stalled >90 days',
    example: 8,
  })
  declare overdue: number;

  @ApiProperty({
    description: 'Breakdown of counts per investiture status',
    type: [InvestiturePipelineItemDto],
  })
  declare pipeline: InvestiturePipelineItemDto[];
}

// ─── Validation Summary ───────────────────────────────────────────────────────

export class ValidationSummaryDto {
  @ApiProperty({
    description: 'Class section progress records with status=PENDING',
    example: 28,
  })
  declare class_sections_pending: number;

  @ApiProperty({
    description: 'Users honors records with validation_status=pending',
    example: 15,
  })
  declare honors_pending: number;

  @ApiProperty({ description: 'Total pending validation items', example: 43 })
  declare total_pending: number;
}

// ─── Camporee Summary ─────────────────────────────────────────────────────────

export class CamporeeSummaryDto {
  @ApiProperty({
    description: 'Club registrations with status=registered (pending approval)',
    example: 12,
  })
  declare clubs_pending: number;

  @ApiProperty({
    description:
      'Member registrations with status=registered (pending approval)',
    example: 87,
  })
  declare members_pending: number;

  @ApiProperty({
    description: 'Payment records with status=registered (pending approval)',
    example: 34,
  })
  declare payments_pending: number;
}

// ─── Timing Metrics ───────────────────────────────────────────────────────────

export class TimingMetricsDto {
  @ApiProperty({
    description: 'Average days from IN_PROGRESS to SUBMITTED_FOR_VALIDATION',
    example: 14.5,
    nullable: true,
  })
  declare avg_days_to_submit: number | null;

  @ApiProperty({
    description: 'Average days from SUBMITTED to CLUB_APPROVED',
    example: 3.2,
    nullable: true,
  })
  declare avg_days_club_approval: number | null;

  @ApiProperty({
    description: 'Average days from CLUB_APPROVED to COORDINATOR_APPROVED',
    example: 5.8,
    nullable: true,
  })
  declare avg_days_coordinator_approval: number | null;

  @ApiProperty({
    description: 'Average days from COORDINATOR_APPROVED to FIELD_APPROVED',
    example: 7.1,
    nullable: true,
  })
  declare avg_days_field_approval: number | null;

  @ApiProperty({
    description: 'Overall average days from enrollment to invested',
    example: 62.4,
    nullable: true,
  })
  declare avg_days_total: number | null;
}

// ─── Throughput ───────────────────────────────────────────────────────────────

export class ThroughputWeekDto {
  @ApiProperty({
    description: 'ISO week label (YYYY-Www)',
    example: '2026-W10',
  })
  declare week: string;

  @ApiProperty({
    description:
      'Number of investitures approved (FIELD_APPROVED) in this week',
    example: 5,
  })
  declare approved: number;

  @ApiProperty({
    description: 'Number of investitures rejected in this week',
    example: 1,
  })
  declare rejected: number;
}

// ─── Approval Rate ────────────────────────────────────────────────────────────

export class ApprovalRateDto {
  @ApiProperty({
    description:
      'Total resolved enrollments (approved + rejected) in last 90 days',
    example: 50,
  })
  declare resolved: number;

  @ApiProperty({ description: 'Approved count in last 90 days', example: 45 })
  declare approved: number;

  @ApiProperty({
    description: 'Approval rate as percentage 0-100',
    example: 90.0,
  })
  declare rate: number;
}

// ─── Root DTO ────────────────────────────────────────────────────────────────

export class SlaDashboardDto {
  @ApiProperty({
    description: 'Investiture pipeline summary',
    type: InvestitureSummaryDto,
  })
  declare investiture: InvestitureSummaryDto;

  @ApiProperty({
    description: 'Validation queue summary',
    type: ValidationSummaryDto,
  })
  declare validation: ValidationSummaryDto;

  @ApiProperty({
    description: 'Camporee approval queue summary',
    type: CamporeeSummaryDto,
  })
  declare camporee: CamporeeSummaryDto;

  @ApiProperty({
    description: 'Stage-level timing metrics',
    type: TimingMetricsDto,
  })
  declare timing: TimingMetricsDto;

  @ApiProperty({
    description: '12-week throughput time series',
    type: [ThroughputWeekDto],
  })
  declare throughput: ThroughputWeekDto[];

  @ApiProperty({
    description: 'Approval rate for last 90 days',
    type: ApprovalRateDto,
  })
  declare approval_rate: ApprovalRateDto;

  @ApiProperty({
    description: 'ISO timestamp when this data was computed',
    example: '2026-03-25T10:00:00.000Z',
  })
  declare computed_at: string;

  @ApiProperty({
    description: 'Whether this result was served from cache',
    example: false,
  })
  declare cached: boolean;
}
