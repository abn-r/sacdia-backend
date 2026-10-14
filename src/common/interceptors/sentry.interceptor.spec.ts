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
