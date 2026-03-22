import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as Sentry from '@sentry/node';

@Injectable()
export class SentryInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        // Capturar el error en Sentry
        Sentry.captureException(error);

        // Agregar contexto adicional
        const request = context.switchToHttp().getRequest();
        Sentry.setContext('request', {
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: request.body,
        });

        // Re-throw el error para que NestJS lo maneje normalmente
        return throwError(() => error);
      }),
    );
  }
}
