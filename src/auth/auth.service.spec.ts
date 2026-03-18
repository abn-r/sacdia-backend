import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../common/supabase.service';
import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';

describe('AuthService', () => {
  let service: AuthService;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalRejectSnakeCase = process.env.AUTH_REJECT_SNAKE_CASE;

  const mockTx = {
    users: {
      create: jest.fn(),
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
    },
    users_pr: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
    },
  };

  const mockSupabaseService = {
    admin: {
      auth: {
        admin: {
          createUser: jest.fn(),
          deleteUser: jest.fn(),
          signOut: jest.fn(),
        },
        signInWithPassword: jest.fn(),
        resetPasswordForEmail: jest.fn(),
      },
    },
    anon: {
      auth: {
        refreshSession: jest.fn(),
      },
    },
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(
      async (_bucket: StorageBucketAlias, value: string) => value,
    ),
  };

  const mockAuthorizationContextService = {
    resolveUserAuthorization: jest.fn(),
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
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContextService,
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

  describe('register', () => {
    const registerDto = {
      email: 'juan.garcia@example.com',
      password: 'Password123!',
      name: 'Juan',
      paternal_last_name: 'Garcia',
      maternal_last_name: 'Lopez',
    };

    it('should register a user successfully', async () => {
      mockSupabaseService.admin.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      mockTx.users.create.mockResolvedValue({
        user_id: 'user-123',
        email: registerDto.email,
        name: registerDto.name,
        paternal_last_name: registerDto.paternal_last_name,
        maternal_last_name: registerDto.maternal_last_name,
      });
      mockTx.users_pr.create.mockResolvedValue({
        user_id: 'user-123',
      });
      mockTx.roles.findFirst.mockResolvedValue({
        role_id: 1,
        role_name: 'user',
      });
      mockTx.users_roles.create.mockResolvedValue({
        user_id: 'user-123',
        role_id: 1,
      });

      const result = await service.register(registerDto);

      expect(
        mockSupabaseService.admin.auth.admin.createUser,
      ).toHaveBeenCalledWith({
        email: registerDto.email,
        password: registerDto.password,
        email_confirm: true,
      });
      expect(mockTx.users.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: 'user-123',
          email: registerDto.email,
        }),
      });
      expect(mockTx.users_pr.create).toHaveBeenCalled();
      expect(mockTx.users_roles.create).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        userId: 'user-123',
        message: 'Usuario registrado exitosamente',
      });
    });

    it('should throw BadRequestException when Supabase createUser fails', async () => {
      mockSupabaseService.admin.auth.admin.createUser.mockResolvedValue({
        data: null,
        error: { message: 'User already registered' },
      });

      await expect(service.register(registerDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(
        mockSupabaseService.admin.auth.admin.deleteUser,
      ).not.toHaveBeenCalled();
    });

    it('should rollback Supabase user when database transaction fails', async () => {
      mockSupabaseService.admin.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      mockTx.users.create.mockRejectedValue(new Error('Database exploded'));

      await expect(service.register(registerDto)).rejects.toThrow(
        'Database exploded',
      );
      expect(
        mockSupabaseService.admin.auth.admin.deleteUser,
      ).toHaveBeenCalledWith('user-123');
    });

    it('should rollback Supabase user when default role does not exist', async () => {
      mockSupabaseService.admin.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      mockTx.users.create.mockResolvedValue({
        user_id: 'user-123',
      });
      mockTx.users_pr.create.mockResolvedValue({
        user_id: 'user-123',
      });
      mockTx.roles.findFirst.mockResolvedValue(null);

      await expect(service.register(registerDto)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(
        mockSupabaseService.admin.auth.admin.deleteUser,
      ).toHaveBeenCalledWith('user-123');
    });
  });

  describe('login', () => {
    const loginDto = {
      email: 'juan.garcia@example.com',
      password: 'Password123!',
    };

    it('should throw UnauthorizedException when credentials are invalid', async () => {
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation();
      mockSupabaseService.admin.auth.signInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );

      const warnMessage = String(warnSpy.mock.calls[0]?.[0] ?? '');
      expect(warnMessage).toContain('ju***@example.com');
      expect(warnMessage).not.toContain(loginDto.email);
    });

    it('should throw UnauthorizedException when user is not in local database', async () => {
      mockSupabaseService.admin.auth.signInWithPassword.mockResolvedValue({
        data: {
          user: { id: 'user-123' },
          session: {
            access_token: 'access-token',
            refresh_token: 'refresh-token',
          },
        },
        error: null,
      });
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when supabase session is missing', async () => {
      mockSupabaseService.admin.auth.signInWithPassword.mockResolvedValue({
        data: {
          user: { id: 'user-123' },
          session: null,
        },
        error: null,
      });

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return tokens, user data, and post-registration state', async () => {
      mockSupabaseService.admin.auth.signInWithPassword.mockResolvedValue({
        data: {
          user: { id: 'user-123' },
          session: {
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_at: 1900000000,
            token_type: 'bearer',
          },
        },
        error: null,
      });
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'user-123',
        email: loginDto.email,
        name: 'Juan',
        paternal_last_name: 'Garcia',
        maternal_last_name: 'Lopez',
        user_image: 'https://avatar.test/user-123.png',
        users_pr: [
          {
            complete: false,
            profile_picture_complete: false,
            personal_info_complete: false,
            club_selection_complete: false,
          },
        ],
        users_roles: [
          {
            roles: {
              role_name: 'user',
              role_category: 'GLOBAL',
            },
          },
          {
            roles: {
              role_name: 'director',
              role_category: 'GLOBAL',
            },
          },
        ],
      });

      const result = await service.login(loginDto);

      expect(result).toEqual({
        status: 'success',
        data: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
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
  });

  describe('logout', () => {
    it('should sign out successfully using access token', async () => {
      mockSupabaseService.admin.auth.admin.signOut.mockResolvedValue({
        error: null,
      });

      const result = await service.logout({
        accessToken: 'access-token',
      });

      expect(mockSupabaseService.admin.auth.admin.signOut).toHaveBeenCalledWith(
        'access-token',
      );
      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: true,
        revocationSucceeded: true,
        path: 'access',
      });
    });

    it('should return success even when signOut fails for access token', async () => {
      mockSupabaseService.admin.auth.admin.signOut.mockResolvedValue({
        error: { message: 'Cannot sign out' },
      });

      const result = await service.logout({
        accessToken: 'access-token',
      });

      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: true,
        revocationSucceeded: false,
        path: 'access',
      });
    });

    it('should refresh first and revoke when only refreshToken is provided', async () => {
      mockSupabaseService.anon.auth.refreshSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_at: 1900000000,
            token_type: 'bearer',
          },
        },
        error: null,
      });
      mockSupabaseService.admin.auth.admin.signOut.mockResolvedValue({
        error: null,
      });

      const result = await service.logout({
        refreshToken: 'valid-refresh-token',
        userAgent: 'test-agent',
      });

      expect(mockSupabaseService.anon.auth.refreshSession).toHaveBeenCalledWith(
        {
          refresh_token: 'valid-refresh-token',
        },
      );
      expect(mockSupabaseService.admin.auth.admin.signOut).toHaveBeenCalledWith(
        'new-access-token',
      );
      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: true,
        revocationSucceeded: true,
        path: 'refresh',
      });
    });

    it('should return success when no tokens are provided', async () => {
      const result = await service.logout({});

      expect(
        mockSupabaseService.anon.auth.refreshSession,
      ).not.toHaveBeenCalled();
      expect(
        mockSupabaseService.admin.auth.admin.signOut,
      ).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: false,
        revocationSucceeded: false,
        path: 'none',
      });
    });
  });

  describe('refreshSession', () => {
    it('should throw BadRequestException when refresh token is missing', async () => {
      await expect(service.refreshSession({} as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw UnauthorizedException when Supabase refresh fails', async () => {
      mockSupabaseService.anon.auth.refreshSession.mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid refresh token' },
      });

      await expect(
        service.refreshSession({ refreshToken: 'invalid-refresh-token' }),
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

    it('should return new tokens when refresh succeeds', async () => {
      mockSupabaseService.anon.auth.refreshSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_at: 1900000000,
            token_type: 'bearer',
          },
        },
        error: null,
      });

      const result = await service.refreshSession({
        refreshToken: 'old-refresh-token',
      });

      expect(mockSupabaseService.anon.auth.refreshSession).toHaveBeenCalledWith(
        {
          refresh_token: 'old-refresh-token',
        },
      );
      expect(result).toEqual({
        status: 'success',
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresAt: 1900000000,
          tokenType: 'bearer',
        },
      });
    });

    it('should allow snake_case input when rollback flag is disabled', async () => {
      process.env.AUTH_REJECT_SNAKE_CASE = 'false';
      mockSupabaseService.anon.auth.refreshSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'legacy-access-token',
            refresh_token: 'legacy-refresh-token',
            expires_at: 1900000000,
            token_type: 'bearer',
          },
        },
        error: null,
      });

      const result = await service.refreshSession({
        refresh_token: 'legacy-input-refresh-token',
      });

      expect(mockSupabaseService.anon.auth.refreshSession).toHaveBeenCalledWith(
        {
          refresh_token: 'legacy-input-refresh-token',
        },
      );
      expect(result.data).toEqual({
        accessToken: 'legacy-access-token',
        refreshToken: 'legacy-refresh-token',
        expiresAt: 1900000000,
        tokenType: 'bearer',
      });
    });
  });

  describe('requestPasswordReset', () => {
    it('should request password reset successfully', async () => {
      process.env.FRONTEND_URL = 'https://sacdia.app';
      mockSupabaseService.admin.auth.resetPasswordForEmail.mockResolvedValue({
        error: null,
      });

      const result = await service.requestPasswordReset({
        email: 'juan.garcia@example.com',
      });

      expect(
        mockSupabaseService.admin.auth.resetPasswordForEmail,
      ).toHaveBeenCalledWith('juan.garcia@example.com', {
        redirectTo: 'https://sacdia.app/reset-password',
      });
      expect(result).toEqual({
        success: true,
        message: 'Correo de recuperación enviado',
      });
    });

    it('should throw BadRequestException when reset password fails', async () => {
      mockSupabaseService.admin.auth.resetPasswordForEmail.mockResolvedValue({
        error: { message: 'Cannot send reset email' },
      });

      await expect(
        service.requestPasswordReset({ email: 'juan.garcia@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

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
});
