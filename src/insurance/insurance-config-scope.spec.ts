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

  const withoutLocalField = (roleName: string) => {
    const profile = profileFor(roleName);
    profile.authorization.effective.scope.global = {};
    return profile;
  };

  it('refuses a local field role that asks for another local field', () => {
    expect(() => resolver.resolve(profileFor('director-lf', 73), 74)).toThrow(
      expect.objectContaining({
        code: ErrorCode.INSURANCE_CONFIG_LOCAL_FIELD_SCOPE_REQUIRED,
      }),
    );
  });

  it.each(['admin', 'super-admin'])(
    'lets %s without a local field configure the requested one',
    (roleName) => {
      expect(resolver.resolve(withoutLocalField(roleName), 4)).toEqual({
        localFieldId: 4,
      });
    },
  );

  it.each(['admin', 'super-admin'])(
    'requires %s without a local field to name one',
    (roleName) => {
      expect(() => resolver.resolve(withoutLocalField(roleName))).toThrow(
        expect.objectContaining({
          code: ErrorCode.INSURANCE_CONFIG_LOCAL_FIELD_SCOPE_REQUIRED,
        }),
      );
    },
  );

  it('keeps an admin with a local field to that one', () => {
    expect(resolver.resolve(profileFor('admin', 41))).toEqual({
      localFieldId: 41,
    });
  });

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
