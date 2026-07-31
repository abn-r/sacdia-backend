import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { I18nService, I18nContext } from 'nestjs-i18n';
import { maskEmail } from '../utils/mask-email.util';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

const PUBLIC_DETAIL_CODES = new Set<ErrorCode>([
  ErrorCode.ECCLESIASTICAL_CYCLE_CAPABILITY_UNAVAILABLE,
  ErrorCode.ECCLESIASTICAL_CYCLE_CAPABILITY_VERSION_INCOMPATIBLE,
]);
const PUBLIC_DETAIL_FIELDS = [
  'dependency',
  'expectedVersion',
  'receivedVersion',
  'reason',
] as const;

/**
 * Filtro global de excepciones HTTP.
 *
 * - Si la excepción es AppException (domain error): traduce el mensaje vía
 *   I18nService y añade el campo `code` a la respuesta.
 * - Si es una HttpException vanilla: ruta existente sin `code` (backward compat).
 *
 * En producción oculta detalles de implementación.
 * En desarrollo muestra errores detallados.
 */
@Injectable()
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  constructor(private readonly i18n: I18nService) {}

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
      validationDetails: this.sanitizeValidationDetails(exceptionResponse),
      requestBody:
        process.env.NODE_ENV === 'development'
          ? this.sanitizeRequestBody(request.url, request.body)
          : undefined,
      stack:
        process.env.NODE_ENV === 'development' &&
        status !== HttpStatus.UNAUTHORIZED
          ? exception.stack
          : undefined,
    };

    // En 401 el comportamiento esperado puede ser común (token expirado), por eso WARN.
    if (status === HttpStatus.UNAUTHORIZED) {
      this.logger.warn(logPayload);
    } else {
      this.logger.error(logPayload);
    }

    // ── AppException: domain error with ErrorCode ──────────────────────────
    if (exception instanceof AppException) {
      const { code, namedArgs, details, publicDetails } =
        exception.getResponse();
      const lang = this.resolveLang(host);
      const safePublicDetails = this.pickPublicDetails(code, publicDetails);
      const responseDetails =
        safePublicDetails ??
        (process.env.NODE_ENV !== 'production' ? details : undefined);

      let translatedMessage: string;
      try {
        translatedMessage = this.i18n.translate(`errors.${code}`, {
          lang,
          args: namedArgs ?? {},
        });
      } catch {
        // Fallback: use code itself if translation key is missing
        translatedMessage = code;
      }

      // Production: mask 5xx even for domain errors
      const maskedMessage =
        process.env.NODE_ENV === 'production' &&
        status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? this.i18n.translate(`errors.${ErrorCode.INTERNAL_SERVER_ERROR}`, {
              lang,
            })
          : translatedMessage;

      return response.status(status).json({
        status: 'error',
        statusCode: status,
        code,
        message: maskedMessage,
        ...(responseDetails !== undefined ? { details: responseDetails } : {}),
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }

    // ── Vanilla HttpException: backward-compatible path, no `code` field ───
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

  private pickPublicDetails(
    code: ErrorCode,
    source: Record<string, unknown> | undefined,
  ): Record<string, string | number | boolean | null> | undefined {
    if (!PUBLIC_DETAIL_CODES.has(code) || !source) return undefined;
    const result = Object.fromEntries(
      PUBLIC_DETAIL_FIELDS.filter((field) =>
        this.isPublicDetailValue(source[field]),
      ).map((field) => [
        field,
        source[field] as string | number | boolean | null,
      ]),
    );
    return Object.keys(result).length ? result : undefined;
  }

  private isPublicDetailValue(
    value: unknown,
  ): value is string | number | boolean | null {
    return (
      value === null || ['string', 'number', 'boolean'].includes(typeof value)
    );
  }

  /**
   * Resolves the request locale using I18nContext (set by nestjs-i18n middleware)
   * with a fallback chain: I18nContext → Accept-Language header → 'es'.
   */
  private resolveLang(host: ArgumentsHost): string {
    // I18nContext.current() works when nestjs-i18n middleware has populated CLS
    const i18nCtx = I18nContext.current(host);
    if (i18nCtx?.lang) {
      return i18nCtx.lang;
    }

    // Fallback: read Accept-Language header directly
    const request = host.switchToHttp().getRequest<Request>();
    const acceptLang = request.headers['accept-language'];
    if (acceptLang) {
      const primary = acceptLang.split(',')[0].trim().split(';')[0].trim();
      return primary || 'es';
    }

    return 'es';
  }

  /**
   * Strips submitted user values from validation error details before logging.
   * Keeps constraint names and counts so developers can diagnose failures,
   * but never persists PII or arbitrary user input to the log stream.
   */
  private sanitizeValidationDetails(response: any): any {
    if (typeof response === 'string') return response;
    if (response?.message && Array.isArray(response.message)) {
      // Only keep the constraint messages (field + rule), not submitted values
      return {
        constraints: response.message.length,
        messages: response.message,
      };
    }
    return { type: typeof response };
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

  /**
   * Redacts sensitive fields from any request body before they reach the log stream.
   *
   * Strategy: key-name matching (case-insensitive) against a well-known set of
   * sensitive field names.  Values are replaced with `[REDACTED]` so the log
   * shows that the field was present without leaking its contents.
   *
   * Email is handled specially: it is partially masked (user@domain → u***@domain)
   * instead of fully redacted so developers can correlate failing requests to accounts
   * without seeing the full address.
   *
   * SECURITY: This is defence-in-depth for dev logs.  Production already skips
   * requestBody entirely (see the caller in `catch()`).
   */
  private sanitizeRequestBody(_url: string, body: unknown): unknown {
    return this.redactSensitiveKeys(body);
  }

  private redactSensitiveKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactSensitiveKeys(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, raw] of Object.entries(source)) {
      const lk = key.toLowerCase();

      if (lk === 'email' && typeof raw === 'string') {
        result[key] = maskEmail(raw);
      } else if (HttpExceptionFilter.SENSITIVE_KEYS.has(lk)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = this.redactSensitiveKeys(raw);
      }
    }

    return result;
  }

  /**
   * Lowercase field names that must never appear in logs.
   *
   * Covers: password variants, tokens, secrets, OTP/MFA codes, PINs, SSNs,
   * credit card numbers, CVV, IBAN, and any key containing "secret".
   */
  private static readonly SENSITIVE_KEYS = new Set([
    'password',
    'currentpassword',
    'newpassword',
    'oldpassword',
    'confirm_password',
    'confirmpassword',
    'password_confirmation',
    'passwordconfirmation',
    'token',
    'access_token',
    'accesstoken',
    'refresh_token',
    'refreshtoken',
    'session_token',
    'sessiontoken',
    'id_token',
    'idtoken',
    'authorization',
    'secret',
    'client_secret',
    'clientsecret',
    'api_key',
    'apikey',
    'private_key',
    'privatekey',
    'otp',
    'totp',
    'mfa_code',
    'mfacode',
    'code',
    'pin',
    'ssn',
    'social_security_number',
    'credit_card',
    'creditcard',
    'card_number',
    'cardnumber',
    'cvv',
    'cvc',
    'iban',
  ]);
}
