import { Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { generateSecret, generateSync } from 'otplib';
import * as bcrypt from 'bcryptjs';
import { ErrorCode } from '../common/errors/error-codes';
import { encryptTotpSecret } from '../common/crypto/totp-secret-cipher';
import { BetterAuthService, totpIdentifier } from './better-auth.service';

const USER_ID = 'user-uuid-123';
const IDENTIFIER = totpIdentifier(USER_ID);

// Enroll hashes 10 backup codes with real bcrypt
jest.setTimeout(30000);

describe('BetterAuthService TOTP storage', () => {
  const mockPrisma = {
    users: { findUnique: jest.fn() },
    account: { findFirst: jest.fn() },
    verification: {
      create: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const key = randomBytes(32);
  const originalKey = process.env.TOTP_ENCRYPTION_KEY;

  function buildService() {
    return new BetterAuthService(
      { sign: jest.fn() } as any,
      mockPrisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TOTP_ENCRYPTION_KEY = key.toString('base64');
    mockPrisma.account.findFirst.mockResolvedValue({
      password: bcrypt.hashSync('Pass123!', 4),
    });
    mockPrisma.users.findUnique.mockResolvedValue({ email: 'a@b.com' });
    mockPrisma.verification.updateMany.mockResolvedValue({ count: 1 });
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
    else process.env.TOTP_ENCRYPTION_KEY = originalKey;
  });

  function storedValue(): string {
    return mockPrisma.verification.create.mock.calls[0][0].data.value;
  }

  it('enroll stores secretEnc and no plaintext secret when the key is set', async () => {
    const result = await buildService().enrollTotp(USER_ID, 'Pass123!');

    const raw = JSON.parse(storedValue());
    expect(raw.secret).toBeUndefined();
    expect(raw.secretEnc).toMatch(/^v1:/);
    expect(raw.backupCodes).toHaveLength(10);
    // The URI holds the secret; it must not appear in the stored value
    const secret = new URL(result.totpURI).searchParams.get('secret')!;
    expect(storedValue()).not.toContain(secret);
  });

  it('enroll writes the legacy shape and warns once when no key is set', async () => {
    delete process.env.TOTP_ENCRYPTION_KEY;
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const svc = buildService();

    await svc.enrollTotp(USER_ID, 'Pass123!');
    await svc.enrollTotp(USER_ID, 'Pass123!');

    const raw = JSON.parse(storedValue());
    expect(raw.secretEnc).toBeUndefined();
    expect(typeof raw.secret).toBe('string');
    const keyWarnings = warn.mock.calls.filter((c) =>
      String(c[0]).includes('TOTP_ENCRYPTION_KEY'),
    );
    expect(keyWarnings).toHaveLength(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(raw.secret);
    warn.mockRestore();
  });

  it('verifies against an encrypted row and does not rewrite it', async () => {
    const secret = generateSecret();
    mockPrisma.verification.findFirst.mockResolvedValue({
      id: 'v1',
      value: JSON.stringify({
        secretEnc: encryptTotpSecret(secret, IDENTIFIER, key),
        backupCodes: ['h'],
      }),
    });

    const res = await buildService().verifyTotp(
      USER_ID,
      generateSync({ secret }),
    );

    expect(res).toEqual({ verified: true });
    expect(mockPrisma.verification.updateMany).not.toHaveBeenCalled();
  });

  it('verifies a legacy row and re-writes it encrypted after success', async () => {
    const secret = generateSecret();
    const value = JSON.stringify({ secret, backupCodes: ['h1', 'h2'] });
    mockPrisma.verification.findFirst.mockResolvedValue({ id: 'v1', value });

    const res = await buildService().verifyTotp(
      USER_ID,
      generateSync({ secret }),
    );

    expect(res).toEqual({ verified: true });
    expect(mockPrisma.verification.updateMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.verification.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'v1', value });
    const raw = JSON.parse(arg.data.value);
    expect(raw.secret).toBeUndefined();
    expect(raw.secretEnc).toMatch(/^v1:/);
    expect(raw.backupCodes).toEqual(['h1', 'h2']);
    expect(arg.data.value).not.toContain(secret);
  });

  it('does not re-write a legacy row after a wrong code', async () => {
    const secret = generateSecret();
    mockPrisma.verification.findFirst.mockResolvedValue({
      id: 'v1',
      value: JSON.stringify({ secret, backupCodes: [] }),
    });

    const res = await buildService().verifyTotp(USER_ID, '000000');

    expect(res).toEqual({ verified: false });
    expect(mockPrisma.verification.updateMany).not.toHaveBeenCalled();
  });

  it('keeps verifying when the lazy re-write fails', async () => {
    const secret = generateSecret();
    mockPrisma.verification.findFirst.mockResolvedValue({
      id: 'v1',
      value: JSON.stringify({ secret, backupCodes: [] }),
    });
    mockPrisma.verification.updateMany.mockRejectedValue(new Error('db'));

    const res = await buildService().verifyTotp(
      USER_ID,
      generateSync({ secret }),
    );

    expect(res).toEqual({ verified: true });
  });

  it('does not re-write a legacy row when no key is set', async () => {
    delete process.env.TOTP_ENCRYPTION_KEY;
    const secret = generateSecret();
    mockPrisma.verification.findFirst.mockResolvedValue({
      id: 'v1',
      value: JSON.stringify({ secret, backupCodes: [] }),
    });

    const res = await buildService().verifyTotp(
      USER_ID,
      generateSync({ secret }),
    );

    expect(res).toEqual({ verified: true });
    expect(mockPrisma.verification.updateMany).not.toHaveBeenCalled();
  });

  describe('fails closed', () => {
    let error: jest.SpyInstance;
    beforeEach(() => {
      error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => error.mockRestore());

    it('when the row cannot be decrypted (wrong key)', async () => {
      const secret = generateSecret();
      mockPrisma.verification.findFirst.mockResolvedValue({
        id: 'v1',
        value: JSON.stringify({
          secretEnc: encryptTotpSecret(secret, IDENTIFIER, randomBytes(32)),
          backupCodes: [],
        }),
      });

      await expect(
        buildService().verifyTotp(USER_ID, generateSync({ secret })),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_TOTP_ENROLLMENT_FAILED });
      expect(error).toHaveBeenCalled();
      expect(JSON.stringify(error.mock.calls)).not.toContain(secret);
    });

    it('when the row is encrypted but no key is configured', async () => {
      delete process.env.TOTP_ENCRYPTION_KEY;
      const secret = generateSecret();
      mockPrisma.verification.findFirst.mockResolvedValue({
        id: 'v1',
        value: JSON.stringify({
          secretEnc: encryptTotpSecret(secret, IDENTIFIER, key),
          backupCodes: [],
        }),
      });

      await expect(
        buildService().verifyTotp(USER_ID, generateSync({ secret })),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_TOTP_ENROLLMENT_FAILED });
    });

    it('when the ciphertext was copied from another user', async () => {
      const secret = generateSecret();
      mockPrisma.verification.findFirst.mockResolvedValue({
        id: 'v1',
        value: JSON.stringify({
          secretEnc: encryptTotpSecret(secret, 'totp:someone-else', key),
          backupCodes: [],
        }),
      });

      await expect(
        buildService().verifyTotp(USER_ID, generateSync({ secret })),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_TOTP_ENROLLMENT_FAILED });
    });
  });

  it('hasTotpEnabled only checks row existence (no decryption)', async () => {
    mockPrisma.verification.findFirst.mockResolvedValue({ id: 'v1' });
    delete process.env.TOTP_ENCRYPTION_KEY;

    await expect(buildService().hasTotpEnabled(USER_ID)).resolves.toEqual({
      enabled: true,
    });
    expect(mockPrisma.verification.findFirst).toHaveBeenCalledWith({
      where: { identifier: IDENTIFIER },
      select: { id: true },
    });
  });
});
