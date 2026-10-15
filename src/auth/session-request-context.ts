import type { SessionRequestContext } from '../better-auth/better-auth.service';
import { resolveClientIp, type ClientIpRequest } from '../config/client-ip';

// sessions.user_agent is unbounded TEXT; cap it so a client can't store
// arbitrarily large headers on every login.
const USER_AGENT_MAX = 512;

export type SessionContextRequest = ClientIpRequest & {
  headers?: Record<string, string | string[] | undefined>;
};

/**
 * Builds the IP + User-Agent stored on a new session row. The IP comes from
 * resolveClientIp (Express `trust proxy` aware), never from raw XFF headers.
 */
export function sessionContextFromRequest(
  req: SessionContextRequest | null | undefined,
): SessionRequestContext {
  const ip = resolveClientIp(req);
  const rawUserAgent = req?.headers?.['user-agent'];
  const userAgent = (
    Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent
  )?.trim();

  return {
    ipAddress: ip === 'unknown' ? undefined : ip,
    userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : undefined,
  };
}
