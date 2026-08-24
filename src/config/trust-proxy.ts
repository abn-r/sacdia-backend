const MAX_TRUSTED_HOPS = 5;

/**
 * Express `trust proxy` hop count. Never `true` (that treats the leftmost
 * X-Forwarded-For as client and is spoofable).
 *
 * Render: client → Cloudflare → Render LB → app. Their Express docs still
 * set hops=1 because the platform rewrites X-Forwarded-For for the instance.
 * Extra hops (own Cloudflare orange-cloud) → set TRUST_PROXY_HOPS=2.
 * Hops too high lets the client spoof; hops too low share a proxy bucket.
 */
export function resolveTrustProxyHops(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (raw !== undefined && raw !== '') {
    if (!/^\d+$/.test(raw)) {
      throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5');
    }
    const hops = Number(raw);
    if (hops > MAX_TRUSTED_HOPS) {
      throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5');
    }
    return hops;
  }

  return env.NODE_ENV === 'production' ? 1 : 0;
}
