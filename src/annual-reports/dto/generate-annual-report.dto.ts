import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateAnnualReportDto {
  @ApiProperty({ description: 'ID del club', example: 12, minimum: 1 })
  @IsInt()
  @Min(1)
  club_id!: number;

  @ApiProperty({
    description: 'ID del año eclesiástico',
    example: 3,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  ecclesiastical_year_id!: number;
}
