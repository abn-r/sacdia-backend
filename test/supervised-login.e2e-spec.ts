// Must run before `../src/app.module` is required: an empty REDIS_URL keeps
// the suite on the in-memory cache and no BullMQ. The flag lets the guardian
// management routes through (they are 404 FAMILY_FEATURE_DISABLED otherwise).
process.env.REDIS_URL = '';
// test/setup.ts replaces the principal resolver with an adult-only one unless asked.
process.env.E2E_REAL_SUPERVISED_RESOLVER = 'true';
process.env.FAMILY_TEEN_LOGIN_ENABLED = 'true';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ActingForCache } from '../src/auth/acting-for/acting-for.cache';
import { BetterAuthService } from '../src/better-auth/better-auth.service';
import { AuthorizationContextService } from '../src/common/services/authorization-context.service';
import { UserAwareThrottlerGuard } from '../src/config/user-aware-throttler.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { createModelMock, createPrismaDouble } from './helpers/prisma-double';
import {
  buildAuthorizationSnapshot,
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

/**
 * Supervised login E2E (family profiles, 3a).
 *
 * The real app is booted (global + local guards, the real JwtStrategy, the
 * SupervisedPrincipalResolver, the ActingForResolver, the acting scope policy,
 * DTO validation, the error filter, the real services behind the routes). Only
 * PrismaService (an in-memory, state-driven double: there is no database in the
 * sandbox), BetterAuthService and AuthorizationContextService are replaced.
 *
 * Two journeys:
 *   A. A teen who registered by themselves (15): pending powers, issues a link
 *      code, an adult redeems it, the club verifies the consent, the teen gets
 *      the full teen scopes.
 *   B. A child with a guardian-enabled handle login (14): the handle login
 *      works, acting for the child stops while the login is on, the guardian
 *      disables it (token cut with 401) and acting resumes.
 *
 * NOT driven over HTTP here (state is flipped, the real code is covered by unit
 * specs): the consent form upload (R2 is not configured in the sandbox) and the
 * director's verify-consent call. The assignment activation gate is covered by
 * the membership-requests specs.
 */

const TEEN_ID = '00000000-0000-4000-8000-0000000000b1';
const CHILD_ID = '00000000-0000-4000-8000-0000000000b2';
const ADULT_ID = '00000000-0000-4000-8000-0000000000a1';
const RELATIONSHIP_ID = '00000000-0000-4000-8000-0000000000e1';
const HANDLE = 'rayo-veloz-482913';

interface LoginState {
  method: 'email' | 'handle';
  login_handle: string | null;
  origin: 'self_registered' | 'guardian_enabled';
  enabled_at: Date | null;
  disabled_at: Date | null;
  disabled_reason: string | null;
  password_set_by: 'self' | 'guardian';
}

interface LinkState {
  guardianship_id: string;
  dependent_user_id: string;
  guardian_user_id: string;
  consent_status: 'pending' | 'verified' | 'revoked';
}

interface PersonState {
  birthday: Date;
  hasAccount: boolean;
  login: LoginState | null;
  sessionAlive: boolean;
}

describe('Supervised login E2E', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let actingCache: ActingForCache;
  let prisma: any;
  let throttlerSpy: jest.SpyInstance;
  let issuedCode: string | null;
  let storedCode: Record<string, unknown> | null;

  const people: Record<string, PersonState> = {};
  let links: LinkState[];

  const bearer = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(jwtService, userId)}`,
  });
  const acting = (userId: string, dependentId: string) => ({
    ...bearer(userId),
    'X-Acting-For': dependentId,
  });
  const errorCode = (body: any): string | undefined =>
    body?.error?.code ?? body?.code ?? body?.message?.code;

  const yearsAgo = (years: number) => {
    const date = new Date();
    date.setUTCFullYear(date.getUTCFullYear() - years);
    date.setUTCMonth(0, 1);
    return date;
  };

  const resetWorld = () => {
    people[TEEN_ID] = {
      birthday: yearsAgo(15),
      hasAccount: true,
      login: null,
      sessionAlive: true,
    };
    people[CHILD_ID] = {
      birthday: yearsAgo(14),
      hasAccount: true,
      login: {
        method: 'handle',
        login_handle: HANDLE,
        origin: 'guardian_enabled',
        enabled_at: new Date(),
        disabled_at: null,
        disabled_reason: null,
        password_set_by: 'guardian',
      },
      sessionAlive: true,
    };
    people[ADULT_ID] = {
      birthday: new Date('1985-01-15T00:00:00.000Z'),
      hasAccount: true,
      login: null,
      sessionAlive: true,
    };
    links = [
      {
        guardianship_id: 'gs-child',
        dependent_user_id: CHILD_ID,
        guardian_user_id: ADULT_ID,
        consent_status: 'verified',
      },
    ];
    issuedCode = null;
    storedCode = null;
  };

  const liveLinks = (dependentId: string) =>
    links.filter(
      (link) =>
        link.dependent_user_id === dependentId &&
        link.consent_status !== 'revoked',
    );

  /** One users row that satisfies every select the journeys go through. */
  const userRow = (userId: string) => {
    const person = people[userId];
    if (!person) return null;
    const verified = liveLinks(userId).filter(
      (link) => link.consent_status === 'verified',
    );
    return {
      user_id: userId,
      email: `${userId}@test.local`,
      name: 'Test',
      paternal_last_name: 'User',
      maternal_last_name: null,
      user_image: null,
      active: true,
      birthday: person.birthday,
      country_id: null,
      account: person.hasAccount ? [{ id: `acc-${userId}` }] : [],
      supervised_login: person.login,
      dependent_profile:
        liveLinks(userId).length > 0 || userId === CHILD_ID
          ? { frozen_at: null, purged_at: null }
          : null,
      guardianships_as_dependent: verified.map((link) => ({
        guardianship_id: link.guardianship_id,
      })),
      users_pr: { complete: false },
      users_roles: [],
    };
  };

  /** The row the guardian summary reads (SUMMARY_SELECT shape). */
  const summaryRowOf = (link: LinkState) => ({
    guardianship_id: link.guardianship_id,
    dependent_user_id: link.dependent_user_id,
    is_primary: true,
    consent_status: link.consent_status,
    verified_at: null,
    relationship_type: {
      relationship_type_id: RELATIONSHIP_ID,
      name: 'Madre',
    },
    dependent: {
      ...userRow(link.dependent_user_id),
      guardianships_as_dependent: [{ consent_evidences: [] }],
    },
  });

  /** The three guardianship lookups the journeys use, told apart by shape. */
  const guardianshipsFindFirst = (args: any) => {
    const where = args?.where ?? {};
    const dependentId = where.dependent_user_id as string | undefined;
    const guardianId = where.guardian_user_id as string | undefined;
    const link = links.find(
      (row) =>
        row.dependent_user_id === dependentId &&
        row.guardian_user_id === guardianId &&
        row.consent_status !== 'revoked',
    );

    // Acting-for resolver: pending or verified, with the managed-dependent rule.
    if (where.consent_status?.in) {
      if (!link) return null;
      const person = people[link.dependent_user_id];
      const login = person.login;
      const managed =
        !person.hasAccount ||
        (login?.origin === 'guardian_enabled' && login.disabled_at !== null);
      if (!managed) return null;
      return {
        guardianship_id: link.guardianship_id,
        consent_status: link.consent_status,
        dependent: { birthday: person.birthday, country_id: null },
      };
    }
    // The denial diagnosis (orderBy) only feeds a log line.
    if (args?.orderBy) return null;
    // The guardian summary (getSummaryForGuardian) selects the dependent block.
    if (args?.select?.dependent?.select?.name !== undefined && link) {
      return summaryRowOf(link);
    }
    // Guardian powers policy: needs the consent status.
    if (args?.select?.consent_status) {
      return link
        ? {
            guardianship_id: link.guardianship_id,
            dependent_user_id: link.dependent_user_id,
            guardian_user_id: link.guardian_user_id,
            consent_status: link.consent_status,
          }
        : null;
    }
    // "Already linked" probe of the redeem.
    return link ? { guardianship_id: link.guardianship_id } : null;
  };

  beforeAll(async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET || 'test-secret';

    jwtService = createTestJwtService();
    throttlerSpy = jest
      .spyOn(UserAwareThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);

    resetWorld();

    const users = createModelMock({
      findUnique: jest.fn(async (args: any) =>
        userRow(args?.where?.user_id as string),
      ),
      findFirst: jest.fn(async (args: any) =>
        userRow(args?.where?.user_id as string),
      ),
    });

    const guardianships = createModelMock({
      findFirst: jest.fn(async (args: any) => guardianshipsFindFirst(args)),
      count: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        // countActiveGuardians(dependent): live user guardians of a child.
        if (where.dependent_user_id) {
          return liveLinks(where.dependent_user_id as string).length;
        }
        // The guardian's own dependents (10 cap).
        return links.filter(
          (link) =>
            link.guardian_user_id === where.guardian_user_id &&
            link.consent_status !== 'revoked',
        ).length;
      }),
      findMany: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        // The teen's own view: the guardians linked to them.
        if (where.dependent_user_id) {
          return liveLinks(where.dependent_user_id as string).map((link) => ({
            guardian: { name: 'Marta', paternal_last_name: 'Gómez' },
            relationship_type: { name: 'Madre' },
          }));
        }
        return links
          .filter(
            (link) =>
              link.guardian_user_id === where.guardian_user_id &&
              link.consent_status !== 'revoked',
          )
          .map(summaryRowOf);
      }),
      create: jest.fn(async (args: any) => {
        const link: LinkState = {
          guardianship_id: 'gs-teen',
          dependent_user_id: args.data.dependent_user_id,
          guardian_user_id: args.data.guardian_user_id,
          consent_status: 'pending',
        };
        links.push(link);
        return { guardianship_id: link.guardianship_id };
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });

    const linkCodes = createModelMock({
      create: jest.fn(async (args: any) => {
        storedCode = {
          link_code_id: 'lc-1',
          code_hash: args.data.code_hash,
          dependent_user_id: args.data.dependent_user_id,
          purpose: args.data.purpose,
          issued_by_user_id: args.data.issued_by_user_id,
          issued_for_club_section_id: null,
        };
        return storedCode;
      }),
      // The redeem looks the code up by hash: the one stored by `create` is the
      // only code in this world, and only a matching hash finds it.
      findFirst: jest.fn(async (args: any) =>
        storedCode && storedCode.code_hash === args?.where?.code_hash
          ? storedCode
          : null,
      ),
      updateMany: jest.fn(async (args: any) => {
        // Consuming (consumed_at: null guard) vs revoking older open codes.
        if (args?.data?.consumed_at) {
          const was = storedCode;
          storedCode = null;
          return { count: was ? 1 : 0 };
        }
        return { count: 0 };
      }),
    });

    const supervisedLogins = createModelMock({
      update: jest.fn(async (args: any) => {
        const person = people[args.where.user_id as string];
        person.login = { ...(person.login as LoginState), ...args.data };
        return person.login;
      }),
      upsert: jest.fn(async (args: any) => {
        const person = people[args.where.user_id as string];
        person.login = person.login
          ? { ...person.login, ...args.update }
          : ({ ...args.create } as LoginState);
        return person.login;
      }),
    });

    const session = createModelMock({
      findFirst: jest.fn(async (args: any) =>
        people[args?.where?.userId as string]?.sessionAlive
          ? { id: 'session-1' }
          : null,
      ),
      deleteMany: jest.fn(async (args: any) => {
        const person = people[args?.where?.userId as string];
        if (person) person.sessionAlive = false;
        return { count: 1 };
      }),
    });

    const prismaDouble = createPrismaDouble({
      users,
      guardianships,
      guardianship_link_codes: linkCodes,
      supervised_logins: supervisedLogins,
      session,
      account: createModelMock({
        count: jest.fn(async (args: any) =>
          people[args?.where?.userId as string]?.hasAccount ? 1 : 0,
        ),
      }),
      relationship_types: createModelMock({
        findFirst: jest.fn().mockResolvedValue({
          relationship_type_id: RELATIONSHIP_ID,
          name: 'Madre',
        }),
      }),
      users_pr: createModelMock({
        findUnique: jest.fn().mockResolvedValue({
          complete: false,
          profile_picture_complete: false,
          personal_info_complete: false,
          club_selection_complete: false,
          date_completed: null,
        }),
      }),
      clubs: createModelMock({
        findUnique: jest.fn().mockResolvedValue({
          club_id: 7,
          club_sections: [{ club_section_id: 3 }],
        }),
      }),
      club_role_assignments: createModelMock({
        findMany: jest.fn().mockResolvedValue([]),
      }),
      units: createModelMock({ findMany: jest.fn().mockResolvedValue([]) }),
      $transaction: jest.fn(async (arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
          : Promise.all(arg as Array<Promise<unknown>>),
      ),
    });

    const authorizationContext = {
      resolveUserAuthorization: jest.fn(async (userId: string) => ({
        profile: { user_id: userId },
        post_register_complete: true,
        authorization: buildAuthorizationSnapshot({
          globalPermissions: ['units:read'],
        }),
        legacy: {
          roles: [],
          permissions: [],
          club: null,
          club_context: {
            active_assignment_id: null,
            active: null,
            available: [],
          },
        },
      })),
      canManageClub: jest.fn().mockResolvedValue(true),
      canAccessHierarchyScope: jest.fn().mockReturnValue(true),
    };

    // Better Auth: the handle login succeeds for the one handle in this world.
    const betterAuth = {
      signInWithIdentifier: jest.fn(async (identifier: string) => {
        if (identifier !== HANDLE) {
          throw new Error('Invalid login credentials');
        }
        return {
          user: { id: CHILD_ID, email: null, name: 'Test' },
          session: {
            token: 'opaque-session-token',
            expiresAt: new Date(Date.now() + 3_600_000),
          },
          accessToken: createBearerToken(jwtService, CHILD_ID).replace(
            /^Bearer /,
            '',
          ),
        };
      }),
      signJwt: jest.fn().mockReturnValue('fake-jwt'),
      signOut: jest.fn().mockResolvedValue(undefined),
      hasTotpEnabled: jest.fn().mockResolvedValue({ enabled: false }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthorizationContextService)
      .useValue(authorizationContext)
      .overrideProvider(BetterAuthService)
      .useValue(betterAuth)
      .overrideProvider(PrismaService)
      .useValue(prismaDouble)
      .compile();

    prisma = moduleFixture.get(PrismaService);
    actingCache = moduleFixture.get(ActingForCache, { strict: false });

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    throttlerSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // A. Self-registered teen
  // ---------------------------------------------------------------------------

  describe('A. a teen who registered by themselves', () => {
    beforeAll(async () => {
      resetWorld();
      await actingCache.bump(TEEN_ID);
    });

    it('pending: a member-reachable club route is denied with PRINCIPAL_SCOPE_DENIED', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/clubs/7/units')
        .set(bearer(TEEN_ID));

      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('PRINCIPAL_SCOPE_DENIED');
    });

    it('pending: step 3 of the post-registration is reachable', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${TEEN_ID}/post-registration/status`)
        .set(bearer(TEEN_ID));

      expect(response.status).toBe(200);
    });

    it('pending: the teen sees their own supervision (no guardian yet)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/me/supervision')
        .set(bearer(TEEN_ID));

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        status: 'pending_guardian',
        guardians: [],
        summary_visible_to_guardians: true,
      });
    });

    it('a teen token cannot send X-Acting-For (403 ACTING_FOR_FORBIDDEN)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${TEEN_ID}/post-registration/status`)
        .set(acting(TEEN_ID, CHILD_ID));

      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('ACTING_FOR_FORBIDDEN');
    });

    it('the teen issues a guardian link code (shown once)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/me/guardian-link-codes')
        .set(bearer(TEEN_ID));

      expect(response.status).toBe(201);
      issuedCode = response.body.data.code;
      expect(issuedCode).toMatch(/^[A-Z0-9-]+$/);
      expect(response.body.data.expires_at).toEqual(expect.any(String));
    });

    it('an adult redeems the code: a PENDING guardianship is created, never verified', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/guardianships/link-codes/redeem')
        .set(bearer(ADULT_ID))
        .send({
          code: issuedCode,
          relationship_type_id: RELATIONSHIP_ID,
          sworn_declaration: true,
        });

      expect(response.status).toBe(201);
      const link = links.find((row) => row.dependent_user_id === TEEN_ID);
      expect(link).toMatchObject({
        guardian_user_id: ADULT_ID,
        consent_status: 'pending',
      });
      // The code is single use.
      expect(storedCode).toBeNull();
    });

    it('a pending guardian has no powers: managing the teen login is 403', async () => {
      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${TEEN_ID}/supervised-login/disable`,
        )
        .set(bearer(ADULT_ID))
        .send({});

      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe(
        'GUARDIANSHIP_CONSENT_NOT_VERIFIED',
      );
    });

    it('still pending after the link: the club route stays denied', async () => {
      await actingCache.bump(TEEN_ID);
      const response = await request(app.getHttpServer())
        .get('/api/v1/clubs/7/units')
        .set(bearer(TEEN_ID));

      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('PRINCIPAL_SCOPE_DENIED');

      const supervision = await request(app.getHttpServer())
        .get('/api/v1/users/me/supervision')
        .set(bearer(TEEN_ID));
      expect(supervision.body.data.guardians).toHaveLength(1);
    });

    it('after the consent is verified the teen gets the teen scopes', async () => {
      // The signed form upload and the director's verify-consent call are
      // covered by their own specs; here only their result is applied, and the
      // epoch moves like the real verification does after commit.
      const link = links.find((row) => row.dependent_user_id === TEEN_ID);
      (link as LinkState).consent_status = 'verified';
      await actingCache.bump(TEEN_ID);

      const response = await request(app.getHttpServer())
        .get('/api/v1/clubs/7/units')
        .set(bearer(TEEN_ID));

      expect(response.status).toBe(200);
    });

    it('verified: the teen still cannot issue another guardian code (pending-only scope)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/me/guardian-link-codes')
        .set(bearer(TEEN_ID));

      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('PRINCIPAL_SCOPE_DENIED');
    });
  });

  // ---------------------------------------------------------------------------
  // B. Guardian-enabled handle login
  // ---------------------------------------------------------------------------

  describe('B. a child with a guardian-enabled handle login', () => {
    beforeAll(async () => {
      resetWorld();
      await actingCache.bump(CHILD_ID);
    });

    it('while the login is on, the guardian cannot act for the child (uniform 403)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${CHILD_ID}/post-registration/status`)
        .set(acting(ADULT_ID, CHILD_ID));

      expect(response.status).toBe(403);
    });

    it('the child logs in with the handle and is a supervised_user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: HANDLE, password: 'guardian-chosen-pass-1' });

      expect(response.status).toBe(200);
      expect(response.body.data.user.principal).toMatchObject({
        kind: 'supervised_user',
      });
      // The handle never comes back in the response.
      expect(JSON.stringify(response.body)).not.toContain(HANDLE);
    });

    it('a wrong handle is the same 401 as a wrong password', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: 'nope-nope-000000', password: 'whatever-pass-1' });

      expect(response.status).toBe(401);
    });

    it('the child token works while the login is enabled', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${CHILD_ID}/post-registration/status`)
        .set(bearer(CHILD_ID));

      expect(response.status).toBe(200);
    });

    it('the verified guardian disables the login', async () => {
      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${CHILD_ID}/supervised-login/disable`,
        )
        .set(bearer(ADULT_ID))
        .send({});

      expect(response.status).toBe(200);
      expect(people[CHILD_ID].login?.disabled_reason).toBe('guardian');
      expect(people[CHILD_ID].sessionAlive).toBe(false);
    });

    it('the child token is cut: 401', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${CHILD_ID}/post-registration/status`)
        .set(bearer(CHILD_ID));

      expect(response.status).toBe(401);
      expect(errorCode(response.body)).toBe('AUTH_SUPERVISED_ACCESS_REVOKED');
    });

    it('acting for the child resumes (guardian-enabled login that was disabled)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${CHILD_ID}/post-registration/status`)
        .set(acting(ADULT_ID, CHILD_ID));

      expect(response.status).toBe(200);
    });
  });
});
