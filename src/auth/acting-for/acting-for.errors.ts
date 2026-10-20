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

/**
 * Scope denial for the non-guardian restricted kinds (`supervised_user`,
 * `linked_device`). It is a DIFFERENT code from ACTING_FOR_SCOPE_DENIED on
 * purpose: the app's acting interceptor exits "acting" on the latter, and a
 * teen or a device is never acting for anyone.
 */
export function principalScopeDenied(
  requiredScope: string | null,
  kind: string,
  supervision?: string,
): AppException {
  return new AppException(
    ErrorCode.PRINCIPAL_SCOPE_DENIED,
    HttpStatus.FORBIDDEN,
    undefined,
    {
      required_scope: requiredScope,
      kind,
      ...(supervision !== undefined ? { supervision } : {}),
    },
  );
}

/**
 * True for the 401 the supervised-principal pipeline raises on purpose
 * (disabled, reset, frozen). Guards rethrow it untouched so the app can show
 * the reason instead of the generic GUARD_JWT_UNAUTHORIZED.
 */
export function isSupervisedAccessError(err: unknown): err is AppException {
  return (
    err instanceof AppException &&
    err.code === ErrorCode.AUTH_SUPERVISED_ACCESS_REVOKED
  );
}

export function supervisedAccessRevoked(): AppException {
  return new AppException(
    ErrorCode.AUTH_SUPERVISED_ACCESS_REVOKED,
    HttpStatus.UNAUTHORIZED,
  );
}

const DEVICE_ACCESS_ERROR_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.AUTH_DEVICE_REVOKED,
  ErrorCode.AUTH_DEVICE_SESSION_EXPIRED,
]);

/**
 * True for the 401 the linked-device pipeline raises on purpose (unlinked,
 * kill switch, ineligible, absolute cap). Guards rethrow it untouched so the
 * app can tell "this device was unlinked" from a plain expired token.
 */
export function isDeviceAccessError(err: unknown): err is AppException {
  return err instanceof AppException && DEVICE_ACCESS_ERROR_CODES.has(err.code);
}

export function deviceRevoked(): AppException {
  return new AppException(
    ErrorCode.AUTH_DEVICE_REVOKED,
    HttpStatus.UNAUTHORIZED,
  );
}

export function deviceSessionExpired(): AppException {
  return new AppException(
    ErrorCode.AUTH_DEVICE_SESSION_EXPIRED,
    HttpStatus.UNAUTHORIZED,
  );
}
