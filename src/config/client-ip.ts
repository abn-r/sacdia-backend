import { createHash, timingSafeEqual } from 'crypto';
import { isIP } from 'net';

/**
 * Client IP after Express `trust proxy` (see resolveTrustProxyHops).
 * Do not read X-Forwarded-For or X-Real-IP here — leftmost hops are spoofable.
 *
 * The only header honoured is the admin panel's: its server calls this API
 * from shared egress IPs, so it forwards the real client IP in
 * `x-sacdia-client-ip`, authenticated by the shared secret in
 * `x-sacdia-proxy-secret` (ADMIN_PROXY_SECRET). Without a valid secret both
 * headers are ignored.
 */
export const ADMIN_CLIENT_IP_HEADER = 'x-sacdia-client-ip';
export const ADMIN_PROXY_SECRET_HEADER = 'x-sacdia-proxy-secret';

export type ClientIpRequest = {
  ip?: unknown;
  socket?: { remoteAddress?: unknown };
  headers?: Record<string, string | string[] | undefined>;
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw : undefined;
}

// Compare SHA-256 digests so length differences don't leak or throw.
function secretMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function resolveAdminProxyIp(req: ClientIpRequest | null | undefined) {
  const expected = process.env.ADMIN_PROXY_SECRET;
  if (!expected || !req?.headers) {
    return undefined;
  }

  const presented = firstHeader(req.headers[ADMIN_PROXY_SECRET_HEADER]);
  if (!presented || !secretMatches(presented, expected)) {
    return undefined;
  }

  const ip = firstHeader(req.headers[ADMIN_CLIENT_IP_HEADER])?.trim();
  return ip && isIP(ip) !== 0 ? ip : undefined;
}

export function resolveClientIp(
  req: ClientIpRequest | null | undefined,
): string {
  const proxiedIp = resolveAdminProxyIp(req);
  if (proxiedIp) {
    return proxiedIp;
  }

  if (typeof req?.ip === 'string') {
    const ip = req.ip.trim();
    if (ip.length > 0) {
      return ip;
    }
  }

  const socketIp = req?.socket?.remoteAddress;
  if (typeof socketIp === 'string') {
    const ip = socketIp.trim();
    if (ip.length > 0) {
      return ip;
    }
  }

  return 'unknown';
}
