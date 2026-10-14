import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
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
 * SACDIA code no longer uses this instance: OAuth is native id-token sign-in
 * (src/auth/social-sign-in) and TOTP lives in BetterAuthService. It is kept
 * only until Better Auth is removed from the backend.
 *
 * The user.fields mapping below is intentionally minimal.
 */
// The explicit cast to `ReturnType<typeof betterAuth>` prevents TS2742
// ("inferred type cannot be named without a reference to an internal zod path")
// which fires when a dependent package resolves zod at a different install depth
// (e.g. after a better-auth version bump that brings in zod v4 transitively).
//
// WHY A CAST IS NECESSARY:
//   betterAuth<Options>() → Auth<Options>
//   The concrete Options type inferred here is a deeply-nested object that
//   references internal zod paths. Auth<BetterAuthOptions> (the default/unparameterised
//   form) is not assignable from Auth<ConcreteOptions> because the `api` property
//   is typed via InferAPI<...> which is variant in the plugin set.
//   There is no way to write a non-inferred return type that is both assignable
//   from the concrete value AND free of the internal zod reference — hence the cast.
//
// FIDELITY: Nothing in SACDIA consumes the returned instance any more, so the
// cast has no runtime effect; it only keeps the declared return type nameable.
export function createBetterAuth(
  prisma: PrismaClient,
): ReturnType<typeof betterAuth> {
  return betterAuth({
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    user: {
      modelName: 'users',
      fields: {
        // BA uses these field mappings for READ operations only.
        // NOTE: BA does NOT correctly apply these mappings for WRITE operations —
        // that is why BetterAuthService handles user creation directly via Prisma.
        id: 'user_id',
        image: 'user_image',
        createdAt: 'created_at',
        updatedAt: 'modified_at',
      },
    },
    emailAndPassword: { enabled: true },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day slide
    },
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_BASE_URL,
    advanced: {
      database: {
        // BA 1.7 validates the Prisma schema before every adapter call and
        // rejects the request on mismatch. Our users table keeps SACDIA names
        // (user_id, email_verified), BA does not honour user.fields.id in that
        // check, and TOTP lives in our own code instead of the twoFactor
        // tables — so the check always fails. BetterAuthService writes users
        // and sessions directly through Prisma.
        validateSchema: false,
      },
    },
  }) as unknown as ReturnType<typeof betterAuth>;
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
