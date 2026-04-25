/**
 * Canonical error codes for the SACDIA API.
 *
 * Rules:
 *   - ALL_CAPS_SNAKE format
 *   - Domain-namespaced (AUTH_, CLUB_, RBAC_, etc.)
 *   - Each code MUST have a corresponding entry in all src/i18n/{locale}/errors.json files
 *   - Phase A: generic + auth sample keys. Phase B: migrate all modules here.
 */
export enum ErrorCode {
  // ── Generic ────────────────────────────────────────────────────────────────
  GENERIC_ERROR = 'GENERIC_ERROR',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',

  // ── Database / Prisma ──────────────────────────────────────────────────────
  RECORD_NOT_FOUND = 'RECORD_NOT_FOUND',
  RECORD_CONFLICT = 'RECORD_CONFLICT',
  RECORD_FK_VIOLATION = 'RECORD_FK_VIOLATION',
  RECORD_RELATED_NOT_FOUND = 'RECORD_RELATED_NOT_FOUND',

  // ── Auth (sample — full migration in Phase B) ──────────────────────────────
  AUTH_REFRESH_TOKEN_REQUIRED = 'AUTH_REFRESH_TOKEN_REQUIRED',
  AUTH_INVALID_TOKEN = 'AUTH_INVALID_TOKEN',
}
