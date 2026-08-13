import { AuthorizationContextService } from '../services/authorization-context.service';
import { ErrorCode } from '../errors/error-codes';
import { OwnerOrAdminGuard } from './owner-or-admin.guard';

describe('OwnerOrAdminGuard', () => {
  const mockAuthorizationContext = {
    hasAnyGlobalRole: jest.fn(),
  };

  const guard = new OwnerOrAdminGuard(
    mockAuthorizationContext as unknown as AuthorizationContextService,
  );

  const createContext = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should throw when user is not authenticated', async () => {
    await expect(
      guard.canActivate(createContext({ params: { userId: 'user-1' } })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_USER_NOT_AUTHENTICATED });
  });

  it('should throw when user has no sub claim', async () => {
    await expect(
      guard.canActivate(
        createContext({ user: {}, params: { userId: 'user-1' } }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_USER_NOT_AUTHENTICATED });
  });

  it('should throw when userId param is missing', async () => {
    await expect(
      guard.canActivate(createContext({ user: { sub: 'actor-1' }, params: {} })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_USER_ID_PARAM_MISSING });
  });

  it('should allow the resource owner without checking global roles', async () => {
    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'user-1' },
          params: { userId: 'user-1' },
        }),
      ),
    ).resolves.toBe(true);

    expect(mockAuthorizationContext.hasAnyGlobalRole).not.toHaveBeenCalled();
  });

  it('should allow administrative global roles to access another user resource', async () => {
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(true);

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'actor-1' },
          params: { userId: 'user-2' },
        }),
      ),
    ).resolves.toBe(true);

    expect(mockAuthorizationContext.hasAnyGlobalRole).toHaveBeenCalledWith(
      'actor-1',
      ['admin', 'assistant-admin', 'super-admin'],
    );
  });

  it('should deny coordinator access to another user resource', async () => {
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(false);

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'coordinator-1' },
          params: { userId: 'user-2' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_OWNER_OR_ADMIN_REQUIRED });

    expect(mockAuthorizationContext.hasAnyGlobalRole).toHaveBeenCalledWith(
      'coordinator-1',
      ['admin', 'assistant-admin', 'super-admin'],
    );
  });

  it('should deny a non-owner without administrative roles', async () => {
    mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValueOnce(false);

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'member-1' },
          params: { userId: 'user-2' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_OWNER_OR_ADMIN_REQUIRED });
  });
});
