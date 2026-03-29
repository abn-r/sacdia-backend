import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { BetterAuthService } from '../better-auth/better-auth.service';
import {
  BadRequestException,
  InternalServerErrorException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { TokenBlacklistService } from '../common/services/token-blacklist.service';

describe('AuthService', () => {
  let service: AuthService;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalRejectSnakeCase = process.env.AUTH_REJECT_SNAKE_CASE;

  // -------------------------------------------------------------------------
  // Prisma transaction mock — only users_pr and roles remain in the SACDIA
  // transaction (BA owns the users table insert via prismaAdapter).
  // -------------------------------------------------------------------------
  const mockTx = {
    users: {
      update: jest.fn(),
    },
    users_pr: {
      create: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
    },
    users_roles: {
      create: jest.fn(),
    },
  };

  const mockPrismaService = {
    $transaction: jest.fn(),
    users: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    users_pr: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
    },
    verification: {
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  };

  // -------------------------------------------------------------------------
  // BetterAuthService mock — replaces all SupabaseService calls
  // -------------------------------------------------------------------------
  const mockBetterAuthService = {
    createUser: jest.fn(),
    signInWithPassword: jest.fn(),
    refreshSession: jest.fn(),
    signOut: jest.fn(),
    resetPasswordForEmail: jest.fn(),
    updatePasswordById: jest.fn(),
    signJwt: jest.fn(),
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(
      async (_bucket: StorageBucketAlias, value: string) => value,
    ),
  };

  const mockAuthorizationContextService = {
    resolveUserAuthorization: jest.fn(),
  };

  const mockTokenBlacklistService = {
    blacklist: jest.fn(),
    isBlacklisted: jest.fn(),
    blacklistAllUserTokens: jest.fn(),
    isUserBlacklisted: jest.fn(),
  };

  beforeEach(async () => {
    mockPrismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof mockTx) => Promise<unknown>) =>
        callback(mockTx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BetterAuthService, useValue: mockBetterAuthService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContextService,
        },
        {
          provide: TokenBlacklistService,
          useValue: mockTokenBlacklistService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = originalFrontendUrl;
    process.env.AUTH_REJECT_SNAKE_CASE = originalRejectSnakeCase;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // register()
  // ---------------------------------------------------------------------------
  describe('register', () => {
    const registerDto = {
      email: 'juan.garcia@example.com',
      password: 'Password123!',
      name: 'Juan',
      paternal_last_name: 'Garcia',
      maternal_last_name: 'Lopez',
    };

    const mockBaResult = {
      user: {
        id: 'user-123',
        email: registerDto.email,
        name: registerDto.name,
      },
      session: {
        token: 'ba-session-token',
        expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
      },
      accessToken: 'sacdia-jwt-token',
    };

    it('should register a user successfully', async () => {
      mockBetterAuthService.createUser.mockResolvedValue(mockBaResult);
      mockTx.users_pr.create.mockResolvedValue({ user_id: 'user-123' });
      mockTx.roles.findFirst.mockResolvedValue({
        role_id: 1,
        role_name: 'user',
      });
      mockTx.users_roles.create.mockResolvedValue({
        user_id: 'user-123',
        role_id: 1,
      });
      mockPrismaService.verification.create.mockResolvedValue({});

      const result = await service.register(registerDto);

      expect(mockBetterAuthService.createUser).toHaveBeenCalledWith(
        registerDto.email,
        registerDto.password,
        registerDto.name,
      );
      expect(mockTx.users_pr.create).toHaveBeenCalled();
      expect(mockTx.users_roles.create).toHaveBeenCalled();
      expect(result).toMatchObject({
        success: true,
        userId: 'user-123',
        message: 'Usuario registrado exitosamente',
        emailVerificationPending: true,
        status: 'success',
        data: expect.objectContaining({
          user: expect.objectContaining({
            id: 'user-123',
            email: registerDto.email,
            name: registerDto.name,
            paternal_last_name: registerDto.paternal_last_name,
            maternal_last_name: registerDto.maternal_last_name,
            roles: ['user'],
          }),
          needsPostRegistration: true,
          postRegistrationStatus: expect.objectContaining({
            complete: false,
          }),
        }),
      });
    });

    it('should throw when BA createUser fails', async () => {
      mockBetterAuthService.createUser.mockRejectedValue(
        new UnauthorizedException('Email already in use'),
      );

      await expect(service.register(registerDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockBetterAuthService.signOut).not.toHaveBeenCalled();
    });

    it('should revoke BA session when database transaction fails', async () => {
      mockBetterAuthService.createUser.mockResolvedValue(mockBaResult);
      mockBetterAuthService.signOut.mockResolvedValue(undefined);
      mockTx.users_pr.create.mockRejectedValue(new Error('Database exploded'));

      await expect(service.register(registerDto)).rejects.toThrow(
        'Database exploded',
      );
      expect(mockBetterAuthService.signOut).toHaveBeenCalledWith(
        mockBaResult.session.token,
      );
    });

    it('should revoke BA session when default role does not exist', async () => {
      mockBetterAuthService.createUser.mockResolvedValue(mockBaResult);
      mockBetterAuthService.signOut.mockResolvedValue(undefined);
      mockTx.users_pr.create.mockResolvedValue({ user_id: 'user-123' });
      mockTx.roles.findFirst.mockResolvedValue(null);

      await expect(service.register(registerDto)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(mockBetterAuthService.signOut).toHaveBeenCalledWith(
        mockBaResult.session.token,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // login()
  // ---------------------------------------------------------------------------
  describe('login', () => {
    const loginDto = {
      email: 'juan.garcia@example.com',
      password: 'Password123!',
    };

    const sessionExpiresAt = new Date(1900000000 * 1000);
    const mockBaResult = {
      user: { id: 'user-123', email: loginDto.email },
      session: {
        token: 'ba-opaque-session-token',
        expiresAt: sessionExpiresAt,
      },
      accessToken: 'sacdia-hs256-jwt',
    };

    it('should throw UnauthorizedException when BA credentials are invalid', async () => {
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation();
      mockBetterAuthService.signInWithPassword.mockRejectedValue(
        new UnauthorizedException('Invalid login credentials'),
      );

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );

      const warnMessage = String(warnSpy.mock.calls[0]?.[0] ?? '');
      expect(warnMessage).toContain('ju***@example.com');
      expect(warnMessage).not.toContain(loginDto.email);
    });

    it('should throw UnauthorizedException when user is not in local database', async () => {
      mockBetterAuthService.signInWithPassword.mockResolvedValue(mockBaResult);
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return tokens, user data, and post-registration state', async () => {
      mockBetterAuthService.signInWithPassword.mockResolvedValue(mockBaResult);
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'user-123',
        email: loginDto.email,
        name: 'Juan',
        paternal_last_name: 'Garcia',
        maternal_last_name: 'Lopez',
        user_image: 'https://avatar.test/user-123.png',
        users_pr: {
          complete: false,
          profile_picture_complete: false,
          personal_info_complete: false,
          club_selection_complete: false,
        },
        users_roles: [
          { roles: { role_name: 'user', role_category: 'GLOBAL' } },
          { roles: { role_name: 'director', role_category: 'GLOBAL' } },
        ],
      });

      const result = await service.login(loginDto);

      expect(result).toEqual({
        status: 'success',
        data: {
          // accessToken = SACDIA HS256 JWT (1h)
          accessToken: 'sacdia-hs256-jwt',
          // refreshToken = BA opaque session token (7-day sliding credential)
          refreshToken: 'ba-opaque-session-token',
          expiresAt: 1900000000,
          tokenType: 'bearer',
          user: {
            id: 'user-123',
            email: loginDto.email,
            name: 'Juan',
            paternal_last_name: 'Garcia',
            maternal_last_name: 'Lopez',
            avatar: 'https://avatar.test/user-123.png',
            roles: ['user', 'director'],
          },
          needsPostRegistration: true,
          postRegistrationStatus: {
            complete: false,
            profile_picture_complete: false,
            personal_info_complete: false,
            club_selection_complete: false,
          },
        },
      });
    });

    it('should compute needsPostRegistration=false when users_pr.complete is true', async () => {
      mockBetterAuthService.signInWithPassword.mockResolvedValue(mockBaResult);
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'user-123',
        email: loginDto.email,
        name: 'Juan',
        paternal_last_name: 'Garcia',
        maternal_last_name: 'Lopez',
        user_image: null,
        users_pr: {
          complete: true,
          profile_picture_complete: true,
          personal_info_complete: true,
          club_selection_complete: true,
        },
        users_roles: [],
      });

      const result = await service.login(loginDto);

      expect(result.data.needsPostRegistration).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // logout()
  // ---------------------------------------------------------------------------
  describe('logout', () => {
    it('should revoke BA session when refreshToken (BA session token) is provided', async () => {
      mockBetterAuthService.signOut.mockResolvedValue(undefined);

      const result = await service.logout({
        refreshToken: 'ba-session-token',
        userAgent: 'test-agent',
      });

      expect(mockBetterAuthService.signOut).toHaveBeenCalledWith(
        'ba-session-token',
      );
      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: true,
        revocationSucceeded: true,
        path: 'session',
      });
    });

    it('should return success even when BA signOut throws (best effort)', async () => {
      mockBetterAuthService.signOut.mockRejectedValue(
        new Error('Session not found'),
      );

      const result = await service.logout({
        refreshToken: 'ba-session-token',
      });

      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: true,
        revocationSucceeded: false,
        path: 'session',
      });
    });

    it('should return access_only path when only SACDIA JWT access token is provided', async () => {
      // SACDIA JWT: BA has no record of it — cannot revoke server-side
      const result = await service.logout({
        accessToken: 'sacdia-hs256-jwt',
      });

      expect(mockBetterAuthService.signOut).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: false,
        revocationSucceeded: false,
        path: 'access_only',
      });
    });

    it('should return none path when no tokens are provided', async () => {
      const result = await service.logout({});

      expect(mockBetterAuthService.signOut).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: false,
        revocationSucceeded: false,
        path: 'none',
      });
    });

    it('should prefer refreshToken over accessToken when both are provided', async () => {
      mockBetterAuthService.signOut.mockResolvedValue(undefined);

      const result = await service.logout({
        accessToken: 'sacdia-hs256-jwt',
        refreshToken: 'ba-session-token',
      });

      expect(mockBetterAuthService.signOut).toHaveBeenCalledWith(
        'ba-session-token',
      );
      expect(result.path).toBe('session');
    });
  });

  // ---------------------------------------------------------------------------
  // refreshSession()
  // ---------------------------------------------------------------------------
  describe('refreshSession', () => {
    const sessionExpiresAt = new Date(1900000000 * 1000);
    const mockBaResult = {
      user: { id: 'user-123', email: 'juan.garcia@example.com' },
      session: { token: 'same-ba-session-token', expiresAt: sessionExpiresAt },
      accessToken: 'new-sacdia-jwt',
    };

    it('should throw BadRequestException when refresh token is missing', async () => {
      await expect(service.refreshSession({} as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw UnauthorizedException when BA refreshSession fails', async () => {
      mockBetterAuthService.refreshSession.mockRejectedValue(
        new UnauthorizedException('Session not found or expired'),
      );

      await expect(
        service.refreshSession({ refreshToken: 'invalid-session-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject legacy snake_case field by default', async () => {
      process.env.AUTH_REJECT_SNAKE_CASE = 'true';

      await expect(
        service.refreshSession({ refresh_token: 'legacy-token' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'LEGACY_SNAKE_CASE_REMOVED',
          removedAt: '2026-03-01',
          use: 'refreshToken',
        }),
      });
    });

    it('should return new SACDIA JWT with same BA session token', async () => {
      mockBetterAuthService.refreshSession.mockResolvedValue(mockBaResult);

      const result = await service.refreshSession({
        refreshToken: 'ba-session-token',
      });

      expect(mockBetterAuthService.refreshSession).toHaveBeenCalledWith(
        'ba-session-token',
      );
      expect(result).toEqual({
        status: 'success',
        data: {
          accessToken: 'new-sacdia-jwt',
          refreshToken: 'same-ba-session-token',
          expiresAt: 1900000000,
          tokenType: 'bearer',
        },
      });
    });

    it('should allow snake_case input when rollback flag is disabled', async () => {
      process.env.AUTH_REJECT_SNAKE_CASE = 'false';
      mockBetterAuthService.refreshSession.mockResolvedValue(mockBaResult);

      const result = await service.refreshSession({
        refresh_token: 'legacy-ba-session-token',
      });

      expect(mockBetterAuthService.refreshSession).toHaveBeenCalledWith(
        'legacy-ba-session-token',
      );
      expect(result.data.accessToken).toBe('new-sacdia-jwt');
      expect(result.data.refreshToken).toBe('same-ba-session-token');
    });
  });

  // ---------------------------------------------------------------------------
  // requestPasswordReset()
  // ---------------------------------------------------------------------------
  describe('requestPasswordReset', () => {
    it('should call BA resetPasswordForEmail with redirectTo when FRONTEND_URL is set', async () => {
      process.env.FRONTEND_URL = 'https://sacdia.app';
      mockBetterAuthService.resetPasswordForEmail.mockResolvedValue(undefined);

      const result = await service.requestPasswordReset({
        email: 'juan.garcia@example.com',
      });

      expect(mockBetterAuthService.resetPasswordForEmail).toHaveBeenCalledWith(
        'juan.garcia@example.com',
        'https://sacdia.app/reset-password',
      );
      expect(result).toEqual({
        success: true,
        message: 'Correo de recuperación enviado',
      });
    });

    it('should call BA resetPasswordForEmail without redirectTo when FRONTEND_URL is unset', async () => {
      delete process.env.FRONTEND_URL;
      mockBetterAuthService.resetPasswordForEmail.mockResolvedValue(undefined);

      await service.requestPasswordReset({ email: 'juan.garcia@example.com' });

      expect(mockBetterAuthService.resetPasswordForEmail).toHaveBeenCalledWith(
        'juan.garcia@example.com',
        undefined,
      );
    });

    it('should throw BadRequestException when BA resetPasswordForEmail throws', async () => {
      mockBetterAuthService.resetPasswordForEmail.mockRejectedValue(
        new Error('BA error'),
      );

      await expect(
        service.requestPasswordReset({ email: 'juan.garcia@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // updatePassword()
  // ---------------------------------------------------------------------------
  describe('updatePassword', () => {
    it('should throw NotImplementedException (BA admin plugin not configured)', async () => {
      await expect(
        service.updatePassword('user-123', 'NewPassword123!'),
      ).rejects.toThrow(NotImplementedException);
    });
  });

  // ---------------------------------------------------------------------------
  // getProfile()
  // ---------------------------------------------------------------------------
  describe('getProfile', () => {
    it('should throw UnauthorizedException when user is not found', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockRejectedValue(
        new UnauthorizedException('Usuario no encontrado'),
      );

      await expect(service.getProfile('missing-user')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return profile with canonical authorization and legacy fields', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: {
            user_id: 'user-123',
            email: 'juan.garcia@example.com',
            name: 'Juan',
            paternal_last_name: 'Garcia',
            maternal_last_name: 'Lopez',
            gender: 'M',
            birthday: new Date('2000-01-01'),
            baptism: true,
            baptism_date: new Date('2015-01-01'),
            user_image: 'https://avatar.test/user-123.png',
            country_id: 1,
            union_id: 2,
            local_field_id: 3,
            created_at: new Date('2026-02-10'),
          },
          post_register_complete: true,
          authorization: {
            grants: {
              global_roles: [
                {
                  role_name: 'user',
                  permissions: ['read', 'write'],
                  scope: {
                    country: { id: 1, name: 'México' },
                    union: { id: 2, name: 'UMS' },
                    local_field: { id: 3, name: 'Campo Sur' },
                  },
                },
              ],
              club_assignments: [],
            },
            active_assignment: { assignment_id: null },
            effective: {
              permissions: ['read', 'write'],
              scope: {
                global: {
                  country: { id: 1, name: 'México' },
                  union: { id: 2, name: 'UMS' },
                  local_field: { id: 3, name: 'Campo Sur' },
                },
                club: null,
              },
            },
          },
          legacy: {
            roles: ['user', 'leader'],
            permissions: ['read', 'write'],
            club: null,
            club_context: {
              active_assignment_id: null,
              active: null,
              available: [],
            },
          },
        },
      );

      const result = await service.getProfile('user-123');

      expect(result.status).toBe('success');
      expect(result.data.roles).toEqual(['user', 'leader']);
      expect(result.data.permissions).toEqual(['read', 'write']);
      expect(result.data.authorization).toEqual({
        grants: {
          global_roles: [
            {
              role_name: 'user',
              permissions: ['read', 'write'],
              scope: {
                country: { id: 1, name: 'México' },
                union: { id: 2, name: 'UMS' },
                local_field: { id: 3, name: 'Campo Sur' },
              },
            },
          ],
          club_assignments: [],
        },
        active_assignment: { assignment_id: null },
        effective: {
          permissions: ['read', 'write'],
          scope: {
            global: {
              country: { id: 1, name: 'México' },
              union: { id: 2, name: 'UMS' },
              local_field: { id: 3, name: 'Campo Sur' },
            },
            club: null,
          },
        },
      });
      expect(result.data.post_register_complete).toBe(true);
    });

    it('should prioritize active context from authorization resolver', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: {
            user_id: 'user-123',
            email: 'juan.garcia@example.com',
            name: 'Juan',
            paternal_last_name: 'Garcia',
            maternal_last_name: 'Lopez',
            gender: 'M',
            birthday: new Date('2000-01-01'),
            baptism: true,
            baptism_date: new Date('2015-01-01'),
            user_image: 'https://avatar.test/user-123.png',
            country_id: 1,
            union_id: 2,
            local_field_id: 3,
            created_at: new Date('2026-02-10'),
          },
          post_register_complete: true,
          authorization: {
            grants: {
              global_roles: [
                {
                  role_name: 'user',
                  permissions: ['read'],
                  scope: {},
                },
              ],
              club_assignments: [
                {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  permissions: ['clubs:read'],
                  club: { club_id: 1, club_name: 'Club A' },
                  instance: {
                    type: 'adventurers',
                    instance_id: 11,
                    instance_name: 'Aventureros',
                  },
                  scope: {},
                  status: 'active',
                  start_date: new Date('2026-01-01'),
                  end_date: null,
                },
                {
                  assignment_id: 'assignment-2',
                  role_name: 'member',
                  permissions: ['clubs:read'],
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                  scope: {},
                  status: 'active',
                  start_date: new Date('2026-01-01'),
                  end_date: null,
                },
              ],
            },
            active_assignment: {
              assignment_id: 'assignment-2',
            },
            effective: {
              permissions: ['clubs:read', 'read'],
              scope: {
                global: {},
                club: {
                  assignment_id: 'assignment-2',
                  role_name: 'member',
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                },
              },
            },
          },
          legacy: {
            roles: ['user'],
            permissions: ['read'],
            club: {
              club_id: 2,
              club_name: 'Club B',
              club_type: 'Conquistadores',
            },
            club_context: {
              active_assignment_id: 'assignment-2',
              active: {
                assignment_id: 'assignment-2',
                role_name: 'member',
                instance_type: 'pathfinders',
                instance_id: 22,
                club_id: 2,
                club_name: 'Club B',
                club_type: 'Conquistadores',
              },
              available: [
                {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  instance_type: 'adventurers',
                  instance_id: 11,
                  club_id: 1,
                  club_name: 'Club A',
                  club_type: 'Aventureros',
                },
                {
                  assignment_id: 'assignment-2',
                  role_name: 'member',
                  instance_type: 'pathfinders',
                  instance_id: 22,
                  club_id: 2,
                  club_name: 'Club B',
                  club_type: 'Conquistadores',
                },
              ],
            },
          },
        },
      );

      const result = await service.getProfile('user-123');

      expect(result.data.club).toEqual({
        club_id: 2,
        club_name: 'Club B',
        club_type: 'Conquistadores',
      });
      expect(result.data.club_context.active!.assignment_id).toBe(
        'assignment-2',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // setActiveClubContext()
  // ---------------------------------------------------------------------------
  describe('setActiveClubContext', () => {
    it('should throw BadRequestException when assignment is not active for user', async () => {
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);

      await expect(
        service.setActiveClubContext('user-123', {
          assignment_id: 'missing-assignment',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should persist active assignment and return normalized context', async () => {
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-1',
        roles: { role_name: 'member' },
        club_sections: {
          club_section_id: 22,
          club_types: { name: 'Conquistadores' },
          clubs: { club_id: 2, name: 'Club B' },
        },
      });
      mockPrismaService.users_pr.upsert.mockResolvedValue({
        user_id: 'user-123',
        active_club_assignment_id: 'assignment-1',
      });
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: {
            user_id: 'user-123',
            email: 'juan.garcia@example.com',
            name: 'Juan',
            paternal_last_name: 'Garcia',
            maternal_last_name: 'Lopez',
            gender: 'M',
            birthday: new Date('2000-01-01'),
            baptism: true,
            baptism_date: new Date('2015-01-01'),
            user_image: 'https://avatar.test/user-123.png',
            country_id: 1,
            union_id: 2,
            local_field_id: 3,
            created_at: new Date('2026-02-10'),
          },
          post_register_complete: true,
          authorization: {
            grants: {
              global_roles: [],
              club_assignments: [
                {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  permissions: ['clubs:read'],
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                  scope: {},
                  status: 'active',
                  start_date: new Date('2026-01-01'),
                  end_date: null,
                },
              ],
            },
            active_assignment: { assignment_id: 'assignment-1' },
            effective: {
              permissions: ['clubs:read'],
              scope: {
                global: {},
                club: {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                },
              },
            },
          },
          legacy: {
            roles: [],
            permissions: [],
            club: {
              club_id: 2,
              club_name: 'Club B',
              club_type: 'Conquistadores',
            },
            club_context: {
              active_assignment_id: 'assignment-1',
              active: {
                assignment_id: 'assignment-1',
                role_name: 'member',
                instance_type: 'pathfinders',
                instance_id: 22,
                club_id: 2,
                club_name: 'Club B',
                club_type: 'Conquistadores',
              },
              available: [
                {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  instance_type: 'pathfinders',
                  instance_id: 22,
                  club_id: 2,
                  club_name: 'Club B',
                  club_type: 'Conquistadores',
                },
              ],
            },
          },
        },
      );

      const result = await service.setActiveClubContext('user-123', {
        assignment_id: 'assignment-1',
      } as any);

      expect(mockPrismaService.users_pr.upsert).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
        update: { active_club_assignment_id: 'assignment-1' },
        create: {
          user_id: 'user-123',
          active_club_assignment_id: 'assignment-1',
        },
      });
      expect(result).toEqual({
        status: 'success',
        data: {
          active_assignment_id: 'assignment-1',
          club: {
            club_id: 2,
            club_name: 'Club B',
            club_type: 'Conquistadores',
          },
          authorization: {
            grants: {
              global_roles: [],
              club_assignments: [
                {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  permissions: ['clubs:read'],
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                  scope: {},
                  status: 'active',
                  start_date: new Date('2026-01-01'),
                  end_date: null,
                },
              ],
            },
            active_assignment: { assignment_id: 'assignment-1' },
            effective: {
              permissions: ['clubs:read'],
              scope: {
                global: {},
                club: {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                },
              },
            },
          },
          active: {
            assignment_id: 'assignment-1',
            role_name: 'member',
            instance_type: 'pathfinders',
            instance_id: 22,
            club_id: 2,
            club_name: 'Club B',
            club_type: 'Conquistadores',
          },
        },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getCompletionStatus()
  // ---------------------------------------------------------------------------
  describe('getCompletionStatus', () => {
    it('should throw BadRequestException when post-registration does not exist', async () => {
      mockPrismaService.users_pr.findUnique.mockResolvedValue(null);

      await expect(service.getCompletionStatus('user-123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should set nextStep to profilePicture when first step is pending', async () => {
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        complete: false,
        profile_picture_complete: false,
        personal_info_complete: false,
        club_selection_complete: false,
        date_completed: null,
      });

      const result = await service.getCompletionStatus('user-123');

      expect(result.data.nextStep).toBe('profilePicture');
    });

    it('should set nextStep to personalInfo when second step is pending', async () => {
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        complete: false,
        profile_picture_complete: true,
        personal_info_complete: false,
        club_selection_complete: false,
        date_completed: null,
      });

      const result = await service.getCompletionStatus('user-123');

      expect(result.data.nextStep).toBe('personalInfo');
    });

    it('should set nextStep to clubSelection when third step is pending', async () => {
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        complete: false,
        profile_picture_complete: true,
        personal_info_complete: true,
        club_selection_complete: false,
        date_completed: null,
      });

      const result = await service.getCompletionStatus('user-123');

      expect(result.data.nextStep).toBe('clubSelection');
    });

    it('should return nextStep as null when all steps are complete', async () => {
      const completionDate = new Date('2026-02-10');
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        complete: true,
        profile_picture_complete: true,
        personal_info_complete: true,
        club_selection_complete: true,
        date_completed: completionDate,
      });

      const result = await service.getCompletionStatus('user-123');

      expect(result).toEqual({
        status: 'success',
        data: {
          complete: true,
          steps: {
            profilePicture: true,
            personalInfo: true,
            clubSelection: true,
          },
          nextStep: null,
          dateCompleted: completionDate,
        },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // sendVerificationEmail()
  // ---------------------------------------------------------------------------
  describe('sendVerificationEmail', () => {
    it('should throw BadRequestException when user is not found', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(
        service.sendVerificationEmail('missing-user'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return alreadyVerified=true when email is already verified', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        email: 'juan.garcia@example.com',
        email_verified: true,
      });

      const result = await service.sendVerificationEmail('user-123');

      expect(result).toEqual({
        success: true,
        message: 'El email ya está verificado',
        alreadyVerified: true,
      });
      expect(mockPrismaService.verification.create).not.toHaveBeenCalled();
    });

    it('should create a verification token and return success when email is unverified', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        email: 'juan.garcia@example.com',
        email_verified: false,
      });
      mockPrismaService.verification.create.mockResolvedValue({});

      const result = await service.sendVerificationEmail('user-123');

      expect(mockPrismaService.verification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identifier: 'juan.garcia@example.com',
          }),
        }),
      );
      expect(result).toEqual({
        success: true,
        message: 'Email de verificación enviado',
      });
    });

    it('should set token expiry to approximately 24h from now', async () => {
      const before = Date.now();
      mockPrismaService.users.findUnique.mockResolvedValue({
        email: 'juan.garcia@example.com',
        email_verified: false,
      });
      mockPrismaService.verification.create.mockResolvedValue({});

      await service.sendVerificationEmail('user-123');

      const createCall = mockPrismaService.verification.create.mock.calls[0][0];
      const expiresAt: Date = createCall.data.expiresAt;
      const expectedExpiry = before + 24 * 60 * 60 * 1000;

      // Allow 5 second tolerance
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 5000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry + 5000);
    });
  });

  // ---------------------------------------------------------------------------
  // confirmEmailVerification()
  // ---------------------------------------------------------------------------
  describe('confirmEmailVerification', () => {
    const validToken = 'valid-base64url-token';
    const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1h from now

    it('should throw BadRequestException when token does not exist', async () => {
      mockPrismaService.verification.findFirst.mockResolvedValue(null);

      await expect(
        service.confirmEmailVerification({ token: 'nonexistent-token' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException and delete token when token is expired', async () => {
      const expiredDate = new Date(Date.now() - 1000); // 1 second in the past
      mockPrismaService.verification.findFirst.mockResolvedValue({
        id: 'verification-id-1',
        identifier: 'juan.garcia@example.com',
        value: validToken,
        expiresAt: expiredDate,
      });
      mockPrismaService.verification.delete.mockResolvedValue({});

      await expect(
        service.confirmEmailVerification({ token: validToken }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrismaService.verification.delete).toHaveBeenCalledWith({
        where: { id: 'verification-id-1' },
      });
    });

    it('should verify email and delete token when token is valid', async () => {
      mockPrismaService.verification.findFirst.mockResolvedValue({
        id: 'verification-id-1',
        identifier: 'juan.garcia@example.com',
        value: validToken,
        expiresAt: futureDate,
      });
      // $transaction with array of promises
      mockPrismaService.$transaction.mockImplementation(
        async (ops: Promise<unknown>[]) => Promise.all(ops),
      );
      mockPrismaService.users.update.mockResolvedValue({});
      mockPrismaService.verification.delete.mockResolvedValue({});

      const result = await service.confirmEmailVerification({
        token: validToken,
      });

      expect(result).toEqual({
        success: true,
        message: 'Email verificado exitosamente',
      });
    });

    it('should update email_verified to true for the correct user email', async () => {
      mockPrismaService.verification.findFirst.mockResolvedValue({
        id: 'verification-id-1',
        identifier: 'juan.garcia@example.com',
        value: validToken,
        expiresAt: futureDate,
      });
      mockPrismaService.$transaction.mockImplementation(
        async (ops: Promise<unknown>[]) => Promise.all(ops),
      );
      mockPrismaService.users.update.mockResolvedValue({});
      mockPrismaService.verification.delete.mockResolvedValue({});

      await service.confirmEmailVerification({ token: validToken });

      expect(mockPrismaService.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'juan.garcia@example.com' },
          data: { email_verified: true },
        }),
      );
    });
  });
});
