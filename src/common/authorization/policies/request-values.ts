import { isUUID } from 'class-validator';
import {
  AppBadRequestException,
  AppForbiddenException,
} from '../../errors/app.exception';
import { ErrorCode } from '../../errors/error-codes';

/**
 * Same shape `ParseUUIDPipe` accepts (and Postgres `uuid` parses). Stricter
 * `isUUID(…, 'all')` rejects non-RFC variants that are valid ids in the DB.
 */
export const UUID_PARAM_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getRequestValue(
  request: any,
  source: 'param' | 'query' | 'body',
  field: string,
): unknown {
  switch (source) {
    case 'query':
      return request.query?.[field];
    case 'body':
      return request.body?.[field];
    case 'param':
    default:
      return request.params?.[field];
  }
}

export function getRequiredNumericValue(
  value: unknown,
  _errorMessage: string,
): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsed)) {
    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  return parsed;
}

/**
 * Guards run before `ParseUUIDPipe`, so a malformed id would otherwise reach
 * a `@db.Uuid` lookup and surface as a 500. Missing/empty → `null` (callers
 * keep their own 403); present but not a UUID → 400.
 */
export function getOptionalUuidValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string' || !UUID_PARAM_PATTERN.test(value)) {
    throw new AppBadRequestException(ErrorCode.GUARD_ID_PARAM_INVALID);
  }

  return value;
}

/**
 * Tenant ids must be a positive integer or its plain decimal string form.
 * Arrays, objects and partially numeric strings ("20abc") are rejected.
 */
export function parseTenantId(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }

  throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
}

/** Entity UUIDs are checked before they reach a `@db.Uuid` lookup. */
export function parseEntityUuid(value: unknown): string {
  if (typeof value === 'string' && isUUID(value, 'all')) {
    return value;
  }

  throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
}

export function requireMainClubId(
  value: number | null | undefined,
  _errorMessage: string,
): number {
  if (!Number.isFinite(value)) {
    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  return value as number;
}
