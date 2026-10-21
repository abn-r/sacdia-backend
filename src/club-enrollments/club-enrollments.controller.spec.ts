import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClubEnrollmentsController } from './club-enrollments.controller';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  AUTHORIZATION_RESOURCE_KEY,
  PERMISSIONS_KEY,
} from '../common/decorators';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthorizationContextService } from '../common/services/authorization-context.service';
import type { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';
import type { PrismaService } from '../prisma/prisma.service';

type Handler = 'create' | 'findAll' | 'findCurrent' | 'update';

const PERMISSION_BY_HANDLER: Record<Handler, string> = {
  create: 'club_instances:create',
  findAll: 'club_instances:read',
  findCurrent: 'club_instances:read',
  update: 'club_instances:update',
};

const HANDLERS = Object.keys(PERMISSION_BY_HANDLER) as Handler[];

describe('ClubEnrollmentsController section binding', () => {
  const proto = ClubEnrollmentsController.prototype;

  describe('authorization metadata', () => {
    it.each(HANDLERS)(
      '%s binds the sectionId in the path to the clubId in the path',
      (handler) => {
        expect(
          Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, proto[handler]),
        ).toEqual({
          type: 'club_section',
          clubIdParam: 'clubId',
          idParam: 'sectionId',
        });
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, proto[handler]).permissions,
        ).toEqual([PERMISSION_BY_HANDLER[handler]]);
      },
    );
  });

  describe('real PermissionsGuard against the real route metadata', () => {
    const ACTOR = 'club-10-section-22-director';
    const mockPrisma = { club_sections: { findUnique: jest.fn() } };
    const mockAuthorizationContext = {
      resolveUserAuthorization: jest.fn(),
      canManageClub: jest.fn(),
    };
    const guard = new PermissionsGuard(
      new Reflector(),
      mockAuthorizationContext as unknown as AuthorizationContextService,
      mockPrisma as unknown as PrismaService,
      {} as unknown as InstitutionalHierarchyService,
    );

    const permissions = Object.values(PERMISSION_BY_HANDLER);
    const resolvedDirector = {
      authorization: {
        grants: {
          global_roles: [],
          direct_permissions: [],
          club_assignments: [
            {
              assignment_id: 'a-1',
              role_name: 'director',
              permissions,
              club: { club_id: 10, club_name: 'Club A' },
              section: { club_section_id: 22, club_type_name: 'pathfinders' },
              scope: {},
              status: 'active',
            },
          ],
        },
        active_assignment: { assignment_id: 'a-1' },
        effective: {
          permissions,
          scope: {
            global: {},
            club: {
              assignment_id: 'a-1',
              role_name: 'director',
              club: { club_id: 10, club_name: 'Club A' },
              section: { club_section_id: 22, club_type_name: 'pathfinders' },
            },
          },
        },
      },
    };

    const contextFor = (
      handler: Handler,
      params: Record<string, string>,
    ): ExecutionContext =>
      ({
        getHandler: () => proto[handler],
        getClass: () => ClubEnrollmentsController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { sub: ACTOR }, params, query: {} }),
        }),
      }) as unknown as ExecutionContext;

    const paramsFor = (handler: Handler, clubId: string, sectionId: string) =>
      handler === 'update'
        ? { clubId, sectionId, enrollmentId: 'e-1' }
        : { clubId, sectionId };

    beforeEach(() => {
      jest.clearAllMocks();
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        resolvedDirector,
      );
      mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    });

    it.each(HANDLERS)(
      '%s: a section of ANOTHER club in the path is rejected as not found',
      async (handler) => {
        // Section 44 belongs to club 99; the actor holds the permission on club 10.
        mockPrisma.club_sections.findUnique.mockResolvedValue({
          club_section_id: 44,
          main_club_id: 99,
          club_type_id: 2,
        });

        await expect(
          guard.canActivate(contextFor(handler, paramsFor(handler, '10', '44'))),
        ).rejects.toMatchObject({ code: ErrorCode.CLUB_SECTION_NOT_FOUND });
      },
    );

    it.each(HANDLERS)(
      '%s: a non-existent section is rejected as not found',
      async (handler) => {
        mockPrisma.club_sections.findUnique.mockResolvedValue(null);

        await expect(
          guard.canActivate(
            contextFor(handler, paramsFor(handler, '10', '9999')),
          ),
        ).rejects.toMatchObject({ code: ErrorCode.CLUB_SECTION_NOT_FOUND });
      },
    );

    it.each(HANDLERS)(
      '%s: another section of the SAME club, outside the actor scope, is forbidden',
      async (handler) => {
        mockPrisma.club_sections.findUnique.mockResolvedValue({
          club_section_id: 23,
          main_club_id: 10,
          club_type_id: 1,
        });

        await expect(
          guard.canActivate(contextFor(handler, paramsFor(handler, '10', '23'))),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
      },
    );

    it.each(HANDLERS)(
      '%s: the actor own section in its own club is allowed',
      async (handler) => {
        mockPrisma.club_sections.findUnique.mockResolvedValue({
          club_section_id: 22,
          main_club_id: 10,
          club_type_id: 2,
        });

        await expect(
          guard.canActivate(contextFor(handler, paramsFor(handler, '10', '22'))),
        ).resolves.toBe(true);
      },
    );
  });
});
