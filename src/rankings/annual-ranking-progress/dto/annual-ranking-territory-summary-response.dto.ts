import { ApiProperty } from '@nestjs/swagger';

export class AnnualRankingTerritorySummaryRowDto {
  @ApiProperty({ description: 'Union or local field id', example: 12 })
  id!: number;

  @ApiProperty({ example: 'Asociación del Golfo' })
  name!: string;

  @ApiProperty({
    description:
      'Distinct active clubs with at least one active section in this child',
    example: 8,
  })
  clubs_count!: number;

  @ApiProperty({
    description:
      'True when an annual ranking config applies to the child for the year (own or inherited from its union; for a union, any of its local fields)',
    example: true,
  })
  configured!: boolean;

  @ApiProperty({
    description:
      'Distinct clubs of this child with at least one section whose snapshot points reach the gold tier ("oro") or better, using the live tier bands. Null when no annual-progress snapshot exists yet for the year or the gold tier is inactive.',
    example: 3,
    nullable: true,
    type: Number,
  })
  gold_or_better_count!: number | null;

  @ApiProperty({
    description:
      'ISO timestamp of the oldest annual-progress snapshot behind this row (nightly job). Null when the child has no snapshot rows.',
    example: '2026-11-26T02:05:11.000Z',
    nullable: true,
    type: String,
  })
  progress_calculated_at!: string | null;
}
