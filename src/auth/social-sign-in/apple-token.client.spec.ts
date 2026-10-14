import { ConfigService } from '@nestjs/config';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { AppServiceUnavailableException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  AppleTokenClient,
  AppleTokenError,
  APPLE_TOKEN_URL,
  APPLE_REVOKE_URL,
} from './apple-token.client';

describe('AppleTokenClient', () => {
  let client: AppleTokenClient;
  let fetchMock: jest.Mock;
  let publicKey: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    publicKey = pair.publicKey;
    const pem = await exportPKCS8(pair.privateKey);
    const config = new ConfigService({
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY1234567',
      APPLE_BUNDLE_ID: 'app.sacdia.mobile',
      // Render stores multi-line secrets with literal \n — the client must unescape.
      APPLE_PRIVATE_KEY: pem.replace(/\n/g, '\\n'),
    });
    fetchMock = jest.fn();
    client = new AppleTokenClient(config, fetchMock);
  });

  beforeEach(() => fetchMock.mockReset());

  it('signs a client_secret with ES256 and the Apple claims', async () => {
    const secret = await client.clientSecret();
    const { payload, protectedHeader } = await jwtVerify(secret, publicKey, {
      issuer: 'TEAM123456',
      audience: 'https://appleid.apple.com',
      subject: 'app.sacdia.mobile',
    });
    expect(protectedHeader).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    // iat and exp are both "now"-based; allow a 1 s boundary crossing.
    expect(Math.abs(payload.exp! - payload.iat! - 300)).toBeLessThanOrEqual(1);
  });

  it('exchanges an authorization code for a refresh token', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ refresh_token: 'rt-1', id_token: 'x' }), {
        status: 200,
      }),
    );

    await expect(client.exchangeCode('auth-code')).resolves.toEqual({
      refreshToken: 'rt-1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(APPLE_TOKEN_URL);
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('client_id')).toBe('app.sacdia.mobile');
    expect(body.get('client_secret')).toEqual(expect.any(String));
  });

  it('throws when the token endpoint answers non-2xx', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    const error = await client.exchangeCode('bad').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppleTokenError);
    expect(error).toMatchObject({
      operation: 'token',
      status: 400,
      error: 'invalid_grant',
      message: 'Apple token endpoint 400: invalid_grant',
    });
  });

  it('revokes a refresh token', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await expect(client.revoke('rt-1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(APPLE_REVOKE_URL);
    const body = new URLSearchParams(init.body as string);
    expect(body.get('token')).toBe('rt-1');
    expect(body.get('token_type_hint')).toBe('refresh_token');
  });

  it('throws when revoke answers non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 400 }));
    const error = await client.revoke('rt-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppleTokenError);
    expect(error).toMatchObject({
      operation: 'revoke',
      status: 400,
      error: null,
    });
    expect((error as AppleTokenError).message).toContain(
      'Apple revoke endpoint 400',
    );
  });

  it('passes a timeout signal to fetch', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await client.revoke('rt-1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a network failure to 503 AUTH_OAUTH_PROVIDER_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const error = await client.exchangeCode('code').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppServiceUnavailableException);
    expect((error as AppServiceUnavailableException).code).toBe(
      ErrorCode.AUTH_OAUTH_PROVIDER_UNAVAILABLE,
    );
  });

  it('maps a fetch timeout to 503 AUTH_OAUTH_PROVIDER_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(
      new DOMException('The operation timed out', 'TimeoutError'),
    );
    await expect(client.revoke('rt-1')).rejects.toBeInstanceOf(
      AppServiceUnavailableException,
    );
  });

  it('maps a non-JSON 200 body to 503 AUTH_OAUTH_PROVIDER_UNAVAILABLE', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
    const error = await client.exchangeCode('code').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppServiceUnavailableException);
    expect((error as AppServiceUnavailableException).code).toBe(
      ErrorCode.AUTH_OAUTH_PROVIDER_UNAVAILABLE,
    );
  });

  it('maps a timeout while reading the body to 503 AUTH_OAUTH_PROVIDER_UNAVAILABLE', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.reject(
          new DOMException('The operation timed out', 'TimeoutError'),
        ),
    });
    const error = await client.exchangeCode('code').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppServiceUnavailableException);
    expect((error as AppServiceUnavailableException).code).toBe(
      ErrorCode.AUTH_OAUTH_PROVIDER_UNAVAILABLE,
    );
  });

  it('throws a clear error when the Apple key config is missing', async () => {
    const bare = new AppleTokenClient(new ConfigService({}), fetchMock);
    await expect(bare.clientSecret()).rejects.toThrow('APPLE_TEAM_ID');
  });
});
