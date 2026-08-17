import { SetMetadata } from '@nestjs/common';

export const AUDIT_OPTIONS_KEY = 'audit:options';

export interface AuditOptions {
  /** Excludes the endpoint from automatic HTTP audit persistence. */
  skip?: boolean;
  /** Overrides the entity_type derived from the route path. */
  entityType?: string;
  /** Overrides the action derived from the HTTP method (e.g. 'APPROVED'). */
  action?: string;
}

/**
 * Tunes the automatic HTTP audit trail for a handler or controller.
 *
 * Mutating endpoints (POST/PUT/PATCH/DELETE) are persisted to `audit_logs`
 * by `HttpAuditInterceptor` with values derived from the route. Use this
 * decorator to skip noisy endpoints or to give semantically meaningful
 * entity/action names to nested routes.
 *
 * @example `@Audit({ skip: true })`
 * @example `@Audit({ entityType: 'club_members', action: 'APPROVED' })`
 */
export const Audit = (options: AuditOptions) =>
  SetMetadata(AUDIT_OPTIONS_KEY, options);
