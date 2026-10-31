import { Injectable } from '@nestjs/common';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';

const INSURANCE_CONFIG_ROLES = new Set(['director-lf', 'assistant-lf']);
/** Platform administrators configure any local field (decision 2026-10-30). */
const INSURANCE_ADMIN_ROLES = new Set(['admin', 'super-admin']);

export type InsuranceConfigScope = {
  localFieldId: number;
};

@Injectable()
export class InsuranceConfigScopeResolver {
  /**
   * The local field whose insurance products and cycles the actor manages.
   *
   * - director-lf / assistant-lf: their own local field; asking for another
   *   one is refused.
   * - admin / super-admin: the local field of their global scope when they
   *   have one (like a local field role), otherwise the one they request
   *   (`?local_field_id=`), which is then required. Same rule as the
   *   payment order configuration.
   */
  resolve(
    profile: ResolvedAuthorizationProfile,
    requestedLocalFieldId?: number,
  ): InsuranceConfigScope {
    const roles = new Set(
      profile.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );
    const isFieldRole = [...INSURANCE_CONFIG_ROLES].some((role) =>
      roles.has(role),
    );
    const isAdmin = [...INSURANCE_ADMIN_ROLES].some((role) => roles.has(role));

    if (!isFieldRole && !isAdmin) {
      throw new AppForbiddenException(
        ErrorCode.INSURANCE_CONFIG_ROLE_FORBIDDEN,
      );
    }

    const ownLocalFieldId =
      profile.authorization.effective.scope.global.local_field?.id;
    if (typeof ownLocalFieldId === 'number') {
      if (
        requestedLocalFieldId !== undefined &&
        requestedLocalFieldId !== ownLocalFieldId
      ) {
        throw new AppForbiddenException(
          ErrorCode.INSURANCE_CONFIG_LOCAL_FIELD_SCOPE_REQUIRED,
        );
      }
      return { localFieldId: ownLocalFieldId };
    }

    if (isAdmin && requestedLocalFieldId !== undefined) {
      return { localFieldId: requestedLocalFieldId };
    }

    throw new AppForbiddenException(
      ErrorCode.INSURANCE_CONFIG_LOCAL_FIELD_SCOPE_REQUIRED,
    );
  }
}
