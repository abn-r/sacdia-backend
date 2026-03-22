import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
// NOTE: `totp` is NOT a valid export from `better-auth/plugins`.
// The correct plugin is `twoFactor` which includes TOTP + OTP + backup codes.
// See better-auth.service.ts for the TOTP API differences documented there.
import { twoFactor } from 'better-auth/plugins';
import { PrismaClient } from '@prisma/client';

export function createBetterAuth(prisma: PrismaClient) {
  return betterAuth({
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
      usePlural: true,
    }),
    user: {
      modelName: 'users',
      fields: {
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
