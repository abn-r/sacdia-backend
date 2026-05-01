import { IsNumber, IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMemberRankingWeightsDto {
  @ApiProperty({
    description: 'Percentage weight for class progress (0–100)',
    minimum: 0,
    maximum: 100,
    example: 50,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  class_pct!: number;

  @ApiProperty({
    description: 'Percentage weight for investiture status (0–100)',
    minimum: 0,
    maximum: 100,
    example: 30,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  investiture_pct!: number;

  @ApiProperty({
    description: 'Percentage weight for camporee score (0–100)',
    minimum: 0,
    maximum: 100,
    example: 20,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  camporee_pct!: number;

  @ApiPropertyOptional({
    description: 'Club type ID this weight applies to (null = all types)',
    type: Number,
    nullable: true,
    example: null,
  })
  @IsOptional()
  @IsInt()
  club_type_id?: number | null;

  @ApiPropertyOptional({
    description:
      'Ecclesiastical year ID this weight applies to (null = all years)',
    type: Number,
    nullable: true,
    example: null,
  })
  @IsOptional()
  @IsInt()
  ecclesiastical_year_id?: number | null;
}
