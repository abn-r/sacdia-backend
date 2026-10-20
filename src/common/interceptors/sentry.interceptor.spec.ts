import { redactBody } from './sentry.interceptor';

describe('redactBody', () => {
  it('redacts social sign-in credentials and keeps the rest', () => {
    const body = {
      idToken: 'eyJhbGciOi.id.token',
      id_token: 'snake.id.token',
      nonce: 'raw-nonce-replayable',
      authorizationCode: 'apple-auth-code',
      authorization_code: 'apple-auth-code-snake',
      fullName: { givenName: 'Ana' },
    };

    expect(redactBody(body)).toEqual({
      idToken: '[REDACTED]',
      id_token: '[REDACTED]',
      nonce: '[REDACTED]',
      authorizationCode: '[REDACTED]',
      authorization_code: '[REDACTED]',
      fullName: { givenName: 'Ana' },
    });
  });

  it('redacts the device pairing token and its QR payload (3b)', () => {
    expect(
      redactBody({
        pairing_token: 'abcdefghijklmnopqrstuv',
        qr_payload: 'sacdia://pair?t=abcdefghijklmnopqrstuv',
        platform: 'ios',
      }),
    ).toEqual({
      pairing_token: '[REDACTED]',
      qr_payload: '[REDACTED]',
      platform: 'ios',
    });
  });

  it('does not mutate the original body', () => {
    const body = { nonce: 'n' };
    redactBody(body);
    expect(body.nonce).toBe('n');
  });

  it('passes through non-object bodies', () => {
    expect(redactBody(undefined)).toBeUndefined();
    expect(redactBody('text')).toBe('text');
    expect(redactBody([{ nonce: 'n' }])).toEqual([{ nonce: 'n' }]);
  });
});
