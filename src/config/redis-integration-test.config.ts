const CI_REDIS_CONFIGURATION_ERROR =
  'CI Redis integration requires ALLOW_REDIS_INTEGRATION=1 and REDIS_INTEGRATION_URL';

export function resolveRedisIntegrationUrl(
  env: NodeJS.ProcessEnv,
): string | undefined {
  const enabled = env.ALLOW_REDIS_INTEGRATION === '1';
  const redisUrl = env.REDIS_INTEGRATION_URL;

  if (env.CI === 'true' && (!enabled || !redisUrl)) {
    throw new Error(CI_REDIS_CONFIGURATION_ERROR);
  }

  if (!enabled || !redisUrl) {
    return undefined;
  }

  const parsed = new URL(redisUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('Redis integration tests require a loopback URL');
  }

  return redisUrl;
}
