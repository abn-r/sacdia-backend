import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/constants/int4.constants';

export const PERIODIC_REPORT_STATUSES = ['draft', 'finalized'] as const;

export class ListQuarterlyReportsQueryDto {
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  divisionId?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  unionId?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  localFieldId?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  clubId?: number;

  @ApiPropertyOptional({ type: Number, example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quarter?: number;

  @ApiPropertyOptional({ enum: PERIODIC_REPORT_STATUSES })
  @IsOptional()
  @IsIn(PERIODIC_REPORT_STATUSES)
  status?: (typeof PERIODIC_REPORT_STATUSES)[number];

  @ApiPropertyOptional({ type: Number, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  page?: number;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
