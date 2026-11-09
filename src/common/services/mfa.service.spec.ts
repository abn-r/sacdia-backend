import { UnauthorizedException } from '@nestjs/common';
import { ErrorCode } from '../errors/error-codes';
import { MfaService } from './mfa.service';
import { MfaFailureCounter } from './mfa-failure-counter';

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
  const mockMarkMfaSessionAssured = jest.fn();
  const mockSignJwt = jest.fn().mockReturnValue('mock-aal2-token');

  const mockBetterAuthService = {
    enrollTotp: mockEnrollTotp,
    verifyTotp: mockVerifyTotp,
    disableTotp: mockDisableTotp,
    hasTotpEnabled: mockHasTotpEnabled,
    markMfaSessionAssured: mockMarkMfaSessionAssured,
    signJwt: mockSignJwt,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Real counter on the in-process path (no Redis store).
    service = new MfaService(
      mockBetterAuthService as any,
      new MfaFailureCounter({ stores: [] } as never),
    );
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
    it('should return { verified: true, accessToken } when code is valid (no sessionId)', async () => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: true });
      mockVerifyTotp.mockResolvedValue({ verified: true });

      const result = await service.verifyMfa(
        USER_ID,
        'user@example.com',
        '123456',
      );

      expect(result).toEqual({
        verified: true,
        accessToken: 'mock-aal2-token',
      });
      expect(mockVerifyTotp).toHaveBeenCalledWith(USER_ID, '123456');
      // sessionId is undefined when not provided — forwarded as undefined to signJwt
      expect(mockSignJwt).toHaveBeenCalledWith(
        { id: USER_ID, email: 'user@example.com' },
        false,
        undefined,
      );
    });

    it('should forward sessionId to signJwt when provided', async () => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: true });
      mockVerifyTotp.mockResolvedValue({ verified: true });

      const SESSION_ID = 'ba-session-uuid-123';
      const result = await service.verifyMfa(
        USER_ID,
        'user@example.com',
        '123456',
        SESSION_ID,
      );

      expect(result).toEqual({
        verified: true,
        accessToken: 'mock-aal2-token',
      });
      expect(mockSignJwt).toHaveBeenCalledWith(
        { id: USER_ID, email: 'user@example.com' },
        false,
        SESSION_ID,
      );
      expect(mockMarkMfaSessionAssured).toHaveBeenCalledWith(
        USER_ID,
        SESSION_ID,
      );
    });

    it('should pass undefined to signJwt when sessionId is null (legacy token)', async () => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: true });
      mockVerifyTotp.mockResolvedValue({ verified: true });

      await service.verifyMfa(USER_ID, 'user@example.com', '123456', null);

      expect(mockSignJwt).toHaveBeenCalledWith(
        { id: USER_ID, email: 'user@example.com' },
        false,
        undefined,
      );
      expect(mockMarkMfaSessionAssured).not.toHaveBeenCalled();
    });

    it('should return { verified: false } when code is invalid', async () => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: true });
      mockVerifyTotp.mockResolvedValue({ verified: false });

      const result = await service.verifyMfa(
        USER_ID,
        'user@example.com',
        '000000',
      );

      expect(result).toEqual({ verified: false });
    });

    it('should throw UnauthorizedException when TOTP is not enrolled', async () => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: false });

      await expect(
        service.verifyMfa(USER_ID, 'user@example.com', '123456'),
      ).rejects.toMatchObject({ code: ErrorCode.MFA_CODE_INVALID });
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

  // ---------------------------------------------------------------------------
  // verifyMfa lockout
  // ---------------------------------------------------------------------------

  describe('verifyMfa lockout', () => {
    const wrong = async (userId = USER_ID, code = '000000') =>
      service.verifyMfa(userId, 'a@b.c', code, null);

    beforeEach(() => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: true });
      mockVerifyTotp.mockResolvedValue({ verified: false });
    });

    it('locks after 5 wrong codes: 6th attempt is 429 AUTH_MFA_LOCKED even with a correct code, verifier not called', async () => {
      for (let i = 0; i < 5; i += 1) {
        expect(await wrong()).toEqual({ verified: false });
      }
      mockVerifyTotp.mockClear();
      mockVerifyTotp.mockResolvedValue({ verified: true });

      await expect(wrong(USER_ID, '123456')).rejects.toMatchObject({
        code: ErrorCode.AUTH_MFA_LOCKED,
        response: expect.anything(),
      });
      const err = await wrong(USER_ID, '123456').catch((e) => e);
      expect(err.getStatus()).toBe(429);
      expect(err.namedArgs ?? err.getResponse()).toBeDefined();
      expect(mockVerifyTotp).not.toHaveBeenCalled();
      expect(mockSignJwt).not.toHaveBeenCalled();
    });

    it('a backup-code-shaped (8 char) wrong code counts against the same lock', async () => {
      for (let i = 0; i < 5; i += 1) {
        await wrong(USER_ID, 'AB3XYZ12');
      }
      await expect(wrong(USER_ID, 'AB3XYZ12')).rejects.toMatchObject({
        code: ErrorCode.AUTH_MFA_LOCKED,
      });
    });

    it('a correct code before the threshold clears the counter', async () => {
      for (let i = 0; i < 4; i += 1) await wrong();
      mockVerifyTotp.mockResolvedValue({ verified: true });
      expect((await wrong(USER_ID, '123456')).verified).toBe(true);

      mockVerifyTotp.mockResolvedValue({ verified: false });
      for (let i = 0; i < 4; i += 1) {
        expect(await wrong()).toEqual({ verified: false });
      }
      // 5th wrong after the reset locks; the 4 before the success did not carry over.
      expect(await wrong()).toEqual({ verified: false });
      await expect(wrong()).rejects.toMatchObject({
        code: ErrorCode.AUTH_MFA_LOCKED,
      });
    });

    it('the lock is per user: another user is unaffected', async () => {
      for (let i = 0; i < 5; i += 1) await wrong();
      await expect(wrong()).rejects.toMatchObject({
        code: ErrorCode.AUTH_MFA_LOCKED,
      });
      expect(await wrong('other-user')).toEqual({ verified: false });
    });

    it('not-enrolled attempts are not counted as guesses', async () => {
      mockHasTotpEnabled.mockResolvedValue({ enabled: false });
      for (let i = 0; i < 6; i += 1) {
        await expect(wrong()).rejects.toMatchObject({
          code: ErrorCode.MFA_CODE_INVALID,
        });
      }
    });
  });
});
