import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request audit context propagated via AsyncLocalStorage.
 *
 * - `correlationId` links every audit row written during one HTTP request
 *   (generic HTTP row, explicit domain events, critical durable events).
 * - `explicitAuditRecorded` is the dedup flag: when a service writes a rich
 *   domain event during the request, the HTTP interceptor skips its generic
 *   row so the operation produces one meaningful entry instead of two.
 * - `actingFor` is set by JwtStrategy for every non-`user` principal, so
 *   `recordEvent` and the critical writer attribute the row to the real actor
 *   and tag it with the principal kind: a guardian acting for a dependent
 *   (actor = guardian), a supervised teen or a linked device (actor = subject).
 */
export type AuditActorKind =
  'guardian_acting' | 'supervised_user' | 'linked_device';

export interface AuditActingFor {
  /** The real person: the guardian when acting, the subject itself otherwise. */
  actorUserId: string;
  /** The profile the request is about: `request.user.sub`. */
  subjectUserId: string;
  /** Only for `guardian_acting`. */
  guardianshipId?: string;
  /** Only for `linked_device` (3b). */
  linkedDeviceId?: string;
  kind: AuditActorKind;
}

export interface AuditRequestContext {
  correlationId: string;
  explicitAuditRecorded: boolean;
  actingFor?: AuditActingFor;
}

const storage = new AsyncLocalStorage<AuditRequestContext>();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function runWithAuditContext<T>(fn: () => T, correlationId?: string): T {
  return storage.run(
    {
      correlationId: correlationId ?? randomUUID(),
      explicitAuditRecorded: false,
    },
    fn,
  );
}

export function getAuditContext(): AuditRequestContext | undefined {
  return storage.getStore();
}

export function getAuditCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function getAuditActingFor(): AuditActingFor | undefined {
  return storage.getStore()?.actingFor;
}

export function setAuditActingFor(actingFor: AuditActingFor): void {
  const context = storage.getStore();
  if (context) {
    context.actingFor = actingFor;
  }
}

export function markExplicitAuditRecorded(): void {
  const context = storage.getStore();
  if (context) {
    context.explicitAuditRecorded = true;
  }
}

/**
 * Express middleware that opens an audit context for the whole request
 * lifecycle. Honors an incoming `x-request-id` header when it is a valid
 * UUID (audit_logs.correlation_id is a UUID column); otherwise generates one.
 */
export function auditContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers['x-request-id'];
  const candidate = Array.isArray(header) ? header[0] : header;
  const correlationId =
    candidate && UUID_PATTERN.test(candidate) ? candidate : undefined;
  runWithAuditContext(() => next(), correlationId);
}
