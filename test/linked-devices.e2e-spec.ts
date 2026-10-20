// Must run before `../src/app.module` is required: an empty REDIS_URL keeps
// the suite on the in-memory cache and no BullMQ. The flag lets the pairing and
// device routes through (they are 404 / 401 otherwise: kill switch).
process.env.REDIS_URL = '';
process.env.FAMILY_LINKED_DEVICE_ENABLED = 'true';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ActingForCache } from '../src/auth/acting-for/acting-for.cache';
import { ClassesService } from '../src/classes/classes.service';
import { UserAwareThrottlerGuard } from '../src/config/user-aware-throttler.guard';
import { GuardianNotificationsService } from '../src/guardianships/guardian-notifications.service';
import {
  LINKED_DEVICE_REVOKER,
  NOOP_LINKED_DEVICE_REVOKER,
} from '../src/guardianships/linked-device-revoker.port';
import { LinkedDevicesService } from '../src/guardianships/linked-devices.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { AuthorizationContextService } from '../src/common/services/authorization-context.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createModelMock, createPrismaDouble } from './helpers/prisma-double';
import {
  buildAuthorizationSnapshot,
  createBearerToken,
  createTestJwtService,
  useE2ePermissionsPassthrough,
} from './helpers/rbac-test-helpers';

/**
 * Linked device E2E (family profiles, 3b).
 *
 * The real app is booted: global + local guards, the real JwtStrategy and the
 * real LinkedDeviceGate, the acting scope policy, DTO validation, the error
 * filter, the real BetterAuthService (device JWT signing, session creation,
 * device-aware refresh) and the real services behind the routes (pairing,
 * linked devices, lifecycle, FCM tokens, activities, auth). PrismaService is an
 * in-memory, state-driven double (no database in the sandbox) and
 * AuthorizationContextService is replaced.
 *
 * Boundaries stubbed on purpose:
 *  - RBAC (PermissionsGuard) is passed through (`useE2ePermissionsPassthrough`):
 *    the device scope policy lives in JwtAuthGuard and stays REAL, but the
 *    member-role permission checks are not exercised here;
 *  - ClassesService.uploadSectionFile / submitSection are replaced by two
 *    methods that return the shapes of the real ones and call the REAL
 *    GuardianNotificationsService hook exactly like the real upload does
 *    (R2 and the whole enrollment machinery are not available without a
 *    database). The class progress rules have their own specs;
 *  - NotificationsService.sendToUser is spied (what a guardian would receive).
 *
 * Journey: pair -> device token -> /auth/me -> allowed reads -> default-deny
 * -> X-Acting-For -> evidence upload + submit -> guardian notified -> push
 * token -> agenda without attendees -> refresh (old token blacklisted) ->
 * guardian revoke -> immediate 401 (also on refresh) -> re-pair -> the pairing
 * guardian leaves and the other guardian's device stays -> flag off.
 */

const CHILD = '00000000-0000-4000-8000-0000000000d1';
const SIBLING = '00000000-0000-4000-8000-0000000000d2';
const GUARDIAN = '00000000-0000-4000-8000-0000000000a1';
const GUARDIAN_2 = '00000000-0000-4000-8000-0000000000a2';
const STRANGER = '00000000-0000-4000-8000-0000000000a9';
const GS_1 = '00000000-0000-4000-8000-0000000000e1';
const GS_2 = '00000000-0000-4000-8000-0000000000e2';

interface Guardianship {
  guardianship_id: string;
  dependent_user_id: string;
  guardian_user_id: string;
  consent_status: 'pending' | 'verified' | 'revoked';
  is_primary: boolean;
  is_custodian: boolean;
  is_test_data: boolean;
  revoked_reason?: string | null;
}

interface DeviceRow {
  linked_device_id: string;
  dependent_user_id: string;
  guardianship_id: string;
  paired_by_user_id: string;
  session_id: string;
  label: string;
  platform: string;
  app_version: string | null;
  fcm_token_id: string | null;
  paired_at: Date;
  absolute_expires_at: Date;
  last_seen_at: Date | null;
  revoked_at: Date | null;
  revoked_by_user_id: string | null;
  revoked_reason: string | null;
}

interface TokenRow {
  pairing_token_id: string;
  token_hash: string;
  dependent_user_id: string;
  guardianship_id: string;
  created_by_user_id: string;
  expires_at: Date;
  consumed_at: Date | null;
  consumed_device_id: string | null;
  revoked_at: Date | null;
  created_at: Date;
}

interface SessionRow {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

describe('Linked device E2E (family profiles 3b)', () => {
  useE2ePermissionsPassthrough();

  let app: INestApplication;
  let jwtService: JwtService;
  let config: ConfigService;
  let moduleRef: TestingModule;
  let actingCache: ActingForCache;
  let throttlerSpy: jest.SpyInstance;
  let sendToUser: jest.SpyInstance;

  // ---------------------------------------------------------------- world
  let guardianships: Guardianship[];
  let devices: DeviceRow[];
  let pairingTokens: TokenRow[];
  let sessions: SessionRow[];
  let fcmTokens: Array<{
    fcm_token_id: string;
    user_id: string;
    token: string;
    active: boolean;
  }>;
  let audits: Array<Record<string, any>>;
  let childBirthday: Date;
  let hasAccount: boolean;
  let uploadCalls: number;
  let attendeeIds: string[];

  const yearsAgo = (years: number) => {
    const date = new Date();
    date.setUTCFullYear(date.getUTCFullYear() - years);
    date.setUTCMonth(0, 1);
    return date;
  };

  const resetWorld = () => {
    guardianships = [
      {
        guardianship_id: GS_1,
        dependent_user_id: CHILD,
        guardian_user_id: GUARDIAN,
        consent_status: 'verified',
        is_primary: true,
        is_custodian: false,
        is_test_data: false,
      },
      {
        guardianship_id: GS_2,
        dependent_user_id: CHILD,
        guardian_user_id: GUARDIAN_2,
        consent_status: 'verified',
        is_primary: false,
        is_custodian: false,
        is_test_data: false,
      },
    ];
    devices = [];
    pairingTokens = [];
    sessions = [];
    fcmTokens = [];
    audits = [];
    childBirthday = yearsAgo(9);
    hasAccount = false;
    uploadCalls = 0;
    attendeeIds = [SIBLING, STRANGER];
    sendToUser?.mockClear();
  };

  const bearer = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(jwtService, userId)}`,
  });
  const deviceAuth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const errorCode = (body: any): string | undefined =>
    body?.error?.code ?? body?.code ?? body?.message?.code;

  const matches = (row: any, where: Record<string, any> = {}): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'OR' || key === 'AND' || key === 'NOT') return true;
      const actual = row[key];
      if (value === null) return actual === null || actual === undefined;
      if (value instanceof Date) {
        return actual instanceof Date && actual.getTime() === value.getTime();
      }
      if (value && typeof value === 'object') {
        if ('in' in value) return (value.in as unknown[]).includes(actual);
        if ('not' in value) {
          return value.not === null
            ? actual !== null && actual !== undefined
            : actual !== value.not;
        }
        if ('gt' in value) return actual > value.gt;
        if ('lte' in value) return actual <= value.lte;
        return true; // nested relation filters are answered by the callers
      }
      return actual === value;
    });

  const childRow = () => ({
    user_id: CHILD,
    email: null,
    name: 'Ana Sofía',
    paternal_last_name: 'Pérez',
    maternal_last_name: null,
    user_image: null,
    active: true,
    birthday: childBirthday,
    country_id: null,
    account: hasAccount ? [{ id: 'acc' }] : [],
    supervised_login: null,
    dependent_profile: { frozen_at: null, purged_at: null },
    guardianships_as_dependent: guardianships
      .filter((g) => g.consent_status !== 'revoked')
      .map((g) => ({ guardian_user_id: g.guardian_user_id })),
  });

  const adultRow = (userId: string) => ({
    user_id: userId,
    email: `${userId}@test.local`,
    name: 'Mamá',
    paternal_last_name: 'Pérez',
    birthday: new Date('1985-01-15T00:00:00.000Z'),
    country_id: null,
    active: true,
    account: [{ id: 'acc' }],
    supervised_login: null,
    dependent_profile: null,
    guardianships_as_dependent: [],
  });

  const userRow = (userId: string) =>
    userId === CHILD
      ? childRow()
      : [GUARDIAN, GUARDIAN_2, STRANGER].includes(userId)
        ? adultRow(userId)
        : null;

  const gate = (device: DeviceRow) => ({
    ...device,
    guardianship: {
      ...(guardianships.find(
        (g) => g.guardianship_id === device.guardianship_id,
      ) as Guardianship),
      is_custodian: false,
      is_test_data: false,
      revoked_at: null,
      guardian_user_id: guardianships.find(
        (g) => g.guardianship_id === device.guardianship_id,
      )?.guardian_user_id,
    },
    dependent: childRow(),
  });

  // ------------------------------------------------------------- doubles
  const buildPrisma = () => {
    const users = createModelMock({
      findUnique: jest.fn(async (args: any) =>
        userRow(args?.where?.user_id as string),
      ),
      findUniqueOrThrow: jest.fn(async (args: any) =>
        userRow(args?.where?.user_id as string),
      ),
      findFirst: jest.fn(async (args: any) =>
        userRow(args?.where?.user_id as string),
      ),
      findMany: jest.fn().mockResolvedValue([]),
    });

    const guardianshipModel = createModelMock({
      // GuardianPowersPolicy, the pairing re-validation and the lifecycle.
      findFirst: jest.fn(async (args: any) => {
        const row = guardianships.find((g) => matches(g, args?.where ?? {}));
        return row ? { ...row } : null;
      }),
      findUnique: jest.fn(async (args: any) => {
        const row = guardianships.find(
          (g) => g.guardianship_id === args?.where?.guardianship_id,
        );
        return row ?? null;
      }),
      findMany: jest.fn(async (args: any) =>
        guardianships
          .filter((g) => matches(g, args?.where ?? {}))
          .map((g) => ({ ...g })),
      ),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(async (args: any) => {
        const row = guardianships.find(
          (g) => g.guardianship_id === args.where.guardianship_id,
        );
        if (row) {
          Object.assign(row, {
            consent_status: args.data.consent_status ?? row.consent_status,
            is_primary: args.data.is_primary ?? row.is_primary,
            revoked_reason: args.data.revoked_reason ?? row.revoked_reason,
          });
        }
        return row;
      }),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });

    const linkedDevices = createModelMock({
      // The per-request gate (nested guardianship + dependent) and the
      // FcmTokensService device link.
      findFirst: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        const device = devices.find((d) => matches(d, where));
        if (!device) return null;
        return args?.select?.guardianship ? gate(device) : device;
      }),
      findUnique: jest.fn(async (args: any) => {
        const device = devices.find(
          (d) => d.linked_device_id === args?.where?.linked_device_id,
        );
        return device ?? null;
      }),
      findUniqueOrThrow: jest.fn(async (args: any) => {
        const device = devices.find(
          (d) => d.linked_device_id === args?.where?.linked_device_id,
        );
        if (!device) throw new Error('not found');
        return device;
      }),
      findMany: jest.fn(async (args: any) =>
        devices
          .filter((d) => matches(d, args?.where ?? {}))
          .map((d) => ({
            ...d,
            paired_by: { name: 'Mamá', paternal_last_name: 'Pérez' },
          })),
      ),
      count: jest.fn(
        async (args: any) =>
          devices.filter((d) => matches(d, args?.where ?? {})).length,
      ),
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn(async (args: any) => {
        const row: DeviceRow = {
          app_version: null,
          fcm_token_id: null,
          last_seen_at: null,
          revoked_at: null,
          revoked_by_user_id: null,
          revoked_reason: null,
          ...args.data,
        };
        devices.push(row);
        return row;
      }),
      update: jest.fn(async (args: any) => {
        const device = devices.find(
          (d) => d.linked_device_id === args.where.linked_device_id,
        );
        if (device) Object.assign(device, args.data);
        return device;
      }),
      updateMany: jest.fn(async (args: any) => {
        const hit = devices.filter((d) => matches(d, args?.where ?? {}));
        hit.forEach((d) => Object.assign(d, args.data));
        return { count: hit.length };
      }),
    });

    const tokensModel = createModelMock({
      findUnique: jest.fn(async (args: any) => {
        const row = pairingTokens.find(
          (t) => t.token_hash === args?.where?.token_hash,
        );
        return row ?? null;
      }),
      create: jest.fn(async (args: any) => {
        const row: TokenRow = {
          pairing_token_id: `tok-${pairingTokens.length + 1}`,
          consumed_at: null,
          consumed_device_id: null,
          revoked_at: null,
          ...args.data,
        };
        pairingTokens.push(row);
        return row;
      }),
      updateMany: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        const hit = pairingTokens.filter(
          (t) =>
            (where.pairing_token_id === undefined ||
              t.pairing_token_id === where.pairing_token_id) &&
            (where.dependent_user_id === undefined ||
              t.dependent_user_id === where.dependent_user_id) &&
            t.consumed_at === null &&
            t.revoked_at === null &&
            (where.expires_at?.gt === undefined ||
              t.expires_at > where.expires_at.gt),
        );
        hit.forEach((t) => Object.assign(t, args.data));
        return { count: hit.length };
      }),
    });

    const sessionModel = createModelMock({
      create: jest.fn(async (args: any) => {
        const row: SessionRow = {
          createdAt: new Date(),
          updatedAt: new Date(),
          ipAddress: null,
          userAgent: null,
          ...args.data,
        };
        sessions.push(row);
        return row;
      }),
      findFirst: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        const now = new Date();
        const row = sessions.find(
          (s) =>
            (where.id === undefined || s.id === where.id) &&
            (where.userId === undefined || s.userId === where.userId) &&
            (where.token === undefined || s.token === where.token) &&
            (where.expiresAt?.gt === undefined || s.expiresAt > now),
        );
        return row ?? null;
      }),
      findMany: jest.fn(async (args: any) =>
        sessions.filter((s) => matches(s, args?.where ?? {})),
      ),
      deleteMany: jest.fn(async (args: any) => {
        const before = sessions.length;
        const where = args?.where ?? {};
        sessions = sessions.filter(
          (s) =>
            !(
              (where.id === undefined || s.id === where.id) &&
              (where.userId === undefined || s.userId === where.userId) &&
              (where.token === undefined || s.token === where.token)
            ),
        );
        return { count: before - sessions.length };
      }),
    });

    const fcmModel = createModelMock({
      findFirst: jest.fn(async (args: any) => {
        return fcmTokens.find((t) => t.token === args?.where?.token) ?? null;
      }),
      findMany: jest.fn(async (args: any) =>
        fcmTokens.filter((t) => matches(t, args?.where ?? {})),
      ),
      create: jest.fn(async (args: any) => {
        const row = {
          fcm_token_id: `fcm-${fcmTokens.length + 1}`,
          active: true,
          ...args.data,
        };
        fcmTokens.push(row);
        return row;
      }),
      update: jest.fn(async (args: any) => {
        const row = fcmTokens.find(
          (t) => t.fcm_token_id === args.where.fcm_token_id,
        );
        if (row) Object.assign(row, args.data);
        return row;
      }),
      updateMany: jest.fn(async (args: any) => {
        const hit = fcmTokens.filter((t) => matches(t, args?.where ?? {}));
        hit.forEach((t) => Object.assign(t, args.data));
        return { count: hit.length };
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    });

    const auditModel = createModelMock({
      create: jest.fn(async (args: any) => {
        audits.push(args.data);
        return args.data;
      }),
    });

    const activities = createModelMock({
      findUnique: jest.fn(async () => ({
        activity_id: 91,
        name: 'Campamento de verano',
        active: true,
        attendees: attendeeIds,
        rsvp: { [SIBLING]: 'going' },
        activity_instances: [],
      })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    });

    const $queryRaw = jest.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        const token = values[values.length - 1] as string;
        if (
          sql.includes('FROM sessions s') &&
          sql.includes('JOIN linked_devices')
        ) {
          // findLinkedDeviceOfSession
          const session = sessions.find((s) => s.token === token);
          const device = session
            ? devices.find((d) => d.session_id === session.id)
            : undefined;
          return device && session
            ? [
                {
                  session_id: session.id,
                  linked_device_id: device.linked_device_id,
                  dependent_user_id: device.dependent_user_id,
                  revoked_at: device.revoked_at,
                  absolute_expires_at: device.absolute_expires_at,
                },
              ]
            : [];
        }
        if (sql.includes('UPDATE sessions')) {
          // The sliding UPDATE of BetterAuthService.refreshSession.
          const newExpiresAt = values[0] as Date;
          const sessionToken = values[1] as string;
          const session = sessions.find(
            (s) => s.token === sessionToken && s.expiresAt > new Date(),
          );
          if (!session) return [];
          session.expiresAt = newExpiresAt;
          const user = userRow(session.userId) as any;
          return [
            {
              id: session.id,
              token: session.token,
              expires_at: session.expiresAt,
              created_at: session.createdAt,
              updated_at: new Date(),
              ip_address: null,
              user_agent: null,
              user_id: session.userId,
              u_user_id: session.userId,
              u_email: user.email,
              u_name: user.name,
              u_email_verified: false,
              u_user_image: null,
              u_created_at: new Date(),
              u_modified_at: new Date(),
            },
          ];
        }
        return [];
      },
    );

    const prismaDouble: any = createPrismaDouble({
      users,
      guardianships: guardianshipModel,
      linked_devices: linkedDevices,
      device_pairing_tokens: tokensModel,
      session: sessionModel,
      user_fcm_tokens: fcmModel,
      audit_logs: auditModel,
      activities,
      legal_acceptances: createModelMock({
        findMany: jest.fn().mockResolvedValue([]),
      }),
      guardianship_link_codes: createModelMock({
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      }),
      account: createModelMock({
        count: jest.fn(async () => (hasAccount ? 1 : 0)),
      }),
      club_role_assignments: createModelMock({
        findMany: jest.fn().mockResolvedValue([]),
      }),
      supervised_logins: createModelMock({
        upsert: jest.fn().mockResolvedValue({}),
      }),
      $queryRaw,
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => Promise<unknown>)(prismaDouble)
          : Promise.all(arg as Array<Promise<unknown>>),
      ),
    });
    return prismaDouble;
  };

  // ------------------------------------------------------------ helpers
  const issueToken = async (guardianId = GUARDIAN): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post(
        `/api/v1/guardianships/me/dependents/${CHILD}/devices/pairing-tokens`,
      )
      .set(bearer(guardianId));
    expect(response.status).toBe(201);
    return response.body.data.pairing_token as string;
  };

  const pair = (token: string, extra: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/device/pair')
      .send({
        pairing_token: token,
        platform: 'android',
        app_version: '2.4.0',
        label: 'Tablet de Ana',
        ...extra,
      });

  interface Paired {
    accessToken: string;
    refreshToken: string;
    deviceId: string;
  }
  const pairDevice = async (guardianId = GUARDIAN): Promise<Paired> => {
    const token = await issueToken(guardianId);
    const response = await pair(token);
    expect(response.status).toBe(200);
    return {
      accessToken: response.body.data.accessToken,
      refreshToken: response.body.data.refreshToken,
      deviceId: response.body.data.device.linked_device_id,
    };
  };

  const setLinkedDeviceFlag = (value: boolean) => {
    (config as unknown as { set: (key: string, value: unknown) => void }).set(
      'FAMILY_LINKED_DEVICE_ENABLED',
      value,
    );
  };

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

  beforeAll(async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;

    jwtService = createTestJwtService();
    throttlerSpy = jest
      .spyOn(UserAwareThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);
    sendToUser = jest
      .spyOn(NotificationsService.prototype, 'sendToUser')
      .mockResolvedValue(undefined);

    resetWorld();
    const prismaDouble = buildPrisma();

    const authorizationContext = {
      resolveUserAuthorization: jest.fn(async (userId: string) => ({
        profile: {
          user_id: userId,
          name: 'Ana Sofía',
          birthday: childBirthday,
          country_id: null,
          user_image: null,
        },
        post_register_complete: true,
        authorization: buildAuthorizationSnapshot({}),
        legacy: {
          roles: ['user'],
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
      hasAnyGlobalRole: jest.fn().mockResolvedValue(false),
      invalidateUserAuthorizationCache: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthorizationContextService)
      .useValue(authorizationContext)
      .overrideProvider(PrismaService)
      .useValue(prismaDouble)
      .overrideProvider(ClassesService)
      .useFactory({
        inject: [GuardianNotificationsService],
        factory: (notifications: GuardianNotificationsService) => ({
          // Same contract as the real upload: the guardians are told AFTER the
          // upload succeeded, through the real hook; a failure tells nobody.
          uploadSectionFile: jest.fn(
            async (
              targetUserId: string,
              actorUserId: string,
              _classId: number,
              _sectionId: number,
              file: { size?: number },
            ) => {
              uploadCalls += 1;
              if (!file) throw new Error('CLASS_FILE_REQUIRED');
              void notifications.onDependentEvidenceUploaded({
                dependentUserId: targetUserId,
                kind: 'class_section',
                actorUserId,
              });
              return {
                evidence_file_id: uploadCalls,
                file_name: 'evidence.png',
              };
            },
          ),
          submitSection: jest.fn(async () => ({
            section_progress_id: 1,
            section_id: 7,
            status: 'SUBMITTED',
            submitted_at: new Date().toISOString(),
          })),
        }),
      })
      .compile();

    moduleRef = moduleFixture;
    config = moduleFixture.get(ConfigService);
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
    sendToUser.mockRestore();
  });

  beforeEach(async () => {
    resetWorld();
    setLinkedDeviceFlag(true);
    await actingCache.bump(CHILD);
  });

  // ---------------------------------------------------------------------------
  // The journey
  // ---------------------------------------------------------------------------

  describe('A. pair -> device token -> allowed reads -> evidence -> notified -> revoke -> 401', () => {
    it('runs the whole journey', async () => {
      // 1. The guardian creates the QR token.
      const issued = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${CHILD}/devices/pairing-tokens`,
        )
        .set(bearer(GUARDIAN));
      expect(issued.status).toBe(201);
      const {
        pairing_token: pairingToken,
        qr_payload,
        expires_in,
      } = issued.body.data;
      expect(qr_payload).toBe(`sacdia://pair?t=${pairingToken}`);
      expect(expires_in).toBe(600);
      // Only the hash is stored.
      expect(JSON.stringify(pairingTokens)).not.toContain(pairingToken);
      expect(pairingTokens[0].token_hash).toMatch(/^[0-9a-f]{64}$/);

      // 2. The child's phone redeems it (public, no bearer).
      const paired = await pair(pairingToken);
      expect(paired.status).toBe(200);
      const body = paired.body.data;
      expect(Object.keys(body).sort()).toEqual(
        [
          'accessToken',
          'device',
          'expiresAt',
          'refreshToken',
          'tokenType',
          'user',
        ].sort(),
      );
      expect(body.user).toEqual({ id: CHILD, name: 'Ana', avatar: null });
      expect(JSON.stringify(paired.body)).not.toContain(pairingToken);
      expect(JSON.stringify(paired.body)).not.toMatch(/@test\.local/);
      const deviceJwt = body.accessToken as string;
      const deviceId = body.device.linked_device_id as string;

      // The access token is a device JWT: aud EXACTLY the device string, 1 hour.
      const claims = jwtService.decode<Record<string, any>>(deviceJwt);
      expect(claims).toMatchObject({
        sub: CHILD,
        dev: deviceId,
        iss: 'https://api.sacdia.app',
        aud: 'sacdia:device',
      });
      expect(typeof claims.aud).toBe('string');
      expect(claims.exp - claims.iat).toBe(3600);
      expect(claims.email).toBeUndefined();

      // The guardians were told (device paired), the token consumed.
      await flush();
      expect(pairingTokens[0].consumed_at).toBeInstanceOf(Date);
      expect(pairingTokens[0].consumed_device_id).toBe(deviceId);
      expect(devices).toHaveLength(1);
      expect(audits.map((a) => a.action)).toContain('linked_device.paired');
      expect(JSON.stringify(audits)).not.toContain(pairingToken);

      // 3. GET /auth/me as the device.
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(deviceJwt));
      expect(me.status).toBe(200);
      const profile = me.body.data ?? me.body;
      expect(profile.principal).toMatchObject({
        kind: 'linked_device',
        device: { linked_device_id: deviceId, label: 'Tablet de Ana' },
      });
      expect(profile.mode).toBe('device');
      expect(profile.family).toBeNull();
      expect(profile.acting_for).toBeNull();
      expect(profile.analytics_anonymous).toBe(true);
      expect(profile.legal).toBeDefined();

      // 4. Default deny: everything outside DEVICE_SCOPES.
      for (const [method, path] of [
        ['get', '/api/v1/auth/sessions'],
        ['get', `/api/v1/users/${CHILD}/allergies`],
        ['get', `/api/v1/users/${CHILD}/emergency-contacts`],
        ['patch', `/api/v1/users/${CHILD}`],
        ['post', '/api/v1/auth/update-password'],
        ['post', `/api/v1/users/${CHILD}/classes/enroll`],
        ['post', `/api/v1/users/${CHILD}/honors`],
        ['post', `/api/v1/users/${CHILD}/honors/5/files`],
        ['get', '/api/v1/guardianships/me/dependents'],
        ['get', '/api/v1/fcm-tokens'],
      ] as const) {
        const denied = await request(app.getHttpServer())
          [method](path)
          .set(deviceAuth(deviceJwt));
        expect({ path, status: denied.status }).toEqual({ path, status: 403 });
        expect({ path, code: errorCode(denied.body) }).toEqual({
          path,
          code: 'PRINCIPAL_SCOPE_DENIED',
        });
      }

      // 5. X-Acting-For on a device token is 403 ACTING_FOR_FORBIDDEN.
      const actingAttempt = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set({ ...deviceAuth(deviceJwt), 'X-Acting-For': GUARDIAN });
      expect(actingAttempt.status).toBe(403);
      expect(errorCode(actingAttempt.body)).toBe('ACTING_FOR_FORBIDDEN');

      // 6. Evidence upload (201) and submit.
      sendToUser.mockClear();
      const upload = await request(app.getHttpServer())
        .post(`/api/v1/users/${CHILD}/classes/3/sections/7/files`)
        .set(deviceAuth(deviceJwt))
        .attach('file', Buffer.from('89504e470d0a1a0a', 'hex'), {
          filename: 'photo.png',
          contentType: 'image/png',
        });
      expect(upload.status).toBe(201);
      await flush();
      // Both verified guardians got family:evidence_uploaded, once.
      const notified = sendToUser.mock.calls.filter(
        (call) => call[2] === 'family:evidence_uploaded',
      );
      expect(notified.map((call) => call[0].userId).sort()).toEqual(
        [GUARDIAN, GUARDIAN_2].sort(),
      );
      expect(notified[0][0].data).toMatchObject({
        type: 'dependent_evidence_uploaded',
        dependent_user_id: CHILD,
      });

      sendToUser.mockClear();
      const submit = await request(app.getHttpServer())
        .post(`/api/v1/users/${CHILD}/classes/3/sections/7/submit`)
        .set(deviceAuth(deviceJwt))
        .send({});
      expect(submit.status).toBe(201);
      await flush();
      // Submitting does not notify.
      expect(
        sendToUser.mock.calls.filter(
          (call) => call[2] === 'family:evidence_uploaded',
        ),
      ).toHaveLength(0);

      // 7. Push registration: own token only, remembered on the device row.
      const register = await request(app.getHttpServer())
        .post('/api/v1/users/me/fcm-tokens')
        .set(deviceAuth(deviceJwt))
        .send({ token: 'fcm-device-token', device_type: 'android' });
      expect(register.status).toBe(201);
      expect(devices[0].fcm_token_id).toBe(
        register.body.fcm_token_id ?? fcmTokens[0].fcm_token_id,
      );
      expect(fcmTokens[0]).toMatchObject({ user_id: CHILD, active: true });

      // 8. The agenda carries no attendee names, ids or RSVP map.
      const activity = await request(app.getHttpServer())
        .get('/api/v1/activities/91')
        .set(deviceAuth(deviceJwt));
      expect(activity.status).toBe(200);
      const payload = JSON.stringify(activity.body);
      expect(payload).toContain('Campamento de verano');
      expect(payload).not.toMatch(/attendee|rsvp/i);
      expect(payload).not.toContain(SIBLING);
      expect(payload).not.toContain(STRANGER);

      // 9. A guardian (an adult) still gets the full payload.
      const adultView = await request(app.getHttpServer())
        .get('/api/v1/activities/91')
        .set(bearer(GUARDIAN));
      expect(adultView.status).toBe(200);
      expect(JSON.stringify(adultView.body)).toContain(SIBLING);

      // 10. The guardian lists the device and revokes it.
      const listed = await request(app.getHttpServer())
        .get(`/api/v1/guardianships/me/dependents/${CHILD}/devices`)
        .set(bearer(GUARDIAN_2));
      expect(listed.status).toBe(200);
      expect(listed.body.data.limits).toEqual({ max_devices: 2 });
      expect(listed.body.data.devices[0]).toMatchObject({
        linked_device_id: deviceId,
        label: 'Tablet de Ana',
        status: 'active',
        paired_by_display_name: 'Mamá Pérez',
      });

      // The JWT is still unexpired (55+ minutes left): revoke cuts it anyway.
      sendToUser.mockClear();
      const revoke = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${CHILD}/devices/${deviceId}/revoke`,
        )
        .set(bearer(GUARDIAN_2));
      expect(revoke.status).toBe(200);
      expect(revoke.body.data).toMatchObject({
        linked_device_id: deviceId,
        revoked_reason: 'guardian',
      });

      const afterRevoke = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(deviceJwt));
      expect(afterRevoke.status).toBe(401);
      expect(errorCode(afterRevoke.body)).toBe('AUTH_DEVICE_REVOKED');

      // The refresh token died with the session.
      const refreshAfter = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: body.refreshToken });
      expect(refreshAfter.status).toBe(401);

      // The other guardian was told, the actor was not; the FCM token is gone.
      await flush();
      expect(fcmTokens[0].active).toBe(false);
      expect(
        sendToUser.mock.calls
          .filter((call) => call[2] === 'family:security')
          .map((call) => call[0].userId),
      ).toEqual([GUARDIAN]);

      // Revoking again is idempotent: same 200, one audit row.
      const again = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${CHILD}/devices/${deviceId}/revoke`,
        )
        .set(bearer(GUARDIAN));
      expect(again.status).toBe(200);
      expect(again.body.data.revoked_reason).toBe('guardian');
      expect(
        audits.filter((a) => a.action === 'linked_device.revoked'),
      ).toHaveLength(1);

      // The list still shows it as revoked (history).
      const history = await request(app.getHttpServer())
        .get(`/api/v1/guardianships/me/dependents/${CHILD}/devices`)
        .set(bearer(GUARDIAN));
      expect(history.body.data.devices[0]).toMatchObject({
        status: 'revoked',
        revoked_reason: 'guardian',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Pairing rules over HTTP
  // ---------------------------------------------------------------------------

  describe('B. pairing rules', () => {
    it('the token is single use: the replay is the uniform 400', async () => {
      const token = await issueToken();
      expect((await pair(token)).status).toBe(200);

      const replay = await pair(token);
      expect(replay.status).toBe(400);
      expect(errorCode(replay.body)).toBe('DEVICE_PAIRING_TOKEN_INVALID');
    });

    it('unknown, malformed and expired tokens answer the identical body', async () => {
      const expired = await issueToken();
      pairingTokens[0].expires_at = new Date(Date.now() - 1000);

      const bodies = [];
      for (const token of ['x'.repeat(22), 'short', expired]) {
        const response = await pair(token);
        expect(response.status).toBe(400);
        expect(errorCode(response.body)).toBe('DEVICE_PAIRING_TOKEN_INVALID');
        bodies.push(JSON.stringify({ ...response.body, timestamp: undefined }));
      }
      expect(
        new Set(bodies.map((b) => b.replace(/"requestId":"[^"]*"/, ''))).size,
      ).toBe(1);
    });

    it('a second token kills the first', async () => {
      const first = await issueToken();
      const second = await issueToken();

      expect((await pair(first)).status).toBe(400);
      expect((await pair(second)).status).toBe(200);
    });

    it('a 13 year old, an account holder, a stranger and a pending guardian cannot get a token', async () => {
      childBirthday = yearsAgo(13);
      await actingCache.bump(CHILD);
      let response = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${CHILD}/devices/pairing-tokens`,
        )
        .set(bearer(GUARDIAN));
      expect(response.status).toBe(422);
      expect(errorCode(response.body)).toBe('DEVICE_PAIRING_NOT_ELIGIBLE');

      childBirthday = yearsAgo(9);
      hasAccount = true;
      response = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${CHILD}/devices/pairing-tokens`,
        )
        .set(bearer(GUARDIAN));
      expect(response.status).toBe(422);
      hasAccount = false;

      response = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${CHILD}/devices/pairing-tokens`,
        )
        .set(bearer(STRANGER));
      expect(response.status).toBe(404);

      guardianships[0].consent_status = 'pending';
      response = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${CHILD}/devices/pairing-tokens`,
        )
        .set(bearer(GUARDIAN));
      expect(response.status).toBe(403);
    });

    it('the third device is 409 DEVICE_LIMIT_REACHED {max_devices: 2}', async () => {
      await pairDevice();
      await pairDevice();

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${CHILD}/devices/pairing-tokens`,
        )
        .set(bearer(GUARDIAN));
      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('DEVICE_LIMIT_REACHED');
    });

    it('a label with markup or 500 characters is sanitized, never a 500', async () => {
      const token = await issueToken();
      const response = await pair(token, {
        label: `<script>alert(1)</script>${'x'.repeat(475)}`,
      });

      expect(response.status).toBe(200);
      expect(response.body.data.device.label).not.toMatch(/[<>]/);
      expect(response.body.data.device.label.length).toBeLessThanOrEqual(40);
    });

    it('a device of another family is 404 DEVICE_NOT_FOUND for the revoke', async () => {
      const { deviceId } = await pairDevice();
      guardianships.push({
        guardianship_id: '00000000-0000-4000-8000-0000000000e9',
        dependent_user_id: SIBLING,
        guardian_user_id: STRANGER,
        consent_status: 'verified',
        is_primary: true,
        is_custodian: false,
        is_test_data: false,
      });

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${SIBLING}/devices/${deviceId}/revoke`,
        )
        .set(bearer(STRANGER));
      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('DEVICE_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // Token handling
  // ---------------------------------------------------------------------------

  describe('C. device token handling', () => {
    it('refresh gives a DEVICE JWT (never an access one) and blacklists the old one', async () => {
      const { accessToken, refreshToken } = await pairDevice();

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set(deviceAuth(accessToken))
        .send({ refreshToken });

      expect(refreshed.status).toBe(200);
      const next = refreshed.body.data.accessToken as string;
      expect(next).not.toBe(accessToken);
      const claims = jwtService.decode<Record<string, any>>(next);
      expect(claims.aud).toBe('sacdia:device');
      expect(claims.sub).toBe(CHILD);

      // The old device JWT is blacklisted by the refresh.
      const old = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(accessToken));
      expect(old.status).toBe(401);

      const fresh = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(next));
      expect(fresh.status).toBe(200);
    });

    it('a device session refresh is capped at the absolute expiry (past it: AUTH_DEVICE_SESSION_EXPIRED)', async () => {
      const { refreshToken } = await pairDevice();
      devices[0].absolute_expires_at = new Date(Date.now() - 1000);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(401);
      expect(errorCode(response.body)).toBe('AUTH_DEVICE_SESSION_EXPIRED');
    });

    it('logging out with the device refresh token revokes the device (device_logout)', async () => {
      const { accessToken, refreshToken, deviceId } = await pairDevice();

      const logout = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(deviceAuth(accessToken))
        .send({ refreshToken });
      expect(logout.status).toBe(200);

      await flush();
      const row = devices.find((d) => d.linked_device_id === deviceId);
      expect(row?.revoked_reason).toBe('device_logout');
      expect(sessions).toHaveLength(0);
    });

    it('a forged token is rejected: wrong signature, alg none, audience array, both audiences, access token with a spoofed dev claim', async () => {
      const { deviceId } = await pairDevice();
      const claims = {
        sub: CHILD,
        sid: sessions[0].id,
        dev: deviceId,
        iss: 'https://api.sacdia.app',
      };
      const forged = new JwtService({
        secret: 'another-secret-0123456789abcdef0123',
      });
      const cases: Array<[string, string]> = [
        [
          'wrong signature',
          forged.sign({ ...claims, aud: 'sacdia:device' }, { expiresIn: '1h' }),
        ],
        [
          'alg none',
          `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
            JSON.stringify({ ...claims, aud: 'sacdia:device' }),
          ).toString('base64url')}.`,
        ],
        [
          'aud array',
          jwtService.sign(
            { ...claims, aud: ['sacdia:device'] },
            { expiresIn: '1h' },
          ),
        ],
        [
          'both audiences',
          jwtService.sign(
            { ...claims, aud: ['sacdia:access', 'sacdia:device'] },
            { expiresIn: '1h' },
          ),
        ],
        [
          'qr audience',
          jwtService.sign(
            { ...claims, aud: 'sacdia:qr-member' },
            { expiresIn: '1h' },
          ),
        ],
      ];
      for (const [label, token] of cases) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/auth/me')
          .set(deviceAuth(token));
        expect({ label, status: response.status }).toEqual({
          label,
          status: 401,
        });
      }

      // An ACCESS token that claims to be a device stays a plain `user`.
      const spoofed = jwtService.sign(
        {
          sub: GUARDIAN,
          email: 'g@test.local',
          iss: 'https://api.sacdia.app',
          aud: 'sacdia:access',
          dev: deviceId,
          sid: 'x',
        },
        { expiresIn: '1h' },
      );
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(spoofed));
      expect(me.status).toBe(200);
      expect((me.body.data ?? me.body).principal.kind).toBe('user');
    });

    it('a device token whose session is a user session (or absent) is 401', async () => {
      const { deviceId } = await pairDevice();
      const token = jwtService.sign(
        {
          sub: CHILD,
          sid: 'a-session-that-does-not-exist',
          dev: deviceId,
          iss: 'https://api.sacdia.app',
          aud: 'sacdia:device',
        },
        { expiresIn: '1h' },
      );

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(token));

      expect(response.status).toBe(401);
      expect(errorCode(response.body)).toBe('AUTH_DEVICE_REVOKED');
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-revoke through the real container
  // ---------------------------------------------------------------------------

  describe('D. auto revoke', () => {
    it("the pairing guardian leaves: their device is revoked (guardianship_revoked), the other guardian's device stays and can re-pair", async () => {
      const first = await pairDevice(GUARDIAN);
      const second = await pairDevice(GUARDIAN_2);

      const leave = await request(app.getHttpServer())
        .post(`/api/v1/guardianships/${GS_1}/revoke`)
        .set(bearer(GUARDIAN))
        .send({ reason: 'guardian_left' });
      expect(leave.status).toBe(200);
      expect(leave.body.data.dependent_outcome).toBe('other_guardian');

      const revoked = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(first.accessToken));
      expect(revoked.status).toBe(401);
      expect(errorCode(revoked.body)).toBe('AUTH_DEVICE_REVOKED');
      expect(
        devices.find((d) => d.linked_device_id === first.deviceId),
      ).toMatchObject({ revoked_reason: 'guardianship_revoked' });

      const stays = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(second.accessToken));
      expect(stays.status).toBe(200);

      // G2 can re-pair a new phone.
      const repaired = await pairDevice(GUARDIAN_2);
      expect(repaired.deviceId).not.toBe(first.deviceId);
    });

    it('the child turns of age: the next request is 401 (majority), the row records why', async () => {
      const { accessToken, deviceId } = await pairDevice();
      childBirthday = yearsAgo(19);
      await actingCache.bump(CHILD);

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(accessToken));
      expect(response.status).toBe(401);

      await flush();
      expect(
        devices.find((d) => d.linked_device_id === deviceId)?.revoked_reason,
      ).toBe('majority');
    });

    it('the child turning 13 does NOT revoke an existing device', async () => {
      const { accessToken } = await pairDevice();
      childBirthday = yearsAgo(13);
      await actingCache.bump(CHILD);

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(accessToken));
      expect(response.status).toBe(200);
    });

    it('the pairing guardianship stops being verified: the device is cut on the next request', async () => {
      const { accessToken } = await pairDevice(GUARDIAN);
      guardianships[0].consent_status = 'pending';
      await actingCache.bump(CHILD);

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(accessToken));
      expect(response.status).toBe(401);
      expect(errorCode(response.body)).toBe('AUTH_DEVICE_REVOKED');
    });
  });

  // ---------------------------------------------------------------------------
  // Kill switch
  // ---------------------------------------------------------------------------

  describe('E. FAMILY_LINKED_DEVICE_ENABLED', () => {
    it('off: existing device tokens are 401 AUTH_DEVICE_REVOKED, pairing is the uniform 400, creating a token is 404 FAMILY_FEATURE_DISABLED', async () => {
      const { accessToken } = await pairDevice();
      const token = await issueToken();

      setLinkedDeviceFlag(false);

      const device = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(accessToken));
      expect(device.status).toBe(401);
      expect(errorCode(device.body)).toBe('AUTH_DEVICE_REVOKED');

      const redeem = await pair(token);
      expect(redeem.status).toBe(400);
      expect(errorCode(redeem.body)).toBe('DEVICE_PAIRING_TOKEN_INVALID');

      const issue = await request(app.getHttpServer())
        .post(
          `/api/v1/guardianships/me/dependents/${CHILD}/devices/pairing-tokens`,
        )
        .set(bearer(GUARDIAN));
      expect(issue.status).toBe(404);
      expect(errorCode(issue.body)).toBe('FAMILY_FEATURE_DISABLED');

      // No data changed: the device row is untouched and works again with the flag back.
      expect(devices[0].revoked_at).toBeNull();
      setLinkedDeviceFlag(true);
      const back = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(deviceAuth(accessToken));
      expect(back.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // FP3-45: a device only ever acts on its OWN child
  // ---------------------------------------------------------------------------

  describe('F. a linked device cannot touch a sibling (same guardian) evidence', () => {
    // The suite passes RBAC through globally. Here the REAL PermissionsGuard
    // must run: the owner rule (`ownerParam: userId`) is the only thing that
    // keeps a device of child A away from child B's userId. The env flag is
    // read on every request, so flipping it is enough.
    let previousPassthrough: string | undefined;
    let authContext: { resolveUserAuthorization: jest.Mock };
    let originalResolve: jest.Mock;
    let classes: { uploadSectionFile: jest.Mock; submitSection: jest.Mock };

    beforeAll(() => {
      previousPassthrough = process.env.E2E_PASSTHROUGH_PERMISSIONS;
      delete process.env.E2E_PASSTHROUGH_PERMISSIONS;

      authContext = moduleRef.get<unknown, typeof authContext>(
        AuthorizationContextService,
        { strict: false },
      );
      originalResolve = authContext.resolveUserAuthorization;
      // What the child really holds: ONLY the base `user` role (own data
      // grants), no club role, no direct permission. It is the same snapshot
      // for any userId the guard asks about, exactly like production for an
      // account that has no other grant.
      authContext.resolveUserAuthorization = jest.fn(async (userId: string) => {
        const base = await originalResolve(userId);
        return {
          ...base,
          authorization: buildAuthorizationSnapshot({
            globalRoleName: 'user',
            globalPermissions: ['classes:read', 'classes:submit_progress'],
            assignmentId: null,
          }),
        };
      });
      classes = moduleRef.get<unknown, typeof classes>(ClassesService, {
        strict: false,
      });
    });

    afterAll(() => {
      authContext.resolveUserAuthorization = originalResolve;
      if (previousPassthrough === undefined) {
        delete process.env.E2E_PASSTHROUGH_PERMISSIONS;
      } else {
        process.env.E2E_PASSTHROUGH_PERMISSIONS = previousPassthrough;
      }
    });

    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const upload = (path: string, token: string) =>
      request(app.getHttpServer())
        .post(path)
        .set(deviceAuth(token))
        .attach('file', png, {
          filename: 'photo.png',
          contentType: 'image/png',
        });

    it("control: the guard is real, so the device's OWN userId is allowed (upload 201, submit 201)", async () => {
      const { accessToken } = await pairDevice();
      classes.uploadSectionFile.mockClear();
      classes.submitSection.mockClear();

      const ok = await upload(
        `/api/v1/users/${CHILD}/classes/3/sections/7/files`,
        accessToken,
      );
      expect(ok.status).toBe(201);
      const submitted = await request(app.getHttpServer())
        .post(`/api/v1/users/${CHILD}/classes/3/sections/7/submit`)
        .set(deviceAuth(accessToken))
        .send({});
      expect(submitted.status).toBe(201);
      expect(uploadCalls).toBe(1);
      expect(classes.submitSection).toHaveBeenCalledTimes(1);
    });

    it("the device of child A is 403 GUARD_PERMISSION_DENIED on child B's upload, submit, delete and enrollments, and nothing is written or notified", async () => {
      const { accessToken } = await pairDevice();
      sendToUser.mockClear();
      classes.uploadSectionFile.mockClear();
      classes.submitSection.mockClear();

      const attempts: Array<[string, string, () => request.Test]> = [
        [
          'upload',
          `/users/${SIBLING}/classes/3/sections/7/files`,
          () =>
            upload(
              `/api/v1/users/${SIBLING}/classes/3/sections/7/files`,
              accessToken,
            ),
        ],
        [
          'upload with a guessed enrollmentId',
          `/users/${SIBLING}/classes/3/sections/7/files?enrollmentId=1`,
          () =>
            upload(
              `/api/v1/users/${SIBLING}/classes/3/sections/7/files?enrollmentId=1`,
              accessToken,
            ),
        ],
        [
          'submit',
          `/users/${SIBLING}/classes/3/sections/7/submit`,
          () =>
            request(app.getHttpServer())
              .post(`/api/v1/users/${SIBLING}/classes/3/sections/7/submit`)
              .set(deviceAuth(accessToken))
              .send({}),
        ],
        [
          'delete file',
          `/users/${SIBLING}/classes/3/sections/7/files/55`,
          () =>
            request(app.getHttpServer())
              .delete(`/api/v1/users/${SIBLING}/classes/3/sections/7/files/55`)
              .set(deviceAuth(accessToken)),
        ],
        [
          'enrollments read',
          `/users/${SIBLING}/classes`,
          () =>
            request(app.getHttpServer())
              .get(`/api/v1/users/${SIBLING}/classes`)
              .set(deviceAuth(accessToken)),
        ],
      ];

      for (const [label, path, send] of attempts) {
        const denied = await send();
        expect({ label, path, status: denied.status }).toEqual({
          label,
          path,
          status: 403,
        });
        expect({ label, code: errorCode(denied.body) }).toEqual({
          label,
          code: 'GUARD_PERMISSION_DENIED',
        });
      }

      await flush();
      // No write: the (stubbed) service layer was never reached, so no file,
      // no submission and no guardian notification exist for the sibling.
      expect(uploadCalls).toBe(0);
      expect(classes.uploadSectionFile).not.toHaveBeenCalled();
      expect(classes.submitSection).not.toHaveBeenCalled();
      expect(
        sendToUser.mock.calls.filter(
          (call) => call[2] === 'family:evidence_uploaded',
        ),
      ).toHaveLength(0);
    });

    it('a guardian-side id is no way in either: the device is also denied on its own guardian and on a stranger as the path userId', async () => {
      const { accessToken } = await pairDevice();
      for (const other of [GUARDIAN, STRANGER]) {
        const denied = await upload(
          `/api/v1/users/${other}/classes/3/sections/7/files`,
          accessToken,
        );
        expect(denied.status).toBe(403);
        expect(errorCode(denied.body)).toBe('GUARD_PERMISSION_DENIED');
      }
      expect(uploadCalls).toBe(0);
    });
  });

  it('the real container binds LINKED_DEVICE_REVOKER to the REAL LinkedDevicesService (no no-op)', () => {
    const revoker = moduleRef.get(LINKED_DEVICE_REVOKER, { strict: false });
    expect(revoker).toBe(
      moduleRef.get(LinkedDevicesService, { strict: false }),
    );
    expect(revoker).not.toBe(NOOP_LINKED_DEVICE_REVOKER);
  });
});
