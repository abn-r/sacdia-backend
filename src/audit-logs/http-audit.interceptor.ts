import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  AUDIT_OPTIONS_KEY,
  AuditOptions,
} from '../common/decorators/audit.decorator';
import { AuditLogsService } from './audit-logs.service';
import {
  getAuditContext,
  getAuditCorrelationId,
} from './audit-request-context';

const MUTATION_ACTIONS: Record<string, 'CREATED' | 'UPDATED' | 'DELETED'> = {
  POST: 'CREATED',
  PUT: 'UPDATED',
  PATCH: 'UPDATED',
  DELETE: 'DELETED',
};

/**
 * Normalized route paths (global prefix and version stripped) that are never
 * persisted to audit_logs: high-frequency plumbing with no audit value.
 */
const EXCLUDED_PATHS = ['health', 'auth/refresh'];

/**
 * Global interceptor with two responsibilities:
 *
 * 1. Application log line for every request (success/error, duration, actor) —
 *    behavior inherited from the former common/interceptors AuditInterceptor.
 * 2. Persistent audit trail: every mutating request (POST/PUT/PATCH/DELETE)
 *    is recorded in `audit_logs` with source='http', unless the endpoint is
 *    excluded, marked with `@Audit({ skip: true })`, or a richer domain event
 *    was already recorded during the request (dedup via audit context flag).
 *
 * Request bodies are never persisted: `changes` stays reserved for explicit
 * domain events, which avoids leaking credentials or sensitive health data.
 * Persistence is fire-and-forget — audit failures never affect the response.
 */
@Injectable()
export class HttpAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLog');

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogs: AuditLogsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();
    const userAgent = (request.headers['user-agent'] || 'unknown').substring(
      0,
      100,
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode =
            context.switchToHttp().getResponse()?.statusCode ?? 200;
          this.logRequest(request, userAgent, duration, 'success');
          this.persistMutation(context, request, {
            statusCode,
            durationMs: duration,
            userAgent,
            result: 'succeeded',
          });
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          this.logRequest(request, userAgent, duration, 'error', error);
          this.persistMutation(context, request, {
            statusCode:
              error instanceof HttpException ? error.getStatus() : 500,
            durationMs: duration,
            userAgent,
            result: 'failed',
          });
        },
      }),
    );
  }

  private logRequest(
    request: any,
    userAgent: string,
    duration: number,
    status: 'success' | 'error',
    error?: Error,
  ): void {
    const entry = {
      timestamp: new Date().toISOString(),
      userId: request.user?.user_id || 'anonymous',
      method: request.method,
      url: this.sanitizeUrl(request.url),
      ip: this.getClientIp(request),
      userAgent,
      duration: `${duration}ms`,
      status,
      ...(error ? { errorMessage: error.message } : {}),
    };
    if (status === 'success') {
      this.logger.log(entry);
    } else {
      this.logger.warn(entry);
    }
  }

  private persistMutation(
    context: ExecutionContext,
    request: any,
    outcome: {
      statusCode: number;
      durationMs: number;
      userAgent: string;
      result: 'succeeded' | 'failed';
    },
  ): void {
    const action = MUTATION_ACTIONS[request.method as string];
    if (!action) {
      return; // GET/HEAD/OPTIONS are never persisted
    }

    const options = this.reflector.getAllAndOverride<AuditOptions | undefined>(
      AUDIT_OPTIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (options?.skip) {
      return;
    }

    // A richer domain/critical event was already written for this request.
    if (getAuditContext()?.explicitAuditRecorded) {
      return;
    }

    const sanitizedPath = this.sanitizeUrl(request.url);
    const segments = this.routeSegments(sanitizedPath);
    const normalizedPath = segments.join('/');
    if (
      EXCLUDED_PATHS.some(
        (excluded) =>
          normalizedPath === excluded ||
          normalizedPath.startsWith(`${excluded}/`),
      )
    ) {
      return;
    }

    const userId: string | undefined = request.user?.user_id;

    // Fire-and-forget: recordEvent swallows its own errors.
    void this.auditLogs.recordEvent({
      entity_type: (options?.entityType ?? segments[0] ?? 'unknown').slice(
        0,
        50,
      ),
      entity_id: this.extractEntityId(request.params),
      action: (options?.action ?? action).slice(0, 64),
      club_id: this.extractClubId(request.params),
      actor_user_id: userId,
      actor_kind: userId ? 'user' : 'anonymous',
      summary: `${request.method} ${sanitizedPath}`.slice(0, 500),
      result: outcome.result,
      source: 'http',
      request_context: {
        method: request.method,
        path: sanitizedPath,
        status_code: outcome.statusCode,
        duration_ms: outcome.durationMs,
        ip: this.getClientIp(request),
        user_agent: outcome.userAgent,
      },
      correlation_id: getAuditCorrelationId(),
    });
  }

  /** Path segments with the global prefix (`api`) and version (`v1`) removed. */
  private routeSegments(sanitizedPath: string): string[] {
    return sanitizedPath
      .split('/')
      .filter(Boolean)
      .filter(
        (segment, index) =>
          !(index === 0 && segment === 'api') && !/^v\d+$/.test(segment),
      );
  }

  private extractEntityId(params: Record<string, string> | undefined): string {
    if (!params) return '-';
    // Deepest id-like param wins: in /clubs/:clubId/members/:memberId the
    // audited entity is the member, not the club (param order = route order).
    const idLike = Object.entries(params).filter(([key]) => /id$/i.test(key));
    const value = params.id ?? idLike[idLike.length - 1]?.[1];
    return value ? String(value).slice(0, 64) : '-';
  }

  private extractClubId(
    params: Record<string, string> | undefined,
  ): number | undefined {
    const raw = params?.clubId ?? params?.club_id;
    if (raw === undefined) return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  /**
   * Obtener IP real del cliente (considerando proxies)
   */
  private getClientIp(request: any): string {
    return (
      request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      request.headers['x-real-ip'] ||
      request.ip ||
      'unknown'
    );
  }

  /**
   * Sanitizar URL para no exponer información sensible en logs.
   * - Elimina query params (pueden contener tokens o valores sensibles)
   * - Enmascara segmentos de path que parecen tokens largos (>30 chars alfanuméricos)
   *   típicos de FCM tokens, API keys u otros secretos en la URL
   */
  private sanitizeUrl(url: string): string {
    const path = url.split('?')[0];
    return path
      .split('/')
      .map((segment) =>
        /^[A-Za-z0-9_-]{30,}$/.test(segment) ? '[REDACTED]' : segment,
      )
      .join('/');
  }
}
