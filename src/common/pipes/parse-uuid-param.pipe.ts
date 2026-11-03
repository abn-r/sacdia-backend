import { Injectable, ParseUUIDPipe } from '@nestjs/common';
import { AppBadRequestException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

/**
 * `ParseUUIDPipe` that answers with the shared `GUARD_ID_PARAM_INVALID` code
 * (localized) instead of Nest's English message without `code`. Same error the
 * `PermissionsGuard` returns for malformed id params.
 *
 * Pass `{ optional: true }` for optional headers/query values: `undefined`
 * goes through untouched, anything else is still validated.
 */
@Injectable()
export class ParseUuidParamPipe extends ParseUUIDPipe {
  constructor(options?: { optional?: boolean }) {
    super({
      ...options,
      exceptionFactory: () =>
        new AppBadRequestException(ErrorCode.GUARD_ID_PARAM_INVALID),
    });
  }
}
