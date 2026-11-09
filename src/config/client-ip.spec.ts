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

describe('resolveClientIp admin proxy headers', () => {
  const SECRET = 'a'.repeat(40);
  const original = process.env.ADMIN_PROXY_SECRET;

  const build = (headers: Record<string, string | string[] | undefined>) => ({
    ip: '76.76.21.1',
    headers,
  });

  beforeEach(() => {
    process.env.ADMIN_PROXY_SECRET = SECRET;
  });

  afterAll(() => {
    if (original === undefined) {
      delete process.env.ADMIN_PROXY_SECRET;
    } else {
      process.env.ADMIN_PROXY_SECRET = original;
    }
  });

  it('ignores the headers when no secret is configured', () => {
    delete process.env.ADMIN_PROXY_SECRET;
    expect(
      resolveClientIp(
        build({
          'x-sacdia-client-ip': '203.0.113.9',
          'x-sacdia-proxy-secret': SECRET,
        }),
      ),
    ).toBe('76.76.21.1');
  });

  it('uses the forwarded IPv4 when the secret matches', () => {
    expect(
      resolveClientIp(
        build({
          'x-sacdia-client-ip': ' 203.0.113.9 ',
          'x-sacdia-proxy-secret': SECRET,
        }),
      ),
    ).toBe('203.0.113.9');
  });

  it('uses the forwarded IPv6 when the secret matches', () => {
    expect(
      resolveClientIp(
        build({
          'x-sacdia-client-ip': '2001:db8::1',
          'x-sacdia-proxy-secret': SECRET,
        }),
      ),
    ).toBe('2001:db8::1');
  });

  it('falls back to req.ip on a wrong secret', () => {
    expect(
      resolveClientIp(
        build({
          'x-sacdia-client-ip': '203.0.113.9',
          'x-sacdia-proxy-secret': 'b'.repeat(40),
        }),
      ),
    ).toBe('76.76.21.1');
  });

  it('falls back to req.ip when the secret header is missing', () => {
    expect(
      resolveClientIp(build({ 'x-sacdia-client-ip': '203.0.113.9' })),
    ).toBe('76.76.21.1');
  });

  it('falls back to req.ip on a secret of different length without throwing', () => {
    expect(
      resolveClientIp(
        build({
          'x-sacdia-client-ip': '203.0.113.9',
          'x-sacdia-proxy-secret': 'short',
        }),
      ),
    ).toBe('76.76.21.1');
  });

  it.each(['not-an-ip', '1.2.3.4, 5.6.7.8', ''])(
    'falls back to req.ip on invalid IP value %p',
    (value) => {
      expect(
        resolveClientIp(
          build({
            'x-sacdia-client-ip': value,
            'x-sacdia-proxy-secret': SECRET,
          }),
        ),
      ).toBe('76.76.21.1');
    },
  );

  it('takes the first element of array header values', () => {
    expect(
      resolveClientIp(
        build({
          'x-sacdia-client-ip': ['203.0.113.9', '198.51.100.1'],
          'x-sacdia-proxy-secret': [SECRET, 'other'],
        }),
      ),
    ).toBe('203.0.113.9');
  });
});
