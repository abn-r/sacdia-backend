import { Reflector } from '@nestjs/core';
import { GlobalRolesGuard } from './global-roles.guard';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { ErrorCode } from '../errors/error-codes';

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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should allow when no roles are required', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).resolves.toBe(true);
  });

  it('should allow when required roles list is empty', async () => {
    mockReflector.getAllAndOverride.mockReturnValue([]);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).resolves.toBe(true);
  });

  it('should throw ForbiddenException when user is not authenticated', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['admin']);

    await expect(guard.canActivate(createContext({}))).rejects.toMatchObject({
      code: ErrorCode.GUARD_USER_NOT_AUTHENTICATED,
    });
  });

  it('should throw ForbiddenException when user has no sub claim', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['admin']);

    await expect(
      guard.canActivate(createContext({ user: {} })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_USER_NOT_AUTHENTICATED });
  });

  it('should allow super-admin user when roles list does not include super-admin', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['admin', 'coordinator']);
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
    mockReflector.getAllAndOverride.mockReturnValue(['admin', 'coordinator']);
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
    mockReflector.getAllAndOverride.mockReturnValue(['coordinator']);
    // isSuperAdmin → false, role check → true
    mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(false);
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(true);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'coordinator-user' } })),
    ).resolves.toBe(true);
  });

  it('should expand admin alias to include assistant-admin', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['admin']);
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
    mockReflector.getAllAndOverride.mockReturnValue(['coordinator']);
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
      ]),
    );
  });

  it('should let general coordinator satisfy zone-coordinator requirement', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['zone-coordinator']);
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
    mockReflector.getAllAndOverride.mockReturnValue(['admin']);
    // isSuperAdmin → false, role check → false
    mockAuthorizationContext.isSuperAdmin.mockResolvedValueOnce(false);
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(false);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });
});
