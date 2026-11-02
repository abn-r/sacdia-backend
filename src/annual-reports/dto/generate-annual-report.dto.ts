import { IsInt, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/constants/int4.constants';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateAnnualReportDto {
  @ApiProperty({ description: 'ID del club', example: 12, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  club_id!: number;

  @ApiProperty({
    description: 'ID del año eclesiástico',
    example: 3,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  ecclesiastical_year_id!: number;
}
