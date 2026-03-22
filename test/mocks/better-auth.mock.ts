/**
 * Jest module mock for `better-auth` and all `better-auth/*` sub-paths.
 *
 * Better Auth ships as ESM-only (.mjs) which Jest (CommonJS mode) cannot parse.
 * This mock replaces the entire package so tests that import source files
 * which transitively import better-auth can run without the ESM error.
 *
 * All tests that exercise BetterAuth behaviour mock BetterAuthService at the
 * NestJS provider level — they never need the real betterAuth() factory.
 */

export const betterAuth = jest.fn(() => ({
  api: {
    signUpEmail: jest.fn(),
    signInEmail: jest.fn(),
    getSession: jest.fn(),
    revokeSession: jest.fn(),
    requestPasswordReset: jest.fn(),
    signInSocial: jest.fn(),
    callbackOAuth: jest.fn(),
    enableTwoFactor: jest.fn(),
    verifyTOTP: jest.fn(),
    disableTwoFactor: jest.fn(),
  },
}));

export const prismaAdapter = jest.fn(() => ({}));

export const twoFactor = jest.fn(() => ({}));

export const totp = jest.fn(() => ({}));

// Default export — some imports use `import betterAuth from 'better-auth'`
export default betterAuth;
