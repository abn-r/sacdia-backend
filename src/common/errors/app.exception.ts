import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/**
 * Structured payload returned by AppException.getResponse().
 * The HttpExceptionFilter reads this to build the translated API response.
 */
export interface AppExceptionPayload {
  code: ErrorCode;
  statusCode: HttpStatus;
  namedArgs?: Record<string, unknown>;
  details?: unknown;
}

/**
 * Base exception for all SACDIA domain errors.
 *
 * Extends HttpException so it is caught by HttpExceptionFilter FIRST
 * (filter registration order: HttpException → AllExceptions), preserving
 * existing filter semantics. AppException adds a typed ErrorCode so the
 * filter can look up the localized message via I18nService.
 *
 * Usage:
 *   throw new AppException(ErrorCode.CLUB_NOT_FOUND, HttpStatus.NOT_FOUND);
 *   throw new AppException(ErrorCode.SOME_ERR, HttpStatus.BAD_REQUEST, { field: 'email' });
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;

  constructor(
    code: ErrorCode,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    namedArgs?: Record<string, unknown>,
    details?: unknown,
  ) {
    const payload: AppExceptionPayload = {
      code,
      statusCode,
      ...(namedArgs !== undefined ? { namedArgs } : {}),
      ...(details !== undefined ? { details } : {}),
    };
    // Pass code as the message string so Logger shows a meaningful entry
    // without revealing user-facing text (translation happens in the filter).
    super(payload, statusCode);
    this.code = code;
  }

  /**
   * Override so the filter can reliably cast to AppExceptionPayload.
   */
  override getResponse(): AppExceptionPayload {
    return super.getResponse() as AppExceptionPayload;
  }
}

// ── Convenience subclasses ───────────────────────────────────────────────────
// These save boilerplate at the call site: no need to import HttpStatus.

export class AppBadRequestException extends AppException {
  constructor(code: ErrorCode, namedArgs?: Record<string, unknown>) {
    super(code, HttpStatus.BAD_REQUEST, namedArgs);
  }
}

export class AppNotFoundException extends AppException {
  constructor(code: ErrorCode, namedArgs?: Record<string, unknown>) {
    super(code, HttpStatus.NOT_FOUND, namedArgs);
  }
}

export class AppUnauthorizedException extends AppException {
  constructor(code: ErrorCode, namedArgs?: Record<string, unknown>) {
    super(code, HttpStatus.UNAUTHORIZED, namedArgs);
  }
}

export class AppForbiddenException extends AppException {
  constructor(code: ErrorCode, namedArgs?: Record<string, unknown>) {
    super(code, HttpStatus.FORBIDDEN, namedArgs);
  }
}

export class AppConflictException extends AppException {
  constructor(code: ErrorCode, namedArgs?: Record<string, unknown>) {
    super(code, HttpStatus.CONFLICT, namedArgs);
  }
}
