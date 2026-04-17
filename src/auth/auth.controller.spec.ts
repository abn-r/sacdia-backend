import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    refreshSession: jest.fn(),
    logout: jest.fn(),
    requestPasswordReset: jest.fn(),
    sendVerificationEmail: jest.fn(),
    confirmEmailVerification: jest.fn(),
    updatePassword: jest.fn(),
    getProfile: jest.fn(),
    getCompletionStatus: jest.fn(),
    setActiveClubContext: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
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
      };
      const expected = { success: true };
      mockAuthService.register.mockResolvedValue(expected);

      const result = await controller.register(dto);

      expect(mockAuthService.register).toHaveBeenCalledWith(dto);
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

      const result = await controller.login(dto);

      expect(mockAuthService.login).toHaveBeenCalledWith(dto);
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
      });
      expect(result).toEqual(expected);
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
    it('should delegate to authService.updatePassword and return success message', async () => {
      const currentUser = { userId: 'user-123' };
      const dto = { password: 'NewPassword123!' };
      mockAuthService.updatePassword.mockResolvedValue(undefined);

      const result = await controller.updatePassword(currentUser, dto);

      expect(mockAuthService.updatePassword).toHaveBeenCalledWith(
        'user-123',
        'NewPassword123!',
      );
      expect(result).toEqual({
        status: 'success',
        message: 'Password updated',
      });
    });
  });

  describe('getProfile', () => {
    it('should use current user userId and delegate to authService.getProfile', async () => {
      const currentUser = { userId: 'user-123' };
      const expected = { status: 'success' };
      mockAuthService.getProfile.mockResolvedValue(expected);

      const result = await controller.getProfile(currentUser);

      expect(mockAuthService.getProfile).toHaveBeenCalledWith('user-123');
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

      const result = await controller.setActiveContext(currentUser, dto as any);

      expect(mockAuthService.setActiveClubContext).toHaveBeenCalledWith(
        'user-123',
        dto,
      );
      expect(result).toEqual(expected);
    });
  });
});
