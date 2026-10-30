import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { AUTHORIZATION_RESOURCE_KEY, PERMISSIONS_KEY } from '../decorators';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_PERMISSIONS_KEY } from '../decorators/skip-permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../errors/error-codes';
import { InstitutionalHierarchyService } from '../services/institutional-hierarchy.service';

const SENSITIVE_USER_SUBRESOURCE_KEY = 'sensitive_user_subresource';

describe('PermissionsGuard', () => {
  const MEMBER_USER_ID = '88888888-8888-4888-8888-888888888888';

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
    canManageClub: jest.fn(),
    canAccessHierarchyScope: jest.fn(),
  };

  const mockHierarchy = {
    resolveCurrent: jest.fn(),
  };

  const mockPrisma = {
    enrollments: { findFirst: jest.fn() },
    monthly_reports: { findUnique: jest.fn() },
    club_enrollments: { findUnique: jest.fn() },
    users: { findUnique: jest.fn(), count: jest.fn() },
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
    class_counselor_assignments: { findUnique: jest.fn() },
    club_sections: { findUnique: jest.fn() },
  };

  const guard = new PermissionsGuard(
    mockReflector as unknown as Reflector,
    mockAuthorizationContext as unknown as AuthorizationContextService,
    mockPrisma as unknown as PrismaService,
    mockHierarchy as unknown as InstitutionalHierarchyService,
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
    globalRoleName = 'admin',
    extraGlobalRoles = [],
    activeClubPermissions = [],
    directPermissions = [],
    clubId = 10,
    instanceType = 'pathfinders',
    instanceId = 22,
    localFieldId = 50,
    unionId = 70,
    divisionId = 1,
    globalCountryId,
    globalUnionId,
    globalLocalFieldId,
    globalDivisionId,
  }: {
    globalPermissions?: string[];
    globalRoleName?: string;
    extraGlobalRoles?: { role_name: string; permissions: string[] }[];
    activeClubPermissions?: string[];
    directPermissions?: string[];
    clubId?: number;
    instanceType?: 'adventurers' | 'pathfinders' | 'master_guilds';
    instanceId?: number;
    localFieldId?: number;
    unionId?: number;
    divisionId?: number;
    globalCountryId?: number;
    globalUnionId?: number;
    globalLocalFieldId?: number;
    globalDivisionId?: number;
  }) => ({
    authorization: {
      grants: {
        global_roles: [
          {
            role_name: globalRoleName,
            permissions: globalPermissions,
            scope: {
              ...(globalDivisionId
                ? { division: { id: globalDivisionId } }
                : {}),
              ...(globalCountryId ? { country: { id: globalCountryId } } : {}),
              ...(globalUnionId ? { union: { id: globalUnionId } } : {}),
              ...(globalLocalFieldId
                ? { local_field: { id: globalLocalFieldId } }
                : {}),
            },
          },
          ...extraGlobalRoles.map((role) => ({ ...role, scope: {} })),
        ],
        direct_permissions: directPermissions,
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
              division: { id: divisionId, name: 'División Interamericana' },
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
          global: {
            ...(globalDivisionId ? { division: { id: globalDivisionId } } : {}),
            ...(globalCountryId ? { country: { id: globalCountryId } } : {}),
            ...(globalUnionId ? { union: { id: globalUnionId } } : {}),
            ...(globalLocalFieldId
              ? { local_field: { id: globalLocalFieldId } }
              : {}),
          },
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
    mockPrisma.club_role_assignments.findFirst.mockResolvedValue(null);
    // Target users sit inside the actor's territory unless a test says not.
    mockPrisma.users.count.mockResolvedValue(1);
    mockAuthorizationContext.canAccessHierarchyScope.mockImplementation(
      (resolved, scope) => {
        const globalScope = resolved.authorization.effective.scope.global ?? {};
        if (
          typeof scope.local_field_id === 'number' &&
          globalScope.local_field?.id === scope.local_field_id
        ) {
          return true;
        }
        if (
          typeof scope.union_id === 'number' &&
          globalScope.union?.id === scope.union_id
        ) {
          return true;
        }
        return (
          typeof scope.division_id === 'number' &&
          globalScope.division?.id === scope.division_id
        );
      },
    );
    mockHierarchy.resolveCurrent.mockResolvedValue({
      division_id: 1,
      division_name: 'División Interamericana',
      union_id: 70,
      local_field_id: 50,
      as_of: new Date('2026-01-01'),
      source: 'current',
      precision: 'exact',
    });
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
        createResolved({
          globalPermissions: [permission],
          globalLocalFieldId: 50,
        }),
      );

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'admin-1' },
            params: { userId: '11111111-1111-4111-8111-111111111123' },
          }),
        ),
      ).resolves.toBe(true);

      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalPermissions: [legacyFallback],
          globalLocalFieldId: 50,
        }),
      );

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'admin-1' },
            params: { userId: '11111111-1111-4111-8111-111111111123' },
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
            params: { userId: '11111111-1111-4111-8111-111111111123' },
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
      'allows fine permission, allows legacy fallback, and rejects club-only access to a non-section user for %s',
      async (permission, legacyFallback, mode) => {
        await expectSensitiveUserAccess({
          permission,
          legacyFallback,
          mode,
        });
      },
    );
  });

  it('rejects authenticated routes that declare neither permissions nor an opt-out', async () => {
    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_RBAC_MISCONFIGURATION });
  });

  it('rejects unknown authorization resource types even when the permission matches', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['clubs:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'district' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ globalPermissions: ['clubs:read'] }),
    );

    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_RBAC_MISCONFIGURATION });
  });

  it('allows @Public() routes without a permission catalog entry', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) {
        return true;
      }
      return undefined;
    });

    await expect(guard.canActivate(createContext({}))).resolves.toBe(true);
  });

  it('allows @SkipPermissions() routes without a permission catalog entry', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === SKIP_PERMISSIONS_KEY) {
        return true;
      }
      return undefined;
    });

    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).resolves.toBe(true);
  });

  it('allows e2e passthrough without a permission catalog entry', async () => {
    const previous = process.env.E2E_PASSTHROUGH_PERMISSIONS;
    process.env.E2E_PASSTHROUGH_PERMISSIONS = 'true';

    try {
      await expect(
        guard.canActivate(createContext({ user: { sub: 'user-123' } })),
      ).resolves.toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.E2E_PASSTHROUGH_PERMISSIONS;
      } else {
        process.env.E2E_PASSTHROUGH_PERMISSIONS = previous;
      }
    }
  });

  it.each(['production', 'development', 'staging', undefined])(
    'ignores e2e passthrough when NODE_ENV is %s',
    async (nodeEnv) => {
      const previousFlag = process.env.E2E_PASSTHROUGH_PERMISSIONS;
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.E2E_PASSTHROUGH_PERMISSIONS = 'true';
      if (nodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = nodeEnv;
      }

      try {
        await expect(
          guard.canActivate(createContext({ user: { sub: 'user-123' } })),
        ).rejects.toMatchObject({
          code: ErrorCode.GUARD_RBAC_MISCONFIGURATION,
        });
      } finally {
        if (previousFlag === undefined) {
          delete process.env.E2E_PASSTHROUGH_PERMISSIONS;
        } else {
          process.env.E2E_PASSTHROUGH_PERMISSIONS = previousFlag;
        }
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    },
  );

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

  it('attaches both the authorization snapshot and full resolved profile to the request', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['section_rankings:read_club'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'active_assignment' };
      }
      return undefined;
    });
    const resolved = createResolved({
      activeClubPermissions: ['section_rankings:read_club'],
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolved,
    );
    const request = { user: { sub: 'club-user-1' } };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect((request as any).authorization).toBe(resolved.authorization);
    expect((request as any).authorizationProfile).toBe(resolved);
  });

  it('allows an explicitly owner-scoped active assignment resource when the actor owns the target user', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['classes:submit_progress'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'active_assignment', ownerParam: 'userId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({}),
    );

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'member-1' },
          params: { userId: 'member-1' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('does not apply the owner bypass to third-party active assignment resources', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['classes:submit_progress'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'active_assignment', ownerParam: 'userId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({}),
    );

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'member-1' },
          params: { userId: 'other-member' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
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

  it('allows a global resource when the permission is a direct users_permissions grant', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['reports:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'global' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ directPermissions: ['reports:read'] }),
    );

    await expect(
      guard.canActivate(createContext({ user: { sub: 'direct-user-1' } })),
    ).resolves.toBe(true);
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

  describe('club scope round trips', () => {
    const clubResourceMetadata = () =>
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSIONS_KEY) {
          return { permissions: ['clubs:update'], mode: 'all' };
        }
        if (key === AUTHORIZATION_RESOURCE_KEY) {
          return { type: 'club', clubIdParam: 'clubId' };
        }
        return undefined;
      });

    it('lets a member of the club through without the territorial lookup', async () => {
      clubResourceMetadata();
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({ activeClubPermissions: ['clubs:update'], clubId: 10 }),
      );

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'club-user-1' },
            params: { clubId: '10' },
          }),
        ),
      ).resolves.toBe(true);
      expect(mockAuthorizationContext.canManageClub).not.toHaveBeenCalled();
    });

    it('checks territorial management with the already-resolved profile for another club', async () => {
      clubResourceMetadata();
      const resolved = createResolved({
        activeClubPermissions: ['clubs:update'],
        clubId: 99,
      });
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        resolved,
      );
      mockAuthorizationContext.canManageClub.mockResolvedValue(true);

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'field-admin-1' },
            params: { clubId: '10' },
          }),
        ),
      ).resolves.toBe(true);
      expect(mockAuthorizationContext.canManageClub).toHaveBeenCalledWith(
        'field-admin-1',
        10,
        resolved,
      );
    });

    it('reuses a grant when the controller guard re-runs on the same request', async () => {
      clubResourceMetadata();
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({ activeClubPermissions: ['clubs:update'], clubId: 10 }),
      );
      const handler = () => undefined;
      const request = {
        user: { sub: 'club-user-1' },
        params: { clubId: '10' },
      };
      const context = {
        getHandler: () => handler,
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).resolves.toBe(true);
      await expect(guard.canActivate(context)).resolves.toBe(true);

      expect(
        mockAuthorizationContext.resolveUserAuthorization,
      ).toHaveBeenCalledTimes(1);
    });

    it('does not reuse a grant for a different principal or handler', async () => {
      clubResourceMetadata();
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({ activeClubPermissions: ['clubs:update'], clubId: 10 }),
      );
      const request: Record<string, unknown> = {
        user: { sub: 'club-user-1' },
        params: { clubId: '10' },
      };
      const contextFor = (handler: () => void) =>
        ({
          getHandler: () => handler,
          getClass: jest.fn(),
          switchToHttp: () => ({ getRequest: () => request }),
        }) as unknown as ExecutionContext;
      const handler = () => undefined;

      await guard.canActivate(contextFor(handler));
      await guard.canActivate(contextFor(() => undefined));
      request.user = { sub: 'club-user-2' };
      await guard.canActivate(contextFor(handler));

      expect(
        mockAuthorizationContext.resolveUserAuthorization,
      ).toHaveBeenCalledTimes(3);
    });

    it('does not memoize a denial', async () => {
      clubResourceMetadata();
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({ activeClubPermissions: ['clubs:update'], clubId: 99 }),
      );
      const handler = () => undefined;
      const request = {
        user: { sub: 'club-user-1' },
        params: { clubId: '10' },
      };
      const context = {
        getHandler: () => handler,
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });
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

  it('allows a club section resource when the active assignment matches that section', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['club_sections:update'], mode: 'all' };
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
        activeClubPermissions: ['club_sections:update'],
        clubId: 10,
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
          user: { sub: 'section-a-secretary' },
          params: { clubId: '10', sectionId: '22' },
        }),
      ),
    ).resolves.toBe(true);
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
      createResolved({
        globalPermissions: ['users:update'],
        globalLocalFieldId: 50,
      }),
    );

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'admin-1' },
          params: { userId: '11111111-1111-4111-8111-111111111123' },
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

  it('allows membership approvers to read a pending requester profile in their active section', async () => {
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
      createResolved({
        activeClubPermissions: ['club_members:approve'],
        instanceId: 22,
      }),
    );
    mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
      assignment_id: 'pending-assignment-1',
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'director-1' },
          params: { userId: '99999999-9999-4999-8999-999999999991' },
        }),
      ),
    ).resolves.toBe(true);

    expect(mockPrisma.club_role_assignments.findFirst).toHaveBeenCalledWith({
      where: {
        user_id: '99999999-9999-4999-8999-999999999991',
        club_section_id: 22,
        active: true,
        OR: [
          { status: null },
          {
            status: {
              in: ['active', 'pending'],
            },
          },
        ],
      },
      select: { assignment_id: true },
    });
  });

  it('allows section member readers to open an active member profile in their active section', async () => {
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
      createResolved({
        activeClubPermissions: ['club_roles:read'],
        instanceId: 22,
      }),
    );
    mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
      assignment_id: 'active-assignment-1',
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'director-1' },
          params: { userId: MEMBER_USER_ID },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('rejects membership approvers when the target user has no active or pending assignment in their active section', async () => {
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
      createResolved({
        activeClubPermissions: ['club_members:approve'],
        instanceId: 22,
      }),
    );
    mockPrisma.club_role_assignments.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'director-1' },
          params: { userId: '99999999-9999-4999-8999-999999999992' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });

  describe('club-scoped sensitive subresource read', () => {
    const mockSensitiveRoute = (
      family: string,
      mode: 'read' | 'update',
    ): void => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSIONS_KEY) {
          return { permissions: [`${family}:${mode}`], mode: 'all' };
        }
        if (key === AUTHORIZATION_RESOURCE_KEY) {
          return { type: 'user', ownerParam: 'userId' };
        }
        if (key === SENSITIVE_USER_SUBRESOURCE_KEY) {
          return { family, mode };
        }
        return undefined;
      });
    };

    const directorContext = () =>
      createContext({
        user: { sub: 'director-1' },
        params: { userId: MEMBER_USER_ID },
      });

    it('skips the section-membership lookup when the target userId is not a UUID', async () => {
      mockSensitiveRoute('health', 'read');
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          activeClubPermissions: ['health:read'],
          instanceId: 22,
        }),
      );

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'director-1' },
            params: { userId: 'not-a-uuid' },
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      expect(mockPrisma.club_role_assignments.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      'health',
      'emergency_contacts',
      'legal_representative',
      'post_registration',
    ])(
      'allows %s:read from the active club assignment for an active member of the active section',
      async (family) => {
        mockSensitiveRoute(family, 'read');
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          createResolved({
            activeClubPermissions: [`${family}:read`],
            instanceId: 22,
          }),
        );
        mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
          assignment_id: 'active-assignment-1',
        });

        await expect(guard.canActivate(directorContext())).resolves.toBe(true);

        expect(mockPrisma.club_role_assignments.findFirst).toHaveBeenCalledWith(
          {
            where: {
              user_id: MEMBER_USER_ID,
              club_section_id: 22,
              active: true,
              OR: [{ status: null }, { status: { in: ['active'] } }],
            },
            select: { assignment_id: true },
          },
        );
      },
    );

    it('rejects when the target is not an active member of the active section', async () => {
      mockSensitiveRoute('health', 'read');
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          activeClubPermissions: ['health:read'],
          instanceId: 22,
        }),
      );
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue(null);

      await expect(guard.canActivate(directorContext())).rejects.toMatchObject({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });
    });

    it('does not honor the legacy users:read_detail fallback from a club assignment', async () => {
      mockSensitiveRoute('health', 'read');
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          activeClubPermissions: ['users:read_detail'],
          instanceId: 22,
        }),
      );
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'active-assignment-1',
      });

      await expect(guard.canActivate(directorContext())).rejects.toMatchObject({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });
    });

    it('does not grant update mode from a club assignment', async () => {
      mockSensitiveRoute('health', 'update');
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          activeClubPermissions: ['health:update'],
          instanceId: 22,
        }),
      );
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'active-assignment-1',
      });

      await expect(guard.canActivate(directorContext())).rejects.toMatchObject({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });
    });
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
          params: { assignmentId: '55555555-5555-4555-8555-555555555555' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_ASSIGNMENT_NOT_FOUND });
  });

  describe('malformed UUID route params', () => {
    const mockUuidResource = (
      permission: string,
      resource: Record<string, unknown>,
    ) => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSIONS_KEY) {
          return { permissions: [permission], mode: 'all' };
        }
        if (key === AUTHORIZATION_RESOURCE_KEY) {
          return resource;
        }
        return undefined;
      });
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({ globalPermissions: [permission] }),
      );
    };

    it.each([
      [
        'club_assignment',
        'club_roles:revoke',
        'assignmentId',
        'club_role_assignments',
      ],
      [
        'class_counselor_assignment',
        'club_roles:assign',
        'assignmentId',
        'class_counselor_assignments',
      ],
      ['insurance_member', 'insurance:read', 'memberId', 'users'],
    ] as const)(
      'rejects a non-UUID %s id with 400 before querying Prisma',
      async (type, permission, idParam, model) => {
        mockUuidResource(permission, { type, idParam });

        await expect(
          guard.canActivate(
            createContext({
              user: { sub: 'admin-1' },
              params: { clubSectionId: '12', [idParam]: 'not-a-uuid' },
            }),
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.GUARD_ID_PARAM_INVALID,
          status: 400,
        });
        expect(mockPrisma[model].findUnique).not.toHaveBeenCalled();
      },
    );

    it('keeps 403 when the club assignment id param is missing', async () => {
      mockUuidResource('club_roles:revoke', {
        type: 'club_assignment',
        idParam: 'assignmentId',
      });

      await expect(
        guard.canActivate(
          createContext({ user: { sub: 'admin-1' }, params: {} }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.GUARD_ASSIGNMENT_SCOPE_INVALID,
      });
      expect(
        mockPrisma.club_role_assignments.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('queries Prisma with a well-formed club assignment UUID', async () => {
      const assignmentId = '77777777-7777-4777-8777-777777777777';
      mockUuidResource('club_roles:revoke', {
        type: 'club_assignment',
        idParam: 'assignmentId',
      });
      mockPrisma.club_role_assignments.findUnique.mockResolvedValue(null);

      await expect(
        guard.canActivate(
          createContext({ user: { sub: 'admin-1' }, params: { assignmentId } }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_ASSIGNMENT_NOT_FOUND });
      expect(mockPrisma.club_role_assignments.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { assignment_id: assignmentId } }),
      );
    });
  });

  it('rejects class counselor assignment mutation when actor scope is another club section', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['club_roles:assign'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return {
          type: 'class_counselor_assignment',
          idParam: 'assignmentId',
        };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({
        activeClubPermissions: ['club_roles:assign'],
        clubId: 10,
        instanceId: 22,
      }),
    );
    mockPrisma.class_counselor_assignments.findUnique.mockResolvedValue({
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
          params: { assignmentId: '44444444-4444-4444-4444-444444444444' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  it('rejects investiture enrollment mutation when actor permission is scoped to another club section', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['investiture:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'investiture_enrollment', idParam: 'enrollmentId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({
        activeClubPermissions: ['investiture:read'],
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

  it('rejects an invalid monthly report UUID before querying Prisma', async () => {
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
      createResolved({ globalPermissions: ['reports:read'] }),
    );
    mockPrisma.monthly_reports.findUnique.mockImplementation(() => {
      throw new Error('Prisma must not receive an invalid UUID');
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-user-1' },
          params: { reportId: 'undefined' },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockPrisma.monthly_reports.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an invalid monthly report enrollment UUID before querying Prisma', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) {
        return { permissions: ['reports:read'], mode: 'all' };
      }
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'monthly_report', idParam: 'enrollmentId' };
      }
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ globalPermissions: ['reports:read'] }),
    );
    mockPrisma.club_enrollments.findUnique.mockImplementation(() => {
      throw new Error('Prisma must not receive an invalid UUID');
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-user-1' },
          params: { enrollmentId: 'undefined' },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockPrisma.club_enrollments.findUnique).not.toHaveBeenCalled();
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
          params: { memberId: '66666666-6666-4666-8666-666666666666' },
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
        if (key === 'permissions')
          return { permissions: ['camporee_events:update'], mode: 'all' };
        if (key === 'authorization_resource')
          return { type: 'camporee_event', idParam: 'eventId' };
        return undefined;
      });
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({ globalPermissions: ['camporee_events:update'] }),
      );
      (mockPrisma as any).camporee_events.findUnique.mockResolvedValue(null);

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'user-1' },
            params: { eventId: '999' },
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_EVENT_NOT_FOUND });
    });

    it('C7.1 — authorized user mutates their own camporee event (local scope)', async () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'permissions')
          return { permissions: ['camporee_events:update'], mode: 'all' };
        if (key === 'authorization_resource')
          return { type: 'camporee_event', idParam: 'eventId' };
        return undefined;
      });
      // Construct a resolved profile where global scope has local_field_id=50
      const resolvedWithLocalField = {
        authorization: {
          grants: {
            global_roles: [
              {
                role_name: 'director-lf',
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
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        resolvedWithLocalField,
      );
      (mockPrisma as any).camporee_events.findUnique.mockResolvedValue({
        local_camporee_id: 7,
        union_camporee_id: null,
      });
      mockPrisma.local_camporees.findUnique.mockResolvedValue({
        local_field_id: 50,
        local_fields: { union_id: 70, unions: { country_id: 1 } },
      });

      const result = await guard.canActivate(
        createContext({
          user: { sub: 'director-1' },
          params: { eventId: '1' },
        }),
      );
      expect(result).toBe(true);
    });

    it('C7.2 — user blocked from mutating event of another camporee', async () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'permissions')
          return { permissions: ['camporee_events:update'], mode: 'all' };
        if (key === 'authorization_resource')
          return { type: 'camporee_event', idParam: 'eventId' };
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
          createContext({
            user: { sub: 'director-2' },
            params: { eventId: '5' },
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
    });
  });

  // ── camporee_venue RBAC (Spec C2 / C7 — venue PATCH/DELETE/POST scope) ───

  describe('camporee_venue scope (dynamic venue-scoped RBAC)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (mockPrisma as any).camporee_venues = { findUnique: jest.fn() };
      (mockPrisma as any).unions = { findUnique: jest.fn() };
      (mockPrisma as any).local_fields = { findUnique: jest.fn() };
    });

    it('V1 — throws 404 when venue does not exist (PATCH/DELETE by id)', async () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'permissions')
          return { permissions: ['camporee_events:update'], mode: 'all' };
        if (key === 'authorization_resource')
          return { type: 'camporee_venue', idParam: 'venueId' };
        return undefined;
      });
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({ globalPermissions: ['camporee_events:update'] }),
      );
      (mockPrisma as any).camporee_venues.findUnique.mockResolvedValue(null);

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'user-1' },
            params: { venueId: '999' },
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_VENUE_NOT_FOUND });
    });

    it('V2 — denies cross local_field mutation (PATCH venue belongs to LF 99, user in LF 50)', async () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'permissions')
          return { permissions: ['camporee_events:update'], mode: 'all' };
        if (key === 'authorization_resource')
          return { type: 'camporee_venue', idParam: 'venueId' };
        return undefined;
      });
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalPermissions: ['camporee_events:update'],
          localFieldId: 50,
        }),
      );
      (mockPrisma as any).camporee_venues.findUnique.mockResolvedValue({
        scope: 'local_field',
        union_id: null,
        local_field_id: 99,
      });
      (mockPrisma as any).local_fields.findUnique.mockResolvedValue({
        union_id: 70,
        unions: { country_id: 1 },
      });

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'user-x' },
            params: { venueId: '12' },
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
    });

    it('V3 — denies cross union mutation (POST union venue for union 9 by user in union 70)', async () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'permissions')
          return { permissions: ['camporee_events:create'], mode: 'all' };
        if (key === 'authorization_resource') return { type: 'camporee_venue' };
        return undefined;
      });
      // User has global admin + union scope 70.
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
        authorization: {
          grants: {
            global_roles: [
              {
                role_name: 'assistant-admin',
                permissions: ['camporee_events:create'],
                scope: {},
              },
            ],
            club_assignments: [],
          },
          active_assignment: { assignment_id: null },
          effective: {
            permissions: ['camporee_events:create'],
            scope: {
              global: {
                local_field: null,
                union: { id: 70, name: 'Union Norte' },
                country: null,
              },
              club: null,
            },
          },
        },
      });
      (mockPrisma as any).unions.findUnique.mockResolvedValue({
        country_id: 1,
      });

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'user-y' },
            params: {},
            body: { scope: 'union', union_id: 9, name: 'Cancha cruzada' },
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
    });

    it('V4 — allows mutation when venue local_field matches user scope', async () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'permissions')
          return { permissions: ['camporee_events:update'], mode: 'all' };
        if (key === 'authorization_resource')
          return { type: 'camporee_venue', idParam: 'venueId' };
        return undefined;
      });
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
        authorization: {
          grants: {
            global_roles: [
              {
                role_name: 'director-lf',
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
      });
      (mockPrisma as any).camporee_venues.findUnique.mockResolvedValue({
        scope: 'local_field',
        union_id: null,
        local_field_id: 50,
      });
      (mockPrisma as any).local_fields.findUnique.mockResolvedValue({
        union_id: 70,
        unions: { country_id: 1 },
      });

      const result = await guard.canActivate(
        createContext({
          user: { sub: 'director-z' },
          params: { venueId: '15' },
        }),
      );
      expect(result).toBe(true);
    });
  });

  describe('base user role never authorizes access to another user (BOLA)', () => {
    /** Grants the GLOBAL `user` role held before 20261016100000. */
    const LEGACY_BASE_ROLE_PERMISSIONS = [
      'users:read',
      'users:update_profile',
      'emergency_contacts:read',
      'emergency_contacts:update',
      'health:read',
      'health:update',
      'legal_representative:read',
      'legal_representative:update',
      'classes:read',
      'user_honors:read',
      'user_honors:create',
      'user_honors:submit',
      'user_honors:delete',
      'catalogs:read',
      'certifications:read',
      'post_registration:read',
      'clubs:read',
      'club_sections:read',
      'requests:read',
      'dashboard:read',
      'achievements:read',
      'validation:read',
    ];

    type UserRoute = {
      route: string;
      permission: string;
      sensitive?: { family: string; mode: 'read' | 'update' };
    };

    const sensitive = (
      route: string,
      family: string,
      mode: 'read' | 'update',
    ): UserRoute => ({
      route,
      permission: `${family}:${mode}`,
      sensitive: { family, mode },
    });

    /** Owner-aware routes whose permission the base role used to satisfy. */
    const USER_ROUTES: UserRoute[] = [
      { route: 'PATCH /users/:userId', permission: 'users:update_profile' },
      {
        route: 'POST /users/:userId/profile-picture',
        permission: 'users:update_profile',
      },
      sensitive('GET /users/:userId/allergies', 'health', 'read'),
      sensitive('PUT /users/:userId/allergies', 'health', 'update'),
      sensitive('GET /users/:userId/diseases', 'health', 'read'),
      sensitive('PUT /users/:userId/diseases', 'health', 'update'),
      sensitive('GET /users/:userId/medicines', 'health', 'read'),
      sensitive('PUT /users/:userId/medicines', 'health', 'update'),
      sensitive(
        'GET /users/:userId/emergency-contacts',
        'emergency_contacts',
        'read',
      ),
      sensitive(
        'POST /users/:userId/emergency-contacts',
        'emergency_contacts',
        'update',
      ),
      sensitive(
        'GET /users/:userId/legal-representative',
        'legal_representative',
        'read',
      ),
      sensitive(
        'PATCH /users/:userId/legal-representative',
        'legal_representative',
        'update',
      ),
      sensitive(
        'GET /users/:userId/post-registration/status',
        'post_registration',
        'read',
      ),
      // `post_registration:update` was never a base grant; the route was
      // reachable through the legacy `users:update_profile` fallback.
      sensitive(
        'post-registration update (legacy fallback)',
        'post_registration',
        'update',
      ),
      { route: 'GET /users/:userId/honors', permission: 'user_honors:read' },
      { route: 'POST /users/:userId/honors', permission: 'user_honors:create' },
      {
        route: 'PATCH /users/:userId/honors/:honorId',
        permission: 'user_honors:submit',
      },
      {
        route: 'DELETE /users/:userId/honors/:honorId',
        permission: 'user_honors:delete',
      },
      { route: 'GET /users/:userId/classes', permission: 'classes:read' },
      {
        route: 'GET /validation/eligibility/:userId',
        permission: 'validation:read',
      },
    ];

    const mockUserRoute = ({ permission, sensitive }: UserRoute): void => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSIONS_KEY) {
          return { permissions: [permission], mode: 'all' };
        }
        if (key === AUTHORIZATION_RESOURCE_KEY) {
          return { type: 'user', ownerParam: 'userId' };
        }
        if (key === SENSITIVE_USER_SUBRESOURCE_KEY) {
          return sensitive;
        }
        return undefined;
      });
    };

    const otherUserContext = () =>
      createContext({
        user: { sub: 'attacker-1' },
        params: { userId: '99999999-9999-4999-8999-999999999993' },
      });

    it.each(USER_ROUTES.map((route) => [route.route, route] as const))(
      'denies a non-owner holding only the base user role: %s',
      async (_label, route) => {
        mockUserRoute(route);
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          createResolved({
            globalRoleName: 'user',
            globalPermissions: LEGACY_BASE_ROLE_PERMISSIONS,
          }),
        );

        await expect(
          guard.canActivate(otherUserContext()),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      },
    );

    it.each(USER_ROUTES.map((route) => [route.route, route] as const))(
      'still lets the owner through without resolving permissions: %s',
      async (_label, route) => {
        mockUserRoute(route);

        await expect(
          guard.canActivate(
            createContext({
              user: { sub: '99999999-9999-4999-8999-999999999993' },
              params: { userId: '99999999-9999-4999-8999-999999999993' },
            }),
          ),
        ).resolves.toBe(true);
        expect(
          mockAuthorizationContext.resolveUserAuthorization,
        ).not.toHaveBeenCalled();
      },
    );

    it.each(USER_ROUTES.map((route) => [route.route, route] as const))(
      'allows a global admin role that grants the permission itself: %s',
      async (_label, route) => {
        mockUserRoute(route);
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          createResolved({
            globalRoleName: 'admin',
            globalPermissions: [route.permission],
            globalLocalFieldId: 50,
            extraGlobalRoles: [
              { role_name: 'user', permissions: LEGACY_BASE_ROLE_PERMISSIONS },
            ],
          }),
        );

        await expect(guard.canActivate(otherUserContext())).resolves.toBe(true);
      },
    );

    it.each(['super-admin', 'assistant-admin', 'director-lf', 'director-dia'])(
      'allows the %s global role to update another user profile',
      async (roleName) => {
        mockUserRoute(USER_ROUTES[0]);
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          createResolved({
            globalRoleName: roleName,
            globalPermissions: ['users:update_profile'],
            globalLocalFieldId: 50,
            globalUnionId: 70,
            globalDivisionId: 1,
          }),
        );

        await expect(guard.canActivate(otherUserContext())).resolves.toBe(true);
      },
    );

    it('keeps the legacy users:* fallback when it comes from a non-base global role', async () => {
      mockUserRoute(
        sensitive('PUT /users/:userId/allergies', 'health', 'update'),
      );
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalRoleName: 'assistant-admin',
          globalPermissions: ['users:update_profile'],
          globalLocalFieldId: 50,
        }),
      );

      await expect(guard.canActivate(otherUserContext())).resolves.toBe(true);
    });

    it('denies a staff role that lacks the permission even if the base role has it', async () => {
      // coordinator has users:read_detail but no users:update_profile: the
      // write used to pass only because the same account holds the base role.
      mockUserRoute(USER_ROUTES[0]);
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalRoleName: 'coordinator',
          globalPermissions: ['users:read_detail', 'classes:read'],
          extraGlobalRoles: [
            { role_name: 'user', permissions: LEGACY_BASE_ROLE_PERMISSIONS },
          ],
        }),
      );

      await expect(guard.canActivate(otherUserContext())).rejects.toMatchObject(
        { code: ErrorCode.GUARD_PERMISSION_DENIED },
      );
    });

    it('matches the base role name case-insensitively', async () => {
      mockUserRoute(USER_ROUTES[0]);
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalRoleName: 'User',
          globalPermissions: ['users:update_profile'],
        }),
      );

      await expect(guard.canActivate(otherUserContext())).rejects.toMatchObject(
        { code: ErrorCode.GUARD_PERMISSION_DENIED },
      );
    });

    it('denies a territorial role on a user outside its territory', async () => {
      mockUserRoute(
        sensitive('GET /users/:userId/allergies', 'health', 'read'),
      );
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalRoleName: 'director-lf',
          globalPermissions: ['health:read'],
          globalLocalFieldId: 4,
        }),
      );
      mockPrisma.users.count.mockResolvedValue(0);

      await expect(guard.canActivate(otherUserContext())).rejects.toMatchObject(
        { code: ErrorCode.GUARD_PERMISSION_DENIED },
      );
    });

    it('honors a direct per-user grant (non-base source) for a non-owner', async () => {
      mockUserRoute(USER_ROUTES[0]);
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalRoleName: 'user',
          globalPermissions: LEGACY_BASE_ROLE_PERMISSIONS,
          directPermissions: ['users:update_profile'],
        }),
      );

      await expect(guard.canActivate(otherUserContext())).resolves.toBe(true);
    });

    it('lets section staff read an active member health record through the section path', async () => {
      mockUserRoute(
        sensitive('GET /users/:userId/allergies', 'health', 'read'),
      );
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalRoleName: 'user',
          globalPermissions: LEGACY_BASE_ROLE_PERMISSIONS,
          activeClubPermissions: ['health:read'],
          instanceId: 22,
        }),
      );
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'active-assignment-1',
      });

      await expect(guard.canActivate(otherUserContext())).resolves.toBe(true);
    });

    it.each([
      ['GET /users/:userId/honors', 'user_honors:read'],
      ['GET /users/:userId/classes', 'classes:read'],
    ])(
      'lets section staff open %s of a member through the profile path',
      async (route, permission) => {
        mockUserRoute({ route, permission });
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          createResolved({
            globalRoleName: 'user',
            globalPermissions: LEGACY_BASE_ROLE_PERMISSIONS,
            activeClubPermissions: ['club_roles:read'],
            instanceId: 22,
          }),
        );
        mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
          assignment_id: 'active-assignment-1',
        });

        await expect(guard.canActivate(otherUserContext())).resolves.toBe(true);
      },
    );

    it('denies section staff writing a member health record (no club write path)', async () => {
      // Before the fix this passed via the base role (legacy fallback).
      mockUserRoute(
        sensitive('PUT /users/:userId/allergies', 'health', 'update'),
      );
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalRoleName: 'user',
          globalPermissions: LEGACY_BASE_ROLE_PERMISSIONS,
          activeClubPermissions: ['health:update', 'club_roles:read'],
          instanceId: 22,
        }),
      );
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'active-assignment-1',
      });

      await expect(guard.canActivate(otherUserContext())).rejects.toMatchObject(
        { code: ErrorCode.GUARD_PERMISSION_DENIED },
      );
    });

    it('denies a non-owner on an owner-aware active_assignment route via the base role, owner still passes', async () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSIONS_KEY) {
          return { permissions: ['classes:submit_progress'], mode: 'all' };
        }
        if (key === AUTHORIZATION_RESOURCE_KEY) {
          return { type: 'active_assignment', ownerParam: 'userId' };
        }
        return undefined;
      });
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalRoleName: 'user',
          globalPermissions: ['classes:submit_progress'],
        }),
      );

      await expect(guard.canActivate(otherUserContext())).rejects.toMatchObject(
        { code: ErrorCode.GUARD_PERMISSION_DENIED },
      );
      await expect(
        guard.canActivate(
          createContext({
            user: { sub: '99999999-9999-4999-8999-999999999993' },
            params: { userId: '99999999-9999-4999-8999-999999999993' },
          }),
        ),
      ).resolves.toBe(true);
    });

    it('keeps club permissions working on owner-aware active_assignment routes', async () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSIONS_KEY) {
          return { permissions: ['classes:submit_progress'], mode: 'all' };
        }
        if (key === AUTHORIZATION_RESOURCE_KEY) {
          return { type: 'active_assignment', ownerParam: 'userId' };
        }
        return undefined;
      });
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        createResolved({
          globalRoleName: 'user',
          globalPermissions: LEGACY_BASE_ROLE_PERMISSIONS,
          activeClubPermissions: ['classes:submit_progress'],
        }),
      );

      await expect(guard.canActivate(otherUserContext())).resolves.toBe(true);
    });

    it.each([
      ['global', { type: 'global' }, 'catalogs:read'],
      [
        'active_assignment without owner',
        { type: 'active_assignment' },
        'validation:read',
      ],
    ] as const)(
      'still counts the base role on non-owner-aware %s routes',
      async (_label, resource, permission) => {
        mockReflector.getAllAndOverride.mockImplementation((key: string) => {
          if (key === PERMISSIONS_KEY) {
            return { permissions: [permission], mode: 'all' };
          }
          if (key === AUTHORIZATION_RESOURCE_KEY) {
            return resource;
          }
          return undefined;
        });
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          createResolved({
            globalRoleName: 'user',
            globalPermissions: LEGACY_BASE_ROLE_PERMISSIONS,
          }),
        );

        await expect(
          guard.canActivate(createContext({ user: { sub: 'user-1' } })),
        ).resolves.toBe(true);
      },
    );

    describe('acting-for principal (guardian acting for a dependent)', () => {
      const GUARDIAN = 'guardian-1';
      const DEPENDENT = 'dependent-1';
      const STRANGER = 'stranger-1';

      /** Shape JwtStrategy.validate attaches while acting (see auth-principal.ts). */
      const actingUser = () => ({
        sub: DEPENDENT,
        userId: DEPENDENT,
        user_id: DEPENDENT,
        email: null,
        kind: 'guardian_acting',
        actor_sub: GUARDIAN,
        acting_for: true,
        scopes: ['self:read', 'profile:write'],
        guardianship_id: 'gs-1',
        consent_status: 'pending',
      });

      const actingContext = (targetUserId: string) =>
        createContext({
          user: actingUser(),
          params: { userId: targetUserId },
        });

      it.each(USER_ROUTES.map((route) => [route.route, route] as const))(
        'denies the acting guardian on another user via base-role grants: %s',
        async (_label, route) => {
          mockUserRoute(route);
          mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
            createResolved({
              globalRoleName: 'user',
              globalPermissions: LEGACY_BASE_ROLE_PERMISSIONS,
            }),
          );

          await expect(
            guard.canActivate(actingContext(STRANGER)),
          ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
          // Authorization is resolved for the substituted principal only.
          expect(
            mockAuthorizationContext.resolveUserAuthorization,
          ).toHaveBeenCalledWith(DEPENDENT);
          expect(
            mockAuthorizationContext.resolveUserAuthorization,
          ).not.toHaveBeenCalledWith(GUARDIAN);
        },
      );

      it('denies reading the guardian own record while acting (the guardian is another user)', async () => {
        mockUserRoute(
          sensitive('GET /users/:userId/allergies', 'health', 'read'),
        );
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          createResolved({
            globalRoleName: 'user',
            globalPermissions: LEGACY_BASE_ROLE_PERMISSIONS,
          }),
        );

        await expect(
          guard.canActivate(actingContext(GUARDIAN)),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      });

      it.each(USER_ROUTES.map((route) => [route.route, route] as const))(
        'lets the acting guardian through on the dependent own route (owner bypass): %s',
        async (_label, route) => {
          mockUserRoute(route);

          await expect(
            guard.canActivate(actingContext(DEPENDENT)),
          ).resolves.toBe(true);
          expect(
            mockAuthorizationContext.resolveUserAuthorization,
          ).not.toHaveBeenCalled();
        },
      );

      it('lets the acting guardian through on an owner-aware active_assignment route of the dependent', async () => {
        mockReflector.getAllAndOverride.mockImplementation((key: string) => {
          if (key === PERMISSIONS_KEY) {
            return { permissions: ['classes:submit_progress'], mode: 'all' };
          }
          if (key === AUTHORIZATION_RESOURCE_KEY) {
            return { type: 'active_assignment', ownerParam: 'userId' };
          }
          return undefined;
        });

        await expect(guard.canActivate(actingContext(DEPENDENT))).resolves.toBe(
          true,
        );
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          createResolved({
            globalRoleName: 'user',
            globalPermissions: ['classes:submit_progress'],
          }),
        );
        await expect(
          guard.canActivate(actingContext(STRANGER)),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      });

      it('never borrows the guardian own staff grants while acting', async () => {
        // The guardian is an admin, but the principal is the dependent: the
        // dependent's profile (base role only) is the one evaluated.
        mockUserRoute(USER_ROUTES[0]);
        mockAuthorizationContext.resolveUserAuthorization.mockImplementation(
          async (userId: string) =>
            userId === GUARDIAN
              ? createResolved({
                  globalRoleName: 'admin',
                  globalPermissions: ['users:update_profile'],
                })
              : createResolved({
                  globalRoleName: 'user',
                  globalPermissions: LEGACY_BASE_ROLE_PERMISSIONS,
                }),
        );

        await expect(
          guard.canActivate(actingContext(STRANGER)),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      });

      it('still counts the base role for the acting principal on non-owner-aware routes', async () => {
        mockReflector.getAllAndOverride.mockImplementation((key: string) => {
          if (key === PERMISSIONS_KEY) {
            return { permissions: ['catalogs:read'], mode: 'all' };
          }
          if (key === AUTHORIZATION_RESOURCE_KEY) {
            return { type: 'global' };
          }
          return undefined;
        });
        mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
          createResolved({
            globalRoleName: 'user',
            globalPermissions: LEGACY_BASE_ROLE_PERMISSIONS,
          }),
        );

        await expect(
          guard.canActivate(createContext({ user: actingUser() })),
        ).resolves.toBe(true);
      });
    });
  });
});
