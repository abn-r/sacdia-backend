/**
 * Fase 8 — vía club → coordinación → campo apagada.
 * AppModule real sobre PostgreSQL descartable: JWT y permisos reales;
 * BetterAuth y el cron de year-cut simulados (bootstrapAnnualCycleApp).
 * El throttler corre con los límites de NODE_ENV=test: cada request espera 550 ms.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import request from 'supertest';
import { ErrorCode } from '../src/common/errors/error-codes';
import type { AuthorizationSnapshot } from '../src/common/services/authorization-context.service';
import { InvestitureService } from '../src/investiture/investiture.service';
import { InvestitureAuthorizationRequestService } from '../src/investiture-requests/investiture-authorization-requests.service';
import { INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX } from '../src/investiture-requests/investiture-request-lock';
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
  sectionId: number;
  yearId: number;
  classId: number;
};

const pace = () => new Promise((resolve) => setTimeout(resolve, 550));

const PRESENT_DATE = '2026-11-01';
const PRESENT_AT = new Date('2026-10-15T18:00:00.000Z');
const RESOLVE_AT = new Date('2026-12-10T18:00:00.000Z');

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
  let databaseUrl: string;

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

  function sectionMarker(): AuthorizationSnapshot {
    return {
      grants: {
        global_roles: [],
        club_assignments: [
          {
            assignment_id: 'grant-f8',
            role_name: 'director',
            permissions: [],
            operational: true,
            ecclesiastical_year_id: fx.yearId,
            club: { club_id: 1, club_name: 'F8 Club' },
            section: { club_section_id: fx.sectionId, club_type_id: 1 },
            scope: {},
            status: 'active',
          },
        ],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: 'grant-f8' },
      effective: { permissions: [], scope: { global: {}, club: null } },
    };
  }

  beforeAll(async () => {
    const url = await prepareAnnualCycleDatabase();
    databaseUrl = url;
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

      // Sección real del club: el contexto de presentación lee miembros por sección.
      const country = await client.query<{ country_id: number }>(
        `INSERT INTO countries (name, abbreviation, active)
         VALUES ('F8 Pais', 'F8', true) RETURNING country_id`,
      );
      const division = await client.query<{ division_id: number }>(
        `INSERT INTO divisions (code, name, abbreviation, active)
         VALUES ('F8', 'F8 Division', 'F8', true) RETURNING division_id`,
      );
      const union = await client.query<{ union_id: number }>(
        `INSERT INTO unions (name, abbreviation, active, country_id, division_id)
         VALUES ('F8 Union', 'F8U', true, $1, $2) RETURNING union_id`,
        [country.rows[0].country_id, division.rows[0].division_id],
      );
      const field = await client.query<{ local_field_id: number }>(
        `INSERT INTO local_fields (name, abbreviation, active, union_id, timezone)
         VALUES ('F8 Campo', 'F8F', true, $1, 'America/Mexico_City')
         RETURNING local_field_id`,
        [union.rows[0].union_id],
      );
      const district = await client.query<{ districlub_type_id: number }>(
        `INSERT INTO districts (name, active, local_field_id)
         VALUES ('F8 Distrito', true, $1) RETURNING districlub_type_id`,
        [field.rows[0].local_field_id],
      );
      const church = await client.query<{ church_id: number }>(
        `INSERT INTO churches (name, active, districlub_type_id)
         VALUES ('F8 Iglesia', true, $1) RETURNING church_id`,
        [district.rows[0].districlub_type_id],
      );
      const club = await client.query<{ club_id: number }>(
        `INSERT INTO clubs (name, active, local_field_id, church_id, coordinates, districlub_type_id)
         VALUES ('F8 Club', true, $1, $2, '{}'::json, $3) RETURNING club_id`,
        [
          field.rows[0].local_field_id,
          church.rows[0].church_id,
          district.rows[0].districlub_type_id,
        ],
      );
      const section = await client.query<{ club_section_id: number }>(
        `INSERT INTO club_sections (active, club_type_id, main_club_id)
         VALUES (true, $1, $2) RETURNING club_section_id`,
        [clubType.rows[0].club_type_id, club.rows[0].club_id],
      );
      const sectionId = section.rows[0].club_section_id;
      const memberRole = await client.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_name = 'member' AND role_category = 'CLUB'`,
      );
      const joinSection = (userId: string) =>
        client.query(
          `INSERT INTO club_role_assignments (
             user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id
           )
           VALUES ($1, $2, $3, '2026-01-01', true, 'active', $4)`,
          [userId, memberRole.rows[0].role_id, yearId, sectionId],
        );

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
        if (status === 'CLUB_APPROVED') await joinSection(member);
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
      await joinSection(pendingMember);
      const req = await client.query<{ request_id: string }>(
        `INSERT INTO investiture_authorization_requests (club_section_id, ecclesiastical_year_id, created_by_id)
         VALUES ($1, $2, $3) RETURNING request_id`,
        [sectionId, yearId, ADMIN],
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
        sectionId,
        yearId,
        classId,
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

    it('una fila liberada entra a la vía nueva y la que sigue bloqueada no (decisión B5)', async () => {
      const view = await app
        .get(InvestitureAuthorizationRequestService)
        .presentationContext(
          sectionMarker(),
          fx.sectionId,
          fx.yearId,
          new Date('2026-11-10T18:00:00.000Z'),
        );
      const byEnrollment = new Map(
        view.candidates.map((row) => [row.enrollment_id, row]),
      );
      // fx.open.CLUB_APPROVED ya fue soltada por el caso de liberación.
      const released = byEnrollment.get(fx.open.CLUB_APPROVED);
      expect(released).toBeDefined();
      expect(released?.blocked_code).not.toBe(
        ErrorCode.INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE,
      );
      // Sigue bloqueada y con PENDING: no puede presentarse de nuevo.
      const stillLocked = byEnrollment.get(fx.pendingLocked);
      expect(stillLocked).toBeDefined();
      expect(stillLocked?.eligible).toBe(false);
      expect(stillLocked?.blocked_code).toBe(
        ErrorCode.INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE,
      );
    });
  });

  describe('expedientes liberados en la vía nueva', () => {
    const requests = () => app.get(InvestitureAuthorizationRequestService);

    function fieldAuth(localFieldId: number): AuthorizationSnapshot {
      return {
        grants: {
          global_roles: [
            {
              role_name: 'director-lf',
              permissions: [],
              scope: { local_field: { id: localFieldId, name: 'F8 Campo' } },
            },
          ],
          club_assignments: [],
          direct_permissions: [],
        },
        active_assignment: { assignment_id: null },
        effective: {
          permissions: [],
          scope: {
            global: { local_field: { id: localFieldId, name: 'F8 Campo' } },
            club: null,
          },
        },
      };
    }

    async function joinSection(client: Client, userId: string) {
      await client.query(
        `INSERT INTO club_role_assignments (
           user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id
         )
         SELECT $1, role_id, $2, '2026-01-01', true, 'active', $3
         FROM roles WHERE role_name = 'member' AND role_category = 'CLUB'`,
        [userId, fx.yearId, fx.sectionId],
      );
    }

    // Elegibilidad real: una sección requerida de la clase, validada y con nota.
    let requirement: { moduleId: number; sectionId: number };

    async function completeRequirement(
      client: Client,
      userId: string,
      enrollmentId: number,
    ) {
      await client.query(
        `INSERT INTO class_section_progress (
           user_id, class_id, module_id, section_id, score, enrollment_id, status, active
         )
         VALUES ($1, $2, $3, $4, 100, $5, 'VALIDATED', true)`,
        [
          userId,
          fx.classId,
          requirement.moduleId,
          requirement.sectionId,
          enrollmentId,
        ],
      );
    }

    async function seedLockedMember(tag: string) {
      return withClient(databaseUrl, async (client) => {
        const userId = await insertUser(client, `${tag}@fase8.test`);
        const enrollmentId = await insertEnrollment(client, {
          userId,
          classId: fx.classId,
          yearId: fx.yearId,
          status: 'CLUB_APPROVED',
          locked: true,
        });
        await joinSection(client, userId);
        await completeRequirement(client, userId, enrollmentId);
        return { userId, enrollmentId };
      });
    }

    async function fieldId() {
      const field = await prisma.local_fields.findFirstOrThrow({
        where: { abbreviation: 'F8F' },
        select: { local_field_id: true },
      });
      return field.local_field_id;
    }

    async function openRequestId() {
      const person =
        await prisma.investiture_authorization_people.findFirstOrThrow({
          where: { enrollment_id: fx.pendingLocked, status: 'PENDING' },
        });
      return person.request_id;
    }

    const classCompleted = (userIds: string[]) =>
      prisma.achievement_event_log.count({
        where: { event_type: 'class.completed', user_id: { in: userIds } },
      });

    beforeAll(async () => {
      const module = await prisma.class_modules.create({
        data: { name: 'Módulo F8', class_id: fx.classId, active: true },
      });
      const section = await prisma.class_sections.create({
        data: { name: 'Sección F8', module_id: module.module_id, active: true },
      });
      requirement = {
        moduleId: module.module_id,
        sectionId: section.section_id,
      };
      await prisma.local_field_investiture_windows.create({
        data: {
          local_field_id: await fieldId(),
          ecclesiastical_year_id: fx.yearId,
          start_date: new Date('2026-10-01T00:00:00.000Z'),
          end_date: new Date('2026-12-31T00:00:00.000Z'),
        },
      });
    });

    it('B5: las filas abiertas ya liberadas se presentan, se agregan y se resuelven hasta INVESTIDO con un solo class.completed', async () => {
      const ids = OPEN.map((status) => fx.open[status]);
      const rows = await prisma.enrollments.findMany({
        where: { enrollment_id: { in: ids } },
        select: { enrollment_id: true, user_id: true },
      });
      const userIds = rows.map((row) => row.user_id);
      // Estado de partida: soltadas, con su estado de cadena intacto.
      expect(
        (await locks(ids)).map((row) => [
          row.investiture_status,
          row.locked_for_validation,
        ]),
      ).toEqual(OPEN.map((status) => [status, false]));
      await withClient(databaseUrl, async (client) => {
        // Solo CLUB_APPROVED ya era miembro de la sección.
        for (const row of rows) {
          if (row.enrollment_id !== fx.open.CLUB_APPROVED) {
            await joinSection(client, row.user_id);
          }
          await completeRequirement(client, row.user_id, row.enrollment_id);
        }
      });
      expect(await classCompleted(userIds)).toBe(0);

      await pace();
      const presented = await requests().present(
        sectionMarker(),
        ADMIN,
        fx.sectionId,
        fx.yearId,
        PRESENT_DATE,
        [fx.open.CLUB_APPROVED],
        PRESENT_AT,
      );
      await pace();
      await requests().addPeople(
        sectionMarker(),
        ADMIN,
        presented.request_id,
        PRESENT_DATE,
        ids.filter((id) => id !== fx.open.CLUB_APPROVED),
        PRESENT_AT,
      );
      const pending = await prisma.investiture_authorization_people.findMany({
        where: { enrollment_id: { in: ids }, status: 'PENDING' },
        select: { person_id: true, enrollment_id: true },
      });
      expect(pending.map((row) => row.enrollment_id).sort()).toEqual(
        [...ids].sort(),
      );

      await pace();
      const resolved = await requests().resolve(
        fieldAuth(await fieldId()),
        ADMIN,
        presented.request_id,
        { invest: pending.map((row) => ({ person_id: row.person_id })) },
        RESOLVE_AT,
      );
      expect(resolved.invested).toHaveLength(OPEN.length);
      for (const row of await locks(ids)) {
        expect(row).toMatchObject({
          investiture_status: 'INVESTIDO',
          locked_for_validation: false,
        });
      }
      // Exactamente un class.completed por persona.
      for (const userId of userIds) {
        expect(await classCompleted([userId])).toBe(1);
      }
    });

    describe('carrera entre soltar el candado y presentar', () => {
      type Order = 'release-first' | 'present-first';
      const ORDERS: Order[] = ['release-first', 'present-first'];

      async function holdEnrollmentLock(enrollmentId: number) {
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        await client.query('BEGIN');
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX}${enrollmentId}`],
        );
        const pid = await client.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        return {
          pid: pid.rows[0].pid,
          release: async () => {
            await client.query('COMMIT');
            await client.end();
          },
        };
      }

      async function waitForWaiters(holderPid: number, count: number) {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const waiting = await withClient(databaseUrl, (client) =>
            client.query(
              `SELECT count(DISTINCT pid)::int AS total
               FROM pg_locks
               WHERE locktype = 'advisory' AND NOT granted AND pid <> $1`,
              [holderPid],
            ),
          );
          if (waiting.rows[0].total >= count) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(
          `la operación no quedó esperando ${count} candados advisory en pg_locks`,
        );
      }

      /**
       * Retiene el candado advisory del enrollment, arranca las dos operaciones
       * en el orden pedido (cada una queda esperando en pg_locks) y suelta. Así
       * el orden de los candados es el pedido y no depende de la suerte.
       */
      async function race<A, B>(
        enrollmentId: number,
        order: Order,
        release: () => Promise<A>,
        present: () => Promise<B>,
      ) {
        const holder = await holdEnrollmentLock(enrollmentId);
        let released: Promise<A>;
        let presented: Promise<B>;
        const outcomes = { release: undefined, present: undefined } as {
          release?: PromiseSettledResult<A>;
          present?: PromiseSettledResult<B>;
        };
        try {
          const first = order === 'release-first' ? 'release' : 'present';
          const start = (which: 'release' | 'present') =>
            which === 'release'
              ? (released = release())
              : (presented = present());
          // Un rechazo antes de esperar no debe quedar sin atender.
          const firstPromise = start(first);
          firstPromise.catch(() => undefined);
          await waitForWaiters(holder.pid, 1);
          const secondPromise = start(
            first === 'release' ? 'present' : 'release',
          );
          secondPromise.catch(() => undefined);
          await waitForWaiters(holder.pid, 2);
        } finally {
          await holder.release();
        }
        const [r, p] = await Promise.allSettled([released!, presented!]);
        outcomes.release = r;
        outcomes.present = p;
        return outcomes;
      }

      function assertNoDeadlockSince(offset: number) {
        const log = readFileSync(serverLog.path)
          .subarray(offset)
          .toString('utf8');
        expect(log).not.toMatch(/deadlock detected/i);
      }

      it.each(ORDERS)(
        'fila bloqueada sin PENDING (%s): queda liberada y se presenta solo si el desbloqueo ganó',
        async (order) => {
          const offset = statSync(serverLog.path).size;
          const member = await seedLockedMember(`race-free-${order}`);
          const done = await race(
            member.enrollmentId,
            order,
            async () => {
              await pace();
              return request(app.getHttpServer())
                .post('/api/v1/admin/investiture/legacy-locks/release')
                .set(bearer(SUPER_ADMIN))
                .send({ dry_run: false });
            },
            () =>
              requests().present(
                sectionMarker(),
                ADMIN,
                fx.sectionId,
                fx.yearId,
                PRESENT_DATE,
                [member.enrollmentId],
                PRESENT_AT,
              ),
          );

          expect(done.release?.status).toBe('fulfilled');
          const body =
            done.release?.status === 'fulfilled' ? done.release.value : null;
          expect(body?.status).toBe(200);
          // Sin PENDING en ningún orden, el desbloqueo siempre suelta la fila.
          expect(body?.body.data.released).toContain(member.enrollmentId);
          expect(body?.body.data.skipped_pending).not.toContain(
            member.enrollmentId,
          );
          const [row] = await locks([member.enrollmentId]);
          expect(row).toMatchObject({
            investiture_status: 'CLUB_APPROVED',
            locked_for_validation: false,
          });
          expect(
            await prisma.investiture_validation_history.count({
              where: {
                enrollment_id: member.enrollmentId,
                action: 'LEGACY_LOCK_RELEASED',
              },
            }),
          ).toBe(1);
          const pending = await prisma.investiture_authorization_people.count({
            where: { enrollment_id: member.enrollmentId, status: 'PENDING' },
          });
          if (order === 'present-first') {
            // Presentar ganó el candado con la fila aún bloqueada: rechaza y no deja PENDING.
            expect(done.present?.status).toBe('rejected');
            expect(
              done.present?.status === 'rejected' &&
                (done.present.reason as { code?: string }).code,
            ).toBe(ErrorCode.INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE);
            expect(pending).toBe(0);
          } else {
            // El desbloqueo ganó: la fila ya estaba libre cuando presentar la leyó.
            expect(done.present?.status).toBe('fulfilled');
            expect(pending).toBe(1);
          }
          assertNoDeadlockSince(offset);
        },
      );

      it.each(ORDERS)(
        'fila bloqueada con PENDING (%s): sigue bloqueada, el PENDING queda y el desbloqueo la salta',
        async (order) => {
          const offset = statSync(serverLog.path).size;
          const member = await seedLockedMember(`race-pending-${order}`);
          const requestId = await openRequestId();
          await prisma.investiture_authorization_people.create({
            data: {
              request_id: requestId,
              user_id: member.userId,
              class_id: fx.classId,
              enrollment_id: member.enrollmentId,
              investiture_date: new Date('2026-11-15T00:00:00.000Z'),
              status: 'PENDING',
              single_slot: false,
            },
          });
          const done = await race(
            member.enrollmentId,
            order,
            async () => {
              await pace();
              return request(app.getHttpServer())
                .post('/api/v1/admin/investiture/legacy-locks/release')
                .set(bearer(SUPER_ADMIN))
                .send({ dry_run: false });
            },
            () =>
              requests().addPeople(
                sectionMarker(),
                ADMIN,
                requestId,
                PRESENT_DATE,
                [member.enrollmentId],
                PRESENT_AT,
              ),
          );

          const body =
            done.release?.status === 'fulfilled' ? done.release.value : null;
          expect(body?.status).toBe(200);
          expect(body?.body.data.skipped_pending).toContain(
            member.enrollmentId,
          );
          expect(body?.body.data.released).not.toContain(member.enrollmentId);
          expect(done.present?.status).toBe('rejected');
          expect(
            done.present?.status === 'rejected' &&
              (done.present.reason as { code?: string }).code,
          ).toBe(ErrorCode.INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE);
          const [row] = await locks([member.enrollmentId]);
          expect(row).toMatchObject({
            investiture_status: 'CLUB_APPROVED',
            locked_for_validation: true,
          });
          expect(
            await prisma.investiture_authorization_people.count({
              where: { enrollment_id: member.enrollmentId, status: 'PENDING' },
            }),
          ).toBe(1);
          expect(
            await prisma.investiture_validation_history.count({
              where: {
                enrollment_id: member.enrollmentId,
                action: 'LEGACY_LOCK_RELEASED',
              },
            }),
          ).toBe(0);
          assertNoDeadlockSince(offset);
        },
      );
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
