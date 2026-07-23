import { Injectable } from '@nestjs/common';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';

const INSURANCE_CONFIG_ROLES = new Set(['director-lf', 'assistant-lf']);

export type InsuranceConfigScope = {
  localFieldId: number;
};

@Injectable()
export class InsuranceConfigScopeResolver {
  resolve(profile: ResolvedAuthorizationProfile): InsuranceConfigScope {
    const roles = new Set(
      profile.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );

    if (![...INSURANCE_CONFIG_ROLES].some((role) => roles.has(role))) {
      throw new AppForbiddenException(
        ErrorCode.INSURANCE_CONFIG_ROLE_FORBIDDEN,
      );
    }

    const localFieldId =
      profile.authorization.effective.scope.global.local_field?.id;
    if (typeof localFieldId !== 'number') {
      throw new AppForbiddenException(
        ErrorCode.INSURANCE_CONFIG_LOCAL_FIELD_SCOPE_REQUIRED,
      );
    }

    return { localFieldId };
  }
}
