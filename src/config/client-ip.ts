/**
 * Client IP after Express `trust proxy` (see resolveTrustProxyHops).
 * Do not read X-Forwarded-For or X-Real-IP here — leftmost hops are spoofable.
 */
export type ClientIpRequest = {
  ip?: unknown;
  socket?: { remoteAddress?: unknown };
};

export function resolveClientIp(
  req: ClientIpRequest | null | undefined,
): string {
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
