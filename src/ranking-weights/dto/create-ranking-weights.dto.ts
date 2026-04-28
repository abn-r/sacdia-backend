import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateRankingWeightsDto {
  @ApiPropertyOptional({
    description:
      'Club type ID for this override. Omit/null = default global (seeded, not creatable via API).',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  club_type_id?: number;

  @ApiProperty({ description: 'Weight for annual folders component (0–100)', example: 30 })
  @IsInt()
  @Min(0)
  @Max(100)
  folder_weight!: number;

  @ApiProperty({ description: 'Weight for finance component (0–100)', example: 25 })
  @IsInt()
  @Min(0)
  @Max(100)
  finance_weight!: number;

  @ApiProperty({ description: 'Weight for camporee component (0–100)', example: 25 })
  @IsInt()
  @Min(0)
  @Max(100)
  camporee_weight!: number;

  @ApiProperty({ description: 'Weight for evidence component (0–100)', example: 20 })
  @IsInt()
  @Min(0)
  @Max(100)
  evidence_weight!: number;
}
