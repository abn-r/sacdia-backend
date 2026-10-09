import { HttpStatus, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { SKIP_PERMISSIONS_KEY } from '../common/decorators/skip-permissions.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { InvestitureController } from './investiture.controller';
import { RETIRED_LEGACY_INVESTITURE_ROUTES } from './legacy-investiture-pipeline-retired';
import { LegacyInvestitureRetiredController } from './legacy-investiture-retired.controller';

type Route = { method: RequestMethod; path: string };

function routeOf(prototype: object, name: string): Route {
  const handler = (prototype as Record<string, object>)[name];
  return {
    method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
    path: Reflect.getMetadata(PATH_METADATA, handler) as string,
  };
}

function expected(method: string, path: string): Route {
  return {
    method: RequestMethod[method as keyof typeof RequestMethod],
    path,
  };
}

describe('LegacyInvestitureRetiredController', () => {
  const controller =
    new LegacyInvestitureRetiredController() as unknown as Record<
      string,
      () => never
    >;

  it('lists the 17 retired routes', () => {
    expect(RETIRED_LEGACY_INVESTITURE_ROUTES).toHaveLength(17);
  });

  it.each(RETIRED_LEGACY_INVESTITURE_ROUTES)(
    '$method $path answers 410 with a stable code',
    ({ method, path, handler }) => {
      expect(
        routeOf(LegacyInvestitureRetiredController.prototype, handler),
      ).toEqual(expected(method, path));
      let thrown: unknown;
      try {
        controller[handler]();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppException);
      expect((thrown as AppException).getStatus()).toBe(HttpStatus.GONE);
      expect((thrown as AppException).code).toBe(
        ErrorCode.INVESTITURE_LEGACY_PIPELINE_RETIRED,
      );
    },
  );

  it('asks only for a session, never for a retired permission', () => {
    expect(
      Reflect.getMetadata(
        SKIP_PERMISSIONS_KEY,
        LegacyInvestitureRetiredController,
      ),
    ).toBe(true);
  });

  it('leaves no retired route on InvestitureController', () => {
    const live = Object.getOwnPropertyNames(InvestitureController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => routeOf(InvestitureController.prototype, name))
      .filter((route) => route.path !== undefined);
    for (const retired of RETIRED_LEGACY_INVESTITURE_ROUTES) {
      expect(live).not.toContainEqual(expected(retired.method, retired.path));
    }
    expect(live).toEqual(
      expect.arrayContaining([
        expected('POST', 'admin/classes/enrollments/expire-overdue'),
        expected('GET', 'investiture/enrollments/:enrollmentId/history'),
        expected('GET', 'enrollments/:enrollmentId/investiture-history'),
      ]),
    );
  });
});
