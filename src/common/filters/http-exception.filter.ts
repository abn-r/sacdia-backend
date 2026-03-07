import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

/**
 * Filtro global de excepciones HTTP.
 * En producción oculta detalles de implementación.
 * En desarrollo muestra errores detallados.
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const logPayload = {
      timestamp: new Date().toISOString(),
      method: request.method,
      url: request.url,
      status,
      message: exception.message,
      validationDetails: exceptionResponse,
      requestBody:
        process.env.NODE_ENV === 'development'
          ? this.sanitizeRequestBody(request.url, request.body)
          : undefined,
      stack:
        process.env.NODE_ENV === 'development' && status !== HttpStatus.UNAUTHORIZED
          ? exception.stack
          : undefined,
    };

    // En 401 el comportamiento esperado puede ser común (token expirado), por eso WARN.
    if (status === HttpStatus.UNAUTHORIZED) {
      this.logger.warn(logPayload);
    } else {
      this.logger.error(logPayload);
    }

    // En producción: errores genéricos para >= 500
    if (process.env.NODE_ENV === 'production') {
      response.status(status).json({
        status: 'error',
        statusCode: status,
        message:
          status >= HttpStatus.INTERNAL_SERVER_ERROR
            ? 'Internal server error'
            : this.extractMessage(exceptionResponse),
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    } else {
      // En desarrollo: errores detallados
      response.status(status).json({
        status: 'error',
        statusCode: status,
        message: exception.message,
        details:
          typeof exceptionResponse === 'object'
            ? exceptionResponse
            : { message: exceptionResponse },
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }
  }

  private extractMessage(response: string | object): string {
    if (typeof response === 'string') {
      return response;
    }
    if (typeof response === 'object' && 'message' in response) {
      const message = (response as any).message;
      return Array.isArray(message) ? message[0] : message;
    }
    return 'An error occurred';
  }

  private sanitizeRequestBody(url: string, body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;
    if (!url.includes('/auth/login')) return body;

    return this.maskEmailInObject(body);
  }

  private maskEmailInObject(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.maskEmailInObject(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const source = value as Record<string, unknown>;
    const masked: Record<string, unknown> = {};

    for (const [key, raw] of Object.entries(source)) {
      if (key.toLowerCase() === 'email' && typeof raw === 'string') {
        masked[key] = this.maskEmail(raw);
      } else {
        masked[key] = this.maskEmailInObject(raw);
      }
    }

    return masked;
  }

  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) return '***';

    const visibleLocal = localPart.length <= 2 ? localPart[0] ?? '*' : localPart.slice(0, 2);
    return `${visibleLocal}***@${domain}`;
  }
}
