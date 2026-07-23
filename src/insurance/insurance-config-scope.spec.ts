import { ErrorCode } from '../common/errors/error-codes';
import { InsuranceConfigScopeResolver } from './insurance-config-scope';

describe('InsuranceConfigScopeResolver', () => {
  const resolver = new InsuranceConfigScopeResolver();

  const profileFor = (
    roleName: string,
    localFieldId: number | string | undefined = 41,
  ) =>
    ({
      authorization: {
        grants: { global_roles: [{ role_name: roleName }] },
        effective: {
          scope: {
            global:
              localFieldId === undefined
                ? {}
                : { local_field: { id: localFieldId } },
          },
        },
      },
    }) as any;

  it.each(['director-lf', 'assistant-lf'])(
    'derives Campo only from the effective scope for %s',
    (roleName) => {
      expect(resolver.resolve(profileFor(roleName, 73))).toEqual({
        localFieldId: 73,
      });
    },
  );

  it('rejects a role other than director-lf or assistant-lf', () => {
    expect(() => resolver.resolve(profileFor('director-union'))).toThrow(
      expect.objectContaining({
        code: ErrorCode.INSURANCE_CONFIG_ROLE_FORBIDDEN,
      }),
    );
  });

  it('rejects a local field scope that is absent or not numeric', () => {
    const withoutLocalField = profileFor('director-lf');
    withoutLocalField.authorization.effective.scope.global = {};
    expect(() => resolver.resolve(withoutLocalField)).toThrow(
      expect.objectContaining({
        code: ErrorCode.INSURANCE_CONFIG_LOCAL_FIELD_SCOPE_REQUIRED,
      }),
    );
    expect(() => resolver.resolve(profileFor('director-lf', '41'))).toThrow(
      expect.objectContaining({
        code: ErrorCode.INSURANCE_CONFIG_LOCAL_FIELD_SCOPE_REQUIRED,
      }),
    );
  });
});
