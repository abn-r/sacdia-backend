import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalRolesGuard } from './global-roles.guard';
import { AuthorizationContextService } from '../services/authorization-context.service';

describe('GlobalRolesGuard', () => {
  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockAuthorizationContext = {
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

    await expect(
      guard.canActivate(createContext({})),
    ).rejects.toThrow(new ForbiddenException('User not authenticated'));
  });

  it('should throw ForbiddenException when user has no sub claim', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['admin']);

    await expect(
      guard.canActivate(createContext({ user: {} })),
    ).rejects.toThrow(new ForbiddenException('User not authenticated'));
  });

  it('should allow super_admin user when roles list does not include super_admin', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['admin', 'coordinator']);
    // First call: isSuperAdmin check → true
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(true);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'super-admin-user' } })),
    ).resolves.toBe(true);

    // Should have checked super_admin bypass and short-circuited — only 1 call total
    expect(mockAuthorizationContext.hasAnyGlobalRole).toHaveBeenCalledTimes(1);
    expect(mockAuthorizationContext.hasAnyGlobalRole).toHaveBeenCalledWith(
      'super-admin-user',
      ['super_admin'],
    );
  });

  it('should not grant bypass to non-super_admin users', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['admin', 'coordinator']);
    // First call: isSuperAdmin check → false
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(false);
    // Second call: role check → false
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(false);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'regular-user' } })),
    ).rejects.toThrow(
      new ForbiddenException('You need one of these global roles: admin, coordinator'),
    );

    expect(mockAuthorizationContext.hasAnyGlobalRole).toHaveBeenCalledTimes(2);
  });

  it('should allow a user with a matching required role', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['coordinator']);
    // First call: isSuperAdmin → false
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(false);
    // Second call: role check → true
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(true);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'coordinator-user' } })),
    ).resolves.toBe(true);
  });

  it('should expand admin alias to include assistant_admin', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['admin']);
    // First call: isSuperAdmin → false
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(false);
    // Second call: role check (expanded to admin + assistant_admin) → true
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(true);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'assistant-admin-user' } })),
    ).resolves.toBe(true);

    // Verify aliases were expanded: admin → [admin, assistant_admin]
    const secondCall = mockAuthorizationContext.hasAnyGlobalRole.mock.calls[1];
    expect(secondCall[1]).toEqual(
      expect.arrayContaining(['admin', 'assistant_admin']),
    );
  });

  it('should throw ForbiddenException when user has no matching role', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['admin']);
    // First call: isSuperAdmin → false
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(false);
    // Second call: role check → false
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(false);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).rejects.toThrow(
      new ForbiddenException('You need one of these global roles: admin'),
    );
  });
});
