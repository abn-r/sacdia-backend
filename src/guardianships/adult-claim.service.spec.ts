import { Prisma } from '@prisma/client';
import { ErrorCode } from '../common/errors/error-codes';
import { AdultClaimService } from './adult-claim.service';
import { MAJORITY_HANDOVER_SOURCE } from './family-majority-release-cron.service';
import { LinkCodeFailureCounter } from './link-code-failure-counter';
import {
  deriveLinkCodeKey,
  hashLinkCode,
  normalizeLinkCode,
} from './link-code.util';

// Real bcrypt (cost 12) in loops blows the 5s timeout under load; the hash
// value is irrelevant to these assertions.
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$mockedhash'),
  compare: jest.fn().mockResolvedValue(true),
}));

const SECRET = 's'.repeat(32);
const KEY = deriveLinkCodeKey(SECRET);
const DEPENDENT = '33333333-3333-4333-8333-333333333333';
const ISSUER = '44444444-4444-4444-8444-444444444444';
const PASSWORD = 'Password123!';

const claimable = (over: Record<string, unknown> = {}) => ({
  active: true,
  account: [],
  supervised_login: null,
  dependent_profile: {
    released_at: new Date('2026-11-01T00:00:00Z'),
    release_completed_at: null,
    frozen_at: null,
    frozen_reason: null,
    purged_at: null,
  },
  ...over,
});

function setup(
  options: {
    code?: any;
    consumeCount?: number;
    target?: any;
    taken?: any;
  } = {},
) {
  const state = { consumed: false };
  const calls: string[] = [];
  const codeRow =
    options.code === undefined
      ? {
          link_code_id: 'lc-1',
          dependent_user_id: DEPENDENT,
          issued_by_user_id: ISSUER,
          purpose: 'adult_claim',
        }
      : options.code;
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    guardianship_link_codes: {
      findFirst: jest.fn().mockResolvedValue(codeRow),
      updateMany: jest.fn().mockImplementation(async () => {
        calls.push('consume');
        state.consumed = true;
        return { count: options.consumeCount ?? 1 };
      }),
    },
    users: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.target === undefined ? claimable() : options.target,
        ),
      findFirst: jest.fn().mockResolvedValue(options.taken ?? null),
      update: jest.fn().mockImplementation(async () => {
        calls.push('email');
        return {};
      }),
    },
    account: {
      create: jest.fn().mockImplementation(async () => {
        calls.push('credential');
        return {};
      }),
    },
  };
  const committed = { consumed: false };
  const prisma: any = {
    // The cheap pre-check reads the same row as the transaction does.
    guardianship_link_codes: {
      findFirst: jest.fn(async () =>
        codeRow ? { link_code_id: 'lc-1' } : null,
      ),
    },
    $transaction: jest.fn(async (cb: (t: any) => unknown) => {
      state.consumed = false;
      const result = await cb(tx);
      committed.consumed = state.consumed;
      return result;
    }),
  };
  const failures = new LinkCodeFailureCounter({ stores: [] } as any);
  const config = { get: jest.fn().mockReturnValue(SECRET) };
  const cache = { bump: jest.fn().mockResolvedValue(undefined) };
  const audit = { recordEventOrThrow: jest.fn().mockResolvedValue(undefined) };
  const auth = { sendVerificationEmail: jest.fn().mockResolvedValue({}) };
  const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
  const service = new AdultClaimService(
    prisma,
    config as any,
    failures,
    cache as any,
    audit as any,
    auth as any,
    notifications as any,
  );
  return {
    service,
    tx,
    prisma,
    failures,
    cache,
    audit,
    auth,
    notifications,
    committed,
    calls,
  };
}

const dto = (over: Record<string, unknown> = {}) =>
  ({
    code: '7KQ4-M9TX',
    email: 'ana@example.com',
    password: PASSWORD,
    ...over,
  }) as any;

describe('AdultClaimService.redeem', () => {
  it('consumes the code, sets the email and creates the credential in ONE transaction, then bumps, mails and tells the issuer', async () => {
    const ctx = setup();

    await expect(ctx.service.redeem(dto(), '1.1.1.1')).resolves.toEqual({
      status: 'success',
    });

    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ctx.calls).toEqual(['consume', 'email', 'credential']);
    const consume = ctx.tx.guardianship_link_codes.updateMany.mock.calls[0][0];
    expect(consume.data.consumed_by_user_id).toBe(DEPENDENT);
    expect(ctx.tx.users.update).toHaveBeenCalledWith({
      where: { user_id: DEPENDENT },
      data: { email: 'ana@example.com', email_verified: false },
    });
    const account = ctx.tx.account.create.mock.calls[0][0].data;
    expect(account).toMatchObject({
      accountId: DEPENDENT,
      providerId: 'credential',
      userId: DEPENDENT,
    });
    expect(account.password).not.toBe(PASSWORD);
    expect(ctx.cache.bump).toHaveBeenCalledWith(DEPENDENT);
    expect(ctx.auth.sendVerificationEmail).toHaveBeenCalledWith(DEPENDENT);
    expect(ctx.notifications.sendToUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ISSUER }),
      'system',
      MAJORITY_HANDOVER_SOURCE,
    );
    const audit = ctx.audit.recordEventOrThrow.mock.calls[0][0];
    expect(audit.action).toBe('family.adult_claim.redeemed');
    expect(JSON.stringify(audit)).not.toMatch(/ana@example|Password123|7KQ4/);
  });

  it('looks the code up by its HMAC and ONLY purpose adult_claim (a second_guardian code is the uniform 400)', async () => {
    const ctx = setup({ code: null });
    await expect(ctx.service.redeem(dto(), '1.1.1.1')).rejects.toMatchObject({
      code: ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID,
      status: 400,
    });
    const where =
      ctx.prisma.guardianship_link_codes.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      purpose: 'adult_claim',
      consumed_at: null,
      revoked_at: null,
      code_hash: hashLinkCode(normalizeLinkCode('7KQ4-M9TX'), KEY),
    });
    // An unknown code never costs a password hash nor opens a transaction.
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.cache.bump).not.toHaveBeenCalled();
  });

  it('a malformed code is the same uniform 400 and never reaches the database', async () => {
    const ctx = setup();
    await expect(
      ctx.service.redeem(dto({ code: 'nope' }), '1.1.1.1'),
    ).rejects.toMatchObject({ code: ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('losing the atomic consume (concurrent redeem) is the uniform 400', async () => {
    const ctx = setup({ consumeCount: 0 });
    await expect(ctx.service.redeem(dto(), '1.1.1.1')).rejects.toMatchObject({
      code: ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID,
    });
    expect(ctx.tx.account.create).not.toHaveBeenCalled();
  });

  it('a person who already has an account / completed / legacy-frozen: 404 NOT_RELEASED and the code survives (rollback)', async () => {
    for (const target of [
      claimable({ account: [{ id: 'a' }] }),
      claimable({
        dependent_profile: {
          released_at: new Date(),
          release_completed_at: new Date(),
          frozen_at: null,
          frozen_reason: null,
          purged_at: null,
        },
      }),
      claimable({
        dependent_profile: {
          released_at: new Date(),
          release_completed_at: null,
          frozen_at: new Date(),
          frozen_reason: null,
          purged_at: null,
        },
      }),
      claimable({
        dependent_profile: {
          released_at: null,
          release_completed_at: null,
          frozen_at: null,
          frozen_reason: null,
          purged_at: null,
        },
      }),
    ]) {
      const ctx = setup({ target });
      await expect(ctx.service.redeem(dto(), '1.1.1.1')).rejects.toMatchObject({
        code: ErrorCode.FAMILY_ADULT_CLAIM_NOT_RELEASED,
        status: 404,
      });
      expect(ctx.tx.users.update).not.toHaveBeenCalled();
      expect(ctx.tx.account.create).not.toHaveBeenCalled();
      expect(ctx.committed.consumed).toBe(false);
    }
  });

  it('R6: a person frozen by the release (majority_release) CAN still claim', async () => {
    const ctx = setup({
      target: claimable({
        dependent_profile: {
          released_at: new Date('2026-09-01'),
          release_completed_at: null,
          frozen_at: new Date('2026-10-05'),
          frozen_reason: 'majority_release',
          purged_at: null,
        },
      }),
    });
    await expect(ctx.service.redeem(dto(), '1.1.1.1')).resolves.toEqual({
      status: 'success',
    });
  });

  it('a purged or gone person is the uniform 400', async () => {
    const ctx = setup({
      target: claimable({
        dependent_profile: {
          released_at: new Date(),
          release_completed_at: null,
          frozen_at: new Date(),
          frozen_reason: 'majority_release',
          purged_at: new Date(),
        },
      }),
    });
    await expect(ctx.service.redeem(dto(), '1.1.1.1')).rejects.toMatchObject({
      code: ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID,
      status: 400,
    });
  });

  it('409 FAMILY_ADULT_CLAIM_EMAIL_UNAVAILABLE when the email belongs to someone else (rollback)', async () => {
    const ctx = setup({ taken: { user_id: 'other' } });
    await expect(ctx.service.redeem(dto(), '1.1.1.1')).rejects.toMatchObject({
      code: ErrorCode.FAMILY_ADULT_CLAIM_EMAIL_UNAVAILABLE,
      status: 409,
    });
    expect(ctx.tx.account.create).not.toHaveBeenCalled();
  });

  it('a unique violation on the email (race) maps to the same 409', async () => {
    const ctx = setup();
    ctx.tx.users.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(ctx.service.redeem(dto(), '1.1.1.1')).rejects.toMatchObject({
      code: ErrorCode.FAMILY_ADULT_CLAIM_EMAIL_UNAVAILABLE,
    });
  });

  it('a failure inside the transaction (credential insert) leaves no email and no bump', async () => {
    const ctx = setup();
    ctx.tx.account.create.mockRejectedValue(new Error('db down'));
    await expect(ctx.service.redeem(dto(), '1.1.1.1')).rejects.toThrow(
      'db down',
    );
    expect(ctx.cache.bump).not.toHaveBeenCalled();
    expect(ctx.auth.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('10 wrong codes from one IP lock it: 429 even for the next attempt, the code is not evaluated', async () => {
    const ctx = setup({ code: null });
    for (let i = 0; i < 10; i += 1) {
      await expect(ctx.service.redeem(dto(), '9.9.9.9')).rejects.toMatchObject({
        code: ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID,
      });
    }
    ctx.prisma.$transaction.mockClear();
    await expect(ctx.service.redeem(dto(), '9.9.9.9')).rejects.toMatchObject({
      code: ErrorCode.GUARDIANSHIP_LINK_CODE_LOCKED,
      status: 429,
    });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    // another IP is unaffected
    await expect(ctx.service.redeem(dto(), '8.8.8.8')).rejects.toMatchObject({
      code: ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID,
    });
  });

  it('a verification-mail or issuer-notice failure never undoes the claim', async () => {
    const ctx = setup();
    ctx.auth.sendVerificationEmail.mockRejectedValue(new Error('mail'));
    ctx.notifications.sendToUser.mockRejectedValue(new Error('push'));
    await expect(ctx.service.redeem(dto(), '1.1.1.1')).resolves.toEqual({
      status: 'success',
    });
  });
});
