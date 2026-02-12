import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../common/supabase.service';
import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  const originalFrontendUrl = process.env.FRONTEND_URL;

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
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = originalFrontendUrl;
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

      expect(mockSupabaseService.admin.auth.admin.createUser).toHaveBeenCalledWith(
        {
          email: registerDto.email,
          password: registerDto.password,
          email_confirm: true,
        },
      );
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
      expect(mockSupabaseService.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
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
      expect(mockSupabaseService.admin.auth.admin.deleteUser).toHaveBeenCalledWith(
        'user-123',
      );
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
      expect(mockSupabaseService.admin.auth.admin.deleteUser).toHaveBeenCalledWith(
        'user-123',
      );
    });
  });

  describe('login', () => {
    const loginDto = {
      email: 'juan.garcia@example.com',
      password: 'Password123!',
    };

    it('should throw UnauthorizedException when credentials are invalid', async () => {
      mockSupabaseService.admin.auth.signInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
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

    it('should return tokens, user data, and post-registration state', async () => {
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
    it('should sign out successfully', async () => {
      mockSupabaseService.admin.auth.admin.signOut.mockResolvedValue({
        error: null,
      });

      const result = await service.logout('access-token');

      expect(mockSupabaseService.admin.auth.admin.signOut).toHaveBeenCalledWith(
        'access-token',
      );
      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada exitosamente',
      });
    });

    it('should throw InternalServerErrorException when signOut fails', async () => {
      mockSupabaseService.admin.auth.admin.signOut.mockResolvedValue({
        error: { message: 'Cannot sign out' },
      });

      await expect(service.logout('access-token')).rejects.toThrow(
        InternalServerErrorException,
      );
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
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('missing-user')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return profile with flattened roles and unique permissions', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
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
        users_roles: [
          {
            roles: {
              role_name: 'user',
              role_category: 'GLOBAL',
              role_permissions: [
                { permissions: { permission_name: 'read' } },
                { permissions: { permission_name: 'write' } },
              ],
            },
          },
          {
            roles: {
              role_name: 'leader',
              role_category: 'GLOBAL',
              role_permissions: [{ permissions: { permission_name: 'read' } }],
            },
          },
        ],
      });

      const result = await service.getProfile('user-123');

      expect(result.status).toBe('success');
      expect(result.data.roles).toEqual(['user', 'leader']);
      expect(result.data.permissions).toEqual(['read', 'write']);
      expect(result.data).not.toHaveProperty('users_roles');
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
