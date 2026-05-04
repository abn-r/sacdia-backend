import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type DataExportStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'expired';

export class DataExportItemDto {
  @ApiProperty({ example: 'uuid-v4' })
  declare export_id: string;

  @ApiProperty({
    enum: ['pending', 'processing', 'ready', 'failed', 'expired'],
  })
  declare status: DataExportStatus;

  @ApiProperty({ enum: ['json'] })
  declare format: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  declare file_size_bytes: number | null;

  @ApiProperty({ example: '2026-04-17T20:00:00.000Z' })
  declare created_at: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  declare completed_at: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  declare expires_at: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  declare failure_reason: string | null;
}

export class DataExportListResponseDto {
  @ApiProperty({ type: [DataExportItemDto] })
  declare exports: DataExportItemDto[];
}

export class DataExportDownloadResponseDto {
  @ApiProperty({ description: 'Presigned R2 URL valid for 15 minutes' })
  declare url: string;

  @ApiProperty({ example: '2026-04-17T20:15:00.000Z' })
  declare expires_at: string;
}

export class DataExportCreateResponseDto {
  @ApiProperty({ example: 'uuid-v4' })
  declare export_id: string;

  @ApiProperty({
    enum: ['pending', 'processing', 'ready', 'failed', 'expired'],
  })
  declare status: DataExportStatus;

  @ApiProperty({ example: '2026-04-17T20:00:00.000Z' })
  declare created_at: string;
}

export class DataExportRateLimitResponseDto {
  @ApiProperty({
    description:
      'Seconds until the existing export expires and a new one can be requested',
  })
  declare retry_after_seconds: number;

  @ApiProperty({ example: 'uuid-v4' })
  declare export_id: string;
}
