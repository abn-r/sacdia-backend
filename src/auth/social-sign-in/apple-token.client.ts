import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, importPKCS8 } from 'jose';

export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const APPLE_AUDIENCE = 'https://appleid.apple.com';
/** Apple allows up to 6 months; we sign per call, so 5 minutes is plenty. */
const CLIENT_SECRET_TTL = '5m';

export const FETCH_IMPL = 'SOCIAL_SIGN_IN_FETCH';

/**
 * Server-to-Apple calls for Sign in with Apple.
 *
 * `client_secret` is a JWT signed with the .p8 key (ES256). Signing it per
 * request avoids the 6-month rotation a cached secret would need.
 *
 * Used for: exchanging the native `authorizationCode` for a `refresh_token`
 * (stored in accounts.refresh_token) and revoking it when the user deletes
 * the account (App Store guideline 5.1.1(v)).
 */
@Injectable()
export class AppleTokenClient {
  private readonly logger = new Logger(AppleTokenClient.name);

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(FETCH_IMPL)
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async clientSecret(): Promise<string> {
    const teamId = this.required('APPLE_TEAM_ID');
    const keyId = this.required('APPLE_KEY_ID');
    const bundleId = this.required('APPLE_BUNDLE_ID');
    const pem = this.required('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n');
    const key = await importPKCS8(pem, 'ES256');
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setSubject(bundleId)
      .setAudience(APPLE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(CLIENT_SECRET_TTL)
      .sign(key);
  }

  /** Returns null when Apple did not include a refresh token. */
  async exchangeCode(code: string): Promise<{ refreshToken: string | null }> {
    const response = await this.post(APPLE_TOKEN_URL, {
      grant_type: 'authorization_code',
      code,
    });
    const body = (await response.json()) as { refresh_token?: unknown };
    return {
      refreshToken:
        typeof body.refresh_token === 'string' ? body.refresh_token : null,
    };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.post(APPLE_REVOKE_URL, {
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });
  }

  private async post(
    url: string,
    fields: Record<string, string>,
  ): Promise<Response> {
    const body = new URLSearchParams({
      client_id: this.required('APPLE_BUNDLE_ID'),
      client_secret: await this.clientSecret(),
      ...fields,
    });
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      // Apple's error body is {"error":"invalid_grant"}; keep it, drop the rest.
      const reason = text.slice(0, 200);
      this.logger.warn(`Apple ${url} answered ${response.status}: ${reason}`);
      throw new Error(`Apple token endpoint ${response.status}: ${reason}`);
    }
    return response;
  }

  private required(name: string): string {
    const value = this.config.get<string>(name);
    if (!value) throw new Error(`${name} is not configured`);
    return value;
  }
}
