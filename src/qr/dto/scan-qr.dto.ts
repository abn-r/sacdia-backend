import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

export class ScanQrDto {
  @ApiProperty({
    description:
      'HS256 JWT payload read from the scanned QR code. Validated against ' +
      'audience `sacdia:qr-member`, version, and expiry before use.',
  })
  @IsString()
  @MinLength(20)
  token!: string;

  @ApiPropertyOptional({
    description:
      'Optional activity id — when provided, the scan also appends the ' +
      'scanned member to `activities.attendees` and fires achievement ' +
      'events. Omit for a pure identity lookup.',
    example: 123,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  activity_id?: number;
}

export class ScanMemberDto {
  @ApiProperty() user_id!: string;
  @ApiProperty() full_name!: string;
  @ApiPropertyOptional({ nullable: true }) avatar!: string | null;
  @ApiPropertyOptional({ nullable: true }) club_name!: string | null;
  @ApiPropertyOptional({ nullable: true }) section_name!: string | null;
}

export class ScanAttendanceDto {
  @ApiProperty({ description: 'true when attendance was newly registered' })
  registered!: boolean;

  @ApiProperty({
    description: 'true when the user was already in the attendees list',
  })
  already_present!: boolean;

  @ApiProperty() activity_id!: number;
}

export class ScanResponseDto {
  @ApiProperty({ type: ScanMemberDto })
  member!: ScanMemberDto;

  @ApiPropertyOptional({ type: ScanAttendanceDto, nullable: true })
  attendance!: ScanAttendanceDto | null;

  @ApiProperty({
    description: 'ISO 8601 timestamp when the scan was processed',
    example: '2026-04-23T18:42:00.000Z',
  })
  scanned_at!: string;
}
