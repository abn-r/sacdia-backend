import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { accessJwtClaims } from '../../common/constants/jwt-audiences';
import { runWithAuditContext } from '../../audit-logs/audit-request-context';
import { getAuditContext } from '../../audit-logs/audit-request-context';
import { ActingForResolver } from '../acting-for/acting-for.resolver';
import { SupervisedPrincipalResolver } from '../supervised/supervised-principal.resolver';
import {
  ACTING_GRANT_MEMO,
  AGE_UNKNOWN_SCOPES,
  GUARDIAN_PENDING_SCOPES,
  GUARDIAN_VERIFIED_SCOPES,
  TEEN_PENDING_SCOPES,
  TEEN_SCOPES,
} from '../acting-for/auth-principal';

describe('JwtStrategy', () => {
  const buildConfigService = (degradedMode?: string) =>
    ({
      getOrThrow: jest.fn((key: string) => {
        if (key === 'BETTER_AUTH_SECRET')
          return 'test-secret-min-32-chars-for-hs256';
        throw new Error(`Missing env var: ${key}`);
      }),
      get: jest.fn((key: string) =>
        key === 'AUTH_BLACKLIST_DEGRADED_MODE' ? degradedMode : undefined,
      ),
    }) as unknown as ConfigService;

  const mockTokenBlacklistService = {
    checkToken: jest.fn(),
    checkUserTokens: jest.fn(),
  };

  const mockPrisma = {
    session: { findFirst: jest.fn() },
  };

  const mockActingResolver = {
    resolve: jest.fn(),
  };

  const mockSupervisedResolver = {
    resolveForRequest: jest.fn(),
    isSessionActive: jest.fn(),
  };

  const buildStrategy = (degradedMode?: string) =>
    new JwtStrategy(
      buildConfigService(degradedMode),
      mockTokenBlacklistService as unknown as TokenBlacklistService,
      mockPrisma as unknown as PrismaService,
      mockActingResolver as unknown as ActingForResolver,
      mockSupervisedResolver as unknown as SupervisedPrincipalResolver,
    );

  const buildReq = (token: string, headers: Record<string, unknown> = {}) =>
    ({
      headers: { authorization: `Bearer ${token}`, ...headers },
    }) as any;

  const accessPayload = (overrides: Record<string, unknown> = {}) => ({
    sub: 'user-123',
    email: 'user@example.com',
    iat: 1700000000,
    ...accessJwtClaims(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTokenBlacklistService.checkToken.mockResolvedValue('ok');
    mockTokenBlacklistService.checkUserTokens.mockResolvedValue('ok');
    mockActingResolver.resolve.mockReset();
    mockSupervisedResolver.resolveForRequest.mockReset();
    mockSupervisedResolver.resolveForRequest.mockResolvedValue({
      state: 'adult',
    });
    mockSupervisedResolver.isSessionActive.mockReset();
    mockSupervisedResolver.isSessionActive.mockResolvedValue(true);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps email null when the token carries no email (dependent subject)', async () => {
    const strategy = buildStrategy();

    const result = await strategy.validate(
      buildReq('valid-token'),
      accessPayload({ email: null }),
    );

    expect(result).toMatchObject({ sub: 'user-123', email: null });
  });

  it('should return user payload when token is valid and not revoked', async () => {
    const strategy = buildStrategy();

    const result = await strategy.validate(
      buildReq('valid-token'),
      accessPayload(),
    );

    expect(result).toMatchObject({
      sub: 'user-123',
      userId: 'user-123',
      user_id: 'user-123',
      email: 'user@example.com',
      mfa_pending: false,
    });
    expect(mockTokenBlacklistService.checkToken).toHaveBeenCalled();
    expect(mockPrisma.session.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a QR member audience used as an API Bearer token', async () => {
    const strategy = buildStrategy();

    await expect(
      strategy.validate(
        buildReq('qr-member-token'),
        accessPayload({ aud: 'sacdia:qr-member' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
    expect(mockTokenBlacklistService.checkToken).not.toHaveBeenCalled();
  });

  it('rejects a QR member audience when aud is an array', async () => {
    const strategy = buildStrategy();

    await expect(
      strategy.validate(
        buildReq('qr-member-token'),
        accessPayload({ aud: ['sacdia:qr-member'] }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
  });

  it('rejects a token missing access iss/aud', async () => {
    const strategy = buildStrategy();

    await expect(
      strategy.validate(buildReq('legacy-token'), {
        sub: 'user-123',
        email: 'user@example.com',
        iat: 1700000000,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
    expect(mockTokenBlacklistService.checkToken).not.toHaveBeenCalled();
  });

  it('rejects a token with the wrong issuer', async () => {
    const strategy = buildStrategy();

    await expect(
      strategy.validate(
        buildReq('wrong-iss-token'),
        accessPayload({ iss: 'https://evil.example' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
  });

  it('should throw UnauthorizedException when token is individually blacklisted', async () => {
    mockTokenBlacklistService.checkToken.mockResolvedValue('revoked');
    const strategy = buildStrategy();

    await expect(
      strategy.validate(buildReq('revoked-token'), accessPayload()),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
  });

  it('should throw UnauthorizedException when user was globally blacklisted', async () => {
    mockTokenBlacklistService.checkUserTokens.mockResolvedValue('revoked');
    const strategy = buildStrategy();

    await expect(
      strategy.validate(buildReq('valid-token'), accessPayload()),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
  });

  describe('revocation cache unavailable', () => {
    const SID = '0b1c7d1e-1111-4444-8888-aaaaaaaaaaaa';

    beforeEach(() => {
      mockTokenBlacklistService.checkToken.mockResolvedValue('unavailable');
      mockTokenBlacklistService.checkUserTokens.mockResolvedValue(
        'unavailable',
      );
    });

    describe('db-session (default)', () => {
      it.each([[undefined], ['db-session'], ['not-a-mode']])(
        'accepts a token whose session row is alive (mode=%p)',
        async (mode) => {
          mockPrisma.session.findFirst.mockResolvedValue({ id: SID });
          const strategy = buildStrategy(mode);

          const result = await strategy.validate(
            buildReq('t'),
            accessPayload({ sid: SID }),
          );

          expect(result).toMatchObject({ sub: 'user-123', sid: SID });
          expect(mockPrisma.session.findFirst).toHaveBeenCalledWith({
            where: {
              id: SID,
              userId: 'user-123',
              expiresAt: { gt: expect.any(Date) },
            },
            select: { id: true },
          });
        },
      );

      it('does not query the user-wide key again once the cache is known down', async () => {
        mockPrisma.session.findFirst.mockResolvedValue({ id: SID });
        const strategy = buildStrategy('db-session');

        await strategy.validate(buildReq('t'), accessPayload({ sid: SID }));

        expect(
          mockTokenBlacklistService.checkUserTokens,
        ).not.toHaveBeenCalled();
      });

      it('handles an unavailable user-wide check after an ok token check', async () => {
        mockTokenBlacklistService.checkToken.mockResolvedValue('ok');
        mockPrisma.session.findFirst.mockResolvedValue({ id: SID });
        const strategy = buildStrategy('db-session');

        await expect(
          strategy.validate(buildReq('t'), accessPayload({ sid: SID })),
        ).resolves.toMatchObject({ sid: SID });
        expect(mockPrisma.session.findFirst).toHaveBeenCalledTimes(1);
      });

      it('rejects with 401 when the session row is missing or expired', async () => {
        mockPrisma.session.findFirst.mockResolvedValue(null);
        const strategy = buildStrategy('db-session');

        await expect(
          strategy.validate(buildReq('t'), accessPayload({ sid: SID })),
        ).rejects.toMatchObject({
          code: ErrorCode.GUARD_JWT_UNAUTHORIZED,
          status: 401,
        });
      });

      it('behaves like reject (503) when the token has no sid', async () => {
        const strategy = buildStrategy('db-session');

        await expect(
          strategy.validate(buildReq('t'), accessPayload()),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
          status: 503,
        });
        expect(mockPrisma.session.findFirst).not.toHaveBeenCalled();
      });

      it('answers 503 (not 401) when the database lookup itself fails', async () => {
        mockPrisma.session.findFirst.mockRejectedValue(new Error('db down'));
        const strategy = buildStrategy('db-session');

        await expect(
          strategy.validate(buildReq('t'), accessPayload({ sid: SID })),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
          status: 503,
        });
      });
    });

    describe('reject', () => {
      it('answers 503 even when the token carries a live sid', async () => {
        mockPrisma.session.findFirst.mockResolvedValue({ id: SID });
        const strategy = buildStrategy('reject');

        await expect(
          strategy.validate(buildReq('t'), accessPayload({ sid: SID })),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
          status: 503,
        });
        expect(mockPrisma.session.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('allow', () => {
      it('accepts the token without touching the database and warns', async () => {
        const strategy = buildStrategy('allow');

        await expect(
          strategy.validate(buildReq('t'), accessPayload()),
        ).resolves.toMatchObject({ sub: 'user-123' });
        expect(mockPrisma.session.findFirst).not.toHaveBeenCalled();
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.stringContaining('auth_jwt_revocation_check_unavailable'),
        );
      });

      it('rate-limits the degraded warning', async () => {
        const strategy = buildStrategy('allow');

        await strategy.validate(buildReq('t'), accessPayload());
        await strategy.validate(buildReq('t'), accessPayload());
        await strategy.validate(buildReq('t'), accessPayload());

        const degradedWarnings = (
          Logger.prototype.warn as jest.Mock
        ).mock.calls.filter(([message]) =>
          String(message).includes('auth_jwt_revocation_check_unavailable'),
        );
        expect(degradedWarnings).toHaveLength(1);
      });
    });

    it('a revoked verdict still wins over an unavailable one', async () => {
      mockTokenBlacklistService.checkToken.mockResolvedValue('ok');
      mockTokenBlacklistService.checkUserTokens.mockResolvedValue('revoked');
      const strategy = buildStrategy('allow');

      await expect(
        strategy.validate(buildReq('t'), accessPayload({ sid: SID })),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
    });
  });

  describe('X-Acting-For (principal substitution)', () => {
    const GUARDIAN = '11111111-1111-4111-8111-111111111111';
    const DEPENDENT = '22222222-2222-4222-8222-222222222222';
    const guardianPayload = (overrides: Record<string, unknown> = {}) =>
      accessPayload({ sub: GUARDIAN, ...overrides });

    const pendingGrant = {
      granted: true,
      grant: {
        guardianshipId: 'gs-1',
        consentStatus: 'pending',
        scopes: GUARDIAN_PENDING_SCOPES,
      },
    };

    const actingReq = (value: unknown = DEPENDENT) =>
      buildReq('t', { 'x-acting-for': value });

    it('without the header the principal is a plain user and nothing is resolved', async () => {
      const result = await buildStrategy().validate(
        buildReq('t'),
        guardianPayload(),
      );

      expect(result).toMatchObject({
        sub: GUARDIAN,
        kind: 'user',
        actor_sub: GUARDIAN,
        acting_for: false,
        scopes: null,
      });
      expect(mockActingResolver.resolve).not.toHaveBeenCalled();
    });

    it('substitutes the principal for a pending guardianship', async () => {
      mockActingResolver.resolve.mockResolvedValue(pendingGrant);

      const result = await buildStrategy().validate(
        actingReq(),
        guardianPayload({ sid: 'sid-1' }),
      );

      expect(mockActingResolver.resolve).toHaveBeenCalledWith(
        GUARDIAN,
        DEPENDENT,
      );
      expect(result).toEqual({
        sub: DEPENDENT,
        userId: DEPENDENT,
        user_id: DEPENDENT,
        email: null,
        mfa_pending: false,
        sid: 'sid-1',
        kind: 'guardian_acting',
        actor_sub: GUARDIAN,
        acting_for: true,
        scopes: GUARDIAN_PENDING_SCOPES,
        guardianship_id: 'gs-1',
        consent_status: 'pending',
      });
    });

    it('a verified guardianship carries the full scope set', async () => {
      mockActingResolver.resolve.mockResolvedValue({
        granted: true,
        grant: {
          guardianshipId: 'gs-1',
          consentStatus: 'verified',
          scopes: GUARDIAN_VERIFIED_SCOPES,
        },
      });

      const result = await buildStrategy().validate(
        actingReq(),
        guardianPayload(),
      );

      expect(result.scopes).toEqual(GUARDIAN_VERIFIED_SCOPES);
      expect(result.consent_status).toBe('verified');
    });

    it('only ever produces the kinds user and guardian_acting', async () => {
      mockActingResolver.resolve.mockResolvedValue(pendingGrant);
      const strategy = buildStrategy();

      const kinds = new Set([
        (await strategy.validate(buildReq('t'), guardianPayload())).kind,
        (await strategy.validate(actingReq(), guardianPayload())).kind,
      ]);

      expect([...kinds].sort()).toEqual(['guardian_acting', 'user']);
    });

    it('records the acting context for audit attribution', async () => {
      mockActingResolver.resolve.mockResolvedValue(pendingGrant);
      const strategy = buildStrategy();

      await runWithAuditContext(async () => {
        await strategy.validate(actingReq(), guardianPayload());
        expect(getAuditContext()?.actingFor).toEqual({
          actorUserId: GUARDIAN,
          subjectUserId: DEPENDENT,
          guardianshipId: 'gs-1',
          kind: 'guardian_acting',
        });
      });
    });

    it('does not set the acting context without a header', async () => {
      await runWithAuditContext(async () => {
        await buildStrategy().validate(buildReq('t'), guardianPayload());
        expect(getAuditContext()?.actingFor).toBeUndefined();
      });
    });

    it('memoizes the grant on the request so a local guard re-run does not look it up again', async () => {
      mockActingResolver.resolve.mockResolvedValue(pendingGrant);
      const strategy = buildStrategy();
      const req = actingReq();

      const first = await strategy.validate(req, guardianPayload());
      const second = await strategy.validate(req, guardianPayload());

      expect(mockActingResolver.resolve).toHaveBeenCalledTimes(1);
      expect(req[ACTING_GRANT_MEMO]).toMatchObject({
        guardianId: GUARDIAN,
        dependentId: DEPENDENT,
      });
      expect(second).toEqual(first);
    });

    it('does not reuse a memo that belongs to another dependent', async () => {
      mockActingResolver.resolve.mockResolvedValue(pendingGrant);
      const strategy = buildStrategy();
      const req = actingReq();
      await strategy.validate(req, guardianPayload());

      req.headers['x-acting-for'] = '33333333-3333-4333-8333-333333333333';
      await strategy.validate(req, guardianPayload());

      expect(mockActingResolver.resolve).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['an array', [DEPENDENT, DEPENDENT]],
      ['not a UUID', 'not-a-uuid'],
      ['empty', ''],
    ])(
      'rejects a header that is %s with 400 ACTING_FOR_HEADER_INVALID',
      async (_label, value) => {
        await expect(
          buildStrategy().validate(actingReq(value), guardianPayload()),
        ).rejects.toMatchObject({
          code: ErrorCode.ACTING_FOR_HEADER_INVALID,
          status: 400,
        });
        expect(mockActingResolver.resolve).not.toHaveBeenCalled();
      },
    );

    it('refuses an aal1 (mfa_pending) token before touching the database', async () => {
      await expect(
        buildStrategy().validate(
          actingReq(),
          guardianPayload({ mfa_pending: true }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ACTING_FOR_FORBIDDEN,
        status: 403,
      });
      expect(mockActingResolver.resolve).not.toHaveBeenCalled();
    });

    it('refuses acting for yourself', async () => {
      await expect(
        buildStrategy().validate(actingReq(GUARDIAN), guardianPayload()),
      ).rejects.toMatchObject({
        code: ErrorCode.ACTING_FOR_FORBIDDEN,
        status: 403,
      });
      expect(mockActingResolver.resolve).not.toHaveBeenCalled();
    });

    describe('uniform denial', () => {
      const causes = [
        'no_guardianship',
        'revoked',
        'has_account',
        'frozen',
        'over_age',
        'birthday_missing',
        'unknown',
      ] as const;

      it.each(causes)(
        'cause %s is a 403 ACTING_FOR_FORBIDDEN and the real cause only reaches the log',
        async (cause) => {
          mockActingResolver.resolve.mockResolvedValue({
            granted: false,
            cause,
          });

          await expect(
            buildStrategy().validate(actingReq(), guardianPayload()),
          ).rejects.toMatchObject({
            code: ErrorCode.ACTING_FOR_FORBIDDEN,
            status: 403,
          });

          const logged = (Logger.prototype.warn as jest.Mock).mock.calls
            .map(([message]) => String(message))
            .find((message) => message.includes('acting_for_denied'));
          expect(JSON.parse(logged as string)).toMatchObject({
            event: 'acting_for_denied',
            guardian: GUARDIAN,
            dependent: DEPENDENT,
            cause,
          });
        },
      );

      it('every cause produces a byte-identical response body', async () => {
        const bodies = new Set<string>();
        for (const cause of causes) {
          mockActingResolver.resolve.mockResolvedValue({
            granted: false,
            cause,
          });
          try {
            await buildStrategy().validate(actingReq(), guardianPayload());
          } catch (error) {
            bodies.add(
              JSON.stringify(
                (error as { getResponse: () => unknown }).getResponse(),
              ),
            );
          }
        }
        expect(bodies.size).toBe(1);
      });
    });

    it('propagates the 503 when the guardianship lookup is unavailable', async () => {
      const unavailable = Object.assign(new Error('unavailable'), {
        code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
      });
      mockActingResolver.resolve.mockRejectedValue(unavailable);

      await expect(
        buildStrategy().validate(actingReq(), guardianPayload()),
      ).rejects.toBe(unavailable);
    });

    it('still runs the revocation checks against the guardian token first', async () => {
      mockTokenBlacklistService.checkToken.mockResolvedValue('revoked');

      await expect(
        buildStrategy().validate(actingReq(), guardianPayload()),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
      expect(mockActingResolver.resolve).not.toHaveBeenCalled();
    });

    it('rejects the reserved sacdia:device audience (no linked_device principal in Phase 2)', async () => {
      await expect(
        buildStrategy().validate(
          buildReq('device-token'),
          guardianPayload({ aud: 'sacdia:device' }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.GUARD_JWT_UNAUTHORIZED,
        status: 401,
      });
      await expect(
        buildStrategy().validate(
          buildReq('device-token'),
          guardianPayload({ aud: ['sacdia:access', 'sacdia:device'] }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
      expect(mockTokenBlacklistService.checkToken).not.toHaveBeenCalled();
    });
  });

  describe('supervised principal (server-side kind)', () => {
    const TEEN = '33333333-3333-4333-8333-333333333333';
    const SID = '0b1c7d1e-2222-4444-8888-bbbbbbbbbbbb';
    const teenPayload = (overrides: Record<string, unknown> = {}) =>
      accessPayload({ sub: TEEN, sid: SID, ...overrides });

    const pending = { state: 'supervised', supervision: 'pending_guardian' };
    const active = { state: 'supervised', supervision: 'active' };

    it('adults keep the exact Phase 2 principal (regression snapshot)', async () => {
      const result = await buildStrategy().validate(
        buildReq('t'),
        accessPayload({ sid: SID }),
      );

      expect(result).toEqual({
        sub: 'user-123',
        userId: 'user-123',
        user_id: 'user-123',
        email: 'user@example.com',
        mfa_pending: false,
        sid: SID,
        kind: 'user',
        actor_sub: 'user-123',
        acting_for: false,
        scopes: null,
      });
      expect(mockSupervisedResolver.isSessionActive).not.toHaveBeenCalled();
    });

    it('builds a pending supervised_user with the TEEN_PENDING scopes', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(pending);

      const result = await buildStrategy().validate(
        buildReq('t'),
        teenPayload(),
      );

      expect(result).toMatchObject({
        sub: TEEN,
        userId: TEEN,
        user_id: TEEN,
        actor_sub: TEEN,
        acting_for: false,
        kind: 'supervised_user',
        supervision: 'pending_guardian',
        scopes: TEEN_PENDING_SCOPES,
        sid: SID,
        mfa_pending: false,
      });
    });

    it('builds an active supervised_user with the TEEN scopes', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(active);

      const result = await buildStrategy().validate(
        buildReq('t'),
        teenPayload(),
      );

      expect(result).toMatchObject({
        kind: 'supervised_user',
        supervision: 'active',
        scopes: TEEN_SCOPES,
      });
    });

    it('resolves from the subject of the token, passing the request for the memo', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(active);
      const req = buildReq('t');

      await buildStrategy().validate(req, teenPayload());

      expect(mockSupervisedResolver.resolveForRequest).toHaveBeenCalledWith(
        req,
        TEEN,
      );
    });

    it('gives password, social and refresh tokens the same kind (no claim is involved)', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(active);
      const strategy = buildStrategy();

      const kinds = await Promise.all(
        [
          teenPayload(),
          teenPayload({ email: null }),
          teenPayload({ iat: 1800000000 }),
        ].map(
          async (payload) =>
            (await strategy.validate(buildReq('t'), payload)).kind,
        ),
      );

      expect(kinds).toEqual([
        'supervised_user',
        'supervised_user',
        'supervised_user',
      ]);
    });

    it('ignores a forged kind claim: an adult stays a user, whatever the token says', async () => {
      const result = await buildStrategy().validate(
        buildReq('t'),
        accessPayload({ kind: 'supervised_user', scopes: ['self:read'] }),
      );

      expect(result).toMatchObject({ kind: 'user', scopes: null });
    });

    it('ignores a forged kind:user claim on a teen: the server derivation wins', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(pending);

      const result = await buildStrategy().validate(
        buildReq('t'),
        teenPayload({ kind: 'user', scopes: null }),
      );

      expect(result.kind).toBe('supervised_user');
      expect(result.scopes).toBe(TEEN_PENDING_SCOPES);
    });

    it('a blocked teen (disabled, frozen) gets 401 AUTH_SUPERVISED_ACCESS_REVOKED', async () => {
      for (const cause of ['login_disabled', 'frozen']) {
        mockSupervisedResolver.resolveForRequest.mockResolvedValue({
          state: 'blocked',
          cause,
        });

        await expect(
          buildStrategy().validate(buildReq('t'), teenPayload()),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_SUPERVISED_ACCESS_REVOKED,
          status: 401,
        });
      }
    });

    describe('user-level blacklist hit (QA BUG-5)', () => {
      // disable/reset call blacklistAllUserTokens, which is checked BEFORE the
      // supervised state: the old teen token got the generic
      // GUARD_JWT_UNAUTHORIZED instead of the specified reason.
      beforeEach(() => {
        mockTokenBlacklistService.checkUserTokens.mockResolvedValue('revoked');
      });

      it('a disabled teen whose tokens were blacklisted gets 401 AUTH_SUPERVISED_ACCESS_REVOKED', async () => {
        mockSupervisedResolver.resolveForRequest.mockResolvedValue({
          state: 'blocked',
          cause: 'login_disabled',
        });

        await expect(
          buildStrategy().validate(buildReq('t'), teenPayload()),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_SUPERVISED_ACCESS_REVOKED,
          status: 401,
        });
      });

      it('a teen cut by a reset (still supervised) gets the same 401 AUTH_SUPERVISED_ACCESS_REVOKED', async () => {
        mockSupervisedResolver.resolveForRequest.mockResolvedValue(active);

        await expect(
          buildStrategy().validate(buildReq('t'), teenPayload()),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_SUPERVISED_ACCESS_REVOKED,
          status: 401,
        });
        // Still rejected by the blacklist: no principal is ever built.
        expect(mockSupervisedResolver.isSessionActive).not.toHaveBeenCalled();
      });

      it('an adult keeps the generic 401 GUARD_JWT_UNAUTHORIZED', async () => {
        await expect(
          buildStrategy().validate(buildReq('t'), accessPayload()),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
      });

      it('a failing state lookup still rejects, with the generic 401 (never a 503, never a pass)', async () => {
        mockSupervisedResolver.resolveForRequest.mockRejectedValue(
          new Error('db down'),
        );

        await expect(
          buildStrategy().validate(buildReq('t'), teenPayload()),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
      });
    });

    it('rejects with 401 when the session of the token was deleted (reset / disable inside the 8h JWT)', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(active);
      mockSupervisedResolver.isSessionActive.mockResolvedValue(false);

      await expect(
        buildStrategy().validate(buildReq('t'), teenPayload()),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_SUPERVISED_ACCESS_REVOKED,
        status: 401,
      });
      expect(mockSupervisedResolver.isSessionActive).toHaveBeenCalledWith(
        TEEN,
        SID,
      );
    });

    it('checks the session with a null sid when the token has none (MFA completion tokens)', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(active);

      await buildStrategy().validate(
        buildReq('t'),
        teenPayload({ sid: undefined }),
      );

      expect(mockSupervisedResolver.isSessionActive).toHaveBeenCalledWith(
        TEEN,
        null,
      );
    });

    it('answers 503 when the supervised lookup cannot be performed (never fails open)', async () => {
      const { AppServiceUnavailableException } = jest.requireActual(
        '../../common/errors/app.exception',
      );
      mockSupervisedResolver.resolveForRequest.mockRejectedValue(
        new AppServiceUnavailableException(
          ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
        ),
      );

      await expect(
        buildStrategy().validate(buildReq('t'), teenPayload()),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
        status: 503,
      });
    });

    it('answers 503 when the session lookup cannot be performed', async () => {
      const { AppServiceUnavailableException } = jest.requireActual(
        '../../common/errors/app.exception',
      );
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(active);
      mockSupervisedResolver.isSessionActive.mockRejectedValue(
        new AppServiceUnavailableException(
          ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
        ),
      );

      await expect(
        buildStrategy().validate(buildReq('t'), teenPayload()),
      ).rejects.toMatchObject({ status: 503 });
    });

    it('refuses X-Acting-For on a teen token with 403 ACTING_FOR_FORBIDDEN before any grant lookup', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(active);

      await expect(
        buildStrategy().validate(
          buildReq('t', {
            'x-acting-for': '22222222-2222-4222-8222-222222222222',
          }),
          teenPayload(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ACTING_FOR_FORBIDDEN,
        status: 403,
      });
      expect(mockActingResolver.resolve).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('supervised_token'),
      );
    });

    it('refuses even a malformed X-Acting-For on a teen with the uniform 403 (not a 400)', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(pending);

      await expect(
        buildStrategy().validate(
          buildReq('t', { 'x-acting-for': 'not-a-uuid' }),
          teenPayload(),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.ACTING_FOR_FORBIDDEN });
    });

    it('does not look the supervised state up for a revoked token (revocation checks run first)', async () => {
      mockTokenBlacklistService.checkToken.mockResolvedValue('revoked');

      await expect(
        buildStrategy().validate(buildReq('t'), teenPayload()),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED });
      expect(mockSupervisedResolver.resolveForRequest).not.toHaveBeenCalled();
    });

    it('attributes the audit rows to the teen with actor_kind supervised_user', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(active);

      await runWithAuditContext(async () => {
        await buildStrategy().validate(buildReq('t'), teenPayload());

        expect(getAuditContext()?.actingFor).toEqual({
          actorUserId: TEEN,
          subjectUserId: TEEN,
          kind: 'supervised_user',
        });
      });
    });

    it('sets no audit actor for an adult (byte-identical rows)', async () => {
      await runWithAuditContext(async () => {
        await buildStrategy().validate(buildReq('t'), accessPayload());

        expect(getAuditContext()?.actingFor).toBeUndefined();
      });
    });

    it('lets an adult guardian act exactly as before (supervised resolution is adult)', async () => {
      mockActingResolver.resolve.mockResolvedValue({
        granted: true,
        grant: {
          guardianshipId: 'gs-1',
          consentStatus: 'verified',
          scopes: GUARDIAN_VERIFIED_SCOPES,
        },
      });

      const result = await buildStrategy().validate(
        buildReq('t', {
          'x-acting-for': '22222222-2222-4222-8222-222222222222',
        }),
        accessPayload({ sub: '11111111-1111-4111-8111-111111111111' }),
      );

      expect(result).toMatchObject({
        kind: 'guardian_acting',
        actor_sub: '11111111-1111-4111-8111-111111111111',
        sub: '22222222-2222-4222-8222-222222222222',
      });
    });
  });

  describe('unknown age (NULL birthday, post-registration open)', () => {
    const NEWCOMER = '44444444-4444-4444-8444-444444444444';
    const incomplete = { state: 'profile_incomplete' };

    it('builds an age_unknown_user with the minimal AGE_UNKNOWN scopes', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(incomplete);

      const result = await buildStrategy().validate(
        buildReq('t'),
        accessPayload({ sub: NEWCOMER }),
      );

      expect(result).toEqual({
        sub: NEWCOMER,
        userId: NEWCOMER,
        user_id: NEWCOMER,
        email: 'user@example.com',
        mfa_pending: false,
        sid: null,
        kind: 'age_unknown_user',
        actor_sub: NEWCOMER,
        acting_for: false,
        scopes: AGE_UNKNOWN_SCOPES,
      });
      expect(mockSupervisedResolver.isSessionActive).not.toHaveBeenCalled();
    });

    it('refuses X-Acting-For with the uniform 403 before any grant lookup (an unknown age is never a guardian)', async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(incomplete);

      await expect(
        buildStrategy().validate(
          buildReq('t', {
            'x-acting-for': '22222222-2222-4222-8222-222222222222',
          }),
          accessPayload({ sub: NEWCOMER }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ACTING_FOR_FORBIDDEN,
        status: 403,
      });
      expect(mockActingResolver.resolve).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('age_unknown_token'),
      );
    });

    it("sets no acting audit actor (it is the user's own account)", async () => {
      mockSupervisedResolver.resolveForRequest.mockResolvedValue(incomplete);

      await runWithAuditContext(async () => {
        await buildStrategy().validate(
          buildReq('t'),
          accessPayload({ sub: NEWCOMER }),
        );

        expect(getAuditContext()?.actingFor).toBeUndefined();
      });
    });
  });
});
