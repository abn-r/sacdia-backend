import { ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ACTING_SCOPE_KEY } from '../auth/acting-for/acting-scope.decorator';
import {
  AUTHORIZATION_RESOURCE_KEY,
  PERMISSIONS_KEY,
} from '../common/decorators';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../config/i18n-validation-details';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDirectorDependentDto } from './dto';
import { DirectorDependentsController } from './director-dependents.controller';
import { DirectorDependentsService } from './director-dependents.service';
import { FamilyFeatureFlagsService } from './family-feature-flags.service';

const DIRECTOR = { sub: 'dddddddd-0000-4000-8000-000000000001' };
const SECTION = 22;
const MAIN_CLUB = 10;

const body = {
  name: 'Luis',
  paternal_last_name: 'Pérez',
  birthday: '2016-02-10',
  sworn_declaration: true,
  accepted_terms_version: '2.0.0-family',
  accepted_privacy_version: '2.0.0-family',
};

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    return error as AppException;
  }
  throw new Error('expected a rejection');
}

describe('DirectorDependentsController (POST /club-sections/:clubSectionId/dependents)', () => {
  const service = {
    create: jest.fn().mockResolvedValue({ dependent: { user_id: 'u-1' } }),
  };
  let flagOn = true;
  const flags = {
    assertEnabled: jest.fn((flag: string) => {
      if (flag === 'director_create_minor' && !flagOn) {
        throw new AppException(ErrorCode.FAMILY_FEATURE_DISABLED, 404);
      }
    }),
  };
  let controller: DirectorDependentsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    flagOn = true;
    const module = await Test.createTestingModule({
      controllers: [DirectorDependentsController],
      providers: [
        { provide: DirectorDependentsService, useValue: service },
        { provide: FamilyFeatureFlagsService, useValue: flags },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(DirectorDependentsController);
  });

  it('delegates with the director, the section in the path, the body and the request context, in the success envelope', async () => {
    const req = {
      ip: '10.0.0.9',
      headers: { 'user-agent': 'jest' },
    } as never;

    const result = await controller.create(SECTION, body, DIRECTOR, req);

    expect(result).toEqual({
      status: 'success',
      data: { dependent: { user_id: 'u-1' } },
    });
    expect(service.create).toHaveBeenCalledWith(
      DIRECTOR.sub,
      SECTION,
      body,
      expect.objectContaining({ ipAddress: expect.any(String) }),
    );
  });

  it('flag FAMILY_DIRECTOR_CREATE_MINOR_ENABLED off: 404 FAMILY_FEATURE_DISABLED and the service is never called', async () => {
    flagOn = false;

    const error = await rejection(
      controller.create(SECTION, body, DIRECTOR, {}),
    );

    expect(error.code).toBe(ErrorCode.FAMILY_FEATURE_DISABLED);
    expect(error.getStatus()).toBe(404);
    expect(flags.assertEnabled).toHaveBeenCalledWith('director_create_minor');
    expect(service.create).not.toHaveBeenCalled();
  });

  describe('metadata (default deny)', () => {
    const handler = DirectorDependentsController.prototype.create;

    it('needs dependents:create on the club_section of the path', () => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
        permissions: ['dependents:create'],
        mode: 'all',
      });
      expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
        type: 'club_section',
        idParam: 'clubSectionId',
      });
    });

    it('declares NO acting scope: guardian_acting, supervised_user and linked_device are denied by default', () => {
      expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBeUndefined();
      expect(
        Reflect.getMetadata(ACTING_SCOPE_KEY, DirectorDependentsController),
      ).toBeUndefined();
    });

    it('limits to 30 creations per hour per director on every throttler tier', () => {
      for (const tier of ['short', 'medium', 'long']) {
        expect(Reflect.getMetadata(`THROTTLER:LIMIT${tier}`, handler)).toBe(30);
        expect(Reflect.getMetadata(`THROTTLER:TTL${tier}`, handler)).toBe(
          3_600_000,
        );
      }
    });
  });

  describe('body validation (global pipe options: whitelist + forbidNonWhitelisted)', () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const check = (value: unknown) =>
      pipe.transform(value, {
        type: 'body',
        metatype: CreateDirectorDependentDto,
      });

    it('sworn_declaration:false is a 400', async () => {
      await expect(
        check({ ...body, sworn_declaration: false }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it.each(['email', 'access_mode', 'account'])(
      'a body with %s is rejected with 400 and never reaches the service',
      async (key) => {
        await expect(check({ ...body, [key]: 'x' })).rejects.toMatchObject({
          status: 400,
        });
        expect(service.create).not.toHaveBeenCalled();
      },
    );

    it('a valid body passes', async () => {
      await expect(check(body)).resolves.toMatchObject({ name: 'Luis' });
    });
  });
});

/**
 * The REAL PermissionsGuard against the REAL route metadata: who may reach the
 * handler. Only the profile loader and Prisma are doubles; the territory and
 * section decision is production code.
 */
describe('DirectorDependentsController permissions (real PermissionsGuard)', () => {
  const club = { club_id: MAIN_CLUB, club_name: 'Club Amanecer' };

  function clubRoleProfile(
    roleName: string,
    permissions: string[],
    sectionId: number,
  ) {
    const section = { club_section_id: sectionId, club_type_id: 2 };
    return {
      authorization: {
        grants: {
          global_roles: [],
          club_assignments: [
            {
              assignment_id: 'assignment-1',
              role_name: roleName,
              permissions,
              operational: true,
              club,
              section,
              scope: {},
              status: 'active',
            },
          ],
          direct_permissions: [],
        },
        active_assignment: { assignment_id: 'assignment-1' },
        effective: {
          permissions,
          scope: {
            global: {},
            club: {
              assignment_id: 'assignment-1',
              role_name: roleName,
              club,
              section,
            },
          },
        },
      },
    };
  }

  function guardFor(profile: unknown) {
    const hierarchy = {
      resolveCurrent: jest.fn().mockResolvedValue({
        division_id: 1,
        union_id: 70,
        local_field_id: 50,
        club_id: MAIN_CLUB,
        as_of: new Date(),
        source: 'current',
        precision: 'club',
      }),
    };
    const prisma = {
      club_sections: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve({
            club_section_id: where.club_section_id,
            main_club_id: MAIN_CLUB,
            club_type_id: 2,
          }),
        ),
      },
    };
    const authorizationContext = new AuthorizationContextService(
      prisma as unknown as PrismaService,
      hierarchy as unknown as InstitutionalHierarchyService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(authorizationContext, 'resolveUserAuthorization')
      .mockResolvedValue(profile);
    return new PermissionsGuard(
      new Reflector(),
      authorizationContext,
      prisma as unknown as PrismaService,
      hierarchy as unknown as InstitutionalHierarchyService,
    );
  }

  const context = (sectionInPath: number): ExecutionContext => {
    const request = {
      user: DIRECTOR,
      params: { clubSectionId: String(sectionInPath) },
      query: {},
      body: {},
    };
    return {
      getHandler: () => DirectorDependentsController.prototype.create,
      getClass: () => DirectorDependentsController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  const decide = async (guard: PermissionsGuard, section: number) => {
    try {
      return { allowed: await guard.canActivate(context(section)) };
    } catch (error) {
      return {
        allowed: false,
        code: (error as { code?: string }).code,
        status: (error as { getStatus?: () => number }).getStatus?.(),
      };
    }
  };

  afterEach(() => jest.restoreAllMocks());

  it('the director of the section may create a minor in it', async () => {
    const guard = guardFor(
      clubRoleProfile('director', ['dependents:create'], SECTION),
    );

    expect(await decide(guard, SECTION)).toEqual({ allowed: true });
  });

  it('the director of ANOTHER section is 403 GUARD_CLUB_SCOPE_REQUIRED', async () => {
    const guard = guardFor(
      clubRoleProfile('director', ['dependents:create'], SECTION),
    );

    expect(await decide(guard, 99)).toEqual({
      allowed: false,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      status: 403,
    });
  });

  it('a member without dependents:create is 403 GUARD_PERMISSION_DENIED', async () => {
    const guard = guardFor(
      clubRoleProfile(
        'member',
        ['classes:read', 'club_members:approve'],
        SECTION,
      ),
    );

    expect(await decide(guard, SECTION)).toEqual({
      allowed: false,
      code: ErrorCode.GUARD_PERMISSION_DENIED,
      status: 403,
    });
  });
});
