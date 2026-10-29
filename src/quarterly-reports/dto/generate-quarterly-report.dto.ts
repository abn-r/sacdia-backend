import { IsInt, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateQuarterlyReportDto {
  @ApiProperty({ description: 'ID del club', example: 12, minimum: 1 })
  @IsInt()
  @Min(1)
  club_id!: number;

  @ApiProperty({
    description: 'Año calendario del trimestre',
    example: 2026,
    minimum: 2020,
    maximum: 2100,
  })
  @IsInt()
  @Min(2020)
  @Max(2100)
  year!: number;

  @ApiProperty({
    description: 'Trimestre (1 a 4)',
    example: 3,
    minimum: 1,
    maximum: 4,
  })
  @IsInt()
  @Min(1)
  @Max(4)
  quarter!: number;
}
