import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client, Pool } from 'pg';
import {
  BetterAuthService,
  DEVICE_SESSION_DURATION_MS,
} from '../../better-auth/better-auth.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * The device session path against REAL PostgreSQL: the hand-written join that
 * tells a device session from a user one (`findLinkedDeviceOfSession`) and the
 * single-statement `UPDATE sessions ... RETURNING` that slides the session
 * (`refreshSession`). The unit specs mock `$queryRaw`, so nothing there proves
 * the SQL itself (join keys, the timestamp/timestamptz mix, `LEAST`-style
 * capping done in JS) behaves as the comments claim.
 *
 * Harness: same env gate as the other `*.postgres.spec.ts` suites (CI's unit
 * job provides the Postgres service). A random schema holds the tables, built
 * from the REAL migrations (`sessions` from wave3, `linked_devices` from
 * family_linked_devices) plus two stub parents, and a REAL PrismaClient on the
 * `@prisma/adapter-pg` driver (the production wiring) runs the service, so the
 * Prisma parameter serialisation and result mapping are exercised too.
 * Production (Neon) runs with TimeZone=UTC; the pool pins it so the suite does
 * not depend on the server's default.
 */
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const enabled =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && !!databaseUrl;
const pgDescribe = enabled ? describe : describe.skip;

if (enabled && databaseUrl) {
  const host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('LINKED_DEVICE_REFRESH_TEST_DATABASE_MUST_BE_LOOPBACK');
  }
}

const MIGRATIONS = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
const wave3 = readFileSync(
  join(MIGRATIONS, '20260322225442_wave3_better_auth_schema', 'migration.sql'),
  'utf8',
);
const familyDevices = readFileSync(
  join(MIGRATIONS, '20261021120000_family_linked_devices', 'migration.sql'),
  'utf8',
);
const sessionsDdl = wave3.match(/CREATE TABLE "sessions" \([\s\S]*?\n\);/)?.[0];
const sessionsFk = wave3.match(
  /ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"[^;]*;/,
)?.[0];
// Only the `linked_devices` table and its indexes: the rest of the migration
// touches tables this suite does not need.
const linkedDevicesDdl = familyDevices.slice(
  familyDevices.indexOf('CREATE TABLE IF NOT EXISTS linked_devices'),
  familyDevices.indexOf('CREATE TABLE IF NOT EXISTS device_pairing_tokens'),
);

const DAY_MS = 24 * 60 * 60 * 1000;
const CHILD = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const OTHER_CHILD = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const GUARDIAN = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const GUARDIANSHIP = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';

type SeedDevice = {
  token: string;
  sessionId: string;
  deviceId: string;
};

pgDescribe('device session refresh against real PostgreSQL', () => {
  const schema = `ld_refresh_${randomBytes(6).toString('hex')}`;
  let admin: Client;
  let pool: Pool;
  let prisma: PrismaClient;
  let service: BetterAuthService;

  const sessionExpiry = async (sessionId: string): Promise<Date | null> => {
    // `sessions.expires_at` is a plain `timestamp(3)`: read it as epoch so the
    // node-pg "naive timestamp = local time" parsing cannot skew the value.
    const { rows } = await admin.query(
      `SELECT (extract(epoch FROM expires_at) * 1000)::float8 AS ms
         FROM sessions WHERE id = $1`,
      [sessionId],
    );
    return rows[0] ? new Date(rows[0].ms) : null;
  };

  const sessionUpdatedAt = async (sessionId: string) =>
    (
      await admin.query(
        'SELECT updated_at::text AS value FROM sessions WHERE id = $1',
        [sessionId],
      )
    ).rows[0]?.value;

  /** A session row plus (optionally) the linked_devices row that makes it a device. */
  const seed = async (opts: {
    dependent?: string;
    sessionExpiresAt?: Date;
    device?: {
      absoluteExpiresAt: Date;
      revokedAt?: Date;
    } | null;
  }): Promise<SeedDevice> => {
    const sessionId = `sid-${randomUUID()}`;
    const token = `tok-${randomUUID()}`;
    const deviceId = randomUUID();
    const dependent = opts.dependent ?? CHILD;
    await admin.query(
      `INSERT INTO sessions (id, expires_at, token, updated_at, user_id)
       VALUES ($1, $2::timestamptz AT TIME ZONE 'UTC', $3, now(), $4)`,
      [
        sessionId,
        (opts.sessionExpiresAt ?? new Date(Date.now() + DAY_MS)).toISOString(),
        token,
        dependent,
      ],
    );
    if (opts.device) {
      await admin.query(
        `INSERT INTO linked_devices (
           linked_device_id, dependent_user_id, guardianship_id, paired_by_user_id,
           session_id, label, platform, paired_at, absolute_expires_at,
           revoked_at, revoked_reason)
         VALUES ($1, $2, $3, $4, $5, 'Tablet', 'android', $6, $7, $8, $9)`,
        [
          deviceId,
          dependent,
          GUARDIANSHIP,
          GUARDIAN,
          sessionId,
          new Date(Date.now() - 400 * DAY_MS),
          opts.device.absoluteExpiresAt,
          opts.device.revokedAt ?? null,
          opts.device.revokedAt ? 'guardian' : null,
        ],
      );
    }
    return { token, sessionId, deviceId };
  };

  const refreshError = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as { getResponse?: () => unknown; message?: string };
    }
    throw new Error('expected the refresh to be rejected');
  };

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    if (!sessionsDdl || !sessionsFk || !linkedDevicesDdl) {
      throw new Error('migration DDL not found');
    }
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path = ${schema}`);
    await admin.query(`
      CREATE TABLE users (
        user_id uuid PRIMARY KEY,
        email varchar(100),
        name varchar(50),
        email_verified boolean NOT NULL DEFAULT false,
        user_image text,
        created_at timestamptz NOT NULL DEFAULT now(),
        modified_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE guardianships (guardianship_id uuid PRIMARY KEY);
      INSERT INTO users (user_id, email, name) VALUES
        ('${CHILD}', NULL, 'Child'),
        ('${OTHER_CHILD}', NULL, 'Other child'),
        ('${GUARDIAN}', 'g@example.test', 'Guardian');
      INSERT INTO guardianships VALUES ('${GUARDIANSHIP}');
    `);
    await admin.query(sessionsDdl);
    await admin.query(sessionsFk);
    await admin.query(linkedDevicesDdl);

    pool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      options: `-c search_path=${schema} -c TimeZone=UTC`,
    });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    service = new BetterAuthService(
      new JwtService({ secret: 'test-secret-min-32-chars-for-hs256-hmac' }),
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma?.$disconnect();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  describe('findLinkedDeviceOfSession', () => {
    it('finds the device of the session token, with real Date values for both timestamptz columns', async () => {
      const cap = new Date(Date.now() + 60 * DAY_MS);
      const device = await seed({ device: { absoluteExpiresAt: cap } });

      const found = await service.findLinkedDeviceOfSession(device.token);

      expect(found).toEqual({
        sessionId: device.sessionId,
        linkedDeviceId: device.deviceId,
        dependentUserId: CHILD,
        revokedAt: null,
        absoluteExpiresAt: cap,
      });
    });

    it('resolves the right device when the same child has several (one session each)', async () => {
      const a = await seed({
        device: { absoluteExpiresAt: new Date(Date.now() + 10 * DAY_MS) },
      });
      const b = await seed({
        device: { absoluteExpiresAt: new Date(Date.now() + 20 * DAY_MS) },
      });

      const foundA = await service.findLinkedDeviceOfSession(a.token);
      const foundB = await service.findLinkedDeviceOfSession(b.token);

      expect(foundA?.linkedDeviceId).toBe(a.deviceId);
      expect(foundB?.linkedDeviceId).toBe(b.deviceId);
    });

    it('does not mix up the devices of two different dependents', async () => {
      const mine = await seed({
        dependent: CHILD,
        device: { absoluteExpiresAt: new Date(Date.now() + 10 * DAY_MS) },
      });
      const theirs = await seed({
        dependent: OTHER_CHILD,
        device: { absoluteExpiresAt: new Date(Date.now() + 10 * DAY_MS) },
      });

      expect(
        (await service.findLinkedDeviceOfSession(mine.token))?.dependentUserId,
      ).toBe(CHILD);
      expect(
        (await service.findLinkedDeviceOfSession(theirs.token))
          ?.dependentUserId,
      ).toBe(OTHER_CHILD);
    });

    it('is null for a plain user session (no linked_devices row) and for an unknown token', async () => {
      const userSession = await seed({ dependent: GUARDIAN, device: null });

      await expect(
        service.findLinkedDeviceOfSession(userSession.token),
      ).resolves.toBeNull();
      await expect(
        service.findLinkedDeviceOfSession('tok-does-not-exist'),
      ).resolves.toBeNull();
    });

    it('does NOT filter by state: a revoked or capped device is still returned, with the facts the caller gates on', async () => {
      const revokedAt = new Date(Date.now() - 2 * DAY_MS);
      const capped = new Date(Date.now() - DAY_MS);
      const revoked = await seed({
        device: {
          absoluteExpiresAt: new Date(Date.now() + 5 * DAY_MS),
          revokedAt,
        },
      });
      const expired = await seed({ device: { absoluteExpiresAt: capped } });

      await expect(
        service.findLinkedDeviceOfSession(revoked.token),
      ).resolves.toMatchObject({
        linkedDeviceId: revoked.deviceId,
        revokedAt,
      });
      await expect(
        service.findLinkedDeviceOfSession(expired.token),
      ).resolves.toMatchObject({
        linkedDeviceId: expired.deviceId,
        revokedAt: null,
        absoluteExpiresAt: capped,
      });
    });

    it('is null once the session row is gone, even though the revoked device row stays (revocation hard-deletes the session)', async () => {
      const device = await seed({
        device: { absoluteExpiresAt: new Date(Date.now() + 5 * DAY_MS) },
      });
      await admin.query('DELETE FROM sessions WHERE id = $1', [
        device.sessionId,
      ]);

      await expect(
        service.findLinkedDeviceOfSession(device.token),
      ).resolves.toBeNull();
    });
  });

  describe('refreshSession of a device session', () => {
    it('slides expires_at 30 days when the absolute cap is further away', async () => {
      const device = await seed({
        sessionExpiresAt: new Date(Date.now() + DAY_MS),
        device: { absoluteExpiresAt: new Date(Date.now() + 90 * DAY_MS) },
      });

      const before = Date.now();
      const result = await service.refreshSession(device.token);
      const after = Date.now();

      const stored = (await sessionExpiry(device.sessionId))!.getTime();
      expect(stored).toBeGreaterThanOrEqual(
        before + DEVICE_SESSION_DURATION_MS - 1,
      );
      expect(stored).toBeLessThanOrEqual(after + DEVICE_SESSION_DURATION_MS);
      expect(result.session.id).toBe(device.sessionId);
      expect(result.session.expiresAt.getTime()).toBe(stored);
      expect(result.user.id).toBe(CHILD);
    });

    it('caps expires_at at absolute_expires_at when fewer than 30 days remain', async () => {
      const cap = new Date(Date.now() + 10 * DAY_MS);
      const device = await seed({ device: { absoluteExpiresAt: cap } });

      await service.refreshSession(device.token);

      expect((await sessionExpiry(device.sessionId))!.getTime()).toBe(
        cap.getTime(),
      );
    });

    it('never moves past the cap however often it refreshes', async () => {
      const cap = new Date(Date.now() + 40 * DAY_MS);
      const device = await seed({ device: { absoluteExpiresAt: cap } });

      for (let i = 0; i < 3; i += 1) {
        await service.refreshSession(device.token);
        expect(
          (await sessionExpiry(device.sessionId))!.getTime(),
        ).toBeLessThanOrEqual(cap.getTime());
      }
    });

    it('signs a device JWT for the dependent and touches only the refreshed session', async () => {
      const mine = await seed({
        device: { absoluteExpiresAt: new Date(Date.now() + 90 * DAY_MS) },
      });
      const sibling = await seed({
        device: { absoluteExpiresAt: new Date(Date.now() + 90 * DAY_MS) },
      });
      const siblingExpiry = await sessionExpiry(sibling.sessionId);
      const siblingUpdated = await sessionUpdatedAt(sibling.sessionId);

      const result = await service.refreshSession(mine.token);

      const claims = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
      }).decode(result.accessToken);
      expect(claims).toMatchObject({
        sub: CHILD,
        sid: mine.sessionId,
        dev: mine.deviceId,
      });
      expect(await sessionExpiry(sibling.sessionId)).toEqual(siblingExpiry);
      expect(await sessionUpdatedAt(sibling.sessionId)).toBe(siblingUpdated);
    });

    it('refuses a revoked device before sliding: AUTH_DEVICE_REVOKED and the row is unchanged', async () => {
      const device = await seed({
        device: {
          absoluteExpiresAt: new Date(Date.now() + 90 * DAY_MS),
          revokedAt: new Date(Date.now() - DAY_MS),
        },
      });
      const expiry = await sessionExpiry(device.sessionId);
      const updatedAt = await sessionUpdatedAt(device.sessionId);

      const error = await refreshError(service.refreshSession(device.token));

      expect(JSON.stringify(error.getResponse?.())).toContain(
        ErrorCode.AUTH_DEVICE_REVOKED,
      );
      expect(await sessionExpiry(device.sessionId)).toEqual(expiry);
      expect(await sessionUpdatedAt(device.sessionId)).toBe(updatedAt);
    });

    it('refuses a device past its absolute cap: AUTH_DEVICE_SESSION_EXPIRED and the row is unchanged', async () => {
      const device = await seed({
        device: { absoluteExpiresAt: new Date(Date.now() - 1000) },
      });
      const expiry = await sessionExpiry(device.sessionId);
      const updatedAt = await sessionUpdatedAt(device.sessionId);

      const error = await refreshError(service.refreshSession(device.token));

      expect(JSON.stringify(error.getResponse?.())).toContain(
        ErrorCode.AUTH_DEVICE_SESSION_EXPIRED,
      );
      expect(await sessionExpiry(device.sessionId)).toEqual(expiry);
      expect(await sessionUpdatedAt(device.sessionId)).toBe(updatedAt);
    });

    it('a device whose session was hard-deleted (what revocation does) cannot refresh: the session is gone', async () => {
      const device = await seed({
        device: { absoluteExpiresAt: new Date(Date.now() + 90 * DAY_MS) },
      });
      await admin.query('DELETE FROM sessions WHERE id = $1', [
        device.sessionId,
      ]);

      const error = await refreshError(service.refreshSession(device.token));

      expect(JSON.stringify(error.getResponse?.())).toContain(
        ErrorCode.AUTH_SESSION_EXPIRED,
      );
    });

    it('does not slide a session whose own expires_at already passed (the UPDATE is conditional on it) and deletes it', async () => {
      const device = await seed({
        sessionExpiresAt: new Date(Date.now() - 60 * 1000),
        device: { absoluteExpiresAt: new Date(Date.now() + 90 * DAY_MS) },
      });
      const expiry = (await sessionExpiry(device.sessionId))!;

      const error = await refreshError(service.refreshSession(device.token));

      expect(JSON.stringify(error.getResponse?.())).toContain(
        ErrorCode.AUTH_SESSION_EXPIRED,
      );
      // The clean-up is fire-and-forget: wait for it, never for a slide.
      let remaining = await sessionExpiry(device.sessionId);
      for (let i = 0; i < 40 && remaining !== null; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        remaining = await sessionExpiry(device.sessionId);
      }
      expect(remaining).toBeNull();
      expect(expiry.getTime()).toBeLessThan(Date.now());
    });
  });
});
