import { resolveTrustProxyHops } from './trust-proxy';

describe('resolveTrustProxyHops', () => {
  it('defaults to 1 in production when unset', () => {
    expect(resolveTrustProxyHops({ NODE_ENV: 'production' })).toBe(1);
  });

  it.each(['development', 'test', undefined])(
    'defaults to 0 when NODE_ENV is %s so local X-Forwarded-For is ignored',
    (NODE_ENV) => {
      expect(resolveTrustProxyHops({ NODE_ENV })).toBe(0);
    },
  );

  it.each(['0', '1', '2', '5'])('honors TRUST_PROXY_HOPS=%s', (hops) => {
    expect(
      resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: hops }),
    ).toBe(Number(hops));
  });

  it.each(['true', '-1', '1.5', '6', '1,2'])(
    'rejects TRUST_PROXY_HOPS=%s',
    (TRUST_PROXY_HOPS) => {
      expect(() =>
        resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS }),
      ).toThrow(/TRUST_PROXY_HOPS/);
    },
  );
});
