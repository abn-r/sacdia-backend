import { Reflector } from '@nestjs/core';
import { ClubRolesGuard } from './club-roles.guard';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { ErrorCode } from '../errors/error-codes';

describe('ClubRolesGuard', () => {
  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockAuthorizationContext = {
    canManageClub: jest.fn(),
    resolveUserAuthorization: jest.fn(),
  };

  const guard = new ClubRolesGuard(
    mockReflector as unknown as Reflector,
    mockAuthorizationContext as unknown as AuthorizationContextService,
  );

  const createContext = (request: Record<string, unknown>) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should allow when no club roles are required', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'user-123' }, params: { clubId: '10' } }),
      ),
    ).resolves.toBe(true);
  });

  it('should allow territorial global managers before checking active assignment', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['director']);
    mockAuthorizationContext.canManageClub.mockResolvedValue(true);

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'user-123' }, params: { clubId: '10' } }),
      ),
    ).resolves.toBe(true);
    expect(
      mockAuthorizationContext.resolveUserAuthorization,
    ).not.toHaveBeenCalled();
  });

  it('should allow when active assignment belongs to the club and role matches', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['deputy_director']);
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        effective: {
          scope: {
            club: {
              assignment_id: 'assignment-1',
              role_name: 'subdirector',
              club: {
                club_id: 10,
                club_name: 'Club Amanecer',
              },
              instance: {
                type: 'pathfinders',
                instance_id: 22,
                instance_name: 'Conquistadores',
              },
            },
          },
        },
      },
    });

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'user-123' }, params: { clubId: '10' } }),
      ),
    ).resolves.toBe(true);
  });

  it('should reject when the request does not include a club id', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['director']);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_ID_REQUIRED });
  });

  it('should reject when the active assignment belongs to another club', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['director']);
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        effective: {
          scope: {
            club: {
              assignment_id: 'assignment-1',
              role_name: 'director',
              club: {
                club_id: 99,
                club_name: 'Club Horizonte',
              },
              instance: {
                type: 'pathfinders',
                instance_id: 44,
                instance_name: 'Conquistadores',
              },
            },
          },
        },
      },
    });

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'user-123' }, params: { clubId: '10' } }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  it('should reject when the active club role does not satisfy the required roles', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['treasurer']);
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        effective: {
          scope: {
            club: {
              assignment_id: 'assignment-1',
              role_name: 'director',
              club: {
                club_id: 10,
                club_name: 'Club Amanecer',
              },
              instance: {
                type: 'adventurers',
                instance_id: 11,
                instance_name: 'Aventureros',
              },
            },
          },
        },
      },
    });

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'user-123' }, params: { clubId: '10' } }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });
});
