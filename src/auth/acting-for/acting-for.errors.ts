import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

const ACTING_FOR_ERROR_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.ACTING_FOR_HEADER_INVALID,
  ErrorCode.ACTING_FOR_FORBIDDEN,
  ErrorCode.ACTING_FOR_SCOPE_DENIED,
]);

/**
 * True for the errors the acting-for machinery raises on purpose. Guards must
 * rethrow them untouched: converting them to a 401 would log the guardian out
 * for a problem that only concerns the acted profile.
 */
export function isActingForError(err: unknown): err is AppException {
  return err instanceof AppException && ACTING_FOR_ERROR_CODES.has(err.code);
}

export function actingForHeaderInvalid(): AppException {
  return new AppException(
    ErrorCode.ACTING_FOR_HEADER_INVALID,
    HttpStatus.BAD_REQUEST,
  );
}

/**
 * Uniform denial: unknown, revoked, foreign, frozen, has-account and over-age
 * dependents all produce this exact body, so nothing can be enumerated.
 */
export function actingForForbidden(): AppException {
  return new AppException(ErrorCode.ACTING_FOR_FORBIDDEN, HttpStatus.FORBIDDEN);
}

export function actingForScopeDenied(
  requiredScope: string | null,
): AppException {
  return new AppException(
    ErrorCode.ACTING_FOR_SCOPE_DENIED,
    HttpStatus.FORBIDDEN,
    undefined,
    { required_scope: requiredScope },
  );
}
