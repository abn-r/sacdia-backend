import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { SupportReportStatus } from './query-support-reports.dto';

export class UpdateSupportReportStatusDto {
  @ApiProperty({ enum: SupportReportStatus })
  @IsEnum(SupportReportStatus)
  status!: SupportReportStatus;
}
