import type { ThrottlerOptions } from '@nestjs/throttler';

const configuredThrottlerNames = ['short', 'medium', 'long'] as const;

type NamedThrottleOptions = Pick<ThrottlerOptions, 'ttl' | 'limit'>;

export function namedThrottle(
  options: NamedThrottleOptions,
): Record<(typeof configuredThrottlerNames)[number], NamedThrottleOptions> {
  return configuredThrottlerNames.reduce(
    (acc, name) => ({ ...acc, [name]: { ...options } }),
    {} as Record<
      (typeof configuredThrottlerNames)[number],
      NamedThrottleOptions
    >,
  );
}
