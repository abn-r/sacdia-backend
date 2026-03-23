import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
// NOTE: `totp` is NOT a valid export from `better-auth/plugins`.
// The correct plugin is `twoFactor` which includes TOTP + OTP + backup codes.
// See better-auth.service.ts for the TOTP API differences documented there.
import { twoFactor } from 'better-auth/plugins';
import { PrismaClient } from '@prisma/client';

/**
 * Creates the Better Auth instance.
 *
 * IMPORTANT: BA's Prisma adapter does NOT correctly map field names for WRITE
 * operations. Specifically, when creating a user BA sends camelCase field names
 * (id, emailVerified) instead of our schema's snake_case names (user_id,
 * email_verified), causing PrismaClientValidationError.
 *
 * For this reason, BetterAuthService bypasses BA for ALL user CRUD operations
 * (createUser, signInWithPassword, refreshSession, signOut, resetPasswordForEmail)
 * and writes directly to Prisma.
 *
 * The BA instance is kept for:
 *   - OAuth (signInSocial, callbackOAuth)
 *   - TOTP / MFA (future — pending interface redesign)
 *   - Reading sessions after OAuth callbacks
 *
 * The user.fields mapping below is intentionally minimal — we only keep the
 * fields BA needs internally for READ operations during OAuth flows.
 */
export function createBetterAuth(prisma: PrismaClient) {
  return betterAuth({
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    user: {
      modelName: 'users',
      fields: {
        // BA uses these field mappings for READ operations in OAuth flows.
        // NOTE: BA does NOT correctly apply these mappings for WRITE operations —
        // that is why BetterAuthService handles user creation directly via Prisma.
        id: 'user_id',
        image: 'user_image',
        createdAt: 'created_at',
        updatedAt: 'modified_at',
      },
    },
    plugins: [twoFactor()],
    emailAndPassword: { enabled: true },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
      apple: {
        clientId: process.env.APPLE_CLIENT_ID!,
        teamId: process.env.APPLE_TEAM_ID!,
        keyId: process.env.APPLE_KEY_ID!,
        privateKey: process.env.APPLE_PRIVATE_KEY!,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day slide
    },
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_BASE_URL,
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
