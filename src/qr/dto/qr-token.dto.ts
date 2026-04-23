import { ApiProperty } from '@nestjs/swagger';

export class QrMemberTokenDto {
  @ApiProperty({
    description:
      'HS256 JWT carrying `sub` (user_id), `aud` (sacdia:qr-member), and a 24 h expiry. ' +
      'Encode this string as-is into the QR payload.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  token!: string;

  @ApiProperty({
    description: 'ISO 8601 UTC timestamp at which the token expires.',
    example: '2026-04-24T12:34:56.000Z',
  })
  expires_at!: string;

  @ApiProperty({
    description: 'Seconds until expiry — convenience for clients that cache the token.',
    example: 86400,
  })
  expires_in!: number;
}
