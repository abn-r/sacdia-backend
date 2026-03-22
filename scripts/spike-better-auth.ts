/**
 * W3-000 — Better Auth Token Format Spike
 *
 * PURPOSE: Verify Better Auth behavior with Prisma adapter, usePlural: true,
 * field mapping, and document what type of tokens it emits.
 *
 * This script does NOT connect to a real database. It validates that the
 * configuration is accepted without errors and documents findings from
 * source code inspection of better-auth@1.5.6.
 *
 * Run with: npx tsx scripts/spike-better-auth.ts
 */

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

// ---------------------------------------------------------------------------
// SPIKE FINDINGS (from source code analysis of better-auth@1.5.6)
// ---------------------------------------------------------------------------
//
// Q1 — TOKEN TYPE: OPAQUE SESSION TOKEN (NOT a JWT)
//
//   better-auth/dist/db/internal-adapter.mjs line 156:
//     token: generateId(32),
//
//   signInEmail returns: { token: session.token, user: {...} }
//   The `token` is a 32-byte random opaque string stored in the `session` table.
//   It is NOT a JWT. There is no header.payload.signature structure.
//
//   The JWT plugin (better-auth/plugins/jwt) is a SEPARATE opt-in plugin that:
//   - Exposes GET /token endpoint that returns a JWT based on the current session
//   - Uses EdDSA (Ed25519) by default — NOT HS256
//   - Supports RS256, ES256, PS256, ECDH-ES — but NOT HS256
//   - Requires a jwk table in the database for key storage
//   - Returns a 15-minute JWT (short-lived) derived from the opaque session
//
// Q2 — ALGORITHM: EdDSA (Ed25519) by default for the JWT plugin
//
//   better-auth/dist/plugins/jwt/sign.mjs:
//     const alg = key.alg ?? options?.jwks?.keyPairConfig?.alg ?? "EdDSA";
//
//   HS256 IS NOT NATIVELY SUPPORTED by better-auth's JWT plugin.
//   Supported algorithms: EdDSA, ES256, ES512, RSA256, PS256, ECDH-ES
//
//   IMPLICATION FOR SACDIA: The planned JwtStrategy using HS256 + BETTER_AUTH_SECRET
//   is INCOMPATIBLE with better-auth's JWT plugin out of the box.
//   The current design in sdd/wave3-infra-migration/design is WRONG on this point.
//
// Q3 — JWT CLAIMS (when using JWT plugin):
//
//   better-auth/dist/plugins/jwt/sign.mjs (getJwtToken):
//     payload = ctx.context.session.user (all user fields by default)
//     sub = user.id (= users.user_id after field mapping)
//     iat = Math.floor(Date.now() / 1000)
//     exp = iat + expirationTime (default: 15 minutes)
//     iss = baseURL
//     aud = baseURL
//
//   So `sub` equals users.user_id (the mapped id). The payload also includes
//   name, email, emailVerified, image (after field mapping). NOT HS256.
//
// Q4 — usePlural: true SCOPE:
//
//   better-auth/dist/adapters/prisma-adapter/index.mjs:
//     config: { usePlural: config.usePlural ?? false }
//
//   @better-auth/core/dist/db/adapter/get-model-name.mjs (getModelName):
//     return usePlural ? `${model}s` : model;
//
//   The internal adapter passes these model strings to Prisma:
//     "user", "session", "account", "verification"
//   (see better-auth/dist/db/internal-adapter.mjs — all model strings are singular)
//
//   With usePlural: true, getModelName maps them to:
//     user → "users", session → "sessions", account → "accounts",
//     verification → "verifications"
//
//   CONFIRMED: usePlural affects ALL four core tables, not just user.
//   This means Prisma model names must be: users, sessions, accounts, verifications
//   (or use modelName override per-table).
//
//   The existing design uses `user.modelName: "users"` without usePlural on
//   session/account/verification. This means those models must be named
//   `session`, `account`, `verification` in Prisma schema (singular) to match
//   what BA looks for without usePlural.
//
//   RECOMMENDED CONFIG: Use modelName per-table instead of usePlural: true:
//     user: { modelName: "users" }
//     session: { modelName: "session" }   (Prisma model: session)
//     account: { modelName: "account" }   (Prisma model: account)
//     verification: { modelName: "verification" }  (Prisma model: verification)
//
// Q5 — additionalFields / unknown columns:
//
//   @better-auth/core/dist/db/adapter/factory.mjs — transformInput():
//     iterates ONLY schema[defaultModelName].fields
//     builds transformedData exclusively from known fields
//     unknown columns (paternal_last_name, gender, blood, etc.) are IGNORED
//     BA never reads them, never writes them, never errors on them
//
//   additionalFields (options.user.additionalFields) registers extra fields
//   INTO BA's schema so BA can read/write them. For SACDIA fields managed by
//   SACDIA's own Prisma calls, you do NOT need additionalFields — BA ignores
//   them transparently.
//
// Q6 — SERVER API (auth.api without HTTP handler):
//
//   better-auth endpoints are built on better-call, which allows calling them
//   as regular functions via auth.api.
//
//   From BA docs + source: auth.api.signUpEmail({ body: {...} }) works server-side.
//   auth.api.signInEmail({ body: { email, password } }) works server-side.
//   You do NOT need to mount the HTTP handler for internal calls.
//   The HTTP handler IS needed if you want Better Auth to handle OAuth callbacks
//   at /auth/callback/* — for the redirect flow.
//
//   IMPLICATION: BetterAuthService.signInWithPassword() can call
//   auth.api.signInEmail() directly. But for OAuth, you must mount the handler.
//
// ---------------------------------------------------------------------------
// CRITICAL IMPLICATION — TOKEN FORMAT REDESIGN REQUIRED
// ---------------------------------------------------------------------------
//
// The wave3-infra-migration design (Decision 3, JwtStrategy) assumed Better Auth
// emits HS256 JWTs that can be validated with BETTER_AUTH_SECRET. THIS IS WRONG.
//
// Better Auth's primary token is an OPAQUE session token (random string).
// The JWT plugin emits EdDSA/ES256 tokens via JWKS — NOT HS256.
//
// TWO DESIGN OPTIONS for NestJS JWT validation:
//
// OPTION A: Keep opaque session token — validate via Better Auth API
//   - JwtAuthGuard calls auth.api.getSession({ headers }) on every request
//   - No JWT parsing in NestJS; BA does session lookup via DB
//   - Pros: Simple, no key management, BA handles expiry/revocation natively
//   - Cons: DB hit on every request (unless cached), changes guard architecture
//   - NestJS currently uses PassportStrategy(Strategy) — must swap to custom guard
//
// OPTION B: Use JWT plugin — validate via JWKS (EdDSA)
//   - Add jwt() plugin to betterAuth config
//   - Client calls GET /auth/token to get a 15-min JWT after sign-in
//   - JwtStrategy validates JWT using JWKS endpoint (like Supabase ES256)
//   - Pros: Stateless JWT validation, similar to current Supabase pattern
//   - Cons: Requires jwk table (new migration), short 15-min expiry by default,
//     adds complexity, algorithm is EdDSA not HS256
//
// OPTION C: Use BA session token but validate via DB lookup (recommended for simplicity)
//   - Replace PassportStrategy with a NestJS Guard that calls BA's internalAdapter
//   - Or use auth.api.getSession() directly in the guard
//   - Most idiomatic BA approach for server-rendered apps/APIs
//
// RECOMMENDED RESOLUTION: Option A or C (opaque token + session validation)
// This eliminates the need for JWT algorithm decisions and is how BA was designed
// to work with server-side APIs.
//
// ---------------------------------------------------------------------------

// Minimal mock Prisma client (does not connect to DB) just to verify config
const mockPrisma = {
  user: {} as any,
  session: {} as any,
  account: {} as any,
  verification: {} as any,
  users: {} as any,
  sessions: {} as any,
  accounts: {} as any,
  verifications: {} as any,
} as any;

/**
 * Spike configuration — validates that Better Auth accepts these settings
 * without runtime errors during initialization.
 *
 * Field mapping (from design doc):
 *   BA internal name → SACDIA DB column
 *   id              → user_id
 *   image           → user_image
 *   createdAt       → created_at
 *   updatedAt       → modified_at
 *
 * In better-auth, field mapping under user.fields means:
 *   { id: "user_id" }  means: BA field "id" maps to DB column "user_id"
 */
function createSpikeAuth() {
  return betterAuth({
    secret: 'test-spike-secret-32-chars-minimum!',
    baseURL: 'http://localhost:3000',

    database: prismaAdapter(mockPrisma, {
      provider: 'postgresql',
      // NOTE: Do NOT use usePlural: true if only user needs plural name.
      // Use modelName overrides per-table instead (see Q4 findings above).
    }),

    // User model: mapped to SACDIA's `users` table
    user: {
      modelName: 'users',        // BA looks for Prisma model named "users"
      fields: {
        id: 'user_id',           // BA "id"         → DB column user_id (UUID)
        image: 'user_image',     // BA "image"       → DB column user_image
        createdAt: 'created_at', // BA "createdAt"   → DB column created_at
        updatedAt: 'modified_at',// BA "updatedAt"   → DB column modified_at
      },
      // SACDIA-specific columns (paternal_last_name, maternal_last_name, gender,
      // blood, birthday, baptism, approval_status, etc.) are NOT declared here.
      // BA ignores them transparently — transformInput() only iterates BA's
      // known fields and never touches unknown columns.
    },

    // Session, account, verification: use singular names (Prisma model names must match)
    // These do NOT need plural overrides — singular "session", "account", "verification"
    // is what BA internally uses and what the Prisma models should be named.
    session: {
      expiresIn: 60 * 60 * 24 * 7,   // 7 days
      updateAge: 60 * 60 * 24,        // 1 day slide
    },

    emailAndPassword: {
      enabled: true,
    },

    // Social providers (OAuth) — commented out since we're not testing them here
    // socialProviders: {
    //   google: { clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET' },
    //   apple: { clientId: 'APPLE_CLIENT_ID', teamId: 'APPLE_TEAM_ID', keyId: 'APPLE_KEY_ID', privateKey: 'APPLE_PRIVATE_KEY' },
    // },
  });
}

async function runSpike() {
  console.log('=== W3-000 Better Auth Token Format Spike ===\n');

  try {
    const auth = createSpikeAuth();
    console.log('✓ betterAuth() initialized without errors');
    console.log('✓ prismaAdapter accepted with user.modelName="users" and field mappings');
    console.log('✓ user.fields mapping accepted: id→user_id, image→user_image, createdAt→created_at, updatedAt→modified_at');
    console.log('✓ emailAndPassword plugin accepted');
    console.log('');

    // Verify auth.api exists (server-side API available without HTTP handler)
    if (auth.api && typeof auth.api === 'object') {
      console.log('✓ auth.api is available for server-side calls (no HTTP handler needed)');
      const apiMethods = Object.keys(auth.api);
      console.log(`  Available API methods: ${apiMethods.slice(0, 8).join(', ')}, ...`);
    }
    console.log('');
  } catch (err: unknown) {
    const error = err as Error;
    console.error('✗ Initialization failed:', error.message);
    process.exit(1);
  }

  console.log('=== SPIKE FINDINGS ===\n');

  console.log('Q1 — TOKEN TYPE:');
  console.log('  OPAQUE SESSION TOKEN (random 32-byte string via generateId(32))');
  console.log('  Source: better-auth/dist/db/internal-adapter.mjs:156');
  console.log('  signInEmail returns: { token: session.token, user: {...} }');
  console.log('  The token is a random string stored in the session table — NOT a JWT.\n');

  console.log('Q2 — ALGORITHM:');
  console.log('  N/A for primary session token (not a JWT).');
  console.log('  JWT plugin uses EdDSA (Ed25519) by default — NOT HS256.');
  console.log('  Source: better-auth/dist/plugins/jwt/sign.mjs');
  console.log('  Supported algorithms: EdDSA, ES256, ES512, RSA256, PS256, ECDH-ES.');
  console.log('  HS256 is NOT supported by better-auth JWT plugin.\n');

  console.log('Q3 — JWT CLAIMS:');
  console.log('  Only relevant if using the JWT plugin (GET /token endpoint).');
  console.log('  Claims: sub=user.id (=users.user_id), iat, exp (15m default),');
  console.log('  iss=baseURL, aud=baseURL, plus full user object as payload.');
  console.log('  sub equals users.user_id after field mapping.\n');

  console.log('Q4 — usePlural SCOPE:');
  console.log('  usePlural: true affects ALL four core tables:');
  console.log('  user→users, session→sessions, account→accounts, verification→verifications.');
  console.log('  Source: @better-auth/core/dist/db/adapter/get-model-name.mjs');
  console.log('  PREFERRED: Use modelName per-table instead of usePlural: true.');
  console.log('  Prisma models should be: users (mapped), session, account, verification.\n');

  console.log('Q5 — additionalFields / UNKNOWN COLUMNS:');
  console.log('  BA completely ignores unknown DB columns (SACDIA-specific fields).');
  console.log('  transformInput() only iterates schema fields BA knows about.');
  console.log('  Source: @better-auth/core/dist/db/adapter/factory.mjs:102-144');
  console.log('  No additionalFields declarations needed for SACDIA columns.');
  console.log('  BA never reads or writes paternal_last_name, gender, blood, etc.\n');

  console.log('Q6 — SERVER API:');
  console.log('  auth.api methods work as regular functions (no HTTP handler needed).');
  console.log('  auth.api.signInEmail({ body: { email, password } }) works server-side.');
  console.log('  auth.api.signUpEmail({ body: { email, password, name } }) works server-side.');
  console.log('  HTTP handler required ONLY for OAuth callback redirects.\n');

  console.log('=== CRITICAL IMPLICATION ===\n');
  console.log('The W3-009 design (HS256 JwtStrategy with BETTER_AUTH_SECRET) is INVALID.');
  console.log('Better Auth does NOT emit HS256 JWTs. Primary token is opaque.');
  console.log('The JWT plugin uses EdDSA/JWKS, not HS256.');
  console.log('');
  console.log('RECOMMENDED APPROACH: Session validation via auth.api.getSession().');
  console.log('Replace PassportStrategy with a NestJS Guard that calls BA session API.');
  console.log('This is how Better Auth is designed for server-side API use.');
}

runSpike().catch(console.error);
