import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
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
 * Filtro para excepciones no manejadas (errores inesperados).
 * Captura cualquier error que no sea HttpException.
 * Siempre retorna 500 con mensaje genérico en producción.
 *
 * Prisma errors are handled explicitly so that internal details
 * (table names, column names, constraint names) are never leaked
 * to the client in any environment.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const errorMessage =
      exception instanceof Error ? exception.message : 'Unknown error';
    const errorStack = exception instanceof Error ? exception.stack : undefined;

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
        message: 'Internal server error',
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
      stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
    });

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: 'error',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : errorMessage,
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
