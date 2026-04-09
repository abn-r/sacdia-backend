import { UnauthorizedException } from '@nestjs/common';
import { MfaService } from './mfa.service';

/**
 * MfaService unit tests.
 *
 * BetterAuthService is fully mocked.  We test the service's orchestration logic
 * — password verification, enrollment, code verification, disable — without
 * touching a real DB or TOTP library.
 */
describe('MfaService', () => {
  let service: MfaService;

  // -- BetterAuthService mocks -----------------------------------------------
  const mockEnrollTotp = jest.fn();
  const mockVerifyTotp = jest.fn();
  const mockDisableTotp = jest.fn();
  const mockHasTotpEnabled = jest.fn();
  const mockSignJwt = jest.fn().mockReturnValue('mock-aal2-token');

  const mockBetterAuthService = {
    enrollTotp: mockEnrollTotp,
    verifyTotp: mockVerifyTotp,
    disableTotp: mockDisableTotp,
    hasTotpEnabled: mockHasTotpEnabled,
    signJwt: mockSignJwt,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MfaService(mockBetterAuthService as any);
  });

  const USER_ID = 'test-user-uuid-1234';

  // ---------------------------------------------------------------------------
  // enrollMfa
  // ---------------------------------------------------------------------------

  describe('enrollMfa', () => {
    it('should return totpURI and backupCodes on success', async () => {
      mockEnrollTotp.mockResolvedValue({
        totpURI:
          'otpauth://totp/SACDIA:user@example.com?secret=BASE32SECRET&issuer=SACDIA',
        backupCodes: ['AB3XYZ12', 'CD4MNO56'],
      });

      const result = await service.enrollMfa(USER_ID, 'userPassword1');

      expect(result).toEqual({
        totpURI:
          'otpauth://totp/SACDIA:user@example.com?secret=BASE32SECRET&issuer=SACDIA',
        backupCodes: ['AB3XYZ12', 'CD4MNO56'],
      });
      expect(mockEnrollTotp).toHaveBeenCalledWith(USER_ID, 'userPassword1');
    });

    it('should propagate UnauthorizedException from BetterAuthService (wrong password)', async () => {
      mockEnrollTotp.mockRejectedValue(
        new UnauthorizedException('Invalid password'),
      );

      await expect(service.enrollMfa(USER_ID, 'wrongPass')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // verifyMfa
  // ---------------------------------------------------------------------------

  describe('verifyMfa', () => {
    it('should return { verified: true, accessToken } when code is valid', async () => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: true });
      mockVerifyTotp.mockResolvedValue({ verified: true });

      const result = await service.verifyMfa(USER_ID, 'user@example.com', '123456');

      expect(result).toEqual({ verified: true, accessToken: 'mock-aal2-token' });
      expect(mockVerifyTotp).toHaveBeenCalledWith(USER_ID, '123456');
      expect(mockSignJwt).toHaveBeenCalledWith(
        { id: USER_ID, email: 'user@example.com' },
        false,
      );
    });

    it('should return { verified: false } when code is invalid', async () => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: true });
      mockVerifyTotp.mockResolvedValue({ verified: false });

      const result = await service.verifyMfa(USER_ID, 'user@example.com', '000000');

      expect(result).toEqual({ verified: false });
    });

    it('should throw UnauthorizedException when TOTP is not enrolled', async () => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: false });

      await expect(
        service.verifyMfa(USER_ID, 'user@example.com', '123456'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockVerifyTotp).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // disableMfa
  // ---------------------------------------------------------------------------

  describe('disableMfa', () => {
    it('should resolve without error on success', async () => {
      mockDisableTotp.mockResolvedValue(undefined);

      await expect(
        service.disableMfa(USER_ID, 'myPassword'),
      ).resolves.toBeUndefined();
      expect(mockDisableTotp).toHaveBeenCalledWith(USER_ID, 'myPassword');
    });

    it('should propagate UnauthorizedException for wrong password', async () => {
      mockDisableTotp.mockRejectedValue(
        new UnauthorizedException('Invalid password'),
      );

      await expect(service.disableMfa(USER_ID, 'wrongPass')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getMfaStatus
  // ---------------------------------------------------------------------------

  describe('getMfaStatus', () => {
    it('should return { enabled: true } when TOTP is enrolled', async () => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: true });

      const result = await service.getMfaStatus(USER_ID);
      expect(result).toEqual({ enabled: true });
    });

    it('should return { enabled: false } when TOTP is not enrolled', async () => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: false });

      const result = await service.getMfaStatus(USER_ID);
      expect(result).toEqual({ enabled: false });
    });
  });
});
