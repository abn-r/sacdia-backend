import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/constants/int4.constants';
import { PERIODIC_REPORT_STATUSES } from '../../quarterly-reports/dto/list-quarterly-reports-query.dto';

export class ListAnnualReportsQueryDto {
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

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  ecclesiasticalYearId?: number;

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
