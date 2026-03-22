# Session: Auth Cutover Deployment + Monitoring

Date: **2026-03-01**
Status: **Historical (superseded operationally on 2026-03-04)**

> [!IMPORTANT]
> Este documento representa el estado del cutover inicial del **2026-03-01**.
> La operación vigente de sesiones/Auth fue actualizada en:
> - `docs/IMPLEMENTATION-SESSION-2026-03-04-session-stabilization.md`
> - `docs/adr/ADR-0001-auth-session-compat-window.md`
> - `README.md` (secciones Auth y monitoreo)

## Objective

Apply the immediate Auth contract cutover in production and operate a 14-day monitoring window without date gating.

## Update 2026-03-04 (Session Stabilization)

- Runtime switched to temporary compatibility window:
  - `AUTH_REJECT_SNAKE_CASE=false`
  - Window: **2026-03-04** to **2026-03-18**
- Planned strict cutback date:
  - **2026-03-18** with `AUTH_REJECT_SNAKE_CASE=true`
- New operational event for logout resiliency:
  - `event:auth_logout_best_effort`
  - `event:auth_logout_revoke_failed`

## Applied in Repository

- `vercel.json` enforces runtime default:
  - `"AUTH_REJECT_SNAKE_CASE": "false"` during 2026-03-04..2026-03-18
- `ci.yml` production deploy enforces flag by date:
  - 2026-03-04..2026-03-18 => must be `false`
  - outside that range => must be `true`

## Production Execution Checklist (2026-03-01)

1. Merge to `main` and confirm CI reaches `deploy-production`.
2. Confirm deployed runtime uses:
   - `AUTH_REJECT_SNAKE_CASE=true`
3. Run post-deploy smoke:
   - `POST /api/v1/auth/login` returns camelCase tokens.
   - `POST /api/v1/auth/refresh` with `refreshToken` returns 200.
   - `POST /api/v1/auth/refresh` with `refresh_token` returns 400 + `LEGACY_SNAKE_CASE_REMOVED`.
   - `GET /api/v1/auth/me` works with refreshed token.

## Monitoring Window

- Intensive window: **2026-03-01 to 2026-03-02** (first 24h).
- Daily monitoring: **2026-03-03 to 2026-03-15**.

## Operational Queries (Sentry/Logs)

- Legacy rejection rate:
  - `event:auth_refresh_legacy_rejected`
- Refresh success rate:
  - `event:auth_refresh_success`
- Refresh failure rate:
  - `event:auth_refresh_failed`
- Logout best effort:
  - `event:auth_logout_best_effort`
- Logout revoke failures:
  - `event:auth_logout_revoke_failed`
- Unauthorized on profile endpoint:
  - `event:auth_guard_unauthorized url:/api/v1/auth/me`
- Revocation effectiveness:
  - `event:auth_jwt_revoked_token OR event:auth_jwt_user_blacklisted`
- MFA bind issues:
  - `event:mfa_session_bind_failed`

## Rollback (Controlled, Temporary)

Use only if client breakage is confirmed and high-impact.

1. Set `AUTH_REJECT_SNAKE_CASE=false` in production environment.
2. Redeploy production.
3. Keep telemetry active for legacy usage.
4. Open migration incident and define client remediation ETA.
5. Restore `AUTH_REJECT_SNAKE_CASE=true` after remediation.

## Exit Criteria (2026-03-18)

- Legacy rejection trend near zero.
- Stable `auth/me` 401 rate with no unexplained spikes.
- Stable refresh success/failure ratio.
- No unresolved incidents tied to snake_case payload usage.
