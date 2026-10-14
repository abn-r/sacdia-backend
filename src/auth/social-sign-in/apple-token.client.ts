import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, importPKCS8 } from 'jose';
import { AppServiceUnavailableException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const APPLE_AUDIENCE = 'https://appleid.apple.com';
/** Apple allows up to 6 months; we sign per call, so 5 minutes is plenty. */
const CLIENT_SECRET_TTL = '5m';

/** Upper bound for one call to appleid.apple.com. */
const REQUEST_TIMEOUT_MS = 10_000;

export const FETCH_IMPL = 'SOCIAL_SIGN_IN_FETCH';

/**
 * Apple answered the token or revoke endpoint with a non-2xx status.
 * `error` is the `error` field of Apple's JSON body (e.g. `invalid_grant`),
 * null when the body is not JSON.
 */
export class AppleTokenError extends Error {
  constructor(
    readonly operation: 'token' | 'revoke',
    readonly status: number,
    readonly error: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'AppleTokenError';
  }
}

/**
 * Server-to-Apple calls for Sign in with Apple.
 *
 * `client_secret` is a JWT signed with the .p8 key (ES256). Signing it per
 * request avoids the 6-month rotation a cached secret would need.
 *
 * Used for: exchanging the native `authorizationCode` for a `refresh_token`
 * (stored in accounts.refreshToken) and revoking it when the user deletes
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
    const response = await this.post('token', APPLE_TOKEN_URL, {
      grant_type: 'authorization_code',
      code,
    });
    const body = await this.readJson(response);
    return {
      refreshToken:
        typeof body.refresh_token === 'string' ? body.refresh_token : null,
    };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.post('revoke', APPLE_REVOKE_URL, {
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });
  }

  private async post(
    operation: 'token' | 'revoke',
    url: string,
    fields: Record<string, string>,
  ): Promise<Response> {
    const body = new URLSearchParams({
      client_id: this.required('APPLE_BUNDLE_ID'),
      client_secret: await this.clientSecret(),
      ...fields,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      // Network failure or TimeoutError: Apple is unreachable, not a client bug.
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.logger.warn(`Apple ${operation} endpoint unreachable: ${reason}`);
      throw new AppServiceUnavailableException(
        ErrorCode.AUTH_OAUTH_PROVIDER_UNAVAILABLE,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const error = parseAppleError(text);
      // Apple's error body is {"error":"invalid_grant"}; keep it, drop the rest.
      const detail = error ?? text.slice(0, 200);
      this.logger.warn(
        `Apple ${operation} endpoint answered ${response.status}: ${detail}`,
      );
      throw new AppleTokenError(
        operation,
        response.status,
        error,
        `Apple ${operation} endpoint ${response.status}: ${detail}`,
      );
    }
    return response;
  }

  /**
   * `fetch` resolves once the headers arrive, so the body can still fail: a
   * 200 that is not JSON (SyntaxError) or the 10 s abort firing mid-body
   * (TimeoutError / AbortError). Both mean Apple is misbehaving, not that the
   * caller sent something wrong, so they surface as 503 like a network error.
   */
  private async readJson(
    response: Response,
  ): Promise<{ refresh_token?: unknown }> {
    try {
      return (await response.json()) as { refresh_token?: unknown };
    } catch (cause) {
      // Match on `name`, not `instanceof`: undici raises these from another
      // realm (and under Jest's vm sandbox), so the constructors differ.
      const { name, message } = (cause ?? {}) as {
        name?: unknown;
        message?: unknown;
      };
      if (
        name === 'SyntaxError' ||
        name === 'TimeoutError' ||
        name === 'AbortError'
      ) {
        this.logger.warn(
          `Apple token endpoint body unreadable: ${String(name)}: ${String(message)}`,
        );
        throw new AppServiceUnavailableException(
          ErrorCode.AUTH_OAUTH_PROVIDER_UNAVAILABLE,
        );
      }
      throw cause;
    }
  }

  private required(name: string): string {
    const value = this.config.get<string>(name);
    if (!value) throw new Error(`${name} is not configured`);
    return value;
  }
}

function parseAppleError(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : null;
  } catch {
    return null;
  }
}
