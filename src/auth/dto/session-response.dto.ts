import { ApiProperty } from '@nestjs/swagger';

/** Device type inferred from User-Agent string. */
export type DeviceType = 'ios' | 'android' | 'web' | 'unknown';

export class SessionItemDto {
  @ApiProperty({
    description: 'BA session DB row UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  declare session_id: string;

  @ApiProperty({
    description: 'Device type inferred from User-Agent',
    enum: ['ios', 'android', 'web', 'unknown'],
    example: 'ios',
  })
  declare device_type: DeviceType;

  @ApiProperty({
    description:
      'Human-readable device/browser name, null when not determinable',
    example: 'iPhone',
    nullable: true,
  })
  declare device_name: string | null;

  @ApiProperty({
    description: 'IP address of the session origin (may be masked)',
    example: '203.0.113.0',
    nullable: true,
  })
  declare ip_address: string | null;

  @ApiProperty({
    type: String,
    description: 'Geographic location — reserved for future GeoIP integration',
    example: null,
    nullable: true,
  })
  declare location: null;

  @ApiProperty({
    description: 'Raw User-Agent string, null when absent',
    example: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
    nullable: true,
  })
  declare user_agent: string | null;

  @ApiProperty({
    description: 'ISO 8601 timestamp when the session was created',
    example: '2026-04-17T10:00:00.000Z',
  })
  declare created_at: string;

  @ApiProperty({
    description:
      'ISO 8601 timestamp of last session update (proxy for last activity)',
    example: '2026-04-17T15:30:00.000Z',
  })
  declare last_active_at: string;

  @ApiProperty({
    description:
      'true when this session matches the session_id in the caller JWT (sid claim)',
  })
  declare is_current: boolean;

  @ApiProperty({
    description: 'ISO 8601 timestamp when the session expires',
    example: '2026-04-24T10:00:00.000Z',
  })
  declare expires_at: string;
}

export class SessionListResponseDto {
  @ApiProperty({
    type: [SessionItemDto],
    description: 'Active sessions for the authenticated user',
  })
  declare sessions: SessionItemDto[];

  @ApiProperty({
    description:
      'The session_id that matches the sid claim in the caller JWT. ' +
      'Null when the JWT was issued before the sid claim was introduced.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    nullable: true,
  })
  declare current_session_id: string | null;
}

export class RevokeAllSessionsResponseDto {
  @ApiProperty({
    description: 'Number of sessions revoked (excludes current session)',
    example: 3,
  })
  declare revoked_count: number;
}
