import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AuthorizationContextService } from '../services/authorization-context.service';
import {
  AUTHORIZATION_RESOURCE_KEY,
  PERMISSIONS_KEY,
} from '../decorators';
import { PrismaService } from '../../prisma/prisma.service';

describe('PermissionsGuard', () => {
  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
    canManageClub: jest.fn(),
  };

  const mockPrisma = {
    activities: { findUnique: jest.fn() },
    finances: { findUnique: jest.fn() },
    local_camporees: { findUnique: jest.fn() },
    club_inventory: { findUnique: jest.fn() },
    club_role_assignments: { findUnique: jest.fn() },
    club_adventurers: { findUnique: jest.fn() },
    club_pathfinders: { findUnique: jest.fn() },
    club_master_guilds: { findUnique: jest.fn() },
  };

  const guard = new PermissionsGuard(
    mockReflector as unknown as Reflector,
    mockAuthorizationContext as unknown as AuthorizationContextService,
    mockPrisma as unknown as PrismaService,
  );

  const createContext = (request: Record<string, unknown>) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as any;

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
            instance: {
              type: instanceType,
              instance_id: instanceId,
              instance_name: 'Conquistadores',
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
        permissions: [...new Set([...globalPermissions, ...activeClubPermissions])],
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
                instance: {
                  type: instanceType,
                  instance_id: instanceId,
                  instance_name: 'Conquistadores',
                },
              }
            : null,
        },
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
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
      return undefined;
    });
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      createResolved({ activeClubPermissions: ['clubs:read'] }),
    );

    await expect(
      guard.canActivate(createContext({ user: { sub: 'club-user-1' } })),
    ).rejects.toThrow(
      new ForbiddenException(
        'Missing required global permissions: clubs:read',
      ),
    );
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
    ).rejects.toThrow(
      new ForbiddenException(
        'You need an active club assignment for this club',
      ),
    );
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
    mockPrisma.club_pathfinders.findUnique.mockResolvedValue({
      club_pathf_id: 22,
      main_club_id: 10,
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
    ).rejects.toThrow(
      new ForbiddenException(
        'You need an active assignment or global scope for this camporee',
      ),
    );
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
    mockPrisma.club_pathfinders.findUnique.mockResolvedValue({
      club_pathf_id: 99,
      main_club_id: 10,
    });

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-user-1' },
          params: { clubId: '99' },
          query: { instanceType: 'pathf' },
        }),
      ),
    ).rejects.toThrow(
      new ForbiddenException(
        'You need an active club assignment for this exact instance',
      ),
    );
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
    ).rejects.toThrow(new NotFoundException('Club assignment not found'));
  });
});
