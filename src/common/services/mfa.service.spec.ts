import { UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { MfaService } from './mfa.service';

/**
 * MfaService unit tests — Better Auth twoFactor plugin.
 *
 * The BA instance is fully mocked.  We test the service's orchestration logic,
 * error mapping, and AAL derivation without hitting a real BA server.
 */
describe('MfaService', () => {
  let service: MfaService;

  // -- BA API mocks ----------------------------------------------------------
  const mockGetSession = jest.fn();
  const mockEnableTwoFactor = jest.fn();
  const mockVerifyTOTP = jest.fn();
  const mockDisableTwoFactor = jest.fn();

  const mockBaInstance = {
    api: {
      getSession: mockGetSession,
      enableTwoFactor: mockEnableTwoFactor,
      verifyTOTP: mockVerifyTOTP,
      disableTwoFactor: mockDisableTwoFactor,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BETTER_AUTH_SECRET = 'test-secret-32-bytes-long-for-hmac';
    // MfaService constructor only takes 'BETTER_AUTH_INSTANCE'
    service = new MfaService(mockBaInstance as any);
  });

  // ---------------------------------------------------------------------------
  // enrollMfa
  // ---------------------------------------------------------------------------

  describe('enrollMfa', () => {
    it('should return totpURI and backupCodes on success', async () => {
      mockEnableTwoFactor.mockResolvedValue({
        totpURI: 'otpauth://totp/SACDIA?secret=BASE32SECRET',
        backupCodes: ['code1', 'code2'],
      });

      const result = await service.enrollMfa('raw-session-token', 'userPassword1');

      expect(result).toEqual({
        totpURI: 'otpauth://totp/SACDIA?secret=BASE32SECRET',
        backupCodes: ['code1', 'code2'],
      });
      expect(mockEnableTwoFactor).toHaveBeenCalledWith(
        expect.objectContaining({ body: { password: 'userPassword1' } }),
      );
    });

    it('should return empty backupCodes when BA omits them', async () => {
      mockEnableTwoFactor.mockResolvedValue({
        totpURI: 'otpauth://totp/SACDIA?secret=ABC',
      });

      const result = await service.enrollMfa('token', 'pass');
      expect(result.backupCodes).toEqual([]);
    });

    it('should throw InternalServerErrorException when BA returns no totpURI', async () => {
      mockEnableTwoFactor.mockResolvedValue({});

      await expect(service.enrollMfa('token', 'pass')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // verifyMfa
  // ---------------------------------------------------------------------------

  describe('verifyMfa', () => {
    it('should return { verified: true } on successful verification', async () => {
      mockVerifyTOTP.mockResolvedValue({});

      const result = await service.verifyMfa('session-token', '123456');

      expect(result).toEqual({ verified: true });
      expect(mockVerifyTOTP).toHaveBeenCalledWith(
        expect.objectContaining({ body: { code: '123456' } }),
      );
    });

    it('should throw UnauthorizedException when BA returns 401', async () => {
      mockVerifyTOTP.mockRejectedValue({ statusCode: 401, status: 'Unauthorized' });

      await expect(service.verifyMfa('session-token', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // disableMfa
  // ---------------------------------------------------------------------------

  describe('disableMfa', () => {
    it('should resolve without error on success', async () => {
      mockDisableTwoFactor.mockResolvedValue({});

      await expect(service.disableMfa('session-token', 'myPassword')).resolves.toBeUndefined();
      expect(mockDisableTwoFactor).toHaveBeenCalledWith(
        expect.objectContaining({ body: { password: 'myPassword' } }),
      );
    });

    it('should throw UnauthorizedException when BA returns 401', async () => {
      mockDisableTwoFactor.mockRejectedValue({ statusCode: 401, status: 'Unauthorized' });

      await expect(service.disableMfa('session-token', 'wrongPass')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getMfaStatus
  // ---------------------------------------------------------------------------

  describe('getMfaStatus', () => {
    it('should return { enabled: true } when twoFactorEnabled is true', async () => {
      mockGetSession.mockResolvedValue({
        user: { twoFactorEnabled: true },
        session: {},
      });

      const result = await service.getMfaStatus('session-token');
      expect(result).toEqual({ enabled: true });
    });

    it('should return { enabled: false } when twoFactorEnabled is false', async () => {
      mockGetSession.mockResolvedValue({
        user: { twoFactorEnabled: false },
        session: {},
      });

      const result = await service.getMfaStatus('session-token');
      expect(result).toEqual({ enabled: false });
    });

    it('should throw UnauthorizedException when session is null', async () => {
      mockGetSession.mockResolvedValue(null);

      await expect(service.getMfaStatus('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getAssuranceLevel
  // ---------------------------------------------------------------------------

  describe('getAssuranceLevel', () => {
    it('should return aal2 when TOTP enrolled and verified in session', async () => {
      mockGetSession.mockResolvedValue({
        user: { twoFactorEnabled: true },
        session: { twoFactorVerified: true },
      });

      const result = await service.getAssuranceLevel('session-token');
      expect(result).toEqual({ currentLevel: 'aal2', nextLevel: null });
    });

    it('should return aal1+nextLevel=aal2 when enrolled but not verified', async () => {
      mockGetSession.mockResolvedValue({
        user: { twoFactorEnabled: true },
        session: { twoFactorVerified: false },
      });

      const result = await service.getAssuranceLevel('session-token');
      expect(result).toEqual({ currentLevel: 'aal1', nextLevel: 'aal2' });
    });

    it('should return aal1+nextLevel=null when no TOTP enrolled', async () => {
      mockGetSession.mockResolvedValue({
        user: { twoFactorEnabled: false },
        session: { twoFactorVerified: false },
      });

      const result = await service.getAssuranceLevel('session-token');
      expect(result).toEqual({ currentLevel: 'aal1', nextLevel: null });
    });

    it('should degrade gracefully to aal1 on unexpected errors', async () => {
      mockGetSession.mockRejectedValue(new Error('network error'));

      const result = await service.getAssuranceLevel('session-token');
      expect(result).toEqual({ currentLevel: 'aal1', nextLevel: null });
    });

    it('should return aal1 when session result is null', async () => {
      mockGetSession.mockResolvedValue(null);

      const result = await service.getAssuranceLevel('session-token');
      expect(result).toEqual({ currentLevel: 'aal1', nextLevel: null });
    });
  });
});
