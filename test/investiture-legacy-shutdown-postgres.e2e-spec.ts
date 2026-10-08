/**
 * Fase 8 — vía club → coordinación → campo apagada.
 * AppModule real sobre PostgreSQL descartable: JWT y permisos reales;
 * BetterAuth y el cron de year-cut simulados (bootstrapAnnualCycleApp).
 * El throttler corre con los límites de NODE_ENV=test: cada request espera 550 ms.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { JwtService } from '@nestjs/jwt';
import type { Client } from 'pg';
import request from 'supertest';
import { InvestitureService } from '../src/investiture/investiture.service';
import { ValidationService } from '../src/validation/validation.service';
import {
  bootstrapAnnualCycleApp,
  prepareAnnualCycleDatabase,
  withClient,
} from './helpers/annual-cycle-db.helper';
import {
  assertServerLogHasWarningMarker,
  requireInvestitureServerLogPath,
} from './helpers/investiture-server-log';
import {
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

jest.setTimeout(240000);

const SUPER_ADMIN = '81818181-8181-4181-8181-818181818181';
const ADMIN = '82828282-8282-4282-8282-828282828282';
const OPEN = [
  'SUBMITTED_FOR_VALIDATION',
  'CLUB_APPROVED',
  'COORDINATOR_APPROVED',
  'FIELD_APPROVED',
  'APPROVED',
] as const;
type OpenStatus = (typeof OPEN)[number];

type Fixture = {
  open: Record<OpenStatus, number>;
  pendingLocked: number;
  legacyInvested: number;
  certificate: number;
  inProgress: number;
  certificateMember: string;
};

const pace = () => new Promise((resolve) => setTimeout(resolve, 550));

async function insertUser(client: Client, email: string, userId?: string) {
  const row = await client.query<{ user_id: string }>(
    userId
      ? `INSERT INTO users (user_id, email, name, active, approval_status)
         VALUES ($2, $1, 'Fase8', true, 'approved') RETURNING user_id`
      : `INSERT INTO users (email, name, active, approval_status)
         VALUES ($1, 'Fase8', true, 'approved') RETURNING user_id`,
    userId ? [email, userId] : [email],
  );
  return row.rows[0].user_id;
}

async function insertEnrollment(
  client: Client,
  input: {
    userId: string;
    classId: number;
    yearId: number;
    status: string;
    locked: boolean;
    kind?: 'OPERATIONAL' | 'HISTORICAL_CERTIFICATE';
  },
) {
  const row = await client.query<{ enrollment_id: number }>(
    `INSERT INTO enrollments (
       user_id, class_id, ecclesiastical_year_id, investiture_status,
       locked_for_validation, submitted_for_validation, record_kind, active
     )
     VALUES ($1, $2, $3, $4::investiture_status_enum, $5, $6,
             $7::enrollment_record_kind, true)
     RETURNING enrollment_id`,
    [
      input.userId,
      input.classId,
      input.yearId,
      input.status,
      input.locked,
      (OPEN as readonly string[]).includes(input.status),
      input.kind ?? 'OPERATIONAL',
    ],
  );
  return row.rows[0].enrollment_id;
}

describe('fase 8: vía anterior de investidura apagada (PostgreSQL + HTTP)', () => {
  let app: Awaited<ReturnType<typeof bootstrapAnnualCycleApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootstrapAnnualCycleApp>>['prisma'];
  let jwt: JwtService;
  let fx: Fixture;
  // Posición del log del servidor al empezar: solo se revisa lo que escribió esta suite.
  let serverLog: { path: string; offset: number };

  const bearer = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(jwt, userId)}`,
  });

  async function releaseLocks(userId: string, body: Record<string, unknown>) {
    await pace();
    return request(app.getHttpServer())
      .post('/api/v1/admin/investiture/legacy-locks/release')
      .set(bearer(userId))
      .send(body);
  }

  async function locks(ids: number[]) {
    const rows = await prisma.enrollments.findMany({
      where: { enrollment_id: { in: ids } },
      select: {
        enrollment_id: true,
        investiture_status: true,
        locked_for_validation: true,
        submitted_for_validation: true,
      },
      orderBy: { enrollment_id: 'asc' },
    });
    return rows;
  }

  beforeAll(async () => {
    const url = await prepareAnnualCycleDatabase();
    // Helper existente: falla si SACDIA_POSTGRES_SERVER_LOG falta o si el log no
    // es de este servidor (marcador WARNING). Sin eso un log vacío "pasaría".
    const logPath = requireInvestitureServerLogPath();
    const marker = `sacdia-pg-warning-${randomUUID()}`;
    await withClient(url, (client) =>
      client.query(`DO $$ BEGIN RAISE WARNING '${marker}'; END $$;`),
    );
    assertServerLogHasWarningMarker(logPath, marker);
    serverLog = { path: logPath, offset: statSync(logPath).size };
    fx = await withClient(url, async (client) => {
      await client.query(`
        INSERT INTO roles (role_name, description, role_category, active)
        VALUES ('super-admin', 'Super admin', 'GLOBAL', true),
               ('admin', 'Admin', 'GLOBAL', true)
        ON CONFLICT (role_name) DO NOTHING
      `);
      await insertUser(client, 'super@fase8.test', SUPER_ADMIN);
      await insertUser(client, 'admin@fase8.test', ADMIN);
      for (const [userId, role] of [
        [SUPER_ADMIN, 'super-admin'],
        [ADMIN, 'admin'],
      ] as const) {
        await client.query(
          `INSERT INTO users_roles (user_id, role_id, active)
           SELECT $1, role_id, true FROM roles WHERE role_name = $2`,
          [userId, role],
        );
      }
      const clubType = await client.query<{ club_type_id: number }>(
        `INSERT INTO club_types (name, active) VALUES ('Conquistadores F8', true)
         RETURNING club_type_id`,
      );
      const year = await client.query<{ year_id: number }>(
        `INSERT INTO ecclesiastical_years (start_date, end_date, active)
         VALUES ('2026-01-01', '2026-12-31', true) RETURNING year_id`,
      );
      const klass = await client.query<{ class_id: number }>(
        `INSERT INTO classes (name, active, club_type_id, minimum_age, min_duration_years, max_duration_years)
         VALUES ('Amigo F8', true, $1, 10, 1, 1) RETURNING class_id`,
        [clubType.rows[0].club_type_id],
      );
      const classId = klass.rows[0].class_id;
      const yearId = year.rows[0].year_id;

      const open = {} as Record<OpenStatus, number>;
      let n = 0;
      for (const status of OPEN) {
        const member = await insertUser(client, `m${(n += 1)}@fase8.test`);
        open[status] = await insertEnrollment(client, {
          userId: member,
          classId,
          yearId,
          status,
          locked: true,
        });
        await client.query(
          `INSERT INTO investiture_validation_history (enrollment_id, action, performed_by, comments)
           VALUES ($1, 'SUBMITTED', $2, 'expediente anterior')`,
          [open[status], ADMIN],
        );
      }
      const pendingMember = await insertUser(client, 'pending@fase8.test');
      const pendingLocked = await insertEnrollment(client, {
        userId: pendingMember,
        classId,
        yearId,
        status: 'CLUB_APPROVED',
        locked: true,
      });
      const req = await client.query<{ request_id: string }>(
        `INSERT INTO investiture_authorization_requests (club_section_id, ecclesiastical_year_id, created_by_id)
         VALUES (1, $1, $2) RETURNING request_id`,
        [yearId, ADMIN],
      );
      await client.query(
        `INSERT INTO investiture_authorization_people
           (request_id, user_id, class_id, enrollment_id, investiture_date, status, single_slot)
         VALUES ($1, $2, $3, $4, '2026-11-15', 'PENDING', false)`,
        [req.rows[0].request_id, pendingMember, classId, pendingLocked],
      );
      const legacyInvested = await insertEnrollment(client, {
        userId: await insertUser(client, 'invested@fase8.test'),
        classId,
        yearId,
        status: 'INVESTIDO',
        locked: true,
      });
      const certificateMember = await insertUser(
        client,
        'certificate@fase8.test',
      );
      const certificate = await insertEnrollment(client, {
        userId: certificateMember,
        classId,
        yearId,
        status: 'INVESTIDO',
        locked: true,
        kind: 'HISTORICAL_CERTIFICATE',
      });
      const inProgress = await insertEnrollment(client, {
        userId: await insertUser(client, 'new@fase8.test'),
        classId,
        yearId,
        status: 'IN_PROGRESS',
        locked: false,
      });
      return {
        open,
        pendingLocked,
        legacyInvested,
        certificate,
        inProgress,
        certificateMember,
      };
    });

    const boot = await bootstrapAnnualCycleApp();
    app = boot.app;
    prisma = boot.prisma;
    jwt = createTestJwtService();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const retiredCalls = (id: number) =>
    [
      ['post', `/api/v1/investiture/enrollments/${id}/submit`, {}],
      ['post', `/api/v1/investiture/enrollments/${id}/club-approve`, {}],
      ['post', `/api/v1/investiture/enrollments/${id}/coordinator-approve`, {}],
      ['post', `/api/v1/investiture/enrollments/${id}/field-approve`, {}],
      ['post', `/api/v1/investiture/enrollments/${id}/invest`, {}],
      [
        'post',
        `/api/v1/investiture/enrollments/${id}/reject`,
        { reason: 'fase 8' },
      ],
      [
        'post',
        '/api/v1/investiture/enrollments/bulk-approve',
        { action: 'invest', enrollment_ids: [id] },
      ],
      [
        'post',
        '/api/v1/investiture/enrollments/bulk-reject',
        { enrollment_ids: [id], comments: 'fase 8' },
      ],
      ['post', `/api/v1/enrollments/${id}/submit-for-validation`, {}],
      ['post', `/api/v1/enrollments/${id}/validate`, { action: 'APPROVED' }],
      ['post', `/api/v1/enrollments/${id}/investiture`, {}],
    ] as const;

  async function callRetired(method: 'post', url: string, body: object) {
    await pace();
    return request(app.getHttpServer())
      [method](url)
      .set(bearer(ADMIN))
      .send(body);
  }

  async function callAnonymous(
    method: 'get' | 'post',
    url: string,
    body: object,
  ) {
    await pace();
    const call = request(app.getHttpServer())[method](url);
    return method === 'get' ? call : call.send(body);
  }

  async function legacySnapshot() {
    const ids = [
      ...Object.values(fx.open),
      fx.pendingLocked,
      fx.legacyInvested,
      fx.certificate,
      fx.inProgress,
    ];
    return {
      rows: await locks(ids),
      history: await prisma.investiture_validation_history.count({
        where: { enrollment_id: { in: ids } },
      }),
      people: await prisma.investiture_authorization_people.findMany({
        where: { enrollment_id: { in: ids } },
        select: { enrollment_id: true, status: true },
        orderBy: { enrollment_id: 'asc' },
      }),
      completed: await prisma.achievement_event_log.count({
        where: { event_type: 'class.completed' },
      }),
    };
  }

  describe('vía retirada', () => {
    it.each([
      ['FIELD_APPROVED', () => fx.open.FIELD_APPROVED],
      ['un enrollment operativo nuevo', () => fx.inProgress],
    ])(
      '%s no llega a INVESTIDO por ninguna ruta, alias ni operación masiva',
      async (_label, pick) => {
        const id = pick();
        const before = await legacySnapshot();
        for (const [method, url, body] of retiredCalls(id)) {
          const res = await callRetired(method, url, body);
          expect({ url, status: res.status, code: res.body.code }).toEqual({
            url,
            status: 410,
            code: 'INVESTITURE_LEGACY_PIPELINE_RETIRED',
          });
        }
        expect(await legacySnapshot()).toEqual(before);
        const row = await prisma.enrollments.findUniqueOrThrow({
          where: { enrollment_id: id },
        });
        expect(row.investiture_status).not.toBe('INVESTIDO');
      },
    );

    it('ValidationModule no mueve una clase', async () => {
      const validation = app.get(ValidationService);
      const before = await legacySnapshot();
      await expect(
        validation.submitForReview('class', fx.inProgress, ADMIN),
      ).rejects.toMatchObject({ code: 'INVESTITURE_LEGACY_PIPELINE_RETIRED' });
      await expect(
        validation.review(
          'class',
          fx.open.SUBMITTED_FOR_VALIDATION,
          'approved',
          ADMIN,
        ),
      ).rejects.toMatchObject({ code: 'INVESTITURE_LEGACY_PIPELINE_RETIRED' });
      expect(await legacySnapshot()).toEqual(before);
      expect(
        await prisma.validation_logs.count({ where: { entity_type: 'class' } }),
      ).toBe(0);
    });

    it('ningún expediente abierto se pierde ni se resuelve en silencio', async () => {
      const before = await legacySnapshot();
      const all = [...Object.values(fx.open), fx.pendingLocked];
      for (const [method, url, body] of [
        [
          'post',
          '/api/v1/investiture/enrollments/bulk-approve',
          { action: 'invest', enrollment_ids: all },
        ],
        [
          'post',
          '/api/v1/investiture/enrollments/bulk-reject',
          { enrollment_ids: all, comments: 'fase 8' },
        ],
        ...all.map(
          (id) =>
            [
              'post',
              `/api/v1/enrollments/${id}/validate`,
              { action: 'REJECTED', comments: 'x' },
            ] as const,
        ),
      ] as const) {
        expect((await callRetired(method, url, body)).status).toBe(410);
      }
      const after = await legacySnapshot();
      expect(after).toEqual(before);
      for (const status of OPEN) {
        expect(
          after.rows.find((row) => row.enrollment_id === fx.open[status]),
        ).toMatchObject({
          investiture_status: status,
          locked_for_validation: true,
        });
      }
    });

    it('el historial viejo sigue leyéndose', async () => {
      const history = await app
        .get(InvestitureService)
        .getHistory(fx.open.CLUB_APPROVED, ADMIN);
      expect(history.history).toEqual([
        expect.objectContaining({
          action: 'SUBMITTED',
          comments: 'expediente anterior',
        }),
      ]);
    });

    it('un certificado histórico no se mezcla con la solicitud', async () => {
      const before = await legacySnapshot();
      for (const [method, url, body] of retiredCalls(fx.certificate).slice(
        4,
        5,
      )) {
        expect((await callRetired(method, url, body)).status).toBe(410);
      }
      expect(await legacySnapshot()).toEqual(before);
      expect(
        await prisma.investiture_authorization_people.count({
          where: { enrollment_id: fx.certificate },
        }),
      ).toBe(0);
      await pace();
      const own = await request(app.getHttpServer())
        .get('/api/v1/investiture-history')
        .set(bearer(fx.certificateMember));
      expect(own.status).toBe(200);
      expect(own.body.data).toEqual([]);
    });

    it('sin sesión responde 401 y no 410: las rutas retiradas piden el JWT global, no permisos', async () => {
      const before = await legacySnapshot();
      const id = fx.open.FIELD_APPROVED;
      for (const [method, url, body] of [
        ['post', `/api/v1/investiture/enrollments/${id}/invest`, {}],
        ['post', `/api/v1/enrollments/${id}/validate`, { action: 'APPROVED' }],
        ['get', '/api/v1/investiture/pending', {}],
        ['get', '/api/v1/admin/investiture/config', {}],
      ] as const) {
        const res = await callAnonymous(method, url, body);
        expect({ url, status: res.status }).toEqual({ url, status: 401 });
      }
      expect(await legacySnapshot()).toEqual(before);
    });

    it('las lecturas retiradas también responden 410 con sesión (decisión O1)', async () => {
      for (const url of [
        '/api/v1/investiture/pending',
        '/api/v1/admin/investiture/config',
        '/api/v1/admin/investiture/config/7',
      ]) {
        await pace();
        const res = await request(app.getHttpServer())
          .get(url)
          .set(bearer(ADMIN));
        expect({ url, status: res.status, code: res.body.code }).toEqual({
          url,
          status: 410,
          code: 'INVESTITURE_LEGACY_PIPELINE_RETIRED',
        });
      }
    });
  });

  describe('desbloqueo explícito', () => {
    it('refuses a global admin who is not super-admin and changes nothing', async () => {
      const before = await locks([...Object.values(fx.open), fx.pendingLocked]);
      const res = await releaseLocks(ADMIN, { dry_run: false });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SUPER_ADMIN_WRITE_REQUIRED');
      expect(
        await locks([...Object.values(fx.open), fx.pendingLocked]),
      ).toEqual(before);
    });

    it('lists candidates by default and writes nothing', async () => {
      const res = await releaseLocks(SUPER_ADMIN, {});
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.dry_run).toBe(true);
      expect(
        data.candidates
          .map((row: { enrollment_id: number }) => row.enrollment_id)
          .sort((a: number, b: number) => a - b),
      ).toEqual(
        [...Object.values(fx.open), fx.pendingLocked].sort((a, b) => a - b),
      );
      expect(data.skipped_pending).toEqual([fx.pendingLocked]);
      expect(data.released).toEqual([]);
      expect(
        await prisma.investiture_validation_history.count({
          where: { action: 'LEGACY_LOCK_RELEASED' },
        }),
      ).toBe(0);
    });

    it('releases only rows without PENDING, keeps every status and audits each one', async () => {
      const res = await releaseLocks(SUPER_ADMIN, { dry_run: false });
      expect(res.status).toBe(200);
      expect(
        [...res.body.data.released].sort((a: number, b: number) => a - b),
      ).toEqual(Object.values(fx.open).sort((a, b) => a - b));
      expect(res.body.data.skipped_pending).toEqual([fx.pendingLocked]);

      for (const status of OPEN) {
        const row = await prisma.enrollments.findUniqueOrThrow({
          where: { enrollment_id: fx.open[status] },
        });
        expect(row.investiture_status).toBe(status);
        expect(row.locked_for_validation).toBe(false);
        expect(row.submitted_for_validation).toBe(true);
        expect(
          await prisma.investiture_validation_history.findMany({
            where: {
              enrollment_id: fx.open[status],
              action: 'LEGACY_LOCK_RELEASED',
            },
            select: { performed_by: true },
          }),
        ).toEqual([{ performed_by: SUPER_ADMIN }]);
      }
      const untouched = await locks([
        fx.pendingLocked,
        fx.legacyInvested,
        fx.certificate,
      ]);
      expect(untouched.every((row) => row.locked_for_validation)).toBe(true);
      expect(
        await prisma.investiture_authorization_people.findFirstOrThrow({
          where: { enrollment_id: fx.pendingLocked },
          select: { status: true },
        }),
      ).toEqual({ status: 'PENDING' });
    });

    it('is idempotent', async () => {
      const res = await releaseLocks(SUPER_ADMIN, { dry_run: false });
      expect(res.status).toBe(200);
      expect(
        res.body.data.candidates.map(
          (row: { enrollment_id: number }) => row.enrollment_id,
        ),
      ).toEqual([fx.pendingLocked]);
      expect(res.body.data.released).toEqual([]);
      expect(
        await prisma.investiture_validation_history.count({
          where: { action: 'LEGACY_LOCK_RELEASED' },
        }),
      ).toBe(OPEN.length);
    });
  });

  // Va al final: revisa todo lo que el servidor registró desde beforeAll.
  it('el servidor no registró ningún deadlock durante la suite', () => {
    const log = readFileSync(serverLog.path)
      .subarray(serverLog.offset)
      .toString('utf8');
    expect(log).not.toMatch(/deadlock detected/i);
  });
});
