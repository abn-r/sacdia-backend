# Redis outage: boot, auth and rate limiting

Redis (Upstash) backs the cache (`@keyv/redis`), the token blacklist (on the
cache), the auth-context and catalog caches, the distributed throttler and
BullMQ. This runbook covers how the API behaves when Redis is unreachable or
over quota, and the three switches that control it. Command-budget tuning
lives in `redis-command-budget.md`.

## Switches

All validated in `src/config/env.validation.ts`.

| Variable                       | Values                            | Default      | Recommended on Render |
| ------------------------------ | --------------------------------- | ------------ | --------------------- |
| `REDIS_BOOT_OPTIONAL`          | `true` / `false`                  | `false`      | `true`                |
| `AUTH_BLACKLIST_DEGRADED_MODE` | `db-session` / `reject` / `allow` | `db-session` | `db-session`          |
| `THROTTLER_REDIS_FALLBACK`     | `closed` / `memory` / `open`      | `closed`     | `memory`              |
| `THROTTLER_FAIL_OPEN` (legacy) | `true` / `false`                  | `false`      | unset                 |

The defaults of `REDIS_BOOT_OPTIONAL` (`false`) and `THROTTLER_REDIS_FALLBACK`
(`closed`) preserve the pre-existing behaviour. `AUTH_BLACKLIST_DEGRADED_MODE`
only matters when Redis is down; before it existed, every authenticated request
answered 401 in that situation.

`render.yaml` and `.env.example` are intentionally not touched by the change
that introduced these flags; set the recommended values in the Render dashboard.

### `REDIS_BOOT_OPTIONAL`

- `false`: in production, a failed cache probe or throttler readiness check
  aborts boot (unchanged).
- `true`: the failure is logged as an error and the API still starts. The cache
  keeps its Redis store (it is NOT swapped for an in-memory cache in
  production) and reconnects by itself when Redis returns; the throttler
  keeps its Redis client, which retries in the background.
- Independent of the flag: the throttler readiness check is bounded to 5 s, the
  throttler Redis client has a 5 s connect timeout and a capped (3 s)
  never-give-up backoff, and a failed bootstrap now logs and `process.exit(1)`
  so Render restarts the service instead of showing "No open ports detected".
- A missing/invalid `REDIS_URL` in production still fails boot, even with the
  flag on (that is a configuration error, not an outage).

### `AUTH_BLACKLIST_DEGRADED_MODE`

Applies when the Redis blacklist cannot be consulted (error, 2 s timeout, or
the circuit breaker is open: after a failure Redis is skipped for 15 s, then a
single probe request is let through; one error log per outage, one recovery
log).

- `db-session`: the JWT `sid` claim is the Better Auth `session.id`. One
  indexed lookup (`id` + `userId` + `expiresAt > now`). Missing/expired session
  => 401 `GUARD_JWT_UNAUTHORIZED`. Session present => request continues. Token
  without `sid` => treated like `reject`. If the database lookup itself fails
  => 503.
- `reject`: 503 `AUTH_REVOCATION_CHECK_UNAVAILABLE` for every authenticated
  request while Redis is down. Safest, least available.
- `allow`: accept the token and log a (rate-limited) warning. Revoked tokens
  work until they expire (up to 8 h).

The 503 is propagated by `JwtAuthGuard`. `OptionalJwtAuthGuard` also propagates
it: silently treating an authenticated user as anonymous would serve them
public/anonymous content (and hide their own data) without any signal, so the
client gets a retryable 503 instead. `@Public()` routes without
`OptionalJwtAuthGuard` do not run the JWT strategy and are unaffected.

Why `db-session` is safe: logout (sign-out by refresh token), password
change/reset, admin revoke, self-revoke and account deletion all delete the
`session` row, so a token whose session is gone is rejected without Redis.

#### Residual risk (read this)

- Access-token-only logout (no refresh token sent) cannot delete a session; it
  only blacklists the access token in Redis. During a Redis outage that token
  is still accepted by `db-session` until it expires (JWT TTL 8 h). Same for a
  token blacklisted individually just before the outage started.
- Tokens without `sid` (issued before 2026-04 or by the MFA verify endpoint) get
  a 503 in `db-session` mode.
- Revocations made while Redis is down (`blacklistToken`,
  `blacklistAllUserTokens`) fail; the code logs the error and, for password
  flows, still succeeds because the sessions are already deleted.

### `THROTTLER_REDIS_FALLBACK`

What the throttler does when Redis errors at runtime (after one failure Redis
is skipped for 15 s, one error log per outage, one recovery log). A genuine
"over the limit" answer from Redis is always honoured (429).

- `closed` (default): the Redis error surfaces as a 500; rate limiting is never
  bypassed. This is the contract tested by
  `src/config/redis-throttler.storage.integration.spec.ts` (CI only).
- `memory`: per-process in-memory counters with the same ttl/limit/block
  semantics. Limits are enforced per instance, not globally, so the effective
  limit is up to `instances x limit` during the outage. Counters are discarded
  naturally; on recovery the Redis counters take over.
- `open`: requests pass unthrottled.

Precedence with the legacy `THROTTLER_FAIL_OPEN`: an explicit
`THROTTLER_REDIS_FALLBACK` wins; if it is unset, `THROTTLER_FAIL_OPEN=true`
means `open`, otherwise `closed`. `THROTTLER_FAIL_OPEN=true` together with
`closed`/`memory` is contradictory and fails boot validation.

## Behaviour matrix (Redis down, production)

| Route type                                                | Defaults (`false` / `db-session` / `closed`)                                 | Recommended (`true` / `db-session` / `memory`) |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| Boot                                                      | Aborts, exit 1, Render restarts                                              | Boots, logs error                              |
| `GET /api/v1/health`                                      | OK (no Redis)                                                                | OK                                             |
| Authenticated, token has live `sid`                       | 500 from throttler (closed)                                                  | OK, session checked in DB, throttled in memory |
| Authenticated, revoked/deleted session                    | 500 from throttler                                                           | 401                                            |
| Authenticated, token without `sid`                        | 500 from throttler                                                           | 503 `AUTH_REVOCATION_CHECK_UNAVAILABLE`        |
| `@Public()` + `OptionalJwtAuthGuard`, anonymous           | 500 from throttler                                                           | OK                                             |
| `@Public()` + `OptionalJwtAuthGuard`, token with `sid`    | 500 from throttler                                                           | OK (session checked in DB)                     |
| `@Public()` + `OptionalJwtAuthGuard`, token without `sid` | 500 from throttler                                                           | 503                                            |
| Login / password reset                                    | 500 from throttler                                                           | OK, throttled in memory per instance           |
| Password change/reset (once past the throttler)           | Success; blacklist failure logged (was 500 / 400 after the change committed) | Success; blacklist failure logged              |
| Over-limit answered by Redis                              | 429                                                                          | 429                                            |

With `AUTH_BLACKLIST_DEGRADED_MODE=reject` every authenticated request is 503;
with `allow` it passes without a session check.

## Logs to look for

- `Token blacklist cache unavailable ...` / `... recovered` (one each per outage)
- `Redis throttler unavailable ... falling back to per-process in-memory rate limiting`
- `auth_jwt_revocation_check_unavailable` (at most one per 30 s per instance)
- `auth_password_blacklist_failed` (a password changed while Redis was down)
- `REDIS_BOOT_OPTIONAL=true: starting ...` (booted without a verified Redis)

## Not covered (follow-ups)

- BullMQ producers: `queue.add` can hang during an outage
  (`maxRetriesPerRequest: null`); needs producer-side timeouts.
- Year-cut `onModuleInit` database work runs before `listen`.
- `SessionManagementService` is dead code and should be removed.
