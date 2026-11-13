import { Prisma } from '@prisma/client';
import { ErrorCode } from '../common/errors/error-codes';
import { ReleaseService } from './release.service';

const USER = '11111111-1111-4111-8111-111111111111';

function setup(options: { user?: any; taken?: any; completion?: any } = {}) {
  const tx: any = {
    users: {
      findUnique: jest.fn().mockResolvedValue(options.user ?? { email: null }),
      findFirst: jest.fn().mockResolvedValue(options.taken ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (cb: (t: any) => unknown) => cb(tx)),
  };
  const completion = {
    tryComplete: jest
      .fn()
      .mockResolvedValue(
        options.completion ?? { completed: false, thawed: false },
      ),
  };
  const audit = { recordEventOrThrow: jest.fn().mockResolvedValue(undefined) };
  const cache = { bump: jest.fn().mockResolvedValue(undefined) };
  const auth = { sendVerificationEmail: jest.fn().mockResolvedValue({}) };
  const service = new ReleaseService(
    prisma,
    completion as any,
    audit as any,
    cache as any,
    auth as any,
  );
  return { service, tx, prisma, completion, audit, cache, auth };
}

describe('ReleaseService.setEmail', () => {
  it('stores the email unverified, tries to complete, audits without the address and notifies AFTER commit', async () => {
    const ctx = setup({ completion: { completed: true, thawed: false } });

    await expect(
      ctx.service.setEmail(USER, 'ana@example.com'),
    ).resolves.toEqual({ completed: true, thawed: false });

    expect(ctx.tx.users.update).toHaveBeenCalledWith({
      where: { user_id: USER },
      data: { email: 'ana@example.com', email_verified: false },
    });
    expect(ctx.completion.tryComplete).toHaveBeenCalledWith(ctx.tx, USER);
    const audit = ctx.audit.recordEventOrThrow.mock.calls[0][0];
    expect(audit.action).toBe('family.release.email_set');
    expect(JSON.stringify(audit)).not.toContain('ana@example.com');
    expect(ctx.cache.bump).toHaveBeenCalledWith(USER);
    expect(ctx.auth.sendVerificationEmail).toHaveBeenCalledWith(USER);
  });

  it('a person frozen by the release who adds the email AFTER accepting is thawed (R1)', async () => {
    const ctx = setup({ completion: { completed: true, thawed: true } });
    await expect(
      ctx.service.setEmail(USER, 'ana@example.com'),
    ).resolves.toEqual({ completed: true, thawed: true });
  });

  it('email without acceptance does not complete (still gated)', async () => {
    const ctx = setup();
    await expect(
      ctx.service.setEmail(USER, 'ana@example.com'),
    ).resolves.toEqual({ completed: false, thawed: false });
  });

  it('409 FAMILY_RELEASE_EMAIL_ALREADY_SET when an email is on file, nothing written', async () => {
    const ctx = setup({ user: { email: 'old@example.com' } });
    await expect(
      ctx.service.setEmail(USER, 'new@example.com'),
    ).rejects.toMatchObject({
      code: ErrorCode.FAMILY_RELEASE_EMAIL_ALREADY_SET,
    });
    expect(ctx.tx.users.update).not.toHaveBeenCalled();
    expect(ctx.cache.bump).not.toHaveBeenCalled();
    expect(ctx.auth.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('409 FAMILY_RELEASE_EMAIL_UNAVAILABLE (generic) when another user owns it', async () => {
    const ctx = setup({ taken: { user_id: 'other' } });
    await expect(
      ctx.service.setEmail(USER, 'dup@example.com'),
    ).rejects.toMatchObject({
      code: ErrorCode.FAMILY_RELEASE_EMAIL_UNAVAILABLE,
    });
    expect(ctx.tx.users.update).not.toHaveBeenCalled();
  });

  it('a concurrent unique violation maps to the same 409', async () => {
    const ctx = setup();
    ctx.tx.users.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      ctx.service.setEmail(USER, 'dup@example.com'),
    ).rejects.toMatchObject({
      code: ErrorCode.FAMILY_RELEASE_EMAIL_UNAVAILABLE,
    });
  });

  it('a failed audit rolls the transaction back: nothing is bumped or sent', async () => {
    const ctx = setup();
    ctx.audit.recordEventOrThrow.mockRejectedValue(new Error('audit down'));
    await expect(ctx.service.setEmail(USER, 'ana@example.com')).rejects.toThrow(
      'audit down',
    );
    expect(ctx.cache.bump).not.toHaveBeenCalled();
    expect(ctx.auth.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('a verification-mail failure never undoes the saved email', async () => {
    const ctx = setup();
    ctx.auth.sendVerificationEmail.mockRejectedValue(new Error('mail down'));
    await expect(
      ctx.service.setEmail(USER, 'ana@example.com'),
    ).resolves.toBeDefined();
    expect(ctx.cache.bump).toHaveBeenCalled();
  });
});
