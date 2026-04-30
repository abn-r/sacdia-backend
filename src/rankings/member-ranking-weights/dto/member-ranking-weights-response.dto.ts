import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Public shape returned by all MemberRankingWeightsController endpoints.
 *
 * Decimal coercion: Prisma returns `Decimal` objects for the three pct fields.
 * `fromRow` converts them to plain JS numbers via `Number()`.
 */
export class MemberRankingWeightsResponseDto {
  @ApiProperty({ description: 'UUID primary key' })
  id!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Club type this weight applies to (null = all types)',
  })
  club_type_id!: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Ecclesiastical year this weight applies to (null = all years)',
  })
  ecclesiastical_year_id!: number | null;

  @ApiProperty({ description: 'Class progress weight percentage' })
  class_pct!: number;

  @ApiProperty({ description: 'Investiture weight percentage' })
  investiture_pct!: number;

  @ApiProperty({ description: 'Camporee weight percentage' })
  camporee_pct!: number;

  @ApiProperty({
    description:
      'True for the single global default row (NULL, NULL) seeded at migration',
  })
  is_default!: boolean;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  created_at!: string;

  @ApiProperty({ description: 'ISO 8601 last-modification timestamp' })
  modified_at!: string;

  /**
   * Map a raw Prisma row to the response DTO.
   *
   * - Decimal → Number coercion is applied to class_pct, investiture_pct, camporee_pct.
   * - Dates are converted to ISO strings.
   * - Unexpected extra fields from Prisma are stripped automatically because
   *   we construct a plain object literal here.
   */
  static fromRow(row: {
    id: string;
    club_type_id: number | null;
    ecclesiastical_year_id: number | null;
    class_pct: { toString(): string } | number;
    investiture_pct: { toString(): string } | number;
    camporee_pct: { toString(): string } | number;
    is_default: boolean;
    created_at: Date;
    modified_at: Date;
  }): MemberRankingWeightsResponseDto {
    const dto = new MemberRankingWeightsResponseDto();
    dto.id = row.id;
    dto.club_type_id = row.club_type_id;
    dto.ecclesiastical_year_id = row.ecclesiastical_year_id;
    dto.class_pct = Number(row.class_pct);
    dto.investiture_pct = Number(row.investiture_pct);
    dto.camporee_pct = Number(row.camporee_pct);
    dto.is_default = row.is_default;
    dto.created_at = row.created_at.toISOString();
    dto.modified_at = row.modified_at.toISOString();
    return dto;
  }
}
