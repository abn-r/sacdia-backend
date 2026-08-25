import {
  DEFAULT_OAUTH_REDIRECT_URL,
  isExactOAuthRedirectAllowed,
  resolveBetterAuthTrustedOrigins,
  resolveOAuthRedirectAllowlist,
} from './oauth-redirect-allowlist';

describe('oauth redirect allowlist', () => {
  it('prefers ALLOWED_OAUTH_REDIRECT_URLS and keeps exact URLs', () => {
    const env = {
      ALLOWED_OAUTH_REDIRECT_URLS:
        'https://app.sacdia.app/auth/callback,sacdia://auth/callback',
      ALLOWED_ORIGINS: 'https://admin.sacdia.app',
    };

    expect(resolveOAuthRedirectAllowlist(env)).toEqual([
      'https://app.sacdia.app/auth/callback',
      'sacdia://auth/callback',
    ]);
    expect(
      isExactOAuthRedirectAllowed(
        'https://app.sacdia.app/auth/callback/extra',
        env,
      ),
    ).toBe(false);
  });

  it('falls back to ALLOWED_ORIGINS then the default URL', () => {
    expect(
      resolveOAuthRedirectAllowlist({
        ALLOWED_ORIGINS: 'https://app.sacdia.app, https://admin.sacdia.app',
      }),
    ).toEqual(['https://app.sacdia.app', 'https://admin.sacdia.app']);
    expect(resolveOAuthRedirectAllowlist({})).toEqual([
      DEFAULT_OAUTH_REDIRECT_URL,
    ]);
  });

  it('derives BA trustedOrigins as http(s) origins plus exact custom schemes', () => {
    expect(
      resolveBetterAuthTrustedOrigins({
        ALLOWED_OAUTH_REDIRECT_URLS:
          'https://app.sacdia.app/auth/callback,https://app.sacdia.app/other,sacdia://auth/callback',
      }),
    ).toEqual(['https://app.sacdia.app', 'sacdia://auth/callback']);
  });

  it('skips invalid URLs in the BA origin list', () => {
    expect(
      resolveBetterAuthTrustedOrigins({
        ALLOWED_OAUTH_REDIRECT_URLS: 'not-a-url,https://app.sacdia.app/cb',
      }),
    ).toEqual(['https://app.sacdia.app']);
  });
});
