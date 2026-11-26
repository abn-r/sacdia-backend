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
}
