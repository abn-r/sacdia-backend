import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { AUTHORIZATION_RESOURCE_KEY, PERMISSIONS_KEY } from '../decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../errors/error-codes';

const SENSITIVE_USER_SUBRESOURCE_KEY = 'sensitive_user_subresource';

describe('PermissionsGuard', () => {
  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
    canManageClub: jest.fn(),
  };

  const mockPrisma = {
    enrollments: { findFirst: jest.fn() },
    monthly_reports: { findUnique: jest.fn() },
    club_enrollments: { findUnique: jest.fn() },
    users: { findUnique: jest.fn() },
    member_insurances: { findUnique: jest.fn() },
    activities: { findUnique: jest.fn() },
    finances: { findUnique: jest.fn() },
    local_camporees: { findUnique: jest.fn() },
    club_inventory: { findUnique: jest.fn() },
    club_role_assignments: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    club_sections: { findUnique: jest.fn() },
  };

  const guard = new PermissionsGuard(
    mockReflector as unknown as Reflector,
    mockAuthorizationContext as unknown as AuthorizationContextService,
    mockPrisma as unknown as PrismaService,
  );

  const createContext = (
    request: Record<string, unknown>,
  ): ExecutionContext => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  const createResolved = ({
    globalPermissions = [],
    activeClubPermissions = [],
    clubId = 10,
    instanceType = 'pathfinders',
    instanceId = 22,
    localFieldId = 50,
    unionId = 70,
  }: {
    globalPermissions?: string[];
    activeClubPermissions?: string[];
    clubId?: number;
    instanceType?: 'adventurers' | 'pathfinders' | 'master_guilds';
    instanceId?: number;
    localFieldId?: number;
    unionId?: number;
  }) => ({
    authorization: {
      grants: {
        global_roles: [
          {
            role_name: 'admin',
            permissions: globalPermissions,
            scope: {},
          },
        ],
        club_assignments: [
          {
            assignment_id: 'assignment-1',
            role_name: 'director',
            permissions: activeClubPermissions,
            club: {
              club_id: clubId,
              club_name: 'Club Amanecer',
            },
            section: {
              club_section_id: instanceId,
              club_type_name: instanceType,
            },
            scope: {
              local_field: { id: localFieldId, name: 'Campo Norte' },
              union: { id: unionId, name: 'Union Norte' },
            },
            status: 'active',
            start_date: null,
            end_date: null,
          },
        ],
      },
      active_assignment: {
        assignment_id: activeClubPermissions.length ? 'assignment-1' : null,
      },
      effective: {
        permissions: [
          ...new Set([...globalPermissions, ...activeClubPermissions]),
        ],
        scope: {
          global: {},
          club: activeClubPermissions.length
            ? {
                assignment_id: 'assignment-1',
                role_name: 'director',
                club: {
                  club_id: clubId,
                  club_name: 'Club Amanecer',
                },
                section: {
                  club_section_id: instanceId,
                  club_type_name: instanceType,
                },
              }
            : null,
        },
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return undefined;
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return undefined;
      }
      return undefined;
    });
  });

  describe('sensitive user subresource policy', () => {
    const expectSensitiveUserAccess = async ({
      permission,
      legacyFallback,
      mode,
    }: {
      permission: string;
      legacyFallback: string;
      mode: 'read' | 'update';
    }) => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSIONS_KEY) {
          return { permissions: [permission], mode: 'all' };
        }
        if (key === AUTHORIZATION_RESOURCE_KEY) {
          return { type: 'user', ownerParam: 'userId' };
        }
        if (key === SENSITIVE_USER_SUBRESOURCE_KEY) {
          return { family: permission.split(':')[0], mode };
        }
        return undefined;
      });

      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({ globalPermissions: [permission] }),
      );

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'admin-1' },
            params: { userId: 'user-123' },
          }),
        ),
      ).resolves.toBe(true);

      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({ globalPermissions: [legacyFallback] }),
      );

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'admin-1' },
            params: { userId: 'user-123' },
          }),
        ),
      ).resolves.toBe(true);

      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({ activeClubPermissions: [permission] }),
      );

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'club-user-1' },
            params: { userId: 'user-123' },
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    };

    it.each([
      ['health:read', 'users:read_detail', 'read'],
      // Phase 3 cleanup (`permission-scope-cleanup-phase-3`):
      // legacy `users:update` was retired in favor of `users:update_profile`
      // for sensitive-user subresources in `update` mode.
      ['health:update', 'users:update_profile', 'update'],
      ['emergency_contacts:read', 'users:read_detail', 'read'],
      ['emergency_contacts:update', 'users:update_profile', 'update'],
      ['legal_representative:read', 'users:read_detail', 'read'],
      ['legal_representative:update', 'users:update_profile', 'update'],
      ['post_registration:read', 'users:read_detail', 'read'],
      ['post_registration:update', 'users:update_profile', 'update'],
    ] as const)(
      'allows fine permission, allows legacy fallback, and rejects club-only third-party access for %s',
      async (permission, legacyFallback, mode) => {
        await expectSensitiveUserAccess({
          permission,
          legacyFallback,
          mode,
        });
      },
    );
  });

  it('allows when no permissions are required', async () => {
    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).resolves.toBe(true);
  });

  it('allows a global resource when the user has the global permission', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['users:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'global' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ globalPermissions: ['users:read'] }),
    );

    await expect(
      guard.canActivate(createContext({ user: { sub: 'admin-1' } })),
    ).resolves.toBe(true);
  });

  it('rejects a global resource when the permission only exists on the active club assignment', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['clubs:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'global' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ activeClubPermissions: ['clubs:read'] }),
    );

    await expect(
      guard.canActivate(createContext({ user: { sub: 'club-user-1' } })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });

  it('allows a club resource when the active assignment belongs to the same club and has the permission', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['clubs:update'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'club', clubIdParam: 'clubId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ activeClubPermissions: ['clubs:update'], clubId: 10 }),
    );
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-user-1' },
          params: { clubId: '10' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('rejects a club resource when the active assignment belongs to another club', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['clubs:update'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'club', clubIdParam: 'clubId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ activeClubPermissions: ['clubs:update'], clubId: 99 }),
    );
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-user-1' },
          params: { clubId: '10' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  it('rejects a club section resource when the section is outside the actor scope', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['insurance:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return {
          type: 'club_section',
          idParam: 'sectionId',
          clubIdParam: 'clubId',
        };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({
        activeClubPermissions: ['insurance:read'],
        clubId: 10,
        instanceId: 22,
      }),
    );
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockPrisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: 44,
      main_club_id: 10,
      club_type_id: 2,
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-a-actor' },
          params: { clubId: '10', sectionId: '44' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  it('throws not found for a club section resource when sectionId does not belong to clubId', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['insurance:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return {
          type: 'club_section',
          idParam: 'sectionId',
          clubIdParam: 'clubId',
        };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ activeClubPermissions: ['insurance:read'] }),
    );
    mockPrisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: 44,
      main_club_id: 99,
      club_type_id: 2,
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-a-actor' },
          params: { clubId: '10', sectionId: '44' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CLUB_SECTION_NOT_FOUND });
  });

  it('allows an instance resource when the active assignment matches the exact instance', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['inventory:update'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return {
          type: 'inventory_instance',
          idParam: 'clubId',
          instanceTypeSource: 'query',
          instanceTypeField: 'instanceType',
        };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({
        activeClubPermissions: ['inventory:update'],
        clubId: 10,
        instanceType: 'pathfinders',
        instanceId: 22,
      }),
    );
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockPrisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: 22,
      main_club_id: 10,
      club_type_id: 2,
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-user-1' },
          params: { clubId: '22' },
          query: { instanceType: 'pathf' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('allows a camporee resource when the active assignment belongs to the same local field', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['activities:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'camporee', idParam: 'camporeeId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({
        activeClubPermissions: ['activities:read'],
        localFieldId: 50,
      }),
    );
    mockPrisma.local_camporees.findUnique.mockResolvedValue({
      local_camporee_id: 8,
      local_field_id: 50,
      local_fields: {
        union_id: 70,
      },
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-user-1' },
          params: { camporeeId: '8' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('rejects a camporee resource when neither global nor active assignment scope matches the local field', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['activities:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'camporee', idParam: 'camporeeId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({
        activeClubPermissions: ['activities:read'],
        localFieldId: 50,
        unionId: 70,
      }),
    );
    mockPrisma.local_camporees.findUnique.mockResolvedValue({
      local_camporee_id: 8,
      local_field_id: 99,
      local_fields: {
        union_id: 101,
      },
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-user-1' },
          params: { camporeeId: '8' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  it('rejects an instance resource when the active assignment points to another instance of the same club', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['inventory:update'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return {
          type: 'inventory_instance',
          idParam: 'clubId',
          instanceTypeSource: 'query',
          instanceTypeField: 'instanceType',
        };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({
        activeClubPermissions: ['inventory:update'],
        clubId: 10,
        instanceType: 'pathfinders',
        instanceId: 22,
      }),
    );
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockPrisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: 99,
      main_club_id: 10,
      club_type_id: 2,
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-user-1' },
          params: { clubId: '99' },
          query: { instanceType: 'pathf' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  it('allows owner-scoped resources without requiring extra permissions', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['users:update'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'user', ownerParam: 'userId' };
      }
      return undefined;
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'user-123' },
          params: { userId: 'user-123' },
        }),
      ),
    ).resolves.toBe(true);
    expect(
      mockAuthorizationContext.resolveUserAuthorization,
    ).not.toHaveBeenCalled();
  });

  it('allows a non-owner user resource when the actor has the required global permission', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['users:update'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'user', ownerParam: 'userId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ globalPermissions: ['users:update'] }),
    );

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'admin-1' },
          params: { userId: 'user-123' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('rejects a non-owner user resource when the permission only exists on the active club assignment', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['users:read_detail'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'user', ownerParam: 'userId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ activeClubPermissions: ['users:read_detail'] }),
    );

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-user-1' },
          params: { userId: 'user-123' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });

  it('throws not found when an assignment resource cannot be resolved', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['club_roles:revoke'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'club_assignment', idParam: 'assignmentId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ globalPermissions: ['club_roles:revoke'] }),
    );
    mockPrisma.club_role_assignments.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'admin-1' },
          params: { assignmentId: 'missing-assignment' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_ASSIGNMENT_NOT_FOUND });
  });

  it('rejects investiture enrollment mutation when actor permission is scoped to another club section', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['investiture:submit'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'investiture_enrollment', idParam: 'enrollmentId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({
        activeClubPermissions: ['investiture:submit'],
        clubId: 10,
        instanceId: 22,
      }),
    );
    mockPrisma.enrollments.findFirst.mockResolvedValue({
      user_id: 'member-b',
      ecclesiastical_year_id: 2026,
      classes: { club_type_id: 2 },
    });
    mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
      club_sections: {
        club_section_id: 44,
        main_club_id: 99,
        club_type_id: 2,
      },
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-a-actor' },
          params: { enrollmentId: '123' },
          body: { club_id: 10 },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  it('rejects monthly report access when actor active assignment is outside the report scope', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['reports:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'monthly_report', idParam: 'reportId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({
        activeClubPermissions: ['reports:read'],
        clubId: 10,
        instanceId: 22,
      }),
    );
    mockPrisma.monthly_reports.findUnique.mockResolvedValue({
      club_enrollment: {
        club_section: {
          club_section_id: 44,
          main_club_id: 99,
          club_type_id: 2,
        },
      },
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-a-actor' },
          params: { reportId: '28f20ec9-4f10-4827-b4cd-29ccbc423c34' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  it('rejects insurance member access when actor has insurance permission only in another section', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['insurance:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'insurance_member', idParam: 'memberId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({
        activeClubPermissions: ['insurance:read'],
        clubId: 10,
        instanceId: 22,
      }),
    );
    mockPrisma.users.findUnique.mockResolvedValue({ user_id: 'member-b' });
    mockPrisma.club_role_assignments.findMany.mockResolvedValue([
      {
        club_sections: {
          club_section_id: 44,
          main_club_id: 99,
          club_type_id: 2,
        },
      },
    ]);

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-a-actor' },
          params: { memberId: 'member-b' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  it('rejects insurance record updates when the insured member is outside actor scope', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['insurance:update'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'insurance_record', idParam: 'insuranceId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({
        activeClubPermissions: ['insurance:update'],
        clubId: 10,
        instanceId: 22,
      }),
    );
    mockPrisma.member_insurances.findUnique.mockResolvedValue({
      user_id: 'member-b',
    });
    mockPrisma.club_role_assignments.findMany.mockResolvedValue([
      {
        club_sections: {
          club_section_id: 44,
          main_club_id: 99,
          club_type_id: 2,
        },
      },
    ]);

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-a-actor' },
          params: { insuranceId: '123' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  // ── camporee_event RBAC (Phase 3 — Spec C7) ──────────────────────────────

  describe('camporee_event scope (dynamic camporee-scoped RBAC)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (mockPrisma as any).camporee_events = { findUnique: jest.fn() };
      (mockPrisma as any).union_camporees = { findUnique: jest.fn() };
    });

    it('C7.3 — throws 404 when event does not exist', async () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'permissions') return { permissions: ['camporee_events:update'], mode: 'all' };
        if (key === 'authorization_resource') return { type: 'camporee_event', idParam: 'eventId' };
        return undefined;
      });
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({ globalPermissions: ['camporee_events:update'] }),
      );
      (mockPrisma as any).camporee_events.findUnique.mockResolvedValue(null);

      await expect(
        guard.canActivate(
          createContext({ user: { sub: 'user-1' }, params: { eventId: '999' } }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_EVENT_NOT_FOUND });
    });

    it('C7.1 — authorized user mutates their own camporee event (local scope)', async () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'permissions') return { permissions: ['camporee_events:update'], mode: 'all' };
        if (key === 'authorization_resource') return { type: 'camporee_event', idParam: 'eventId' };
        return undefined;
      });
      // Construct a resolved profile where global scope has local_field_id=50
      const resolvedWithLocalField = {
        authorization: {
          grants: {
            global_roles: [
              {
                role_name: 'coordinator',
                permissions: ['camporee_events:update'],
                scope: {},
              },
            ],
            club_assignments: [],
          },
          active_assignment: { assignment_id: null },
          effective: {
            permissions: ['camporee_events:update'],
            scope: {
              global: {
                local_field: { id: 50, name: 'Campo Norte' },
                union: { id: 70 },
                country: null,
              },
              club: null,
            },
          },
        },
      };
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(resolvedWithLocalField);
      (mockPrisma as any).camporee_events.findUnique.mockResolvedValue({
        local_camporee_id: 7,
        union_camporee_id: null,
      });
      mockPrisma.local_camporees.findUnique.mockResolvedValue({
        local_field_id: 50,
        local_fields: { union_id: 70, unions: { country_id: 1 } },
      });

      const result = await guard.canActivate(
        createContext({ user: { sub: 'director-1' }, params: { eventId: '1' } }),
      );
      expect(result).toBe(true);
    });

    it('C7.2 — user blocked from mutating event of another camporee', async () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'permissions') return { permissions: ['camporee_events:update'], mode: 'all' };
        if (key === 'authorization_resource') return { type: 'camporee_event', idParam: 'eventId' };
        return undefined;
      });
      // User is from local_field=50, but event belongs to local_field=99
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalPermissions: ['camporee_events:update'],
          localFieldId: 50,
        }),
      );
      (mockPrisma as any).camporee_events.findUnique.mockResolvedValue({
        local_camporee_id: 9,
        union_camporee_id: null,
      });
      mockPrisma.local_camporees.findUnique.mockResolvedValue({
        local_field_id: 99, // different local_field
        local_fields: { union_id: 70, unions: { country_id: 1 } },
      });

      await expect(
        guard.canActivate(
          createContext({ user: { sub: 'director-2' }, params: { eventId: '5' } }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
    });
  });
});
