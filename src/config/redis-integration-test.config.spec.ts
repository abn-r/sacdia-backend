import { resolveRedisIntegrationUrl } from './redis-integration-test.config';

describe('resolveRedisIntegrationUrl', () => {
  it('fails closed in CI when Redis integration is not enabled', () => {
    expect(() =>
      resolveRedisIntegrationUrl({
        CI: 'true',
        REDIS_INTEGRATION_URL: 'redis://127.0.0.1:6379',
      }),
    ).toThrow(
      'CI Redis integration requires ALLOW_REDIS_INTEGRATION=1 and REDIS_INTEGRATION_URL',
    );
  });

  it('fails closed in CI when the Redis URL is missing', () => {
    expect(() =>
      resolveRedisIntegrationUrl({
        CI: 'true',
        ALLOW_REDIS_INTEGRATION: '1',
      }),
    ).toThrow(
      'CI Redis integration requires ALLOW_REDIS_INTEGRATION=1 and REDIS_INTEGRATION_URL',
    );
  });

  it('allows a local skip when Redis integration is not configured', () => {
    expect(resolveRedisIntegrationUrl({})).toBeUndefined();
  });

  it('accepts an enabled loopback Redis URL', () => {
    expect(
      resolveRedisIntegrationUrl({
        ALLOW_REDIS_INTEGRATION: '1',
        REDIS_INTEGRATION_URL: 'redis://127.0.0.1:6379',
      }),
    ).toBe('redis://127.0.0.1:6379');
  });
});
