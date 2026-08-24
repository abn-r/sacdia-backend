import { resolveClientIp } from './client-ip';

describe('resolveClientIp', () => {
  it('prefers Express req.ip over spoofable forwarded headers', () => {
    expect(
      resolveClientIp({
        ip: '203.0.113.45',
        socket: { remoteAddress: '10.0.0.2' },
      }),
    ).toBe('203.0.113.45');
  });

  it('falls back to the socket address when req.ip is empty', () => {
    expect(
      resolveClientIp({
        ip: '   ',
        socket: { remoteAddress: '198.51.100.21' },
      }),
    ).toBe('198.51.100.21');
  });

  it('returns unknown when neither Express nor the socket has an IP', () => {
    expect(resolveClientIp({})).toBe('unknown');
    expect(resolveClientIp(undefined)).toBe('unknown');
  });
});
