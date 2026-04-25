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
import {
  PrismaClientKnownRequestError,
  PrismaClientValidationError,
  PrismaClientUnknownRequestError,
  PrismaClientInitializationError,
} from '@prisma/client/runtime/client';
import { I18nService, I18nContext } from 'nestjs-i18n';
import { ErrorCode } from '../errors/error-codes';

/**
 * Global exception filter.
 *
 * Responsibilities:
 *   1. NestJS HttpException subclasses (BadRequest, NotFound, Forbidden, ...)
 *      pass through with their real status and message. The filter only
 *      reshapes the response envelope to the canonical error shape.
 *      NOTE: AppException (extends HttpException) is caught by HttpExceptionFilter
 *      FIRST due to specificity — this branch handles only vanilla HttpExceptions
 *      that somehow escape the specific filter.
 *   2. Prisma errors are handled explicitly so that internal details
 *      (table names, column names, constraint names) never leak to the
 *      client in production. Adds a typed `code` for Phase B migration.
 *   3. Anything else → 500 with a generic message in production, real
 *      message in non-production for debuggability.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const isProduction = process.env.NODE_ENV === 'production';

    const errorMessage =
      exception instanceof Error ? exception.message : 'Unknown error';
    const errorStack = exception instanceof Error ? exception.stack : undefined;

    // -------------------------------------------------------
    // NestJS HttpException — pass through with real status
    // (AppException is handled by HttpExceptionFilter before reaching here;
    //  this branch is a safety net for any vanilla HttpException that reaches
    //  AllExceptionsFilter, e.g. thrown outside an HTTP context.)
    // -------------------------------------------------------
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string'
          ? raw
          : ((raw as { message?: unknown }).message ?? exception.message);

      return response.status(status).json({
        status: 'error',
        statusCode: status,
        message,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }

    // -------------------------------------------------------
    // Prisma error handling — log full detail, return sanitized
    // -------------------------------------------------------
    if (exception instanceof PrismaClientKnownRequestError) {
      this.logger.error({
        timestamp: new Date().toISOString(),
        method: request.method,
        url: request.url,
        prismaCode: exception.code,
        message: errorMessage,
        meta: exception.meta,
        stack: errorStack,
      });

      const { status, code } = this.mapPrismaKnownError(exception.code);
      const lang = this.resolveLang(host);
      const message = this.translateSafe(code, lang);

      return response.status(status).json({
        status: 'error',
        statusCode: status,
        code,
        message,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }

    if (
      exception instanceof PrismaClientValidationError ||
      exception instanceof PrismaClientUnknownRequestError ||
      exception instanceof PrismaClientInitializationError
    ) {
      this.logger.error({
        timestamp: new Date().toISOString(),
        method: request.method,
        url: request.url,
        errorType: exception.constructor.name,
        message: errorMessage,
        stack: errorStack,
      });

      const lang = this.resolveLang(host);
      const message = this.translateSafe(
        ErrorCode.INTERNAL_SERVER_ERROR,
        lang,
      );

      return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: isProduction ? message : errorMessage,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }

    // -------------------------------------------------------
    // Generic unhandled exception — log and return 500
    // -------------------------------------------------------
    this.logger.error({
      timestamp: new Date().toISOString(),
      method: request.method,
      url: request.url,
      message: errorMessage,
      stack: isProduction ? undefined : errorStack,
    });

    const lang = this.resolveLang(host);
    const genericMessage = this.translateSafe(
      ErrorCode.INTERNAL_SERVER_ERROR,
      lang,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: 'error',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: isProduction ? genericMessage : errorMessage,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  /**
   * Maps Prisma known error codes to HTTP status + typed ErrorCode.
   * Only codes that have a meaningful semantic mapping are listed here.
   * Everything else falls back to 500.
   *
   * Prisma error code reference:
   * https://www.prisma.io/docs/orm/reference/error-reference#prisma-client-query-engine
   */
  private mapPrismaKnownError(prismaCode: string): {
    status: number;
    code: ErrorCode;
  } {
    switch (prismaCode) {
      // Unique constraint violation
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.RECORD_CONFLICT,
        };

      // Record not found (findUniqueOrThrow / findFirstOrThrow / update / delete)
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: ErrorCode.RECORD_NOT_FOUND,
        };

      // Foreign key constraint violation
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.RECORD_FK_VIOLATION,
        };

      // Required relation not found (connect on non-existing record)
      case 'P2015':
        return {
          status: HttpStatus.NOT_FOUND,
          code: ErrorCode.RECORD_RELATED_NOT_FOUND,
        };

      // All other known Prisma errors → generic 500
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ErrorCode.INTERNAL_SERVER_ERROR,
        };
    }
  }

  /**
   * Resolves the request locale using I18nContext with a fallback chain.
   */
  private resolveLang(host: ArgumentsHost): string {
    const i18nCtx = I18nContext.current(host);
    if (i18nCtx?.lang) {
      return i18nCtx.lang;
    }

    const request = host.switchToHttp().getRequest<Request>();
    const acceptLang = request.headers['accept-language'];
    if (acceptLang) {
      const primary = acceptLang.split(',')[0].trim().split(';')[0].trim();
      return primary || 'es';
    }

    return 'es';
  }

  /**
   * Translates an ErrorCode safely, falling back to the code string itself
   * if the translation key is missing (prevents 500 inside an error handler).
   */
  private translateSafe(code: ErrorCode, lang: string): string {
    try {
      return this.i18n.translate(`errors.${code}`, { lang }) as string;
    } catch {
      return code;
    }
  }
}
