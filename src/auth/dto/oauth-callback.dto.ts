import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for the OAuth callback endpoint.
 *
 * After Better Auth processes the OAuth code exchange and sets a session cookie,
 * the client must POST the opaque BA session token (read from the cookie or
 * returned from the BA callback URL fragment) plus the provider name.
 *
 * The `code` / `state` fields are NOT handled here — BA's own HTTP handler
 * at `GET /api/auth/callback/{provider}` processes those server-to-provider
 * exchanges internally.  Our endpoint only finalises the SACDIA side once BA
 * has already created the session.
 */
export class OAuthCallbackDto {
  @ApiProperty({
    description:
      'Opaque Better Auth session token (returned after BA OAuth callback)',
    example: 'ba_session_abc123...',
  })
  @IsString()
  @IsNotEmpty()
  session_token: string;

  @ApiProperty({
    description: 'OAuth provider used (google, apple)',
    example: 'google',
  })
  @IsString()
  @IsNotEmpty()
  provider: string;

  @ApiProperty({
    description: 'Redirect URI used during OAuth initiation (must match)',
    example: 'https://sacdia.app/auth/callback',
    required: false,
  })
  @IsOptional()
  @IsString()
  redirect_uri?: string;
}
