import { HttpStatus } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ErrorCode } from '../common/errors/error-codes';
import { DependentActionLimiter } from './dependent-action-limiter';
import { GuardianPowersPolicy } from './guardian-powers.policy';
import { isValidLoginHandle } from './login-handle.util';
import {
  assertPasswordPolicy,
  SupervisedLoginsService,
} from './supervised-logins.service';

const GUARDIAN = 'aaaaaaaa-0000-4000-8000-000000000001';
const GUARDIAN_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const DEP = 'dddddddd-0000-4000-8000-000000000001';
const GS = 'bbbbbbbb-0000-4000-8000-000000000001';
const GOOD_PASSWORD = 'Str0ng-Pass!word1'.replace('-', '@');
const NOW = new Date('2026-10-20T15:00:00.000Z');

const yearsAgo = (years: number): Date => {
  const d = new Date(NOW);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 3);
  return d;
};

interface State {
  users: Record<string, any>;
  accounts: any[];
  logins: Record<string, any>;
  sessions: any[];
  audits: any[];
  guardianships: Array<{
    guardianship_id: string;
    dependent_user_id: string;
    guardian_user_id: string;
    consent_status: string;
    is_custodian: boolean;
  }>;
}

/**
 * In-memory database with REAL rollback: `$transaction` snapshots the state and
 * restores it when the callback throws. That is what makes "nothing is created
 * when the account insert fails" a meaningful assertion.
 */
function makeDb(initial: Partial<State> = {}) {
  const state: State = {
    users: {
      [DEP]: {
        user_id: DEP,
        name: 'Ana María',
        email: null,
        active: true,
        birthday: yearsAgo(14),
        country_id: null,
      },
    },
    accounts: [],
    logins: {},
    sessions: [],
    audits: [],
    guardianships: [
      {
        guardianship_id: GS,
        dependent_user_id: DEP,
        guardian_user_id: GUARDIAN,
        consent_status: 'verified',
        is_custodian: false,
      },
    ],
    ...initial,
  };
  const failures = { accountCreate: false, deleteSessions: false };

  const clone = <T>(value: T): T => structuredClone(value);

  const buildClient = () => ({
    $executeRaw: jest.fn().mockResolvedValue(1),
    users: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const row = where.user_id
          ? state.users[where.user_id]
          : Object.values(state.users).find(
              (u: any) => u.email === where.email,
            );
        if (!row) return null;
        if (select?.account) {
          return {
            ...row,
            dependent_profile: row.dependent_profile ?? {
              frozen_at: null,
              purged_at: null,
            },
            account: state.accounts
              .filter((a) => a.userId === row.user_id)
              .map((a) => ({ id: a.id }))
              .slice(0, 1),
            supervised_login: state.logins[row.user_id] ?? null,
          };
        }
        return { user_id: row.user_id };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        Object.assign(state.users[where.user_id], data);
        return {};
      }),
    },
    account: {
      create: jest.fn(async ({ data }: any) => {
        if (failures.accountCreate) throw new Error('account insert failed');
        state.accounts.push(data);
        return data;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const account of state.accounts) {
          if (
            account.userId === where.userId &&
            account.providerId === where.providerId
          ) {
            Object.assign(account, data);
            count += 1;
          }
        }
        return { count };
      }),
    },
    supervised_logins: {
      findFirst: jest.fn(async ({ where }: any) => {
        const found = Object.entries(state.logins).find(
          ([, login]: any) => login.login_handle === where.login_handle,
        );
        return found ? { user_id: found[0] } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          created_at: new Date(),
          disabled_at: null,
          disabled_reason: null,
          disabled_by_user_id: null,
          login_handle: null,
          ...data,
        };
        state.logins[data.user_id] = row;
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        Object.assign(state.logins[where.user_id], data);
        return state.logins[where.user_id];
      }),
    },
    session: {
      deleteMany: jest.fn(async ({ where }: any) => {
        if (failures.deleteSessions) throw new Error('sessions failed');
        const before = state.sessions.length;
        state.sessions = state.sessions.filter(
          (s) => s.userId !== where.userId,
        );
        return { count: before - state.sessions.length };
      }),
    },
    audit_logs: {
      create: jest.fn(async ({ data }: any) => {
        state.audits.push(data);
        return {};
      }),
    },
    guardianships: {
      findFirst: jest.fn(async ({ where }: any) => {
        const row = state.guardianships.find(
          (g) =>
            g.dependent_user_id === where.dependent_user_id &&
            g.guardian_user_id === where.guardian_user_id &&
            g.is_custodian === where.is_custodian &&
            g.consent_status !== 'revoked',
        );
        return row ?? null;
      }),
    },
  });

  const client = buildClient();
  const prisma = {
    ...client,
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const snapshot = clone({
        users: state.users,
        accounts: state.accounts,
        logins: state.logins,
        sessions: state.sessions,
        audits: state.audits,
      });
      try {
        return await callback(client);
      } catch (error) {
        state.users = snapshot.users;
        state.accounts = snapshot.accounts;
        state.logins = snapshot.logins;
        state.sessions = snapshot.sessions;
        state.audits = snapshot.audits;
        throw error;
      }
    }),
  };
  return { state, prisma, failures, client };
}

function setup(initial: Partial<State> = {}) {
  const db = makeDb(initial);
  const flags = {
    assertEnabled: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(true),
  };
  const powers = new GuardianPowersPolicy(db.prisma as any);
  const actingForCache = { bump: jest.fn().mockResolvedValue(undefined) };
  const agePolicy = {
    getPolicy: jest.fn().mockResolvedValue({
      minSelfLoginAge: 13,
      ageOfMajority: 18,
      timeZone: 'America/Mexico_City',
    }),
  };
  const betterAuth = {
    resetPasswordForEmail: jest.fn().mockResolvedValue(undefined),
  };
  const blacklist = {
    blacklistAllUserTokens: jest.fn().mockResolvedValue(undefined),
  };
  const limiter = { consume: jest.fn().mockResolvedValue(undefined) };
  const deviceRevoker = {
    revokeAllForDependent: jest.fn().mockResolvedValue(2),
    revokeByGuardianship: jest.fn().mockResolvedValue(0),
  };
  const events = {
    onLoginEnabled: jest.fn(),
    onLoginDisabled: jest.fn(),
    onLoginReactivated: jest.fn(),
    onPasswordReset: jest.fn(),
  };
  const service = new SupervisedLoginsService(
    db.prisma as any,
    flags as any,
    powers,
    actingForCache as any,
    agePolicy as any,
    betterAuth as any,
    blacklist as any,
    limiter as unknown as DependentActionLimiter,
    deviceRevoker as any,
    events as any,
  );
  return {
    service,
    ...db,
    flags,
    actingForCache,
    agePolicy,
    betterAuth,
    blacklist,
    limiter,
    deviceRevoker,
    events,
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; status?: number; getResponse?: () => any };
  }
  throw new Error('expected a failure');
}

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  jest.setSystemTime(NOW);
});
afterAll(() => jest.useRealTimers());

describe('assertPasswordPolicy', () => {
  it.each([
    ['too short', 'Aa1@aaaa'],
    ['no uppercase', 'abcdefghij1@x'],
    ['no digit', 'Abcdefghijk@x'],
    ['no special', 'Abcdefghijk1x'],
    ['too long', 'Aa1@' + 'a'.repeat(130)],
  ])(
    'rejects %s with 422 SUPERVISED_LOGIN_PASSWORD_INVALID',
    (_label, password) => {
      expect(() => assertPasswordPolicy(password)).toThrow(
        expect.objectContaining({
          code: ErrorCode.SUPERVISED_LOGIN_PASSWORD_INVALID,
          status: 422,
        }),
      );
    },
  );

  it('accepts a compliant password', () => {
    expect(() => assertPasswordPolicy(GOOD_PASSWORD)).not.toThrow();
  });
});

describe('SupervisedLoginsService.enable', () => {
  it('creates the credential, the handle row, revokes devices and audits, all in ONE transaction (a 14-year-old)', async () => {
    const ctx = setup();

    const result = await ctx.service.enable(GUARDIAN, DEP, {
      method: 'handle',
      password: GOOD_PASSWORD,
    });

    // 201 body: the generated handle comes back, the password never does.
    expect(
      isValidLoginHandle(result.supervised_login.login_handle as string),
    ).toBe(true);
    expect(result.supervised_login.login_handle).toMatch(/^ana-[0-9a-z]{8}$/);
    expect(result.supervised_login).toMatchObject({
      method: 'handle',
      origin: 'guardian_enabled',
      password_set_by: 'guardian',
      disabled_at: null,
      email: null,
    });
    expect(result.devices_revoked).toBe(2);
    expect(JSON.stringify(result)).not.toContain(GOOD_PASSWORD);

    // The credential exists with a REAL bcrypt hash (the child can log in with the password).
    expect(ctx.state.accounts).toHaveLength(1);
    expect(ctx.state.accounts[0]).toMatchObject({
      accountId: DEP,
      providerId: 'credential',
      userId: DEP,
    });
    expect(
      await bcrypt.compare(GOOD_PASSWORD, ctx.state.accounts[0].password),
    ).toBe(true);
    expect(ctx.state.accounts[0].password).not.toContain(GOOD_PASSWORD);

    expect(ctx.state.logins[DEP]).toMatchObject({
      user_id: DEP,
      method: 'handle',
      origin: 'guardian_enabled',
      enabled_by_guardianship_id: GS,
      enabled_by_user_id: GUARDIAN,
      password_set_by: 'guardian',
      pending_since: null,
    });
    // users.email stays NULL for a handle teen.
    expect(ctx.state.users[DEP].email).toBeNull();
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('revokes the linked devices through the port with teen_login_enabled, inside the transaction', async () => {
    const ctx = setup();
    await ctx.service.enable(GUARDIAN, DEP, {
      method: 'handle',
      password: GOOD_PASSWORD,
    });
    expect(ctx.deviceRevoker.revokeAllForDependent).toHaveBeenCalledWith(
      ctx.client,
      DEP,
      'teen_login_enabled',
    );
  });

  it('bumps the epoch after commit (acting for the child is denied on the next request) and tells the other guardians', async () => {
    const ctx = setup();
    await ctx.service.enable(GUARDIAN, DEP, {
      method: 'handle',
      password: GOOD_PASSWORD,
    });
    await flush();

    expect(ctx.actingForCache.bump).toHaveBeenCalledWith(DEP);
    expect(ctx.actingForCache.bump.mock.invocationCallOrder[0]).toBeGreaterThan(
      ctx.prisma.$transaction.mock.invocationCallOrder[0],
    );
    expect(ctx.events.onLoginEnabled).toHaveBeenCalledWith({
      dependentUserId: DEP,
      actorUserId: GUARDIAN,
    });
  });

  it('never audits or logs the password, the handle or the email', async () => {
    const ctx = setup();
    const result = await ctx.service.enable(GUARDIAN, DEP, {
      method: 'handle',
      password: GOOD_PASSWORD,
    });

    expect(ctx.state.audits).toHaveLength(1);
    const audit = JSON.stringify(ctx.state.audits[0]);
    expect(audit).not.toContain(GOOD_PASSWORD);
    expect(audit).not.toContain(result.supervised_login.login_handle as string);
    expect(ctx.state.audits[0]).toMatchObject({
      entity_type: 'supervised_login',
      entity_id: DEP,
      action: 'enabled',
      actor_user_id: GUARDIAN,
      target_user_id: DEP,
    });
  });

  it('the email method sets users.email (email stays the login) and returns no handle', async () => {
    const ctx = setup();
    const result = await ctx.service.enable(GUARDIAN, DEP, {
      method: 'email',
      email: 'ana@example.com',
      password: GOOD_PASSWORD,
    });

    expect(ctx.state.users[DEP].email).toBe('ana@example.com');
    expect(ctx.state.users[DEP].email_verified).toBe(false);
    expect(result.supervised_login).toMatchObject({
      method: 'email',
      login_handle: null,
      email: 'ana@example.com',
    });
  });

  it('an email already used by somebody else is 409 SUPERVISED_LOGIN_EMAIL_UNAVAILABLE and nothing is created', async () => {
    const ctx = setup();
    ctx.state.users['other'] = { user_id: 'other', email: 'ana@example.com' };

    const error = await failure(
      ctx.service.enable(GUARDIAN, DEP, {
        method: 'email',
        email: 'ana@example.com',
        password: GOOD_PASSWORD,
      }),
    );

    expect(error.code).toBe(ErrorCode.SUPERVISED_LOGIN_EMAIL_UNAVAILABLE);
    expect(error.status).toBe(409);
    expect(ctx.state.accounts).toHaveLength(0);
    expect(ctx.state.logins[DEP]).toBeUndefined();
    expect(ctx.state.users[DEP].email).toBeNull();
  });

  it('a unique violation on the email column (a race) is the same 409', async () => {
    const ctx = setup();
    ctx.client.users.update.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );
    const error = await failure(
      ctx.service.enable(GUARDIAN, DEP, {
        method: 'email',
        email: 'new@example.com',
        password: GOOD_PASSWORD,
      }),
    );
    expect(error.code).toBe(ErrorCode.SUPERVISED_LOGIN_EMAIL_UNAVAILABLE);
  });

  it('regenerates the handle when a concurrent enable took it (unique violation) and succeeds', async () => {
    const ctx = setup();
    ctx.client.supervised_logins.create
      .mockRejectedValueOnce(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      )
      .mockImplementation(async ({ data }: any) => {
        const row = { disabled_at: null, disabled_reason: null, ...data };
        ctx.state.logins[data.user_id] = row;
        return row;
      });

    const result = await ctx.service.enable(GUARDIAN, DEP, {
      method: 'handle',
      password: GOOD_PASSWORD,
    });

    expect(result.supervised_login.login_handle).toBeTruthy();
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  describe('eligibility', () => {
    it.each([
      ['12', 12, 'age_below_min'],
      ['18', 18, 'age_over_majority'],
      ['30 (a person of age)', 30, 'age_over_majority'],
    ])(
      'a %s-year-old is 422 SUPERVISED_LOGIN_NOT_ELIGIBLE (%s)',
      async (_label, years, reason) => {
        const ctx = setup();
        ctx.state.users[DEP].birthday = yearsAgo(years);

        const error = await failure(
          ctx.service.enable(GUARDIAN, DEP, {
            method: 'handle',
            password: GOOD_PASSWORD,
          }),
        );

        expect(error.code).toBe(ErrorCode.SUPERVISED_LOGIN_NOT_ELIGIBLE);
        expect(error.status).toBe(422);
        expect(error.getResponse?.().namedArgs).toEqual({ reason });
        expect(ctx.state.accounts).toHaveLength(0);
      },
    );

    it('13 and 17 are eligible (turns 13 today, turns 18 tomorrow)', async () => {
      for (const years of [13, 17]) {
        const ctx = setup();
        ctx.state.users[DEP].birthday = yearsAgo(years);
        await expect(
          ctx.service.enable(GUARDIAN, DEP, {
            method: 'handle',
            password: GOOD_PASSWORD,
          }),
        ).resolves.toBeDefined();
      }
    });

    it('follows the country policy (min age 16)', async () => {
      const ctx = setup();
      ctx.agePolicy.getPolicy.mockResolvedValue({
        minSelfLoginAge: 16,
        ageOfMajority: 18,
        timeZone: 'America/Mexico_City',
      });
      const error = await failure(
        ctx.service.enable(GUARDIAN, DEP, {
          method: 'handle',
          password: GOOD_PASSWORD,
        }),
      );
      expect(error.getResponse?.().namedArgs).toEqual({
        reason: 'age_below_min',
      });
    });

    it('a dependent without a birthday is not eligible', async () => {
      const ctx = setup();
      ctx.state.users[DEP].birthday = null;
      const error = await failure(
        ctx.service.enable(GUARDIAN, DEP, {
          method: 'handle',
          password: GOOD_PASSWORD,
        }),
      );
      expect(error.getResponse?.().namedArgs).toEqual({
        reason: 'birthday_missing',
      });
    });
  });

  describe('who may', () => {
    it('a PENDING guardian is 403 GUARDIANSHIP_CONSENT_NOT_VERIFIED and nothing is touched', async () => {
      const ctx = setup();
      ctx.state.guardianships[0].consent_status = 'pending';
      const error = await failure(
        ctx.service.enable(GUARDIAN, DEP, {
          method: 'handle',
          password: GOOD_PASSWORD,
        }),
      );
      expect(error.code).toBe(ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED);
      expect(error.status).toBe(403);
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a stranger or the guardian of another child is 404 GUARDIANSHIP_NOT_FOUND', async () => {
      const ctx = setup();
      const error = await failure(
        ctx.service.enable(GUARDIAN_2, DEP, {
          method: 'handle',
          password: GOOD_PASSWORD,
        }),
      );
      expect(error.code).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
      expect(error.status).toBe(404);
    });

    it('a custodian row is 404 (custody is not a guardian)', async () => {
      const ctx = setup();
      ctx.state.guardianships[0].is_custodian = true;
      const error = await failure(
        ctx.service.enable(GUARDIAN, DEP, {
          method: 'handle',
          password: GOOD_PASSWORD,
        }),
      );
      expect(error.status).toBe(404);
    });

    it('the flag off is 404 FAMILY_FEATURE_DISABLED before anything is read', async () => {
      const ctx = setup();
      ctx.flags.assertEnabled.mockImplementation(() => {
        throw Object.assign(new Error('off'), {
          code: ErrorCode.FAMILY_FEATURE_DISABLED,
          status: 404,
        });
      });
      const error = await failure(
        ctx.service.enable(GUARDIAN, DEP, {
          method: 'handle',
          password: GOOD_PASSWORD,
        }),
      );
      expect(error.code).toBe(ErrorCode.FAMILY_FEATURE_DISABLED);
      expect(ctx.flags.assertEnabled).toHaveBeenCalledWith('teen_login');
      expect(ctx.prisma.guardianships.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('failures leave nothing behind', () => {
    it('a weak password is 422 SUPERVISED_LOGIN_PASSWORD_INVALID, hashes nothing and opens no transaction', async () => {
      const ctx = setup();
      const error = await failure(
        ctx.service.enable(GUARDIAN, DEP, {
          method: 'handle',
          password: 'weak',
        }),
      );
      expect(error.code).toBe(ErrorCode.SUPERVISED_LOGIN_PASSWORD_INVALID);
      expect(error.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
      expect(ctx.state.accounts).toHaveLength(0);
    });

    it('when the account insert fails no supervised_logins row persists (rollback) and no epoch bump or notice happens', async () => {
      const ctx = setup();
      ctx.failures.accountCreate = true;

      await expect(
        ctx.service.enable(GUARDIAN, DEP, {
          method: 'handle',
          password: GOOD_PASSWORD,
        }),
      ).rejects.toThrow('account insert failed');

      expect(ctx.state.logins[DEP]).toBeUndefined();
      expect(ctx.state.accounts).toHaveLength(0);
      expect(ctx.state.audits).toHaveLength(0);
      expect(ctx.actingForCache.bump).not.toHaveBeenCalled();
      expect(ctx.events.onLoginEnabled).not.toHaveBeenCalled();
    });

    it('when the device revoke fails AFTER the rows were written, the credential and the login row roll back too', async () => {
      const ctx = setup();
      ctx.deviceRevoker.revokeAllForDependent.mockRejectedValue(
        new Error('device store down'),
      );

      await expect(
        ctx.service.enable(GUARDIAN, DEP, {
          method: 'handle',
          password: GOOD_PASSWORD,
        }),
      ).rejects.toThrow('device store down');

      expect(ctx.state.accounts).toHaveLength(0);
      expect(ctx.state.logins[DEP]).toBeUndefined();
      expect(ctx.state.audits).toHaveLength(0);
      expect(ctx.actingForCache.bump).not.toHaveBeenCalled();
    });

    it('a second enable is 409 SUPERVISED_LOGIN_ALREADY_ENABLED', async () => {
      const ctx = setup();
      await ctx.service.enable(GUARDIAN, DEP, {
        method: 'handle',
        password: GOOD_PASSWORD,
      });

      const error = await failure(
        ctx.service.enable(GUARDIAN, DEP, {
          method: 'handle',
          password: GOOD_PASSWORD,
        }),
      );

      expect(error.code).toBe(ErrorCode.SUPERVISED_LOGIN_ALREADY_ENABLED);
      expect(error.status).toBe(409);
      expect(ctx.state.accounts).toHaveLength(1);
    });

    it('a child that already has an account (a self-registered teen) is 409 too', async () => {
      const ctx = setup();
      ctx.state.accounts.push({
        id: 'a',
        userId: DEP,
        providerId: 'credential',
      });
      const error = await failure(
        ctx.service.enable(GUARDIAN, DEP, {
          method: 'handle',
          password: GOOD_PASSWORD,
        }),
      );
      expect(error.code).toBe(ErrorCode.SUPERVISED_LOGIN_ALREADY_ENABLED);
    });

    it('the consent revoked between the check and the lock aborts the enable', async () => {
      const ctx = setup();
      // First assertion (outside the lock) passes, the one under the lock does not.
      const original =
        ctx.client.guardianships.findFirst.getMockImplementation()!;
      ctx.client.guardianships.findFirst
        .mockImplementationOnce(original)
        .mockResolvedValueOnce(null);

      const error = await failure(
        ctx.service.enable(GUARDIAN, DEP, {
          method: 'handle',
          password: GOOD_PASSWORD,
        }),
      );

      expect(error.status).toBe(404);
      expect(ctx.state.accounts).toHaveLength(0);
    });
  });

  it('takes the per-dependent advisory lock before reading the dependent', async () => {
    const ctx = setup();
    await ctx.service.enable(GUARDIAN, DEP, {
      method: 'handle',
      password: GOOD_PASSWORD,
    });
    expect(ctx.client.$executeRaw).toHaveBeenCalledTimes(1);
    expect(ctx.client.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.client.users.findUnique.mock.invocationCallOrder[0],
    );
  });
});

describe('SupervisedLoginsService.get', () => {
  it('shows a verified guardian the eligibility of a plain child', async () => {
    const ctx = setup();
    expect(await ctx.service.get(GUARDIAN, DEP)).toEqual({
      eligible: true,
      ineligible_reason: null,
      supervised_login: null,
    });
  });

  it('shows the login (handle included) once enabled', async () => {
    const ctx = setup();
    await ctx.service.enable(GUARDIAN, DEP, {
      method: 'handle',
      password: GOOD_PASSWORD,
    });
    const view = await ctx.service.get(GUARDIAN, DEP);
    expect(view.eligible).toBe(false);
    expect(view.ineligible_reason).toBe('already_enabled');
    expect(view.supervised_login?.login_handle).toMatch(/^ana-/);
  });

  it('a PENDING guardian gets consent_not_verified and NO login data (200, not a leak)', async () => {
    const ctx = setup();
    await ctx.service.enable(GUARDIAN, DEP, {
      method: 'handle',
      password: GOOD_PASSWORD,
    });
    ctx.state.guardianships[0].consent_status = 'pending';

    expect(await ctx.service.get(GUARDIAN, DEP)).toEqual({
      eligible: false,
      ineligible_reason: 'consent_not_verified',
      supervised_login: null,
    });
  });

  it('a stranger is 404 and the flag off is 404 FAMILY_FEATURE_DISABLED', async () => {
    const ctx = setup();
    expect((await failure(ctx.service.get(GUARDIAN_2, DEP))).status).toBe(404);
    ctx.flags.assertEnabled.mockImplementation(() => {
      throw Object.assign(new Error('off'), { status: 404 });
    });
    expect((await failure(ctx.service.get(GUARDIAN, DEP))).status).toBe(404);
  });

  it('reports the age ineligibility reasons', async () => {
    const ctx = setup();
    ctx.state.users[DEP].birthday = yearsAgo(10);
    expect((await ctx.service.get(GUARDIAN, DEP)).ineligible_reason).toBe(
      'age_below_min',
    );
    ctx.state.users[DEP].birthday = yearsAgo(19);
    expect((await ctx.service.get(GUARDIAN, DEP)).ineligible_reason).toBe(
      'age_over_majority',
    );
  });
});

describe('SupervisedLoginsService.disable', () => {
  async function enabled() {
    const ctx = setup();
    await ctx.service.enable(GUARDIAN, DEP, {
      method: 'handle',
      password: GOOD_PASSWORD,
    });
    ctx.state.sessions.push(
      { id: 's1', userId: DEP },
      { id: 's2', userId: DEP },
      { id: 'other', userId: 'someone' },
    );
    jest.clearAllMocks();
    return ctx;
  }

  it('sets the disabled fields, deletes ALL the teen sessions, blacklists tokens, bumps the epoch and notifies', async () => {
    const ctx = await enabled();

    const result = await ctx.service.disable(GUARDIAN, DEP, {
      reason: 'phone lost',
    });
    await flush();

    expect(result.supervised_login).toMatchObject({
      disabled_at: NOW.toISOString(),
      disabled_reason: 'guardian',
    });
    expect(ctx.state.logins[DEP]).toMatchObject({
      disabled_by_user_id: GUARDIAN,
      disabled_reason: 'guardian',
    });
    expect(ctx.state.sessions).toEqual([{ id: 'other', userId: 'someone' }]);
    expect(ctx.blacklist.blacklistAllUserTokens).toHaveBeenCalledWith(
      DEP,
      28800,
    );
    expect(ctx.actingForCache.bump).toHaveBeenCalledWith(DEP);
    expect(ctx.events.onLoginDisabled).toHaveBeenCalledWith({
      dependentUserId: DEP,
      actorUserId: GUARDIAN,
    });
    expect(ctx.state.audits.at(-1)).toMatchObject({ action: 'disabled' });
    expect(ctx.state.audits.at(-1).changes).toMatchObject({
      reason: 'phone lost',
      sessions_revoked: 2,
    });
  });

  it('is idempotent: a second disable cuts nothing again', async () => {
    const ctx = await enabled();
    await ctx.service.disable(GUARDIAN, DEP, {});
    jest.clearAllMocks();

    await ctx.service.disable(GUARDIAN, DEP, {});

    expect(ctx.client.session.deleteMany).not.toHaveBeenCalled();
    expect(ctx.blacklist.blacklistAllUserTokens).not.toHaveBeenCalled();
    expect(ctx.events.onLoginDisabled).not.toHaveBeenCalled();
  });

  it('a blacklist failure never fails the disable (the sessions are already gone)', async () => {
    const ctx = await enabled();
    ctx.blacklist.blacklistAllUserTokens.mockRejectedValue(new Error('redis'));
    await expect(ctx.service.disable(GUARDIAN, DEP, {})).resolves.toBeDefined();
    expect(ctx.actingForCache.bump).toHaveBeenCalledWith(DEP);
  });

  it('a failing session delete rolls the disable back', async () => {
    const ctx = await enabled();
    ctx.failures.deleteSessions = true;
    await expect(ctx.service.disable(GUARDIAN, DEP, {})).rejects.toThrow();
    expect(ctx.state.logins[DEP].disabled_at).toBeNull();
    expect(ctx.actingForCache.bump).not.toHaveBeenCalled();
  });

  it('a PENDING guardian is 403 and a stranger 404', async () => {
    const ctx = await enabled();
    ctx.state.guardianships[0].consent_status = 'pending';
    expect((await failure(ctx.service.disable(GUARDIAN, DEP, {}))).status).toBe(
      403,
    );
    expect(
      (await failure(ctx.service.disable(GUARDIAN_2, DEP, {}))).status,
    ).toBe(404);
  });

  it('a person who reached the age of majority is 404 for the former guardian', async () => {
    const ctx = await enabled();
    ctx.state.users[DEP].birthday = yearsAgo(19);
    const error = await failure(ctx.service.disable(GUARDIAN, DEP, {}));
    expect(error.code).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    expect(error.status).toBe(404);
  });

  it('a child with no login and no account is 404 SUPERVISED_LOGIN_NOT_FOUND', async () => {
    const ctx = setup();
    const error = await failure(ctx.service.disable(GUARDIAN, DEP, {}));
    expect(error.code).toBe(ErrorCode.SUPERVISED_LOGIN_NOT_FOUND);
  });

  it('a self-registered teen verified before the row existed gets the row created on demand, then disabled', async () => {
    const ctx = setup();
    ctx.state.accounts.push({ id: 'a', userId: DEP, providerId: 'credential' });
    ctx.state.sessions.push({ id: 's1', userId: DEP });

    const result = await ctx.service.disable(GUARDIAN, DEP, {});

    expect(result.supervised_login).toMatchObject({
      method: 'email',
      origin: 'self_registered',
      disabled_reason: 'guardian',
    });
    expect(ctx.state.sessions).toHaveLength(0);
  });

  it('two verified guardians: one disables, the other is notified (the event carries the actor) and can re-enable', async () => {
    const ctx = await enabled();
    ctx.state.guardianships.push({
      guardianship_id: 'gs-2',
      dependent_user_id: DEP,
      guardian_user_id: GUARDIAN_2,
      consent_status: 'verified',
      is_custodian: false,
    });

    await ctx.service.disable(GUARDIAN, DEP, {});
    expect(ctx.events.onLoginDisabled).toHaveBeenCalledWith({
      dependentUserId: DEP,
      actorUserId: GUARDIAN,
    });

    await expect(
      ctx.service.reactivate(GUARDIAN_2, DEP, { password: 'N3w@Password!xyz' }),
    ).resolves.toBeDefined();
  });
});

describe('SupervisedLoginsService.reactivate', () => {
  async function disabled(method: 'handle' | 'email' = 'handle') {
    const ctx = setup();
    await ctx.service.enable(
      GUARDIAN,
      DEP,
      method === 'handle'
        ? { method: 'handle', password: GOOD_PASSWORD }
        : {
            method: 'email',
            email: 'ana@example.com',
            password: GOOD_PASSWORD,
          },
    );
    await ctx.service.disable(GUARDIAN, DEP, {});
    jest.clearAllMocks();
    return ctx;
  }

  it('a handle login needs a NEW password: the old hash is replaced and the old password stops working', async () => {
    const ctx = await disabled();
    const newPassword = 'N3w@Password!xyz';

    const result = await ctx.service.reactivate(GUARDIAN, DEP, {
      password: newPassword,
    });

    expect(result.supervised_login.disabled_at).toBeNull();
    expect(ctx.state.logins[DEP]).toMatchObject({
      disabled_at: null,
      disabled_by_user_id: null,
      disabled_reason: null,
      password_set_by: 'guardian',
    });
    const hash = ctx.state.accounts[0].password;
    expect(await bcrypt.compare(newPassword, hash)).toBe(true);
    expect(await bcrypt.compare(GOOD_PASSWORD, hash)).toBe(false);
    expect(ctx.actingForCache.bump).toHaveBeenCalledWith(DEP);
  });

  it('a handle login without a password, or with a weak one, is 422 and stays disabled', async () => {
    const ctx = await disabled();
    for (const dto of [{}, { password: 'weak' }]) {
      const error = await failure(ctx.service.reactivate(GUARDIAN, DEP, dto));
      expect(error.code).toBe(ErrorCode.SUPERVISED_LOGIN_PASSWORD_INVALID);
    }
    expect(ctx.state.logins[DEP].disabled_at).not.toBeNull();
  });

  it('does NOT restore sessions', async () => {
    const ctx = await disabled();
    await ctx.service.reactivate(GUARDIAN, DEP, {
      password: 'N3w@Password!xyz',
    });
    expect(ctx.state.sessions).toHaveLength(0);
  });

  it('an email login comes back without a password (the old credential stays)', async () => {
    const ctx = await disabled('email');
    const before = ctx.state.accounts[0].password;

    await ctx.service.reactivate(GUARDIAN, DEP, {});

    expect(ctx.state.accounts[0].password).toBe(before);
    expect(ctx.state.logins[DEP].disabled_at).toBeNull();
  });

  it('an enabled login cannot be "reactivated": 409', async () => {
    const ctx = setup();
    await ctx.service.enable(GUARDIAN, DEP, {
      method: 'handle',
      password: GOOD_PASSWORD,
    });
    const error = await failure(
      ctx.service.reactivate(GUARDIAN, DEP, { password: 'N3w@Password!xyz' }),
    );
    expect(error.code).toBe(ErrorCode.SUPERVISED_LOGIN_ALREADY_ENABLED);
  });

  it('past the age of majority it is 404', async () => {
    const ctx = await disabled();
    ctx.state.users[DEP].birthday = yearsAgo(19);
    expect(
      (
        await failure(
          ctx.service.reactivate(GUARDIAN, DEP, {
            password: 'N3w@Password!xyz',
          }),
        )
      ).status,
    ).toBe(404);
  });

  it('notifies the other guardians', async () => {
    const ctx = await disabled();
    await ctx.service.reactivate(GUARDIAN, DEP, {
      password: 'N3w@Password!xyz',
    });
    await flush();
    expect(ctx.events.onLoginReactivated).toHaveBeenCalledWith({
      dependentUserId: DEP,
      actorUserId: GUARDIAN,
    });
  });
});

describe('SupervisedLoginsService.resetPassword', () => {
  async function enabled(method: 'handle' | 'email' = 'handle') {
    const ctx = setup();
    await ctx.service.enable(
      GUARDIAN,
      DEP,
      method === 'handle'
        ? { method: 'handle', password: GOOD_PASSWORD }
        : {
            method: 'email',
            email: 'ana@example.com',
            password: GOOD_PASSWORD,
          },
    );
    ctx.state.sessions.push({ id: 's1', userId: DEP });
    jest.clearAllMocks();
    return ctx;
  }

  it('handle login: the new password works, the old one fails, ALL sessions die and the epoch moves', async () => {
    const ctx = await enabled();
    const newPassword = 'N3w@Password!xyz';

    const result = await ctx.service.resetPassword(GUARDIAN, DEP, {
      password: newPassword,
    });
    await flush();

    expect(result).toEqual({
      sessions_revoked: 1,
      method: 'handle',
      email_sent: false,
    });
    const hash = ctx.state.accounts[0].password;
    expect(await bcrypt.compare(newPassword, hash)).toBe(true);
    expect(await bcrypt.compare(GOOD_PASSWORD, hash)).toBe(false);
    expect(ctx.state.sessions).toHaveLength(0);
    expect(ctx.blacklist.blacklistAllUserTokens).toHaveBeenCalledWith(
      DEP,
      28800,
    );
    expect(ctx.actingForCache.bump).toHaveBeenCalledWith(DEP);
    expect(ctx.state.logins[DEP].password_set_by).toBe('guardian');
    expect(ctx.events.onPasswordReset).toHaveBeenCalledWith({
      dependentUserId: DEP,
      actorUserId: GUARDIAN,
    });
    expect(JSON.stringify(ctx.state.audits.at(-1))).not.toContain(newPassword);
  });

  it('email login: sessions are cut and the STANDARD reset email goes to the child; the guardian never sets a password', async () => {
    const ctx = await enabled('email');
    const before = ctx.state.accounts[0].password;

    const result = await ctx.service.resetPassword(GUARDIAN, DEP, {});

    expect(result).toEqual({
      sessions_revoked: 1,
      method: 'email',
      email_sent: true,
    });
    expect(ctx.betterAuth.resetPasswordForEmail).toHaveBeenCalledWith(
      'ana@example.com',
      undefined,
    );
    expect(ctx.state.accounts[0].password).toBe(before);
    expect(ctx.state.logins[DEP].password_set_by).toBe('guardian'); // enable set it; reset leaves the child's choice to the email
  });

  it('uses the frontend reset URL when configured', async () => {
    const ctx = await enabled('email');
    const original = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://sacdia.app';
    try {
      await ctx.service.resetPassword(GUARDIAN, DEP, {});
    } finally {
      process.env.FRONTEND_URL = original;
    }
    expect(ctx.betterAuth.resetPasswordForEmail).toHaveBeenCalledWith(
      'ana@example.com',
      'https://sacdia.app/reset-password',
    );
  });

  it('a handle reset without a password or with a weak one is 422', async () => {
    const ctx = await enabled();
    for (const dto of [{}, { password: 'weak' }]) {
      expect(
        (await failure(ctx.service.resetPassword(GUARDIAN, DEP, dto))).code,
      ).toBe(ErrorCode.SUPERVISED_LOGIN_PASSWORD_INVALID);
    }
    expect(ctx.state.sessions).toHaveLength(1);
  });

  it('is limited to 5 per hour PER DEPENDENT (the limiter is keyed on the dependent)', async () => {
    const ctx = await enabled();
    await ctx.service.resetPassword(GUARDIAN, DEP, {
      password: 'N3w@Password!xyz',
    });
    expect(ctx.limiter.consume).toHaveBeenCalledWith(
      `supervised-reset:${DEP}`,
      5,
      3_600_000,
      ErrorCode.AUTH_LOGIN_LOCKED,
    );

    ctx.limiter.consume.mockRejectedValue(
      Object.assign(new Error('too many'), { status: 429 }),
    );
    expect(
      (
        await failure(
          ctx.service.resetPassword(GUARDIAN, DEP, {
            password: 'N3w@Password!xyz',
          }),
        )
      ).status,
    ).toBe(429);
  });

  it('a PENDING guardian is 403 and does not burn the limit', async () => {
    const ctx = await enabled();
    ctx.state.guardianships[0].consent_status = 'pending';
    expect(
      (
        await failure(
          ctx.service.resetPassword(GUARDIAN, DEP, {
            password: 'N3w@Password!xyz',
          }),
        )
      ).status,
    ).toBe(403);
    expect(ctx.limiter.consume).not.toHaveBeenCalled();
  });

  it('a child with no login is 404 SUPERVISED_LOGIN_NOT_FOUND', async () => {
    const ctx = setup();
    expect(
      (
        await failure(
          ctx.service.resetPassword(GUARDIAN, DEP, { password: GOOD_PASSWORD }),
        )
      ).code,
    ).toBe(ErrorCode.SUPERVISED_LOGIN_NOT_FOUND);
  });

  it('past the age of majority it is 404', async () => {
    const ctx = await enabled();
    ctx.state.users[DEP].birthday = yearsAgo(19);
    expect(
      (
        await failure(
          ctx.service.resetPassword(GUARDIAN, DEP, {
            password: 'N3w@Password!xyz',
          }),
        )
      ).status,
    ).toBe(404);
  });
});
