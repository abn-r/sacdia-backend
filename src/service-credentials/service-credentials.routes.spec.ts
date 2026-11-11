import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AdminRoleRequirementsController } from '../role-requirements/admin-role-requirements.controller';
import {
  AUTHORIZATION_RESOURCE_KEY,
  type AuthorizationResourceMetadata,
} from '../common/decorators/authorization-resource.decorator';
import {
  PERMISSIONS_KEY,
  type PermissionRequirement,
} from '../common/decorators/permissions.decorator';
import { SKIP_PERMISSIONS_KEY } from '../common/decorators/skip-permissions.decorator';
import { ACTING_SCOPE_KEY } from '../auth/acting-for/acting-scope.decorator';
import { MyServiceCredentialsController } from './my-service-credentials.controller';
import { ServiceCredentialsReviewController } from './service-credentials-review.controller';

const reflector = new Reflector();

function routes(controller: new (...args: never[]) => unknown) {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => typeof proto[name] === 'function')
    .filter(
      (name) =>
        Reflect.getMetadata(METHOD_METADATA, proto[name] as object) !==
        undefined,
    )
    .map((name) => ({
      name,
      handler: proto[name] as object,
      path: Reflect.getMetadata(PATH_METADATA, proto[name] as object) as string,
    }));
}

const read = <T>(key: string, controller: object, handler: object) =>
  reflector.getAllAndOverride<T | undefined>(key, [handler, controller]);

describe('service credential routes metadata', () => {
  it('the self-service routes skip permissions and carry no acting scope', () => {
    const found = routes(MyServiceCredentialsController);
    expect(found.map((r) => r.name).sort()).toEqual([
      'confirm',
      'create',
      'list',
      'withdraw',
    ]);
    for (const route of found) {
      expect(
        read(
          SKIP_PERMISSIONS_KEY,
          MyServiceCredentialsController,
          route.handler,
        ),
      ).toBe(true);
      expect(
        read(ACTING_SCOPE_KEY, MyServiceCredentialsController, route.handler),
      ).toBeUndefined();
    }
  });

  it.each([
    [ServiceCredentialsReviewController, 'service_credentials:review', 4],
    [AdminRoleRequirementsController, 'role_requirements:manage', 2],
  ] as const)(
    '%p declares %s and a global resource on every route',
    (controller, permission, count) => {
      const found = routes(controller);
      expect(found).toHaveLength(count);
      for (const route of found) {
        expect(
          read<PermissionRequirement>(
            PERMISSIONS_KEY,
            controller,
            route.handler,
          ),
        ).toEqual({ permissions: [permission], mode: 'all' });
        expect(
          read<AuthorizationResourceMetadata>(
            AUTHORIZATION_RESOURCE_KEY,
            controller,
            route.handler,
          ),
        ).toEqual({ type: 'global' });
        expect(
          read(ACTING_SCOPE_KEY, controller, route.handler),
        ).toBeUndefined();
      }
    },
  );
});
