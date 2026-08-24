export const DEFAULT_OAUTH_REDIRECT_URL = 'https://sacdia.app/auth/callback';

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function splitCsv(raw?: string): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Exact redirect URLs for OAuth initiate. Same resolution as historically
 * in OAuthService: ALLOWED_OAUTH_REDIRECT_URLS → ALLOWED_ORIGINS → default.
 */
export function resolveOAuthRedirectAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const oauthSpecific = splitCsv(env.ALLOWED_OAUTH_REDIRECT_URLS);
  if (oauthSpecific.length > 0) {
    return unique(oauthSpecific);
  }

  const origins = splitCsv(env.ALLOWED_ORIGINS);
  if (origins.length > 0) {
    return unique(origins);
  }

  return [DEFAULT_OAUTH_REDIRECT_URL];
}

export function isExactOAuthRedirectAllowed(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveOAuthRedirectAllowlist(env).includes(url);
}

/**
 * Better Auth `trustedOrigins` is origin-based for http(s)
 * (`pattern === getOrigin(url)`). Custom schemes use prefix match, so those
 * stay exact. Do not put full https paths here — BA would reject them.
 */
export function resolveBetterAuthTrustedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const origins = new Set<string>();

  for (const entry of resolveOAuthRedirectAllowlist(env)) {
    try {
      const parsed = new URL(entry);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        origins.add(parsed.origin);
      } else {
        origins.add(entry);
      }
    } catch {
      // Invalid entries still work as exact strings in OAuthService.
    }
  }

  return [...origins];
}
