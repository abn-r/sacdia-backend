import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as Sentry from '@sentry/node';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-session-token',
  'x-refresh-token',
  'cookie',
]);

const SENSITIVE_BODY_FIELDS = new Set([
  'password',
  'refresh_token',
  'refreshToken',
  'access_token',
  'accessToken',
  'blood',
  'birthday',
  'allergies',
  'diseases',
  'medicines',
]);

function redactHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = SENSITIVE_HEADERS.has(key.toLowerCase())
      ? '[REDACTED]'
      : value;
  }
  return result;
}

function redactBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  const sanitized = { ...(body as Record<string, unknown>) };
  for (const field of SENSITIVE_BODY_FIELDS) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }
  return sanitized;
}

@Injectable()
export class SentryInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        const request = context.switchToHttp().getRequest();

        // Set safe context — never send raw headers or body
        Sentry.setContext('request', {
          url: request.url,
          method: request.method,
          headers: redactHeaders(request.headers ?? {}),
          body: redactBody(request.body),
        });

        // Capturar el error en Sentry
        Sentry.captureException(error);

        // Re-throw el error para que NestJS lo maneje normalmente
        return throwError(() => error);
      }),
    );
  }
}
