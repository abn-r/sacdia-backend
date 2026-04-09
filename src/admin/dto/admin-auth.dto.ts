import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

// ---------------------------------------------------------------------------
// Session DTOs
// ---------------------------------------------------------------------------

export class AdminSessionItemDto {
  @ApiProperty({ example: 'sess-uuid-abc123', description: 'Session ID' })
  sessionId!: string;

  @ApiProperty({ example: 'user-uuid-xyz', description: 'User ID' })
  userId!: string;

  @ApiProperty({ example: '2026-04-01T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-04-08T10:00:00.000Z' })
  expiresAt!: Date;

  @ApiPropertyOptional({
    nullable: true,
    example: '192.168.1.10',
    description: 'IP address of the session origin',
  })
  ipAddress!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
    description: 'User-Agent string of the session origin',
  })
  userAgent!: string | null;
}

export class AdminSessionListResponseDto {
  @ApiProperty({ example: 'user-uuid-xyz' })
  userId!: string;

  @ApiProperty({ example: 3 })
  totalSessions!: number;

  @ApiProperty({ type: [AdminSessionItemDto] })
  sessions!: AdminSessionItemDto[];
}

// ---------------------------------------------------------------------------
// MFA DTOs
// ---------------------------------------------------------------------------

export class AdminMfaStatusResponseDto {
  @ApiProperty({ example: 'user-uuid-xyz' })
  userId!: string;

  @ApiProperty({
    example: true,
    description: 'Whether the user has TOTP 2FA enrolled',
  })
  mfaEnabled!: boolean;
}

// ---------------------------------------------------------------------------
// Password DTOs
// ---------------------------------------------------------------------------

export class AdminSetPasswordDto {
  @ApiProperty({
    description: 'New password for the user (min 8, max 128 chars)',
    example: 'SecurePass1!',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
