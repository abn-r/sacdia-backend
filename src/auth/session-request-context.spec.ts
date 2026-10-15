import { sessionContextFromRequest } from './session-request-context';

describe('sessionContextFromRequest', () => {
  it('uses req.ip (trust-proxy resolved) and the User-Agent header', () => {
    expect(
      sessionContextFromRequest({
        ip: '203.0.113.7',
        socket: { remoteAddress: '10.0.0.1' },
        headers: {
          'user-agent': 'Dart/3.11 (dart:io)',
          'x-forwarded-for': '1.2.3.4',
        },
      }),
    ).toEqual({ ipAddress: '203.0.113.7', userAgent: 'Dart/3.11 (dart:io)' });
  });

  it('falls back to the socket address when req.ip is missing', () => {
    expect(
      sessionContextFromRequest({ socket: { remoteAddress: '10.0.0.1' } }),
    ).toEqual({ ipAddress: '10.0.0.1', userAgent: undefined });
  });

  it('returns empty fields instead of the "unknown" placeholder', () => {
    expect(
      sessionContextFromRequest({ headers: { 'user-agent': '  ' } }),
    ).toEqual({ ipAddress: undefined, userAgent: undefined });
    expect(sessionContextFromRequest(undefined)).toEqual({
      ipAddress: undefined,
      userAgent: undefined,
    });
  });

  it('caps the stored User-Agent at 512 characters', () => {
    const ctx = sessionContextFromRequest({
      ip: '203.0.113.7',
      headers: { 'user-agent': 'a'.repeat(2000) },
    });
    expect(ctx.userAgent).toHaveLength(512);
  });
});
