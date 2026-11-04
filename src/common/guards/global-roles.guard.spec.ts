import { Reflector } from '@nestjs/core';
import { GlobalRolesGuard } from './global-roles.guard';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { ErrorCode } from '../errors/error-codes';
import {
  EXACT_GLOBAL_ROLES_KEY,
  GLOBAL_ROLES_KEY,
} from '../decorators/global-roles.decorator';

describe('GlobalRolesGuard', () => {
  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockAuthorizationContext = {
    isSuperAdmin: jest.fn(),
    hasAnyGlobalRole: jest.fn(),
  };

  const guard = new GlobalRolesGuard(
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

  // Resolves metadata per key; the handler/class split is exercised by the
  // reflector contract (getAllAndOverride already merges both levels).
  const mockMetadata = (meta: { alias?: unknown; exact?: unknown }) =>
    mockReflector.getAllAndOverride.mockImplementation((key: string) =>
      key === EXACT_GLOBAL_ROLES_KEY
        ? meta.exact
        : key === GLOBAL_ROLES_KEY
          ? meta.alias
          : undefined,
    );
  const mockAlias = (alias: unknown) => mockMetadata({ alias });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should allow when no roles are required', async () => {
    mockAlias(undefined);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).resolves.toBe(true);
  });

  it('should allow when required roles list is empty', async () => {
    mockAlias([]);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).resolves.toBe(true);
  });

  it('should throw ForbiddenException when user is not authenticated', async () => {
    mockAlias(['admin']);

    await expect(guard.canActivate(createContext({}))).rejects.toMatchObject({
      code: ErrorCode.GUARD_USER_NOT_AUTHENTICATED,
    });
  });

  it('should throw ForbiddenException when user has no sub claim', async () => {
    mockAlias(['admin']);

    await expect(
      guard.canActivate(createContext({ user: {} })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_USER_NOT_AUTHENTICATED });
  });

  it('should allow super-admin user when roles list does not include super-admin', async () => {
    mockAlias(['admin', 'coordinator']);
    // isSuperAdmin bypass → true: god-mode, short-circuit
    mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(true);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'super-admin-user' } })),
    ).resolves.toBe(true);

    // isSuperAdmin was called once and the guard short-circuited — hasAnyGlobalRole never reached
    expect(mockAuthorizationContext.isSuperAdmin).toHaveBeenCalledTimes(1);
    expect(mockAuthorizationContext.isSuperAdmin).toHaveBeenCalledWith(
      'super-admin-user',
    );
    expect(mockAuthorizationContext.hasAnyGlobalRole).not.toHaveBeenCalled();
  });

  it('should not grant bypass to non-super-admin users', async () => {
    mockAlias(['admin', 'coordinator']);
    // isSuperAdmin → false, then role check → false
    mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(false);
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(false);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'regular-user' } })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });

    expect(mockAuthorizationContext.isSuperAdmin).toHaveBeenCalledTimes(1);
    expect(mockAuthorizationContext.hasAnyGlobalRole).toHaveBeenCalledTimes(1);
  });

  it('should allow a user with a matching required role', async () => {
    mockAlias(['coordinator']);
    // isSuperAdmin → false, role check → true
    mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(false);
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(true);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'coordinator-user' } })),
    ).resolves.toBe(true);
  });

  it('should expand admin alias to include assistant-admin', async () => {
    mockAlias(['admin']);
    // isSuperAdmin → false, role check (expanded) → true
    mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(false);
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(true);

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'assistant-admin-user' } }),
      ),
    ).resolves.toBe(true);

    // Verify aliases were expanded: admin → [admin, assistant-admin]
    const firstRoleCall =
      mockAuthorizationContext.hasAnyGlobalRole.mock.calls[0];
    expect(firstRoleCall[1]).toEqual(
      expect.arrayContaining(['admin', 'assistant-admin']),
    );
  });

  it('should expand coordinator alias to include zone and general coordinators', async () => {
    mockAlias(['coordinator']);
    mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(false);
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(true);

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'zone-coordinator-user' } }),
      ),
    ).resolves.toBe(true);

    const firstRoleCall =
      mockAuthorizationContext.hasAnyGlobalRole.mock.calls[0];
    expect(firstRoleCall[1]).toEqual(
      expect.arrayContaining([
        'coordinator',
        'zone-coordinator',
        'general-coordinator',
        'director-lf',
        'assistant-lf',
      ]),
    );
  });

  it('should expand coordinator alias to include director-lf', async () => {
    mockAlias(['coordinator']);
    mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(false);
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(true);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'director-lf-user' } })),
    ).resolves.toBe(true);

    const firstRoleCall =
      mockAuthorizationContext.hasAnyGlobalRole.mock.calls[0];
    expect(firstRoleCall[1]).toEqual(
      expect.arrayContaining(['director-lf', 'assistant-lf']),
    );
  });

  it('should let general coordinator satisfy zone-coordinator requirement', async () => {
    mockAlias(['zone-coordinator']);
    mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(false);
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(true);

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'general-coordinator-user' } }),
      ),
    ).resolves.toBe(true);

    const firstRoleCall =
      mockAuthorizationContext.hasAnyGlobalRole.mock.calls[0];
    expect(firstRoleCall[1]).toEqual(
      expect.arrayContaining(['zone-coordinator', 'general-coordinator']),
    );
  });

  it('should throw ForbiddenException when user has no matching role', async () => {
    mockAlias(['admin']);
    // isSuperAdmin → false, role check → false
    mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(false);
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(false);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });

  describe('@ExactGlobalRoles', () => {
    const exact = ['director-lf', 'assistant-lf'];
    // Fake role store: the user holds exactly `held`.
    const holdRoles = (held: string[]) =>
      mockAuthorizationContext.hasAnyGlobalRole.mockImplementation(
        (_userId: string, accepted: string[]) =>
          Promise.resolve(accepted.some((role) => held.includes(role))),
      );

    it('allows director-lf under an exact gate', async () => {
      mockMetadata({ exact });
      mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(false);
      holdRoles(['director-lf']);

      await expect(
        guard.canActivate(createContext({ user: { sub: 'lf-user' } })),
      ).resolves.toBe(true);
      expect(
        mockAuthorizationContext.hasAnyGlobalRole.mock.calls[0][1],
      ).toEqual(exact);
    });

    it('denies director-union under an exact gate that the alias gate would allow', async () => {
      mockAuthorizationContext.isSuperAdmin.mockResolvedValue(false);
      holdRoles(['director-union']);

      mockAlias(['director-lf']);
      await expect(
        guard.canActivate(createContext({ user: { sub: 'union-user' } })),
      ).resolves.toBe(true);

      mockMetadata({ exact: ['director-lf'] });
      await expect(
        guard.canActivate(createContext({ user: { sub: 'union-user' } })),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    });

    it('still lets super-admin bypass an exact gate', async () => {
      mockMetadata({ exact });
      mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(true);

      await expect(
        guard.canActivate(createContext({ user: { sub: 'root' } })),
      ).resolves.toBe(true);
      expect(mockAuthorizationContext.hasAnyGlobalRole).not.toHaveBeenCalled();
    });

    it('lets the exact declaration win over an alias declaration', async () => {
      mockMetadata({ alias: ['director-lf'], exact: ['assistant-lf'] });
      mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(false);
      holdRoles(['director-union']);

      await expect(
        guard.canActivate(createContext({ user: { sub: 'union-user' } })),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      expect(
        mockAuthorizationContext.hasAnyGlobalRole.mock.calls[0][1],
      ).toEqual(['assistant-lf']);
    });
  });
});
