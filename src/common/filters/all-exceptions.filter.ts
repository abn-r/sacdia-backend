import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import {
  PrismaClientKnownRequestError,
  PrismaClientValidationError,
  PrismaClientUnknownRequestError,
  PrismaClientInitializationError,
} from '@prisma/client/runtime/client';

/**
 * Global exception filter.
 *
 * Responsibilities:
 *   1. NestJS HttpException subclasses (BadRequest, NotFound, Forbidden, ...)
 *      pass through with their real status and message. The filter only
 *      reshapes the response envelope to the canonical error shape.
 *   2. Prisma errors are handled explicitly so that internal details
 *      (table names, column names, constraint names) never leak to the
 *      client in production.
 *   3. Anything else → 500 with a generic message in production, real
 *      message in non-production for debuggability.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

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

      const { status, message } = this.mapPrismaKnownError(exception.code);
      return response.status(status).json({
        status: 'error',
        statusCode: status,
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

      return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: isProduction ? 'Internal server error' : errorMessage,
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

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: 'error',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: isProduction ? 'Internal server error' : errorMessage,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  /**
   * Maps Prisma known error codes to HTTP status + safe client message.
   * Only codes that have a meaningful semantic mapping are listed here.
   * Everything else falls back to 500.
   *
   * Prisma error code reference:
   * https://www.prisma.io/docs/orm/reference/error-reference#prisma-client-query-engine
   */
  private mapPrismaKnownError(code: string): {
    status: number;
    message: string;
  } {
    switch (code) {
      // Unique constraint violation
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: 'Record already exists',
        };

      // Record not found (findUniqueOrThrow / findFirstOrThrow / update / delete)
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Record not found',
        };

      // Foreign key constraint violation
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          message: 'Operation violates a referential integrity constraint',
        };

      // Required relation not found (connect on non-existing record)
      case 'P2015':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Related record not found',
        };

      // All other known Prisma errors → generic 500
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        };
    }
  }
}
