import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountDeletionService } from './account-deletion.service';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    refreshSession: jest.fn(),
    logout: jest.fn(),
    requestPasswordReset: jest.fn(),
    confirmPasswordReset: jest.fn(),
    sendVerificationEmail: jest.fn(),
    confirmEmailVerification: jest.fn(),
    updateOwnPassword: jest.fn(),
    getProfile: jest.fn(),
    getCompletionStatus: jest.fn(),
    setActiveClubContext: jest.fn(),
  };

  const mockAccountDeletionService = {
    deleteAccount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        {
          provide: AccountDeletionService,
          useValue: mockAccountDeletionService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should delegate to authService.register', async () => {
      const dto = {
        email: 'juan.garcia@example.com',
        password: 'Password123!',
        name: 'Juan',
        paternal_last_name: 'Garcia',
        maternal_last_name: 'Lopez',
        accepted_terms_version: '1.0.0-store',
        accepted_privacy_version: '1.0.0-store',
      };
      const expected = { success: true };
      mockAuthService.register.mockResolvedValue(expected);

      const req = {
        ip: '203.0.113.7',
        headers: { 'user-agent': 'Dart/3.11 (dart:io)' },
      };

      const result = await controller.register(dto, req);

      expect(mockAuthService.register).toHaveBeenCalledWith(dto, {
        ipAddress: '203.0.113.7',
        userAgent: 'Dart/3.11 (dart:io)',
      });
      expect(result).toEqual(expected);
    });
  });

  describe('login', () => {
    it('should delegate to authService.login', async () => {
      const dto = {
        email: 'juan.garcia@example.com',
        password: 'Password123!',
      };
      const expected = { status: 'success' };
      mockAuthService.login.mockResolvedValue(expected);

      const req = {
        ip: '203.0.113.7',
        headers: { 'user-agent': 'Dart/3.11 (dart:io)' },
      };

      const result = await controller.login(dto, req);

      expect(mockAuthService.login).toHaveBeenCalledWith(dto, {
        ipAddress: '203.0.113.7',
        userAgent: 'Dart/3.11 (dart:io)',
      });
      expect(result).toEqual(expected);
    });
  });

  describe('refresh', () => {
    it('should delegate to authService.refreshSession', async () => {
      const dto = { refreshToken: 'refresh-token' };
      const expected = { status: 'success' };
      mockAuthService.refreshSession.mockResolvedValue(expected);
      const userAgent = 'sacdia-test-agent';

      const result = await controller.refresh(dto, userAgent);

      expect(mockAuthService.refreshSession).toHaveBeenCalledWith(dto, {
        userAgent,
        accessToken: undefined,
      });
      expect(result).toEqual(expected);
    });

    it('forwards the Bearer access token when present', async () => {
      const dto = { refreshToken: 'refresh-token' };
      mockAuthService.refreshSession.mockResolvedValue({ status: 'success' });

      await controller.refresh(dto, 'sacdia-test-agent', 'Bearer old-access');

      expect(mockAuthService.refreshSession).toHaveBeenCalledWith(dto, {
        userAgent: 'sacdia-test-agent',
        accessToken: 'old-access',
      });
    });
  });

  describe('logout', () => {
    it('should delegate to authService.logout in fail-safe mode', async () => {
      const expected = { success: true };
      mockAuthService.logout.mockResolvedValue(expected);
      const body = { refreshToken: 'refresh-token' };
      const userAgent = 'sacdia-test-agent';

      const result = await controller.logout(
        'Bearer access-token',
        body,
        userAgent,
      );

      expect(mockAuthService.logout).toHaveBeenCalledWith({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        userAgent,
      });
      expect(result).toEqual(expected);
    });
  });

  describe('requestPasswordReset', () => {
    it('should delegate to authService.requestPasswordReset', async () => {
      const dto = { email: 'juan.garcia@example.com' };
      const expected = { success: true };
      mockAuthService.requestPasswordReset.mockResolvedValue(expected);

      const result = await controller.requestPasswordReset(dto);

      expect(mockAuthService.requestPasswordReset).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
    });
  });

  describe('confirmPasswordReset', () => {
    it('should delegate to authService.confirmPasswordReset with token and password', async () => {
      const dto = { token: 'reset-token', password: 'NewPassword123!' };
      const expected = {
        success: true,
        message: 'Contraseña actualizada. Inicie sesión de nuevo',
      };
      mockAuthService.confirmPasswordReset.mockResolvedValue(expected);

      const result = await controller.confirmPasswordReset(dto);

      expect(mockAuthService.confirmPasswordReset).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
    });
  });

  describe('sendVerificationEmail', () => {
    it('should delegate to authService.sendVerificationEmail with userId from JWT', async () => {
      const currentUser = { userId: 'user-123' };
      const expected = {
        success: true,
        message: 'Email de verificación enviado',
      };
      mockAuthService.sendVerificationEmail.mockResolvedValue(expected);

      const result = await controller.sendVerificationEmail(currentUser);

      expect(mockAuthService.sendVerificationEmail).toHaveBeenCalledWith(
        'user-123',
      );
      expect(result).toEqual(expected);
    });

    it('should return alreadyVerified response when email is already verified', async () => {
      const currentUser = { userId: 'user-123' };
      const expected = {
        success: true,
        message: 'El email ya está verificado',
        alreadyVerified: true,
      };
      mockAuthService.sendVerificationEmail.mockResolvedValue(expected);

      const result = await controller.sendVerificationEmail(currentUser);

      expect(result).toEqual(expected);
    });
  });

  describe('confirmEmailVerification', () => {
    it('should delegate to authService.confirmEmailVerification with the token DTO', async () => {
      const dto = { token: 'valid-token-abc123' };
      const expected = {
        success: true,
        message: 'Email verificado exitosamente',
      };
      mockAuthService.confirmEmailVerification.mockResolvedValue(expected);

      const result = await controller.confirmEmailVerification(dto);

      expect(mockAuthService.confirmEmailVerification).toHaveBeenCalledWith(
        dto,
      );
      expect(result).toEqual(expected);
    });
  });

  describe('updatePassword', () => {
    it('flags a supervised teen so the guardians are told', async () => {
      mockAuthService.updateOwnPassword.mockResolvedValue(undefined);

      await controller.updatePassword(
        { userId: 'teen-1', kind: 'supervised_user' },
        { currentPassword: 'Current123!', password: 'NewPassword123!' },
      );

      expect(mockAuthService.updateOwnPassword).toHaveBeenCalledWith(
        'teen-1',
        'Current123!',
        'NewPassword123!',
        { supervised: true },
      );
    });

    it('should pass currentPassword and password to authService.updateOwnPassword and return success message', async () => {
      const currentUser = { userId: 'user-123' };
      const dto = {
        currentPassword: 'CurrentPassword123!',
        password: 'NewPassword123!',
      };
      mockAuthService.updateOwnPassword.mockResolvedValue(undefined);

      const result = await controller.updatePassword(currentUser, dto);

      expect(mockAuthService.updateOwnPassword).toHaveBeenCalledWith(
        'user-123',
        'CurrentPassword123!',
        'NewPassword123!',
        { supervised: false },
      );
      expect(result).toEqual({
        status: 'success',
        message: 'Password updated',
      });
    });
  });

  describe('getProfile', () => {
    it('should use current user userId and delegate to authService.getProfile', async () => {
      const currentUser = { userId: 'user-123' } as any;
      const expected = { status: 'success' };
      mockAuthService.getProfile.mockResolvedValue(expected);

      const result = await controller.getProfile(currentUser);

      expect(mockAuthService.getProfile).toHaveBeenCalledWith(
        'user-123',
        currentUser,
      );
      expect(result).toEqual(expected);
    });
  });

  describe('getCompletionStatus', () => {
    it('should use current user userId and delegate to authService.getCompletionStatus', async () => {
      const currentUser = { userId: 'user-123' };
      const expected = { status: 'success' };
      mockAuthService.getCompletionStatus.mockResolvedValue(expected);

      const result = await controller.getCompletionStatus(currentUser);

      expect(mockAuthService.getCompletionStatus).toHaveBeenCalledWith(
        'user-123',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('setActiveContext', () => {
    it('should delegate to authService.setActiveClubContext', async () => {
      const currentUser = { userId: 'user-123' };
      const dto = { assignment_id: '15a0f6a5-3197-4f42-ab29-2f8fcf8f3cad' };
      const expected = { status: 'success' };
      mockAuthService.setActiveClubContext.mockResolvedValue(expected);

      const result = await controller.setActiveContext(currentUser, dto);

      expect(mockAuthService.setActiveClubContext).toHaveBeenCalledWith(
        'user-123',
        dto,
      );
      expect(result).toEqual(expected);
    });
  });

  describe('deleteAccount', () => {
    const user = { userId: 'user-1' };

    it('allows three attempts per hour', () => {
      for (const name of ['short', 'medium', 'long']) {
        expect(
          Reflect.getMetadata(
            `THROTTLER:LIMIT${name}`,
            AuthController.prototype.deleteAccount,
          ),
        ).toBe(3);
        expect(
          Reflect.getMetadata(
            `THROTTLER:TTL${name}`,
            AuthController.prototype.deleteAccount,
          ),
        ).toBe(3600000);
      }
    });

    it('maps a password body to the password re-auth', async () => {
      mockAccountDeletionService.deleteAccount.mockResolvedValue(undefined);

      await controller.deleteAccount(
        user,
        { password: 'Secret123!' },
        '1.1.1.1',
      );

      expect(mockAccountDeletionService.deleteAccount).toHaveBeenCalledWith(
        'user-1',
        { password: 'Secret123!' },
        '1.1.1.1',
        { acknowledgeDependents: false },
      );
    });

    it('forwards acknowledge_dependents only when it is exactly true', async () => {
      mockAccountDeletionService.deleteAccount.mockResolvedValue(undefined);

      await controller.deleteAccount(
        user,
        { password: 'Secret123!', acknowledge_dependents: true },
        '1.1.1.1',
      );
      expect(mockAccountDeletionService.deleteAccount).toHaveBeenLastCalledWith(
        'user-1',
        { password: 'Secret123!' },
        '1.1.1.1',
        { acknowledgeDependents: true },
      );

      await controller.deleteAccount(
        user,
        { password: 'Secret123!', acknowledge_dependents: false },
        '1.1.1.1',
      );
      expect(mockAccountDeletionService.deleteAccount).toHaveBeenLastCalledWith(
        'user-1',
        { password: 'Secret123!' },
        '1.1.1.1',
        { acknowledgeDependents: false },
      );
    });

    it('maps a social body to the id-token re-auth', async () => {
      mockAccountDeletionService.deleteAccount.mockResolvedValue(undefined);

      await controller.deleteAccount(
        user,
        { provider: 'apple', idToken: 'tok', nonce: 'raw' },
        '1.1.1.1',
      );

      expect(mockAccountDeletionService.deleteAccount).toHaveBeenCalledWith(
        'user-1',
        { provider: 'apple', idToken: 'tok', nonce: 'raw' },
        '1.1.1.1',
        { acknowledgeDependents: false },
      );
    });
  });
});
