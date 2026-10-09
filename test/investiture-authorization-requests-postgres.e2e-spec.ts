import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg, { Client } from 'pg';
import type { AuthorizationSnapshot } from '../src/common/services/authorization-context.service';
import { ErrorCode } from '../src/common/errors/error-codes';
import { Job } from 'bullmq';
import { ClassesService } from '../src/classes/classes.service';
import {
  AchievementsService,
  achievementQueueJobId,
} from '../src/achievements/achievements.service';
import { AchievementsProcessor } from '../src/achievements/achievements.processor';
import { INVESTITURE_REQUEST_USER_LOCK_PREFIX } from '../src/investiture-requests/investiture-authorization-requests.service';
import {
  INVESTITURE_REQUEST_CALENDAR_LOCK_PREFIX,
  INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX,
  INVESTITURE_REQUEST_SECTION_LOCK_PREFIX,
  INVESTITURE_REQUEST_YEAR_LOCK_PREFIX,
  LATER_CERTIFICATE_ACCREDITATION_REASON,
} from '../src/investiture-requests/investiture-request-lock';
import {
  INVESTITURE_SYSTEM_REJECTION_TEXT,
  InvestitureAuthorizationRequestService,
} from '../src/investiture-requests/investiture-authorization-requests.service';
import { InvestitureCommunicationsService } from '../src/investiture-requests/investiture-communications.service';
import { DistrictInvestiturePastorService } from '../src/classes/district-investiture-pastors.service';
import { InvestitureService } from '../src/investiture/investiture.service';
import { CertificateBulkImportApplicationService } from '../src/certificate-bulk-imports/certificate-bulk-imports-application.service';
import { CertificateBulkImportsService } from '../src/certificate-bulk-imports/certificate-bulk-imports.service';
import { closePendingInvestitureAuthorizations } from '../src/investiture-requests/investiture-year-close';
import { guardCertificateApprovalAuthorization } from '../src/certificate-bulk-imports/class-certificate-live-authorization';
import {
  assertServerLogHasWarningMarker,
  requireInvestitureServerLogPath,
} from './helpers/investiture-server-log';
import { ValidationService } from '../src/validation/validation.service';
import { YearEndService } from '../src/year-end/year-end.service';
import { YearCutService } from '../src/year-cut/year-cut.service';
import {
  prepareAnnualCycleDatabase,
  withClient,
} from './helpers/annual-cycle-db.helper';

jest.setTimeout(180000);

const MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INSIDE = new Date('2026-10-15T18:00:00.000Z');
const DATE = '2026-11-01';

function ensureTestDatabaseUrl(): void {
  if (process.env.SACDIA_TEST_DATABASE_URL?.trim()) {
    return;
  }
  let text: string;
  try {
    text = readFileSync(join(__dirname, '../.env.test.local'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('SACDIA_TEST_DATABASE_URL=')) {
      continue;
    }
    let value = trimmed.slice('SACDIA_TEST_DATABASE_URL='.length).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) {
      process.env.SACDIA_TEST_DATABASE_URL = value;
    }
    return;
  }
}

function scrub(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'database error';
  return new Error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]'));
}

describe('investiture authorization requests on isolated PostgreSQL', () => {
  let url: string;
  let pool: pg.Pool;
  let prisma: PrismaClient;
  let service: InvestitureAuthorizationRequestService;
  let sectionId: number;
  let yearId: number;
  let enrollmentId: number;
  let classId: number;
  let clubId: number;
  let clubTypeId: number;
  let roleId: string;
  let fieldId: number;
  let districtId: number;
  const eligibilityState = { eligibleIds: new Set<number>(), fail: false };
  const events: Array<{
    eventType: string;
    userId: string;
    idempotencyKey?: string;
  }> = [];

  beforeAll(async () => {
    ensureTestDatabaseUrl();
    try {
      url = await prepareAnnualCycleDatabase();
    } catch (error) {
      throw scrub(error);
    }
    try {
      const seeded = await withClient(url, async (client) => {
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS "uniq_investiture_authorization_people_pending_class"
          ON "investiture_authorization_people" ("user_id", "class_id")
          WHERE "status" = 'PENDING'
        `);
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS "uniq_investiture_authorization_people_pending_single_slot"
          ON "investiture_authorization_people" ("user_id")
          WHERE "status" = 'PENDING' AND "single_slot" = true
        `);
        const country = await client.query<{ country_id: number }>(
          `INSERT INTO countries (name, abbreviation, active)
           VALUES ('P4 Pais', 'P4', true)
           RETURNING country_id`,
        );
        const division = await client.query<{ division_id: number }>(
          `INSERT INTO divisions (code, name, abbreviation, active)
           VALUES ('P4', 'P4 Division', 'P4', true)
           RETURNING division_id`,
        );
        const union = await client.query<{ union_id: number }>(
          `INSERT INTO unions (name, abbreviation, active, country_id, division_id)
           VALUES ('P4 Union', 'P4U', true, $1, $2)
           RETURNING union_id`,
          [country.rows[0].country_id, division.rows[0].division_id],
        );
        const field = await client.query<{ local_field_id: number }>(
          `INSERT INTO local_fields (name, abbreviation, active, union_id, timezone)
           VALUES ('P4 Campo', 'P4F', true, $1, 'America/Mexico_City')
           RETURNING local_field_id`,
          [union.rows[0].union_id],
        );
        const district = await client.query<{ districlub_type_id: number }>(
          `INSERT INTO districts (name, active, local_field_id)
           VALUES ('P4 Distrito', true, $1)
           RETURNING districlub_type_id`,
          [field.rows[0].local_field_id],
        );
        const church = await client.query<{ church_id: number }>(
          `INSERT INTO churches (name, active, districlub_type_id)
           VALUES ('P4 Iglesia', true, $1)
           RETURNING church_id`,
          [district.rows[0].districlub_type_id],
        );
        const club = await client.query<{ club_id: number }>(
          `INSERT INTO clubs (name, active, local_field_id, church_id, coordinates, districlub_type_id)
           VALUES ('P4 Club', true, $1, $2, '{}'::json, $3)
           RETURNING club_id`,
          [
            field.rows[0].local_field_id,
            church.rows[0].church_id,
            district.rows[0].districlub_type_id,
          ],
        );
        const clubType = await client.query<{ club_type_id: number }>(
          `INSERT INTO club_types (name, active)
           VALUES ('Conquistadores', true)
           RETURNING club_type_id`,
        );
        const year = await client.query<{ year_id: number }>(
          `INSERT INTO ecclesiastical_years (start_date, end_date, active)
           VALUES ('2026-01-01', '2026-12-31', true)
           RETURNING year_id`,
        );
        const classRow = await client.query<{ class_id: number }>(
          `INSERT INTO classes (name, active, club_type_id, minimum_age, min_duration_years, max_duration_years)
           VALUES ('Amigo P4', true, $1, 10, 1, 1)
           RETURNING class_id`,
          [clubType.rows[0].club_type_id],
        );
        const section = await client.query<{ club_section_id: number }>(
          `INSERT INTO club_sections (active, club_type_id, main_club_id)
           VALUES (true, $1, $2)
           RETURNING club_section_id`,
          [clubType.rows[0].club_type_id, club.rows[0].club_id],
        );
        await client.query(
          `INSERT INTO users (user_id, email, name, active)
           VALUES ($1, 'member-p4@p4.test', 'Miembro', true)`,
          [MEMBER],
        );
        await client.query(
          `INSERT INTO users (user_id, email, name, active)
           VALUES ($1, 'actor-p4@p4.test', 'Actor', true)`,
          [ACTOR],
        );
        // BCR-6: ACTOR actúa como pastor asignado; la regla única exige el rol global.
        const pastorRole = await client.query<{ role_id: string }>(
          `INSERT INTO roles (role_name, description, role_category, active)
           VALUES ('pastor', 'Pastor', 'GLOBAL', true)
           ON CONFLICT (role_name) DO UPDATE SET active = true
           RETURNING role_id`,
        );
        await client.query(
          `INSERT INTO users_roles (user_id, role_id, active)
           VALUES ($1, $2, true)`,
          [ACTOR, pastorRole.rows[0].role_id],
        );
        const role = await client.query<{ role_id: string }>(
          `SELECT role_id FROM roles
           WHERE role_name = 'member' AND role_category = 'CLUB'`,
        );
        await client.query(
          `INSERT INTO club_role_assignments (
             user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id
           )
           VALUES ($1, $2, $3, '2026-01-01', true, 'active', $4)`,
          [
            MEMBER,
            role.rows[0].role_id,
            year.rows[0].year_id,
            section.rows[0].club_section_id,
          ],
        );
        const enrollment = await client.query<{ enrollment_id: number }>(
          `INSERT INTO enrollments (
             user_id, class_id, ecclesiastical_year_id, investiture_status, record_kind, active
           )
           VALUES ($1, $2, $3, 'IN_PROGRESS', 'OPERATIONAL', true)
           RETURNING enrollment_id`,
          [MEMBER, classRow.rows[0].class_id, year.rows[0].year_id],
        );
        return {
          sectionId: section.rows[0].club_section_id,
          yearId: year.rows[0].year_id,
          enrollmentId: enrollment.rows[0].enrollment_id,
          classId: classRow.rows[0].class_id,
          clubId: club.rows[0].club_id,
          clubTypeId: clubType.rows[0].club_type_id,
          roleId: role.rows[0].role_id,
        };
      });
      sectionId = seeded.sectionId;
      yearId = seeded.yearId;
      enrollmentId = seeded.enrollmentId;
      classId = seeded.classId;
      clubId = seeded.clubId;
      clubTypeId = seeded.clubTypeId;
      roleId = seeded.roleId;
      pool = new pg.Pool({ connectionString: url, max: 6 });
      prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
      const field = await prisma.local_fields.findFirst({
        where: { abbreviation: 'P4F' },
        select: { local_field_id: true },
      });
      const district = await prisma.districts.findFirst({
        where: { name: 'P4 Distrito' },
        select: { districlub_type_id: true },
      });
      if (!field || !district) {
        throw new Error('missing field or district');
      }
      fieldId = field.local_field_id;
      districtId = district.districlub_type_id;
      service = new InvestitureAuthorizationRequestService(
        prisma as never,
        {
          calculateForEnrollment: async (enrollment: number) => {
            if (eligibilityState.fail) {
              throw new Error('eligibility failed');
            }
            return {
              investiture_eligibility: {
                eligible: !eligibilityState.eligibleIds.has(enrollment)
                  ? true
                  : false,
              },
            };
          },
        } as never,
        {
          emitEvent: async (dto: {
            eventType: string;
            userId: string;
            idempotencyKey?: string;
          }) => {
            if (
              dto.idempotencyKey &&
              events.some((item) => item.idempotencyKey === dto.idempotencyKey)
            ) {
              return { eventLogId: events.length, queued: false };
            }
            events.push(dto);
            return { eventLogId: events.length, queued: false };
          },
        } as never,
      );
    } catch (error) {
      throw scrub(error);
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  beforeEach(async () => {
    eligibilityState.fail = false;
    eligibilityState.eligibleIds.clear();
    events.length = 0;
    await prisma.achievement_event_log.deleteMany({
      where: { user_id: { in: [MEMBER, ACTOR] } },
    });
    await prisma.investiture_authorization_people.deleteMany();
    await prisma.investiture_authorization_requests.deleteMany();
    await prisma.local_field_investiture_windows.deleteMany();
    await prisma.district_investiture_pastors.deleteMany();
    await prisma.ecclesiastical_years.update({
      where: { year_id: yearId },
      data: { active: true },
    });
    await prisma.enrollments.update({
      where: { enrollment_id: enrollmentId },
      data: {
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        locked_for_validation: false,
      },
    });
  });

  function marker(targetSectionId = sectionId): AuthorizationSnapshot {
    return {
      grants: {
        global_roles: [],
        club_assignments: [
          {
            assignment_id: 'grant-1',
            role_name: 'director',
            permissions: [],
            operational: true,
            ecclesiastical_year_id: yearId,
            club: { club_id: 1, club_name: 'P4 Club' },
            section: { club_section_id: targetSectionId, club_type_id: 1 },
            scope: {},
            status: 'active',
          },
        ],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: 'grant-1' },
      effective: { permissions: [], scope: { global: {}, club: null } },
    };
  }

  function present() {
    return service.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [enrollmentId],
      INSIDE,
    );
  }

  async function holdAdvisory(key: string): Promise<{
    release: () => Promise<void>;
    pid: number;
  }> {
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [key],
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

  async function holdLock(): Promise<{
    release: () => Promise<void>;
    pid: number;
  }> {
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${INVESTITURE_REQUEST_USER_LOCK_PREFIX}${MEMBER}`],
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

  async function waitForAdvisoryWaiter(holderPid: number): Promise<void> {
    const observer = new Client({ connectionString: url });
    await observer.connect();
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const waiting = await observer.query(
          `SELECT pid
           FROM pg_locks
           WHERE locktype = 'advisory'
             AND NOT granted
             AND pid <> $1
           LIMIT 1`,
          [holderPid],
        );
        if ((waiting.rowCount ?? 0) > 0) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(
        'la operación no quedó esperando un candado advisory en pg_locks',
      );
    } finally {
      await observer.end();
    }
  }

  it('lets exactly one of two simultaneous creates stay pending', async () => {
    const results = await Promise.allSettled([present(), present()]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: 'rejected',
      reason: { code: ErrorCode.INVESTITURE_REQUEST_ACTIVE_EXISTS },
    });
    expect(
      await prisma.investiture_authorization_people.count({
        where: { status: 'PENDING' },
      }),
    ).toBe(1);
  });

  it('keeps a removed person from returning to pending when a date change waits on the same lock', async () => {
    const view = await present();
    const holder = await holdLock();
    let released = false;
    const releaseOnce = async () => {
      if (released) {
        return;
      }
      released = true;
      await holder.release();
    };
    const removing = service.remove(
      marker(),
      ACTOR,
      view.request_id,
      view.people[0].person_id,
      INSIDE,
    );
    void removing.catch(() => undefined);
    let changing: Promise<unknown> = Promise.resolve();
    try {
      await waitForAdvisoryWaiter(holder.pid);
      let changeSettled = false;
      changing = service
        .changeDates(
          marker(),
          ACTOR,
          view.request_id,
          '2026-11-20',
          [view.people[0].person_id],
          INSIDE,
        )
        .finally(() => {
          changeSettled = true;
        });
      void changing.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(changeSettled).toBe(false);
      await releaseOnce();
      const [removed, changed] = await Promise.allSettled([removing, changing]);
      expect(removed.status).toBe('fulfilled');
      const row = await prisma.investiture_authorization_people.findUnique({
        where: { person_id: view.people[0].person_id },
      });
      expect(row?.status).toBe('REMOVED');
      expect(
        await prisma.investiture_authorization_people.count({
          where: { status: 'PENDING' },
        }),
      ).toBe(0);
      if (changed.status === 'rejected') {
        expect(changed.reason).toMatchObject({
          code: ErrorCode.INVESTITURE_REQUEST_NOT_PENDING,
        });
        expect(row?.investiture_date.toISOString().slice(0, 10)).toBe(DATE);
      }
    } catch (error) {
      await releaseOnce().catch(() => undefined);
      await Promise.allSettled([removing, changing]);
      throw scrub(error);
    }
  });

  it('retires an existing pending row when the enrollment is already invested', async () => {
    const view = await present();
    await prisma.enrollments.update({
      where: { enrollment_id: enrollmentId },
      data: { investiture_status: 'INVESTIDO' },
    });

    await expect(present()).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_ALREADY_INVESTED,
    });
    const row = await prisma.investiture_authorization_people.findUnique({
      where: { person_id: view.people[0].person_id },
    });
    expect(row).toMatchObject({
      status: 'REMOVED',
      resolution_code: 'ALREADY_INVESTED',
    });
    expect(
      await prisma.investiture_authorization_people.count({
        where: { status: 'PENDING' },
      }),
    ).toBe(0);

    await prisma.enrollments.update({
      where: { enrollment_id: enrollmentId },
      data: { investiture_status: 'IN_PROGRESS' },
    });
  });

  it('admits a prior-year enrollment that already meets the minimum duration', async () => {
    const previousYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2025-01-01T00:00:00.000Z'),
        end_date: new Date('2025-12-31T00:00:00.000Z'),
        active: false,
      },
      select: { year_id: true },
    });
    const longClass = await prisma.classes.create({
      data: {
        name: 'Amigo dos años',
        active: true,
        club_type_id: clubTypeId,
        minimum_age: 10,
        min_duration_years: 2,
        max_duration_years: 3,
      },
      select: { class_id: true },
    });
    const person = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const firstYearPerson = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const expiredPerson = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await withClient(url, async (client) => {
      await client.query(
        `INSERT INTO users (user_id, email, name, active)
         VALUES ($1, 'duration-p4@p4.test', 'Duracion', true),
                ($2, 'first-year-p4@p4.test', 'Primero', true),
                ($3, 'expired-p4@p4.test', 'Caducada', true)`,
        [person, firstYearPerson, expiredPerson],
      );
      await client.query(
        `INSERT INTO club_role_assignments (
           user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id
         )
         VALUES
           ($1, $4, $5, '2026-01-01', true, 'active', $6),
           ($2, $4, $5, '2026-01-01', true, 'active', $6),
           ($3, $4, $5, '2026-01-01', true, 'active', $6)`,
        [person, firstYearPerson, expiredPerson, roleId, yearId, sectionId],
      );
    });
    const continuing = await prisma.enrollments.create({
      data: {
        user_id: person,
        class_id: longClass.class_id,
        ecclesiastical_year_id: previousYear.year_id,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
      select: { enrollment_id: true },
    });
    const firstYear = await prisma.enrollments.create({
      data: {
        user_id: firstYearPerson,
        class_id: longClass.class_id,
        ecclesiastical_year_id: yearId,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
      select: { enrollment_id: true },
    });
    const expiredClass = await prisma.classes.create({
      data: {
        name: 'Amigo caducada',
        active: true,
        club_type_id: clubTypeId,
        minimum_age: 10,
        min_duration_years: 1,
        max_duration_years: 1,
      },
      select: { class_id: true },
    });
    const expired = await prisma.enrollments.create({
      data: {
        user_id: expiredPerson,
        class_id: expiredClass.class_id,
        ecclesiastical_year_id: previousYear.year_id,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
      select: { enrollment_id: true },
    });

    await expect(
      service.present(
        marker(),
        ACTOR,
        sectionId,
        yearId,
        DATE,
        [firstYear.enrollment_id],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_DURATION_MIN_NOT_MET,
    });
    const admitted = await service.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [continuing.enrollment_id],
      INSIDE,
    );
    expect(admitted.people).toHaveLength(1);
    expect(
      (
        await prisma.enrollments.findUnique({
          where: { enrollment_id: continuing.enrollment_id },
        })
      )?.ecclesiastical_year_id,
    ).toBe(previousYear.year_id);
    await expect(
      service.present(
        marker(),
        ACTOR,
        sectionId,
        yearId,
        DATE,
        [expired.enrollment_id],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_DURATION_EXPIRED,
    });
    expect(
      (
        await prisma.enrollments.findUnique({
          where: { enrollment_id: expired.enrollment_id },
        })
      )?.investiture_status,
    ).toBe('IN_PROGRESS');
  });

  it('presents a cross-type class from the same club class section', async () => {
    const gmType = await prisma.club_types.create({
      data: { name: 'Guías Mayores', active: true },
      select: { club_type_id: true },
    });
    const gmClass = await prisma.classes.create({
      data: {
        name: 'Guía Mayor P4',
        active: true,
        club_type_id: gmType.club_type_id,
        minimum_age: 16,
        min_duration_years: 1,
        max_duration_years: 1,
      },
      select: { class_id: true },
    });
    const gmSection = await prisma.club_sections.create({
      data: {
        active: true,
        club_type_id: gmType.club_type_id,
        main_club_id: clubId,
      },
      select: { club_section_id: true },
    });
    const homeClub = await prisma.clubs.findUniqueOrThrow({
      where: { club_id: clubId },
      select: {
        local_field_id: true,
        church_id: true,
        districlub_type_id: true,
      },
    });
    const otherClub = await prisma.clubs.create({
      data: {
        name: 'Otro club P4',
        active: true,
        local_field_id: homeClub.local_field_id,
        church_id: homeClub.church_id,
        districlub_type_id: homeClub.districlub_type_id,
        coordinates: {},
      },
      select: { club_id: true },
    });
    const otherSection = await prisma.club_sections.create({
      data: {
        active: true,
        club_type_id: clubTypeId,
        main_club_id: otherClub.club_id,
      },
      select: { club_section_id: true },
    });
    const person = 'abababab-abab-4aba-8aba-abababababab';
    await withClient(url, async (client) => {
      await client.query(
        `INSERT INTO users (user_id, email, name, active)
         VALUES ($1, 'cross-p4@p4.test', 'Cruzada', true)`,
        [person],
      );
      await client.query(
        `INSERT INTO club_role_assignments (
           user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id
         )
         VALUES ($1, $2, $3, '2026-01-01', true, 'active', $4)`,
        [person, roleId, yearId, gmSection.club_section_id],
      );
    });
    await prisma.enrollments.create({
      data: {
        user_id: person,
        class_id: gmClass.class_id,
        ecclesiastical_year_id: yearId,
        investiture_status: 'INVESTIDO',
        record_kind: 'HISTORICAL_CERTIFICATE',
        active: true,
      },
    });
    const crossType = await prisma.enrollments.create({
      data: {
        user_id: person,
        class_id: classId,
        ecclesiastical_year_id: yearId,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        cross_type_enrollment: true,
        active: true,
      },
      select: { enrollment_id: true },
    });

    await expect(
      service.present(
        marker(gmSection.club_section_id),
        ACTOR,
        gmSection.club_section_id,
        yearId,
        DATE,
        [crossType.enrollment_id],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION,
    });
    await expect(
      service.present(
        marker(otherSection.club_section_id),
        ACTOR,
        otherSection.club_section_id,
        yearId,
        DATE,
        [crossType.enrollment_id],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION,
    });
    const view = await service.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [crossType.enrollment_id],
      INSIDE,
    );
    expect(view.club_section_id).toBe(sectionId);
    expect(view.people[0].enrollment_id).toBe(crossType.enrollment_id);
  });

  it('keeps one visible request when two different people are presented together', async () => {
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const otherClass = await prisma.classes.create({
      data: {
        name: 'Compañero P4',
        active: true,
        club_type_id: clubTypeId,
        minimum_age: 10,
        min_duration_years: 1,
        max_duration_years: 1,
      },
      select: { class_id: true },
    });
    await withClient(url, async (client) => {
      await client.query(
        `INSERT INTO users (user_id, email, name, active)
         VALUES ($1, 'other-p4@p4.test', 'Otra', true)`,
        [other],
      );
      await client.query(
        `INSERT INTO club_role_assignments (
           user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id
         )
         VALUES ($1, $2, $3, '2026-01-01', true, 'active', $4)`,
        [other, roleId, yearId, sectionId],
      );
    });
    const otherEnrollment = await prisma.enrollments.create({
      data: {
        user_id: other,
        class_id: otherClass.class_id,
        ecclesiastical_year_id: yearId,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
      select: { enrollment_id: true },
    });

    const [first, second] = await Promise.all([
      present(),
      service.present(
        marker(),
        ACTOR,
        sectionId,
        yearId,
        DATE,
        [otherEnrollment.enrollment_id],
        INSIDE,
      ),
    ]);

    expect(first.request_id).toBe(second.request_id);
    expect(await prisma.investiture_authorization_requests.count()).toBe(1);
    const listed = await service.list(marker(), sectionId, yearId);
    expect(listed?.people.map((person) => person.user_id).sort()).toEqual(
      [MEMBER, other].sort(),
    );
  });

  it('does not revive an emptied request after another request is active', async () => {
    const other = '12121212-1212-4212-8212-121212121212';
    await withClient(url, async (client) => {
      await client.query(
        `INSERT INTO users (user_id, email, name, active)
         VALUES ($1, 'stale-p4@p4.test', 'Bruno', true)`,
        [other],
      );
      await client.query(
        `INSERT INTO club_role_assignments (
           user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id
         )
         VALUES ($1, $2, $3, '2026-01-01', true, 'active', $4)`,
        [other, roleId, yearId, sectionId],
      );
    });
    const otherEnrollment = await prisma.enrollments.create({
      data: {
        user_id: other,
        class_id: classId,
        ecclesiastical_year_id: yearId,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
      select: { enrollment_id: true },
    });
    const first = await present();
    await service.remove(
      marker(),
      ACTOR,
      first.request_id,
      first.people[0].person_id,
      INSIDE,
    );
    await expect(service.list(marker(), sectionId, yearId)).resolves.toBeNull();
    const second = await service.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [otherEnrollment.enrollment_id],
      INSIDE,
    );

    await expect(
      service.addPeople(
        marker(),
        ACTOR,
        first.request_id,
        '2026-11-15',
        [enrollmentId],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_STALE,
    });

    const pending = await prisma.investiture_authorization_people.findMany({
      where: { status: 'PENDING' },
    });
    expect(new Set(pending.map((row) => row.request_id)).size).toBe(1);
    const listed = await service.list(marker(), sectionId, yearId);
    expect(listed?.request_id).toBe(second.request_id);
    expect(
      listed?.people
        .filter((person) => person.status === 'PENDING')
        .map((person) => person.user_id),
    ).toEqual(pending.map((row) => row.user_id));
  });

  it('keeps one active request when adding to an old request races a new present', async () => {
    const other = '34343434-3434-4343-8343-343434343434';
    await withClient(url, async (client) => {
      await client.query(
        `INSERT INTO users (user_id, email, name, active)
         VALUES ($1, 'race-p4@p4.test', 'Carrera', true)`,
        [other],
      );
      await client.query(
        `INSERT INTO club_role_assignments (
           user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id
         )
         VALUES ($1, $2, $3, '2026-01-01', true, 'active', $4)`,
        [other, roleId, yearId, sectionId],
      );
    });
    const otherEnrollment = await prisma.enrollments.create({
      data: {
        user_id: other,
        class_id: classId,
        ecclesiastical_year_id: yearId,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
      select: { enrollment_id: true },
    });
    const first = await present();
    await service.remove(
      marker(),
      ACTOR,
      first.request_id,
      first.people[0].person_id,
      INSIDE,
    );
    const results = await Promise.allSettled([
      service.addPeople(
        marker(),
        ACTOR,
        first.request_id,
        '2026-11-15',
        [enrollmentId],
        INSIDE,
      ),
      service.present(
        marker(),
        ACTOR,
        sectionId,
        yearId,
        DATE,
        [otherEnrollment.enrollment_id],
        INSIDE,
      ),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({
          code: ErrorCode.INVESTITURE_REQUEST_STALE,
        });
      }
    }

    const pending = await prisma.investiture_authorization_people.findMany({
      where: { status: 'PENDING' },
    });
    expect(new Set(pending.map((row) => row.request_id)).size).toBe(1);
    const listed = await service.list(marker(), sectionId, yearId);
    expect(
      listed?.people
        .filter((person) => person.status === 'PENDING')
        .map((person) => person.user_id)
        .sort(),
    ).toEqual(pending.map((row) => row.user_id).sort());
  });

  it('does not save progress that passes the check before the request commits', async () => {
    const module = await prisma.class_modules.create({
      data: { name: 'Modulo P4', class_id: classId, active: true },
      select: { module_id: true },
    });
    const classSection = await prisma.class_sections.create({
      data: {
        name: 'Seccion P4',
        module_id: module.module_id,
        active: true,
      },
      select: { section_id: true },
    });
    const classes = new ClassesService(
      prisma as never,
      {
        upload: async () => {
          throw new Error('storage');
        },
        deleteMany: async () => undefined,
        getSignedDownloadUrl: async (value: string) => value,
        extractKeyFromPublicUrl: () => null,
      } as never,
      {} as never,
      {} as never,
      { assertCanAccessProgress: async () => undefined } as never,
      { calculateForEnrollment: async () => null } as never,
      { assertOperationalYearWrite: async () => undefined } as never,
    );
    const holder = new Client({ connectionString: url });
    await holder.connect();
    let released = false;
    try {
      await holder.query('BEGIN');
      await holder.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX}${enrollmentId}`],
      );
      const pid = await holder.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const presenting = present();
      await waitForAdvisoryWaiters(url, pid.rows[0].pid, 1);
      const writing = classes.updateSectionProgress(
        MEMBER,
        classId,
        module.module_id,
        classSection.section_id,
        0,
        undefined,
        enrollmentId,
        MEMBER,
      );
      await waitForAdvisoryWaiters(url, pid.rows[0].pid, 2);
      await holder.query('COMMIT');
      released = true;
      await holder.end();

      await expect(presenting).resolves.toMatchObject({
        club_section_id: sectionId,
      });
      await expect(writing).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_PROGRESS_LOCKED,
      });
    } finally {
      if (!released) {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end().catch(() => undefined);
      }
    }
    expect(
      await prisma.class_section_progress.count({
        where: { enrollment_id: enrollmentId },
      }),
    ).toBe(0);
  });

  function fieldAuth(
    role = 'director-lf',
    targetField = fieldId,
  ): AuthorizationSnapshot {
    return {
      grants: {
        global_roles: [
          {
            role_name: role,
            permissions: [],
            scope: { local_field: { id: targetField, name: 'Campo' } },
          },
        ],
        club_assignments: [],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        permissions: [],
        scope: {
          global: { local_field: { id: targetField, name: 'Campo' } },
          club: null,
        },
      },
    };
  }

  function globalAuth(role: string): AuthorizationSnapshot {
    return {
      grants: {
        global_roles: [{ role_name: role, permissions: [], scope: {} }],
        club_assignments: [],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: { permissions: [], scope: { global: {}, club: null } },
    };
  }

  it('invests on the last window days without the old pipeline or a second event', async () => {
    const view = await present();
    expect(events).toHaveLength(0);
    const personId = view.people[0].person_id;
    const today = new Date('2026-12-10T18:00:00.000Z');

    const resolved = await service.resolve(
      fieldAuth('assistant-lf'),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: personId }] },
      today,
    );

    expect(resolved.invested[0].status).toBe('INVESTED');
    const enrollment = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: enrollmentId },
    });
    expect(enrollment.investiture_status).toBe('INVESTIDO');
    expect(enrollment.investiture_date?.toISOString().slice(0, 10)).toBe(DATE);
    expect(
      await prisma.investiture_validation_history.count({
        where: { enrollment_id: enrollmentId },
      }),
    ).toBe(0);
    expect(events).toEqual([
      expect.objectContaining({ eventType: 'class.completed', userId: MEMBER }),
    ]);

    await expect(
      service.resolve(
        fieldAuth(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        today,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_ALREADY_RESOLVED,
    });
    expect(events).toHaveLength(1);
  });

  it('rejects roles and territories that cannot authorize', async () => {
    const view = await present();
    const personId = view.people[0].person_id;
    const attempt = (authorization: AuthorizationSnapshot) =>
      service.resolve(
        authorization,
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        INSIDE,
      );
    for (const role of [
      'admin',
      'super-admin',
      'director-union',
      'director-dia',
    ]) {
      await expect(attempt(globalAuth(role))).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
      });
    }
    await expect(
      attempt(fieldAuth('director-lf', fieldId + 50)),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    const other = await prisma.districts.create({
      data: { name: 'P4 Otro distrito', active: true, local_field_id: fieldId },
      select: { districlub_type_id: true },
    });
    await prisma.district_investiture_pastors.create({
      data: {
        districlub_type_id: other.districlub_type_id,
        user_id: ACTOR,
        active: true,
      },
    });
    await expect(attempt(globalAuth('pastor'))).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    await prisma.district_investiture_pastors.update({
      where: {
        districlub_type_id_user_id: {
          districlub_type_id: other.districlub_type_id,
          user_id: ACTOR,
        },
      },
      data: { active: false },
    });
    await prisma.district_investiture_pastors.create({
      data: { districlub_type_id: districtId, user_id: ACTOR, active: true },
    });
    const listed = await service.listForAuthorizer(
      globalAuth('pastor'),
      ACTOR,
      yearId,
    );
    expect(listed.map((row) => row.request_id)).toEqual([view.request_id]);
    const resolved = await attempt(globalAuth('pastor'));
    expect(resolved.invested).toHaveLength(1);
  });

  it('keeps authorization closed until the window itself is widened', async () => {
    const view = await present();
    const personId = view.people[0].person_id;
    const today = new Date('2026-12-21T18:00:00.000Z');
    await expect(
      service.resolve(
        fieldAuth(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        today,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
    });
    await service.changeDates(
      marker(),
      ACTOR,
      view.request_id,
      '2026-12-15',
      [personId],
      today,
    );
    await expect(
      service.resolve(
        fieldAuth(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        today,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
    });
    await prisma.local_field_investiture_windows.create({
      data: {
        local_field_id: fieldId,
        ecclesiastical_year_id: yearId,
        start_date: new Date('2026-10-01T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
      },
    });
    const resolved = await service.resolve(
      fieldAuth(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: personId }] },
      today,
    );
    expect(resolved.invested).toHaveLength(1);
  });

  it('does not authorize after the year even if the year row is still active', async () => {
    const view = await present();
    await expect(
      service.resolve(
        fieldAuth(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: view.people[0].person_id }] },
        new Date('2027-01-02T18:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
    await prisma.ecclesiastical_years.update({
      where: { year_id: yearId },
      data: { active: false },
    });
    await expect(
      service.resolve(
        fieldAuth(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: view.people[0].person_id }] },
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
    const enrollment = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: enrollmentId },
    });
    expect(enrollment.investiture_status).toBe('IN_PROGRESS');
  });

  it('system-rejects one person and invests the other in the same request', async () => {
    const other = '56565656-5656-4565-8565-565656565656';
    const otherClass = await prisma.classes.create({
      data: {
        name: 'Explorador P5',
        active: true,
        club_type_id: clubTypeId,
        minimum_age: 10,
        min_duration_years: 1,
        max_duration_years: 1,
      },
      select: { class_id: true },
    });
    await withClient(url, async (client) => {
      await client.query(
        `INSERT INTO users (user_id, email, name, active)
         VALUES ($1, 'partial-p5@p5.test', 'Bruno', true)`,
        [other],
      );
      await client.query(
        `INSERT INTO club_role_assignments (
           user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id
         )
         VALUES ($1, $2, $3, '2026-01-01', true, 'active', $4)`,
        [other, roleId, yearId, sectionId],
      );
    });
    const otherEnrollment = await prisma.enrollments.create({
      data: {
        user_id: other,
        class_id: otherClass.class_id,
        ecclesiastical_year_id: yearId,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
      select: { enrollment_id: true },
    });
    const view = await service.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [enrollmentId, otherEnrollment.enrollment_id],
      INSIDE,
    );
    eligibilityState.eligibleIds.add(enrollmentId);
    const resolved = await service.resolve(
      fieldAuth(),
      ACTOR,
      view.request_id,
      {
        invest: view.people.map((person) => ({ person_id: person.person_id })),
      },
      INSIDE,
    );
    expect(resolved.rejected_by_system).toHaveLength(1);
    expect(resolved.rejected_by_system[0].system_reason).toBe(
      INVESTITURE_SYSTEM_REJECTION_TEXT,
    );
    expect(resolved.invested).toHaveLength(1);
    const blocked = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: enrollmentId },
    });
    const invested = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: otherEnrollment.enrollment_id },
    });
    expect(blocked.investiture_status).toBe('IN_PROGRESS');
    expect(invested.investiture_status).toBe('INVESTIDO');
    const visible = await service.readForAuthorizer(
      fieldAuth(),
      ACTOR,
      view.request_id,
    );
    expect(visible.people.map((person) => person.status).sort()).toEqual([
      'INVESTED',
      'REJECTED_BY_SYSTEM',
    ]);
    expect(events).toHaveLength(1);
  });

  it('requires a human reason and does not invest that enrollment', async () => {
    const view = await present();
    await expect(
      service.resolve(
        fieldAuth(),
        ACTOR,
        view.request_id,
        { reject: [{ person_id: view.people[0].person_id, reason: '  ' }] },
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_REASON_REQUIRED,
    });
    const resolved = await service.resolve(
      fieldAuth(),
      ACTOR,
      view.request_id,
      {
        reject: [
          { person_id: view.people[0].person_id, reason: 'Faltan evidencias' },
        ],
      },
      INSIDE,
    );
    expect(resolved.rejected_by_person[0].rejection_reason).toBeNull();
    const stored =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: view.people[0].person_id },
      });
    expect(stored.rejection_reason).toBe('Faltan evidencias');
    const enrollment = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: enrollmentId },
    });
    expect(enrollment.investiture_status).toBe('IN_PROGRESS');
    expect(events).toHaveLength(0);
  });

  it('keeps one decision when authorize races reject, removal or year close', async () => {
    const view = await present();
    const personId = view.people[0].person_id;
    const raced = await Promise.allSettled([
      service.resolve(
        fieldAuth(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        INSIDE,
      ),
      service.resolve(
        fieldAuth(),
        ACTOR,
        view.request_id,
        { reject: [{ person_id: personId, reason: 'No cumple' }] },
        INSIDE,
      ),
    ]);
    expect(raced.filter((result) => result.status === 'rejected')).toHaveLength(
      1,
    );
    const afterRace =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: personId },
      });
    const enrollment = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: enrollmentId },
    });
    if (afterRace.status === 'INVESTED') {
      expect(enrollment.investiture_status).toBe('INVESTIDO');
      expect(events).toHaveLength(1);
    } else {
      expect(afterRace.status).toBe('REJECTED_BY_PERSON');
      expect(enrollment.investiture_status).toBe('IN_PROGRESS');
      expect(events).toHaveLength(0);
    }

    await prisma.enrollments.update({
      where: { enrollment_id: enrollmentId },
      data: { investiture_status: 'IN_PROGRESS', investiture_date: null },
    });
    await prisma.investiture_authorization_people.deleteMany();
    await prisma.investiture_authorization_requests.deleteMany();
    events.length = 0;
    const removed = await present();
    await Promise.allSettled([
      service.resolve(
        fieldAuth(),
        ACTOR,
        removed.request_id,
        { invest: [{ person_id: removed.people[0].person_id }] },
        INSIDE,
      ),
      service.remove(
        marker(),
        ACTOR,
        removed.request_id,
        removed.people[0].person_id,
        INSIDE,
      ),
    ]);
    const removedRow =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: removed.people[0].person_id },
      });
    const removedEnrollment = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: enrollmentId },
    });
    expect(['INVESTED', 'REMOVED']).toContain(removedRow.status);
    expect(removedEnrollment.investiture_status).toBe(
      removedRow.status === 'INVESTED' ? 'INVESTIDO' : 'IN_PROGRESS',
    );

    await prisma.enrollments.update({
      where: { enrollment_id: enrollmentId },
      data: { investiture_status: 'IN_PROGRESS', investiture_date: null },
    });
    await prisma.investiture_authorization_people.deleteMany();
    await prisma.investiture_authorization_requests.deleteMany();
    events.length = 0;
    const closing = await present();
    const closed = await Promise.allSettled([
      service.resolve(
        fieldAuth(),
        ACTOR,
        closing.request_id,
        { invest: [{ person_id: closing.people[0].person_id }] },
        INSIDE,
      ),
      prisma.$transaction((tx) =>
        closePendingInvestitureAuthorizations(tx, {
          request_id: closing.request_id,
        }),
      ),
    ]);
    const closedRow =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: closing.people[0].person_id },
      });
    const closedEnrollment = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: enrollmentId },
    });
    if (closedRow.status === 'INVESTED') {
      expect(closedEnrollment.investiture_status).toBe('INVESTIDO');
      expect(
        closed.some(
          (result) => result.status === 'fulfilled' && result.value === 0,
        ),
      ).toBe(true);
    } else {
      expect(closedRow.status).toBe('CLOSED_YEAR');
      expect(closedEnrollment.investiture_status).toBe('IN_PROGRESS');
      expect(events).toHaveLength(0);
      expect(
        closed.some(
          (result) =>
            result.status === 'rejected' &&
            result.reason.code ===
              ErrorCode.INVESTITURE_REQUEST_ALREADY_RESOLVED,
        ),
      ).toBe(true);
    }
  });

  it('rolls nothing forward when eligibility throws before the decision is stored', async () => {
    const view = await present();
    eligibilityState.fail = true;
    await expect(
      service.resolve(
        fieldAuth(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: view.people[0].person_id }] },
        INSIDE,
      ),
    ).rejects.toThrow('eligibility failed');
    const person =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: view.people[0].person_id },
      });
    const enrollment = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: enrollmentId },
    });
    expect(person.status).toBe('PENDING');
    expect(person.achievement_intent_key).toBeNull();
    expect(enrollment.investiture_status).toBe('IN_PROGRESS');
    expect(events).toHaveLength(0);
  });

  it('rejects year, window, and pastor changes committed while the section lock is held', async () => {
    const sectionKey = `${INVESTITURE_REQUEST_SECTION_LOCK_PREFIX}${sectionId}:${yearId}`;
    const cases = [
      {
        code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
        authorization: () => fieldAuth(),
        change: async () => {
          await prisma.ecclesiastical_years.update({
            where: { year_id: yearId },
            data: { active: false },
          });
        },
      },
      {
        code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
        authorization: () => fieldAuth(),
        change: async () => {
          await prisma.local_field_investiture_windows.create({
            data: {
              local_field_id: fieldId,
              ecclesiastical_year_id: yearId,
              start_date: new Date('2026-10-01T00:00:00.000Z'),
              end_date: new Date('2026-10-14T00:00:00.000Z'),
            },
          });
        },
      },
      {
        code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
        authorization: () => globalAuth('pastor'),
        change: async () => {
          await prisma.district_investiture_pastors.updateMany({
            where: { user_id: ACTOR },
            data: { active: false },
          });
        },
      },
    ];

    for (const item of cases) {
      await prisma.investiture_authorization_people.deleteMany();
      await prisma.investiture_authorization_requests.deleteMany();
      await prisma.local_field_investiture_windows.deleteMany();
      await prisma.district_investiture_pastors.deleteMany();
      await prisma.ecclesiastical_years.update({
        where: { year_id: yearId },
        data: { active: true },
      });
      await prisma.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: { investiture_status: 'IN_PROGRESS', investiture_date: null },
      });
      if (item.code === ErrorCode.INVESTITURE_REQUEST_FORBIDDEN) {
        await prisma.district_investiture_pastors.create({
          data: {
            districlub_type_id: districtId,
            user_id: ACTOR,
            active: true,
          },
        });
      }
      const view = await present();
      const holder = await holdAdvisory(sectionKey);
      const pending = service.resolve(
        item.authorization(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: view.people[0].person_id }] },
        INSIDE,
      );
      const settled = pending.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      try {
        await waitForAdvisoryWaiter(holder.pid);
        await item.change();
      } finally {
        await holder.release();
      }
      const result = await settled;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({ code: item.code });
      }
      const person =
        await prisma.investiture_authorization_people.findUniqueOrThrow({
          where: { person_id: view.people[0].person_id },
        });
      const enrollment = await prisma.enrollments.findUniqueOrThrow({
        where: { enrollment_id: enrollmentId },
      });
      expect(person.status).toBe('PENDING');
      expect(person.achievement_intent_key).toBeNull();
      expect(enrollment.investiture_status).not.toBe('INVESTIDO');
      expect(events).toHaveLength(0);
      await expect(
        service.resolve(
          item.authorization(),
          ACTOR,
          view.request_id,
          { invest: [{ person_id: view.people[0].person_id }] },
          INSIDE,
        ),
      ).rejects.toMatchObject({ code: item.code });
    }
  });

  it('keeps a window change behind the calendar lock until the decision is stored', async () => {
    const view = await present();
    const holder = await holdLock();
    const pending = service.resolve(
      fieldAuth(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: view.people[0].person_id }] },
      INSIDE,
    );
    await waitForAdvisoryWaiter(holder.pid);
    const writer = (async () => {
      const client = new Client({ connectionString: url });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${INVESTITURE_REQUEST_YEAR_LOCK_PREFIX}${yearId}`],
        );
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${INVESTITURE_REQUEST_CALENDAR_LOCK_PREFIX}${fieldId}:${yearId}`],
        );
        await client.query(
          `INSERT INTO local_field_investiture_windows
             (local_field_id, ecclesiastical_year_id, start_date, end_date)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (local_field_id, ecclesiastical_year_id)
           DO UPDATE SET end_date = EXCLUDED.end_date`,
          [fieldId, yearId, '2026-10-01', '2026-10-14'],
        );
        await client.query('COMMIT');
      } finally {
        await client.end();
      }
    })();
    await waitForAdvisoryWaiters(url, holder.pid, 2);
    await holder.release();
    const resolved = await pending;
    await writer;
    expect(resolved.invested).toHaveLength(1);
    const enrollment = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: enrollmentId },
    });
    const window =
      await prisma.local_field_investiture_windows.findUniqueOrThrow({
        where: {
          local_field_id_ecclesiastical_year_id: {
            local_field_id: fieldId,
            ecclesiastical_year_id: yearId,
          },
        },
      });
    expect(enrollment.investiture_status).toBe('INVESTIDO');
    expect(window.end_date.toISOString().slice(0, 10)).toBe('2026-10-14');
  });

  it('recovers one class.completed after a failed insert and a concurrent retry', async () => {
    const originalCreate = prisma.achievement_event_log.create.bind(
      prisma.achievement_event_log,
    );
    let failures = 1;
    prisma.achievement_event_log.create = (async (args) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('insert failed');
      }
      return originalCreate(args);
    }) as typeof prisma.achievement_event_log.create;
    const durable = new AchievementsService(
      prisma as never,
      {} as never,
      {} as never,
      undefined,
    );
    const local = new InvestitureAuthorizationRequestService(
      prisma as never,
      {
        calculateForEnrollment: async () => ({
          investiture_eligibility: { eligible: true },
        }),
      } as never,
      durable,
    );
    try {
      const view = await present();
      const personId = view.people[0].person_id;
      const resolved = await local.resolve(
        fieldAuth(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        INSIDE,
      );
      expect(resolved.invested).toHaveLength(1);
      expect(
        await prisma.achievement_event_log.count({
          where: { user_id: MEMBER, event_type: 'class.completed' },
        }),
      ).toBe(0);
      const person =
        await prisma.investiture_authorization_people.findUniqueOrThrow({
          where: { person_id: personId },
        });
      expect(person.achievement_intent_key).toBe(
        `investiture-authorization:${personId}`,
      );
      const retries = await Promise.allSettled([
        local.resolve(
          fieldAuth(),
          ACTOR,
          view.request_id,
          { invest: [{ person_id: personId }] },
          INSIDE,
        ),
        local.resolve(
          fieldAuth(),
          ACTOR,
          view.request_id,
          { invest: [{ person_id: personId }] },
          INSIDE,
        ),
      ]);
      expect(retries.every((item) => item.status === 'rejected')).toBe(true);
      for (const item of retries) {
        if (item.status === 'rejected') {
          expect(item.reason).toMatchObject({
            code: ErrorCode.INVESTITURE_REQUEST_ALREADY_RESOLVED,
          });
        }
      }
      expect(
        await prisma.achievement_event_log.count({
          where: {
            idempotency_key: `investiture-authorization:${personId}`,
          },
        }),
      ).toBe(1);
    } finally {
      prisma.achievement_event_log.create = originalCreate;
    }
  });

  it('rejects a lock wait that crosses midnight at the end of the window or the year', async () => {
    const sectionKey = `${INVESTITURE_REQUEST_SECTION_LOCK_PREFIX}${sectionId}:${yearId}`;
    const cases = [
      {
        code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
        start: new Date('2026-12-21T05:59:59.000Z'),
        next: new Date('2026-12-21T06:00:01.000Z'),
        prepare: async () => undefined,
      },
      {
        code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
        start: new Date('2027-01-01T05:59:59.000Z'),
        next: new Date('2027-01-01T06:00:01.000Z'),
        prepare: async () => {
          await prisma.local_field_investiture_windows.create({
            data: {
              local_field_id: fieldId,
              ecclesiastical_year_id: yearId,
              start_date: new Date('2026-10-01T00:00:00.000Z'),
              end_date: new Date('2026-12-31T00:00:00.000Z'),
            },
          });
        },
      },
    ];

    for (const item of cases) {
      await prisma.investiture_authorization_people.deleteMany();
      await prisma.investiture_authorization_requests.deleteMany();
      await prisma.local_field_investiture_windows.deleteMany();
      await prisma.achievement_event_log.deleteMany({
        where: { user_id: MEMBER },
      });
      await prisma.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: { investiture_status: 'IN_PROGRESS', investiture_date: null },
      });
      events.length = 0;
      await item.prepare();
      let current = item.start;
      const local = new InvestitureAuthorizationRequestService(
        prisma as never,
        {
          calculateForEnrollment: async () => ({
            investiture_eligibility: { eligible: true },
          }),
        } as never,
        {
          emitEvent: async (dto: { idempotencyKey?: string }) => {
            events.push(dto);
            return { eventLogId: events.length, queued: false };
          },
        } as never,
        { now: () => current },
      );
      const view = await present();
      const holder = await holdAdvisory(sectionKey);
      const pending = local.resolve(fieldAuth(), ACTOR, view.request_id, {
        invest: [{ person_id: view.people[0].person_id }],
      });
      const settled = pending.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      try {
        await waitForAdvisoryWaiter(holder.pid);
        current = item.next;
      } finally {
        await holder.release();
      }
      const result = await settled;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({ code: item.code });
      }
      const person =
        await prisma.investiture_authorization_people.findUniqueOrThrow({
          where: { person_id: view.people[0].person_id },
        });
      const enrollment = await prisma.enrollments.findUniqueOrThrow({
        where: { enrollment_id: enrollmentId },
      });
      expect(person.status).toBe('PENDING');
      expect(person.achievement_intent_key).toBeNull();
      expect(enrollment.investiture_status).not.toBe('INVESTIDO');
      expect(events).toHaveLength(0);
      expect(
        await prisma.achievement_event_log.count({
          where: { user_id: MEMBER },
        }),
      ).toBe(0);
    }
  });

  it('delivers a confirmed intent after the year closes without another resolution', async () => {
    const originalCreate = prisma.achievement_event_log.create.bind(
      prisma.achievement_event_log,
    );
    let failures = 1;
    prisma.achievement_event_log.create = (async (args) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('insert failed');
      }
      return originalCreate(args);
    }) as typeof prisma.achievement_event_log.create;
    const durable = new AchievementsService(
      prisma as never,
      {} as never,
      {} as never,
      undefined,
    );
    const local = new InvestitureAuthorizationRequestService(
      prisma as never,
      {
        calculateForEnrollment: async () => ({
          investiture_eligibility: { eligible: true },
        }),
      } as never,
      durable,
    );
    try {
      const view = await present();
      const personId = view.people[0].person_id;
      const resolved = await local.resolve(
        fieldAuth(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        INSIDE,
      );
      expect(resolved.invested).toHaveLength(1);
      expect(
        await prisma.achievement_event_log.count({
          where: { idempotency_key: `investiture-authorization:${personId}` },
        }),
      ).toBe(0);
      await prisma.ecclesiastical_years.update({
        where: { year_id: yearId },
        data: { active: false },
      });
      await expect(
        local.resolve(fieldAuth(), ACTOR, view.request_id, {
          invest: [{ person_id: personId }],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
      });
      expect(
        await prisma.achievement_event_log.count({
          where: { idempotency_key: `investiture-authorization:${personId}` },
        }),
      ).toBe(0);
      const recovered = await Promise.all([
        local.reconcileConfirmedAchievementIntents(),
        local.reconcileConfirmedAchievementIntents(),
      ]);
      expect(recovered.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(
        0,
      );
      expect(
        await prisma.achievement_event_log.count({
          where: { idempotency_key: `investiture-authorization:${personId}` },
        }),
      ).toBe(1);
      const person =
        await prisma.investiture_authorization_people.findUniqueOrThrow({
          where: { person_id: personId },
        });
      const enrollment = await prisma.enrollments.findUniqueOrThrow({
        where: { enrollment_id: enrollmentId },
      });
      expect(person.status).toBe('INVESTED');
      expect(enrollment.investiture_status).toBe('INVESTIDO');
    } finally {
      prisma.achievement_event_log.create = originalCreate;
    }
  });

  it('enqueues one evaluation after a queue failure even if the year is closed', async () => {
    const jobs = new Map<
      string,
      { name: string; data: { eventLogId?: number } }
    >();
    let failures = 1;
    const queue = {
      add: async (
        name: string,
        data: { eventLogId?: number },
        opts: { jobId?: string } = {},
      ) => {
        const probe = Object.create(Job.prototype) as {
          opts: { jobId?: string };
          name: string;
          validateOptions: (jobData: { data: string }) => void;
        };
        probe.opts = opts;
        probe.name = name;
        probe.validateOptions({ data: JSON.stringify(data ?? {}) });
        if (failures > 0) {
          failures -= 1;
          throw new Error('redis down');
        }
        const id = opts.jobId ?? '';
        if (jobs.has(id)) {
          throw new Error(`Job ${id} already exists`);
        }
        jobs.set(id, { name, data });
        return { id };
      },
    };
    const durable = new AchievementsService(
      prisma as never,
      {} as never,
      {} as never,
      queue as never,
    );
    const local = new InvestitureAuthorizationRequestService(
      prisma as never,
      {
        calculateForEnrollment: async () => ({
          investiture_eligibility: { eligible: true },
        }),
      } as never,
      durable,
    );
    const view = await present();
    const personId = view.people[0].person_id;
    const intent = `investiture-authorization:${personId}`;
    const resolved = await local.resolve(
      fieldAuth(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: personId }] },
      INSIDE,
    );
    expect(resolved.invested).toHaveLength(1);
    expect(jobs.size).toBe(0);
    const stored = await prisma.achievement_event_log.findFirstOrThrow({
      where: { idempotency_key: intent },
    });
    expect(stored.processed).toBe(false);
    await prisma.ecclesiastical_years.update({
      where: { year_id: yearId },
      data: { active: false },
    });
    await expect(
      local.resolve(fieldAuth(), ACTOR, view.request_id, {
        invest: [{ person_id: personId }],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
    expect(jobs.size).toBe(0);
    await Promise.all([
      local.reconcileConfirmedAchievementIntents(),
      local.reconcileConfirmedAchievementIntents(),
    ]);
    expect(jobs.size).toBe(1);
    expect([...jobs.keys()][0]).toBe(achievementQueueJobId(intent));
    expect(
      await prisma.achievement_event_log.count({
        where: { idempotency_key: intent },
      }),
    ).toBe(1);
    const processor = new AchievementsProcessor(
      prisma as never,
      {} as never,
      { notifySafe: async () => undefined } as never,
    );
    const queued = [...jobs.values()][0];
    await processor.process({
      name: queued.name,
      data: queued.data,
    } as never);
    const evaluated = await prisma.achievement_event_log.findFirstOrThrow({
      where: { idempotency_key: intent },
    });
    expect(evaluated.processed).toBe(true);
    await expect(
      processor.process({
        name: queued.name,
        data: queued.data,
      } as never),
    ).resolves.toEqual({ processed: 0 });
    expect(
      await prisma.achievement_event_log.count({
        where: { idempotency_key: intent },
      }),
    ).toBe(1);
  });

  it('does not emit class.completed when the decision is rejected, removed, or closed', async () => {
    const view = await present();
    const personId = view.people[0].person_id;
    await service.resolve(
      fieldAuth(),
      ACTOR,
      view.request_id,
      { reject: [{ person_id: personId, reason: 'No corresponde' }] },
      INSIDE,
    );
    const rejected =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: personId },
      });
    expect(rejected.achievement_intent_key).toBeNull();
    expect(events).toHaveLength(0);

    const marked = await present();
    const markedPerson = marked.people.find(
      (person) => person.status === 'PENDING',
    );
    if (!markedPerson) {
      throw new Error('missing pending person');
    }
    await service.remove(
      marker(),
      ACTOR,
      marked.request_id,
      markedPerson.person_id,
      INSIDE,
    );
    const removed =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: markedPerson.person_id },
      });
    expect(removed.achievement_intent_key).toBeNull();

    const pending = await present();
    const pendingPerson = pending.people.find(
      (person) => person.status === 'PENDING',
    );
    if (!pendingPerson) {
      throw new Error('missing pending person');
    }
    await prisma.$transaction((tx) =>
      closePendingInvestitureAuthorizations(tx, {
        request_id: pending.request_id,
      }),
    );
    const closed =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: pendingPerson.person_id },
      });
    expect(closed.status).toBe('CLOSED_YEAR');
    expect(closed.achievement_intent_key).toBeNull();
    expect(
      await prisma.achievement_event_log.count({
        where: { user_id: MEMBER, event_type: 'class.completed' },
      }),
    ).toBe(0);
  });

  it('stores one dispatch per recipient, role and execution', async () => {
    const data = {
      kind: 'REMINDER' as const,
      execution_key: '2026-10-05',
      recipient_user_id: MEMBER,
      role: 'pastor',
      scope_key: 'field:1',
      payload: { channel: 'email', paragraphs: ['Ana'] },
    };
    await prisma.investiture_message_dispatches.create({ data });
    await expect(
      prisma.investiture_message_dispatches.create({ data }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.investiture_message_dispatches.create({
      data: { ...data, role: 'director-lf' },
    });
    expect(
      await prisma.investiture_message_dispatches.count({
        where: { execution_key: '2026-10-05', recipient_user_id: MEMBER },
      }),
    ).toBe(2);
  });

  it('stores a new presentation intent after remove, reject, and an empty header', async () => {
    const communications = new InvestitureCommunicationsService(
      prisma as never,
      {
        sendInvestitureNotice: async () => undefined,
        inspectInvestitureJob: async () => 'missing' as const,
        retryFailedInvestitureJob: async () => undefined,
      } as never,
      { pushBestEffort: async () => undefined } as never,
      { get: () => '' } as never,
    );
    const local = new InvestitureAuthorizationRequestService(
      prisma as never,
      {
        calculateForEnrollment: async () => ({
          investiture_eligibility: { eligible: true },
        }),
      } as never,
      { emitEvent: async () => ({ eventLogId: 1, queued: false }) } as never,
      undefined,
      communications,
    );
    await prisma.investiture_message_dispatches.deleteMany();

    const operationId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await communications.stagePresentation(tx, {
        requestId: randomUUID(),
        enrollmentIds: [enrollmentId],
        operationId,
      });
      await communications.stagePresentation(tx, {
        requestId: randomUUID(),
        enrollmentIds: [enrollmentId],
        operationId,
      });
      await tx.investiture_authorization_requests.updateMany({
        data: { created_at: new Date() },
      });
    });
    expect(
      await prisma.investiture_message_dispatches.count({
        where: { execution_key: `presentation:${operationId}` },
      }),
    ).toBe(1);

    await prisma.investiture_message_dispatches.deleteMany();
    const sameHeader = await local.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [enrollmentId],
      INSIDE,
    );
    await local.remove(
      marker(),
      ACTOR,
      sameHeader.request_id,
      sameHeader.people[0].person_id,
      INSIDE,
    );
    const readded = await local.addPeople(
      marker(),
      ACTOR,
      sameHeader.request_id,
      DATE,
      [enrollmentId],
      INSIDE,
    );
    expect(readded.request_id).toBe(sameHeader.request_id);
    expect(await presentationIntents(prisma, enrollmentId)).toBe(2);
    expect(
      await prisma.investiture_authorization_people.count({
        where: { request_id: sameHeader.request_id, status: 'PENDING' },
      }),
    ).toBe(1);

    await prisma.investiture_message_dispatches.deleteMany();
    await prisma.investiture_authorization_people.deleteMany();
    await prisma.investiture_authorization_requests.deleteMany();
    const removed = await local.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [enrollmentId],
      INSIDE,
    );
    await local.remove(
      marker(),
      ACTOR,
      removed.request_id,
      removed.people[0].person_id,
      INSIDE,
    );
    const represented = await local.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [enrollmentId],
      INSIDE,
    );
    expect(represented.request_id).not.toBe(removed.request_id);
    expect(await prisma.investiture_authorization_requests.count()).toBe(2);
    expect(await presentationIntents(prisma, enrollmentId)).toBe(2);

    await prisma.investiture_message_dispatches.deleteMany();
    await prisma.investiture_authorization_people.deleteMany();
    await prisma.investiture_authorization_requests.deleteMany();
    const rejected = await local.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [enrollmentId],
      INSIDE,
    );
    await local.resolve(
      fieldAuth(),
      ACTOR,
      rejected.request_id,
      {
        reject: [
          {
            person_id: rejected.people[0].person_id,
            reason: 'Faltan evidencias',
          },
        ],
      },
      INSIDE,
    );
    const afterReject = await local.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [enrollmentId],
      INSIDE,
    );
    expect(afterReject.request_id).not.toBe(rejected.request_id);
    expect(
      await prisma.investiture_authorization_people.count({
        where: { enrollment_id: enrollmentId },
      }),
    ).toBe(2);
    expect(await presentationIntents(prisma, enrollmentId)).toBe(2);
  });

  function yearEndService(): YearEndService {
    return new YearEndService(
      prisma as never,
      {
        generate: async () => undefined,
      } as never,
    );
  }

  function yearCutService(enrolled: { count: number }): YearCutService {
    return new YearCutService(
      prisma as never,
      {
        getCurrentYear: async () => ({
          year_id: yearId,
          start_date: new Date('2026-01-01T00:00:00.000Z'),
          end_date: new Date('2026-12-31T00:00:00.000Z'),
        }),
      } as never,
      { bumpMany: async () => undefined } as never,
      { invalidateUserAuthorizationCache: async () => undefined } as never,
      {
        ensureNotEnrolled: async () => {
          enrolled.count += 1;
          return 'not_enrolled';
        },
      } as never,
      { resolve: async () => ({ kind: 'none' }) } as never,
      {
        writeTypeJumpEnrollment: async () => {
          enrolled.count += 1;
          return 'enrolled';
        },
      } as never,
    );
  }

  function grant(
    targetSectionId: number,
    targetYearId: number,
  ): AuthorizationSnapshot {
    const snapshot = marker(targetSectionId);
    const assignment = snapshot.grants.club_assignments[0];
    return {
      ...snapshot,
      grants: {
        ...snapshot.grants,
        club_assignments: [
          {
            ...assignment,
            ecclesiastical_year_id: targetYearId,
            section: {
              club_section_id: targetSectionId,
              club_type_id: assignment.section.club_type_id,
            },
          },
        ],
      },
    };
  }

  async function seedEndedSection(
    label: string,
    withAssignment = true,
  ): Promise<{
    clubId: number;
    sectionId: number;
    yearId: number;
    enrollmentId: number;
    classId: number;
    userId: string;
  }> {
    const userId = randomUUID();
    const parent = await prisma.clubs.findUniqueOrThrow({
      where: { club_id: clubId },
      select: {
        local_field_id: true,
        church_id: true,
        districlub_type_id: true,
      },
    });
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const year = await client.query<{ year_id: number }>(
        `INSERT INTO ecclesiastical_years (start_date, end_date, active)
         VALUES ('2024-01-01', '2024-12-31', true)
         RETURNING year_id`,
      );
      const club = await client.query<{ club_id: number }>(
        `INSERT INTO clubs (
           name, active, local_field_id, church_id, coordinates, districlub_type_id
         )
         VALUES ($1, true, $2, $3, '{}'::json, $4)
         RETURNING club_id`,
        [
          `P7 ${label}`,
          parent.local_field_id,
          parent.church_id,
          parent.districlub_type_id,
        ],
      );
      const createdClass = await client.query<{ class_id: number }>(
        `INSERT INTO classes (
           name, active, club_type_id, minimum_age, min_duration_years, max_duration_years
         )
         VALUES ($1, true, $2, 10, 1, 30)
         RETURNING class_id`,
        [`Clase ${label}`, clubTypeId],
      );
      const section = await client.query<{ club_section_id: number }>(
        `INSERT INTO club_sections (active, club_type_id, main_club_id)
         VALUES (true, $1, $2)
         RETURNING club_section_id`,
        [clubTypeId, club.rows[0].club_id],
      );
      await client.query(
        `INSERT INTO users (user_id, email, name, active)
         VALUES ($1, $2, 'P7', true)`,
        [userId, `${label}@p7.test`],
      );
      if (withAssignment) {
        await client.query(
          `INSERT INTO club_role_assignments (
             user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id
           )
           VALUES ($1, $2, $3, '2024-01-01', true, 'active', $4)`,
          [
            userId,
            roleId,
            year.rows[0].year_id,
            section.rows[0].club_section_id,
          ],
        );
      }
      const enrollment = await client.query<{ enrollment_id: number }>(
        `INSERT INTO enrollments (
           user_id, class_id, ecclesiastical_year_id, investiture_status, record_kind, active
         )
         VALUES ($1, $2, $3, 'IN_PROGRESS', 'OPERATIONAL', true)
         RETURNING enrollment_id`,
        [userId, createdClass.rows[0].class_id, year.rows[0].year_id],
      );
      return {
        clubId: club.rows[0].club_id,
        sectionId: section.rows[0].club_section_id,
        yearId: year.rows[0].year_id,
        enrollmentId: enrollment.rows[0].enrollment_id,
        classId: createdClass.rows[0].class_id,
        userId,
      };
    } finally {
      await client.end();
    }
  }

  it('includes a waiting presentation in the administrative close', async () => {
    const held = await holdAdvisory(
      `${INVESTITURE_REQUEST_SECTION_LOCK_PREFIX}${sectionId}:${yearId}`,
    );
    const presentation = present();
    await waitForAdvisoryWaiter(held.pid);
    const closing = yearEndService().closeYear(yearId);
    await waitForAdvisoryWaiters(url, held.pid, 2);
    await held.release();
    await presentation;
    const summary = await closing;
    expect(summary.investiturePendingClosed).toBeGreaterThanOrEqual(1);
    const rows = await prisma.investiture_authorization_people.findMany({
      where: { enrollment_id: enrollmentId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('CLOSED_YEAR');
  });

  it('includes a waiting addition in the administrative close', async () => {
    const request = await prisma.investiture_authorization_requests.create({
      data: {
        club_section_id: sectionId,
        ecclesiastical_year_id: yearId,
        created_by_id: ACTOR,
      },
    });
    const held = await holdAdvisory(
      `${INVESTITURE_REQUEST_SECTION_LOCK_PREFIX}${sectionId}:${yearId}`,
    );
    const adding = service.addPeople(
      marker(),
      ACTOR,
      request.request_id,
      DATE,
      [enrollmentId],
      INSIDE,
    );
    await waitForAdvisoryWaiter(held.pid);
    const closing = yearEndService().closeYear(yearId);
    await waitForAdvisoryWaiters(url, held.pid, 2);
    await held.release();
    await adding;
    await closing;
    const rows = await prisma.investiture_authorization_people.findMany({
      where: { enrollment_id: enrollmentId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('CLOSED_YEAR');
  });

  it('rejects a presentation that was waiting when the year became inactive', async () => {
    const held = await holdAdvisory(
      `${INVESTITURE_REQUEST_YEAR_LOCK_PREFIX}${yearId}`,
    );
    const presentation = present();
    await waitForAdvisoryWaiter(held.pid);
    await prisma.ecclesiastical_years.update({
      where: { year_id: yearId },
      data: { active: false },
    });
    await held.release();
    await expect(presentation).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
    expect(await prisma.investiture_authorization_people.count()).toBe(0);
  });

  it('rejects an addition that was waiting when the year became inactive', async () => {
    const request = await prisma.investiture_authorization_requests.create({
      data: {
        club_section_id: sectionId,
        ecclesiastical_year_id: yearId,
        created_by_id: ACTOR,
      },
    });
    const held = await holdAdvisory(
      `${INVESTITURE_REQUEST_YEAR_LOCK_PREFIX}${yearId}`,
    );
    const adding = service.addPeople(
      marker(),
      ACTOR,
      request.request_id,
      DATE,
      [enrollmentId],
      INSIDE,
    );
    await waitForAdvisoryWaiter(held.pid);
    await prisma.ecclesiastical_years.update({
      where: { year_id: yearId },
      data: { active: false },
    });
    await held.release();
    await expect(adding).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
    expect(await prisma.investiture_authorization_people.count()).toBe(0);
  });

  it('closes ended-year requests even when the club transition is already complete', async () => {
    const ended = await seedEndedSection('complete');
    const investedClass = await prisma.classes.create({
      data: {
        name: 'Clase investida P7',
        active: true,
        club_type_id: clubTypeId,
        minimum_age: 10,
      },
    });
    const investedEnrollment = await prisma.enrollments.create({
      data: {
        user_id: ended.userId,
        class_id: investedClass.class_id,
        ecclesiastical_year_id: ended.yearId,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
        cross_type_enrollment: true,
      },
    });
    const request = await prisma.investiture_authorization_requests.create({
      data: {
        club_section_id: ended.sectionId,
        ecclesiastical_year_id: ended.yearId,
        created_by_id: ACTOR,
      },
    });
    await prisma.investiture_authorization_people.createMany({
      data: [
        {
          request_id: request.request_id,
          user_id: ended.userId,
          class_id: ended.classId,
          enrollment_id: ended.enrollmentId,
          investiture_date: new Date('2024-11-01T00:00:00.000Z'),
          status: 'PENDING',
          single_slot: false,
        },
        {
          request_id: request.request_id,
          user_id: ended.userId,
          class_id: investedClass.class_id,
          enrollment_id: investedEnrollment.enrollment_id,
          investiture_date: new Date('2024-11-01T00:00:00.000Z'),
          status: 'INVESTED',
          single_slot: false,
        },
      ],
    });
    await prisma.club_year_transitions.create({
      data: {
        club_id: ended.clubId,
        ecclesiastical_year_id: yearId,
        status: 'completed',
      },
    });
    const bare = await seedEndedSection('bare', false);
    const bareRequest = await prisma.investiture_authorization_requests.create({
      data: {
        club_section_id: bare.sectionId,
        ecclesiastical_year_id: bare.yearId,
        created_by_id: ACTOR,
      },
    });
    await prisma.investiture_authorization_people.create({
      data: {
        request_id: bareRequest.request_id,
        user_id: bare.userId,
        class_id: bare.classId,
        enrollment_id: bare.enrollmentId,
        investiture_date: new Date('2024-11-01T00:00:00.000Z'),
        status: 'PENDING',
        single_slot: false,
      },
    });
    const enrolled = { count: 0 };
    const cut = yearCutService(enrolled);
    const summary = await cut.applyCut(new Date('2026-10-15T18:00:00.000Z'));
    expect(summary.investiturePendingClosed).toBeGreaterThanOrEqual(2);
    const closed = await prisma.investiture_authorization_people.findMany({
      where: {
        enrollment_id: { in: [ended.enrollmentId, bare.enrollmentId] },
      },
    });
    expect(closed.map((row) => row.status).sort()).toEqual([
      'CLOSED_YEAR',
      'CLOSED_YEAR',
    ]);
    const invested = await prisma.investiture_authorization_people.findFirst({
      where: { enrollment_id: investedEnrollment.enrollment_id },
    });
    expect(invested?.status).toBe('INVESTED');
    expect(
      await prisma.investiture_authorization_requests.count({
        where: {
          club_section_id: { in: [ended.sectionId, bare.sectionId] },
          ecclesiastical_year_id: yearId,
        },
      }),
    ).toBe(0);
    expect(enrolled.count).toBe(0);
    const again = await cut.applyCut(new Date('2026-10-15T18:00:00.000Z'));
    expect(again.investiturePendingClosed).toBe(0);
    expect(enrolled.count).toBe(0);
    expect(
      await prisma.club_role_assignments.count({
        where: {
          club_section_id: { in: [ended.sectionId, bare.sectionId] },
          status: 'active',
          ecclesiastical_year_id: yearId,
        },
      }),
    ).toBe(0);
  });

  it('includes a waiting presentation of an ended year in the automatic cut', async () => {
    const ended = await seedEndedSection('race-present');
    const insideEnded = new Date('2024-10-15T18:00:00.000Z');
    const held = await holdAdvisory(
      `${INVESTITURE_REQUEST_SECTION_LOCK_PREFIX}${ended.sectionId}:${ended.yearId}`,
    );
    const presentation = service.present(
      grant(ended.sectionId, ended.yearId),
      ACTOR,
      ended.sectionId,
      ended.yearId,
      '2024-11-01',
      [ended.enrollmentId],
      insideEnded,
    );
    await waitForAdvisoryWaiter(held.pid);
    const cutting = yearCutService({ count: 0 }).applyCut(
      new Date('2026-10-15T18:00:00.000Z'),
    );
    await waitForAdvisoryWaiters(url, held.pid, 2);
    await held.release();
    await presentation;
    const summary = await cutting;
    expect(summary.investiturePendingClosed).toBeGreaterThanOrEqual(1);
    const row = await prisma.investiture_authorization_people.findFirst({
      where: { enrollment_id: ended.enrollmentId },
    });
    expect(row?.status).toBe('CLOSED_YEAR');
  });

  it('includes a waiting addition of an ended year in the automatic cut', async () => {
    const ended = await seedEndedSection('race-add');
    const request = await prisma.investiture_authorization_requests.create({
      data: {
        club_section_id: ended.sectionId,
        ecclesiastical_year_id: ended.yearId,
        created_by_id: ACTOR,
      },
    });
    const insideEnded = new Date('2024-10-15T18:00:00.000Z');
    const held = await holdAdvisory(
      `${INVESTITURE_REQUEST_SECTION_LOCK_PREFIX}${ended.sectionId}:${ended.yearId}`,
    );
    const adding = service.addPeople(
      grant(ended.sectionId, ended.yearId),
      ACTOR,
      request.request_id,
      '2024-11-01',
      [ended.enrollmentId],
      insideEnded,
    );
    await waitForAdvisoryWaiter(held.pid);
    const cutting = yearCutService({ count: 0 }).applyCut(
      new Date('2026-10-15T18:00:00.000Z'),
    );
    await waitForAdvisoryWaiters(url, held.pid, 2);
    await held.release();
    await adding;
    await cutting;
    const row = await prisma.investiture_authorization_people.findFirst({
      where: { enrollment_id: ended.enrollmentId },
    });
    expect(row?.status).toBe('CLOSED_YEAR');
  });

  it('lists a cross-type class on the matching section of the same club', async () => {
    const person = randomUUID();
    const client = new Client({ connectionString: url });
    await client.connect();
    let guideSectionId: number;
    let guideClassId: number;
    let cqSectionId: number;
    let cqClassId: number;
    let otherSectionId: number;
    try {
      const parent = await prisma.clubs.findUniqueOrThrow({
        where: { club_id: clubId },
        select: {
          local_field_id: true,
          church_id: true,
          districlub_type_id: true,
        },
      });
      const guideType = await client.query<{ club_type_id: number }>(
        `INSERT INTO club_types (name, active)
         VALUES ('P7 Guias Mayores', true)
         RETURNING club_type_id`,
      );
      const cqType = await client.query<{ club_type_id: number }>(
        `INSERT INTO club_types (name, active)
         VALUES ('P7 Conquistadores', true)
         RETURNING club_type_id`,
      );
      const home = await client.query<{ club_id: number }>(
        `INSERT INTO clubs (
           name, active, local_field_id, church_id, coordinates, districlub_type_id
         )
         VALUES ('P7 Anuario', true, $1, $2, '{}'::json, $3)
         RETURNING club_id`,
        [parent.local_field_id, parent.church_id, parent.districlub_type_id],
      );
      const guideSection = await client.query<{ club_section_id: number }>(
        `INSERT INTO club_sections (active, club_type_id, main_club_id)
         VALUES (true, $1, $2)
         RETURNING club_section_id`,
        [guideType.rows[0].club_type_id, home.rows[0].club_id],
      );
      guideSectionId = guideSection.rows[0].club_section_id;
      const cqSection = await client.query<{ club_section_id: number }>(
        `INSERT INTO club_sections (active, club_type_id, main_club_id)
         VALUES (true, $1, $2)
         RETURNING club_section_id`,
        [cqType.rows[0].club_type_id, home.rows[0].club_id],
      );
      cqSectionId = cqSection.rows[0].club_section_id;
      const guideClass = await client.query<{ class_id: number }>(
        `INSERT INTO classes (
           name, active, club_type_id, minimum_age, min_duration_years, max_duration_years
         )
         VALUES ('Guia Mayor P7', true, $1, 16, 1, 1)
         RETURNING class_id`,
        [guideType.rows[0].club_type_id],
      );
      guideClassId = guideClass.rows[0].class_id;
      const cqClass = await client.query<{ class_id: number }>(
        `INSERT INTO classes (
           name, active, club_type_id, minimum_age, min_duration_years, max_duration_years
         )
         VALUES ('Amigo P7 anuario', true, $1, 10, 1, 1)
         RETURNING class_id`,
        [cqType.rows[0].club_type_id],
      );
      cqClassId = cqClass.rows[0].class_id;
      const otherClub = await client.query<{ club_id: number }>(
        `INSERT INTO clubs (
           name, active, local_field_id, church_id, coordinates, districlub_type_id
         )
         VALUES ('P7 Otro', true, $1, $2, '{}'::json, $3)
         RETURNING club_id`,
        [parent.local_field_id, parent.church_id, parent.districlub_type_id],
      );
      const otherSection = await client.query<{ club_section_id: number }>(
        `INSERT INTO club_sections (active, club_type_id, main_club_id)
         VALUES (true, $1, $2)
         RETURNING club_section_id`,
        [cqType.rows[0].club_type_id, otherClub.rows[0].club_id],
      );
      otherSectionId = otherSection.rows[0].club_section_id;
      await client.query(
        `INSERT INTO users (user_id, email, name, active)
         VALUES ($1, 'anuario-p7@p7.test', 'Ana', true)`,
        [person],
      );
      await client.query(
        `INSERT INTO club_role_assignments (
           user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id
         )
         VALUES ($1, $2, $3, '2026-01-01', true, 'active', $4)`,
        [person, roleId, yearId, guideSectionId],
      );
      await client.query(
        `INSERT INTO enrollments (
           user_id, class_id, ecclesiastical_year_id, investiture_status,
           record_kind, active, cross_type_enrollment
         )
         VALUES
           ($1, $2, $3, 'IN_PROGRESS', 'OPERATIONAL', true, true),
           ($1, $4, $3, 'IN_PROGRESS', 'OPERATIONAL', true, false)`,
        [person, cqClassId, yearId, guideClassId],
      );
    } finally {
      await client.end();
    }

    const guides = await service.yearbook(
      grant(guideSectionId, yearId),
      guideSectionId,
    );
    const conquistadores = await service.yearbook(
      grant(cqSectionId, yearId),
      cqSectionId,
    );
    const other = await service.yearbook(
      grant(otherSectionId, yearId),
      otherSectionId,
    );

    expect(guides.entries.map((entry) => entry.class_id)).toEqual([
      guideClassId,
    ]);
    expect(
      conquistadores.entries.some(
        (entry) => entry.user_id === person && entry.class_id === cqClassId,
      ),
    ).toBe(true);
    expect(
      conquistadores.entries.some((entry) => entry.class_id === guideClassId),
    ).toBe(false);
    expect(other.entries).toEqual([]);
    expect(
      await prisma.investiture_authorization_requests.count({
        where: { club_section_id: guideSectionId },
      }),
    ).toBe(0);
  });

  let clockSection:
    | {
        sectionId: number;
        yearId: number;
        enrollmentId: number;
      }
    | undefined;

  async function clockSectionFixture(): Promise<{
    sectionId: number;
    yearId: number;
    enrollmentId: number;
  }> {
    if (clockSection) {
      return clockSection;
    }
    const userId = randomUUID();
    const parent = await prisma.clubs.findUniqueOrThrow({
      where: { club_id: clubId },
      select: {
        local_field_id: true,
        church_id: true,
        districlub_type_id: true,
      },
    });
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const year = await client.query<{ year_id: number }>(
        `INSERT INTO ecclesiastical_years (start_date, end_date, active)
         VALUES ('2035-01-01', '2035-12-31', true)
         RETURNING year_id`,
      );
      const club = await client.query<{ club_id: number }>(
        `INSERT INTO clubs (
           name, active, local_field_id, church_id, coordinates, districlub_type_id
         )
         VALUES ('P7 Reloj', true, $1, $2, '{}'::json, $3)
         RETURNING club_id`,
        [parent.local_field_id, parent.church_id, parent.districlub_type_id],
      );
      const createdClass = await client.query<{ class_id: number }>(
        `INSERT INTO classes (
           name, active, club_type_id, minimum_age, min_duration_years, max_duration_years
         )
         VALUES ('Clase reloj P7', true, $1, 10, 1, 30)
         RETURNING class_id`,
        [clubTypeId],
      );
      const section = await client.query<{ club_section_id: number }>(
        `INSERT INTO club_sections (active, club_type_id, main_club_id)
         VALUES (true, $1, $2)
         RETURNING club_section_id`,
        [clubTypeId, club.rows[0].club_id],
      );
      await client.query(
        `INSERT INTO users (user_id, email, name, active)
         VALUES ($1, 'reloj-p7@p7.test', 'Reloj', true)`,
        [userId],
      );
      const enrollment = await client.query<{ enrollment_id: number }>(
        `INSERT INTO enrollments (
           user_id, class_id, ecclesiastical_year_id, investiture_status, record_kind, active
         )
         VALUES ($1, $2, $3, 'IN_PROGRESS', 'OPERATIONAL', true)
         RETURNING enrollment_id`,
        [userId, createdClass.rows[0].class_id, year.rows[0].year_id],
      );
      clockSection = {
        sectionId: section.rows[0].club_section_id,
        yearId: year.rows[0].year_id,
        enrollmentId: enrollment.rows[0].enrollment_id,
      };
      return clockSection;
    } finally {
      await client.end();
    }
  }

  function clockedService(
    phase: { after: boolean },
    before: Date,
    after: Date,
  ) {
    const reads: Date[] = [];
    const clocked = new InvestitureAuthorizationRequestService(
      prisma as never,
      {
        calculateForEnrollment: async () => ({
          investiture_eligibility: { eligible: true },
        }),
      } as never,
      { emitEvent: async () => ({ eventLogId: 1, queued: false }) } as never,
      {
        now: () => {
          const value = phase.after ? after : before;
          reads.push(value);
          return value;
        },
      },
    );
    return { clocked, reads };
  }

  async function rejectAfterClockAdvance(input: {
    operation: 'present' | 'add';
    before: Date;
    after: Date;
    investitureDate: string;
    code: string;
    throughYearEnd?: boolean;
  }): Promise<void> {
    const fixture = await clockSectionFixture();
    if (input.throughYearEnd) {
      await prisma.local_field_investiture_windows.create({
        data: {
          local_field_id: fieldId,
          ecclesiastical_year_id: fixture.yearId,
          start_date: new Date('2035-10-01T00:00:00.000Z'),
          end_date: new Date('2035-12-31T00:00:00.000Z'),
        },
      });
    }
    const phase = { after: false };
    const { clocked, reads } = clockedService(phase, input.before, input.after);
    const held = await holdAdvisory(
      `${INVESTITURE_REQUEST_SECTION_LOCK_PREFIX}${fixture.sectionId}:${fixture.yearId}`,
    );
    const pending =
      input.operation === 'present'
        ? clocked.present(
            grant(fixture.sectionId, fixture.yearId),
            ACTOR,
            fixture.sectionId,
            fixture.yearId,
            input.investitureDate,
            [fixture.enrollmentId],
          )
        : clocked.addPeople(
            grant(fixture.sectionId, fixture.yearId),
            ACTOR,
            (
              await prisma.investiture_authorization_requests.create({
                data: {
                  club_section_id: fixture.sectionId,
                  ecclesiastical_year_id: fixture.yearId,
                  created_by_id: ACTOR,
                },
              })
            ).request_id,
            input.investitureDate,
            [fixture.enrollmentId],
          );
    await waitForAdvisoryWaiter(held.pid);
    phase.after = true;
    await held.release();
    await expect(pending).rejects.toMatchObject({ code: input.code });
    expect(reads.length).toBeGreaterThanOrEqual(2);
    expect(reads.at(-1)?.toISOString()).toBe(input.after.toISOString());
    expect(
      await prisma.investiture_authorization_people.count({
        where: { enrollment_id: fixture.enrollmentId },
      }),
    ).toBe(0);
    expect(await presentationIntents(prisma, fixture.enrollmentId)).toBe(0);
  }

  it('does not present after the window ends while the lock is held', async () => {
    await rejectAfterClockAdvance({
      operation: 'present',
      before: new Date('2035-12-21T05:59:59.000Z'),
      after: new Date('2035-12-21T06:00:01.000Z'),
      investitureDate: '2035-12-15',
      code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
    });
  });

  it('does not add a person after the window ends while the lock is held', async () => {
    await rejectAfterClockAdvance({
      operation: 'add',
      before: new Date('2035-12-21T05:59:59.000Z'),
      after: new Date('2035-12-21T06:00:01.000Z'),
      investitureDate: '2035-12-15',
      code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
    });
  });

  it('does not present after the year ends while the lock is held', async () => {
    await rejectAfterClockAdvance({
      operation: 'present',
      before: new Date('2036-01-01T05:59:59.000Z'),
      after: new Date('2036-01-01T06:00:01.000Z'),
      investitureDate: '2035-12-31',
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
      throughYearEnd: true,
    });
  });

  it.each(['resolve-first', 'invest-first'])(
    'keeps one INVESTIDO when %s races the other confirm',
    async (order) => {
      await prisma.users.update({
        where: { user_id: MEMBER },
        data: { local_field_id: fieldId },
      });
      await prisma.investiture_config.deleteMany({
        where: { local_field_id: fieldId, ecclesiastical_year_id: yearId },
      });
      await prisma.investiture_config.create({
        data: {
          local_field_id: fieldId,
          ecclesiastical_year_id: yearId,
          submission_deadline: new Date('2026-12-01T00:00:00.000Z'),
          investiture_date: new Date('2026-11-01T00:00:00.000Z'),
          active: true,
        },
      });
      const presented = await service.present(
        marker(),
        ACTOR,
        sectionId,
        yearId,
        DATE,
        [enrollmentId],
        INSIDE,
      );
      await prisma.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: {
          investiture_status: 'FIELD_APPROVED',
          locked_for_validation: true,
        },
      });
      const investiture = new InvestitureService(
        prisma as never,
        {} as never,
        { notifySafe: async () => undefined } as never,
        {
          emitEvent: async (dto: {
            eventType: string;
            userId: string;
            idempotencyKey?: string;
          }) => {
            events.push(dto);
            return { eventLogId: events.length, queued: false };
          },
        } as never,
        {} as never,
        {} as never,
      );
      const holder = new Client({ connectionString: url });
      await holder.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX}${enrollmentId}`],
        );
        const pid = await holder.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const holderPid = pid.rows[0].pid;
        const startResolve = () =>
          service.resolve(
            fieldAuth(),
            ACTOR,
            presented.request_id,
            { invest: [{ person_id: presented.people[0].person_id }] },
            INSIDE,
          );
        const startInvest = () =>
          investiture.markInvestido(enrollmentId, ACTOR, {});
        const first =
          order === 'resolve-first' ? startResolve() : startInvest();
        await waitForAdvisoryWaiters(url, holderPid, 1);
        const second =
          order === 'resolve-first' ? startInvest() : startResolve();
        await waitForAdvisoryWaiters(url, holderPid, 2);
        await holder.query('COMMIT');
        await Promise.allSettled([first, second]);
      } finally {
        try {
          await holder.query('ROLLBACK');
        } catch {
          // The holder transaction already ended.
        }
        await holder.end();
        await prisma.investiture_config.deleteMany({
          where: { local_field_id: fieldId, ecclesiastical_year_id: yearId },
        });
        await prisma.users.update({
          where: { user_id: MEMBER },
          data: { local_field_id: null },
        });
        await prisma.enrollments.update({
          where: { enrollment_id: enrollmentId },
          data: { locked_for_validation: false },
        });
      }

      const enrollment = await prisma.enrollments.findUnique({
        where: { enrollment_id: enrollmentId },
      });
      const pending = await prisma.investiture_authorization_people.count({
        where: { enrollment_id: enrollmentId, status: 'PENDING' },
      });
      expect(enrollment?.investiture_status).toBe('INVESTIDO');
      expect(pending).toBe(0);
      expect(
        events.filter((item) => item.eventType === 'class.completed'),
      ).toHaveLength(1);
    },
  );

  it.each([
    ['resolve-first', 'submit'],
    ['legacy-first', 'submit'],
    ['resolve-first', 'class-submit'],
    ['legacy-first', 'class-submit'],
    ['resolve-first', 'reject'],
    ['legacy-first', 'reject'],
  ] as const)('keeps one INVESTIDO when %s races %s', async (order, legacy) => {
    await prisma.users.update({
      where: { user_id: MEMBER },
      data: { local_field_id: fieldId },
    });
    await prisma.investiture_config.deleteMany({
      where: { local_field_id: fieldId, ecclesiastical_year_id: yearId },
    });
    await prisma.investiture_config.create({
      data: {
        local_field_id: fieldId,
        ecclesiastical_year_id: yearId,
        submission_deadline: new Date('2026-12-01T00:00:00.000Z'),
        investiture_date: new Date('2026-11-01T00:00:00.000Z'),
        active: true,
      },
    });
    const presented = await service.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [enrollmentId],
      INSIDE,
    );
    if (legacy === 'reject') {
      await prisma.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: {
          investiture_status: 'FIELD_APPROVED',
          locked_for_validation: true,
        },
      });
    }
    const eligibility = {
      calculateForEnrollment: async () => ({
        investiture_eligibility: {
          eligible: true,
          total: 1,
          completed: 1,
          missing_required_sections: 0,
          reason: null,
        },
      }),
    };
    const investiture = new InvestitureService(
      prisma as never,
      {
        resolveUserAuthorization: async () => ({
          authorization: {
            grants: { global_roles: [{ role_name: 'admin' }] },
            effective: { scope: { club: null } },
          },
        }),
        canManageClub: async () => true,
      } as never,
      {
        notifySafe: async () => undefined,
        sendToSectionRole: async () => undefined,
        sendToGlobalRole: async () => undefined,
      } as never,
      {
        emitEvent: async (dto: { eventType: string; userId: string }) => {
          events.push(dto);
          return { eventLogId: events.length, queued: false };
        },
      } as never,
      {} as never,
      eligibility as never,
    );
    const validation = new ValidationService(
      prisma as never,
      {
        notifySafe: async () => undefined,
        sendToSectionRole: async () => undefined,
      } as never,
      {} as never,
    );
    const holder = new Client({ connectionString: url });
    await holder.connect();
    let enrollmentStatus: string | null;
    let locked: boolean;
    let history: number;
    let validationLogs: number;
    let completed: number;
    try {
      await holder.query('BEGIN');
      await holder.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX}${enrollmentId}`],
      );
      const pid = await holder.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const startResolve = () =>
        service.resolve(
          fieldAuth(),
          ACTOR,
          presented.request_id,
          { invest: [{ person_id: presented.people[0].person_id }] },
          INSIDE,
        );
      const startLegacy = () => {
        if (legacy === 'submit') {
          return investiture.submitForValidation(enrollmentId, ACTOR, {});
        }
        if (legacy === 'class-submit') {
          return validation.submitForReview('class', enrollmentId, MEMBER);
        }
        return investiture.reject(enrollmentId, ACTOR, {
          reason: 'ajuste de prueba',
        });
      };
      const first = order === 'resolve-first' ? startResolve() : startLegacy();
      await waitForAdvisoryWaiters(url, pid.rows[0].pid, 1);
      const second = order === 'resolve-first' ? startLegacy() : startResolve();
      await waitForAdvisoryWaiters(url, pid.rows[0].pid, 2);
      await holder.query('COMMIT');
      await Promise.allSettled([first, second]);
      const enrollment = await prisma.enrollments.findUnique({
        where: { enrollment_id: enrollmentId },
      });
      enrollmentStatus = enrollment?.investiture_status ?? null;
      locked = enrollment?.locked_for_validation ?? true;
      history = await prisma.investiture_validation_history.count({
        where: { enrollment_id: enrollmentId },
      });
      validationLogs = await prisma.validation_logs.count({
        where: { entity_type: 'class', entity_id: String(enrollmentId) },
      });
      completed = events.filter(
        (item) => item.eventType === 'class.completed',
      ).length;
    } finally {
      try {
        await holder.query('ROLLBACK');
      } catch {
        // The holder transaction already ended.
      }
      await holder.end();
      await prisma.investiture_config.deleteMany({
        where: { local_field_id: fieldId, ecclesiastical_year_id: yearId },
      });
      await prisma.users.update({
        where: { user_id: MEMBER },
        data: { local_field_id: null },
      });
      await prisma.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: { locked_for_validation: false },
      });
      await prisma.investiture_validation_history.deleteMany({
        where: { enrollment_id: enrollmentId },
      });
      await prisma.validation_logs.deleteMany({
        where: { entity_type: 'class', entity_id: String(enrollmentId) },
      });
    }

    expect(enrollmentStatus).toBe('INVESTIDO');
    expect(locked).toBe(false);
    expect(history).toBe(0);
    expect(validationLogs).toBe(0);
    expect(completed).toBe(1);
  });

  const HISTORICAL_REASON =
    'Investidura aplicada por certificado de un año anterior';

  async function approveSubmittedClass(input: {
    userId: string;
    classId: number;
    completedAt: Date;
    reviewerId?: string;
    reconcile?: { enrollmentId: number; expectedModifiedAt: Date };
  }) {
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: {
        user_id: input.userId,
        status: 'SUBMITTED',
        local_field_id: fieldId,
      },
    });
    const item = await prisma.certificate_bulk_import_items.create({
      data: {
        batch_id: batch.batch_id,
        item_type: 'CLASS',
        class_id: input.classId,
        completed_at: input.completedAt,
        status: 'SUBMITTED',
      },
    });
    const certificates = new CertificateBulkImportApplicationService(
      prisma as never,
    );
    return certificates.approveItem(
      input.reviewerId ?? MEMBER,
      batch.batch_id,
      item.item_id,
      {
        ...(input.reconcile
          ? {
              reconcile_enrollment_id: input.reconcile.enrollmentId,
              expected_modified_at:
                input.reconcile.expectedModifiedAt.toISOString(),
            }
          : {}),
      },
    );
  }

  async function pastYear(start: string, end: string): Promise<number> {
    const existing = await prisma.ecclesiastical_years.findFirst({
      where: { start_date: new Date(`${start}T00:00:00.000Z`) },
      select: { year_id: true },
    });
    if (existing) return existing.year_id;
    const created = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date(`${start}T00:00:00.000Z`),
        end_date: new Date(`${end}T00:00:00.000Z`),
        active: false,
      },
      select: { year_id: true },
    });
    return created.year_id;
  }

  it('C-1 shows the earlier-certificate reason on the request read', async () => {
    await pastYear('2019-01-01', '2019-12-31');
    await prisma.users.update({
      where: { user_id: MEMBER },
      data: { birthday: new Date('2000-01-01T00:00:00.000Z') },
    });
    const presented = await present();
    await approveSubmittedClass({
      userId: MEMBER,
      classId,
      completedAt: new Date('2019-06-01T00:00:00.000Z'),
    });

    const person =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: presented.people[0].person_id },
      });
    const read = await service.readForAuthorizer(
      fieldAuth(),
      ACTOR,
      presented.request_id,
    );
    const listed = await service.list(marker(), sectionId, yearId);
    const invested = await prisma.enrollments.count({
      where: {
        user_id: MEMBER,
        class_id: classId,
        investiture_status: 'INVESTIDO',
      },
    });

    expect(person.status).toBe('REMOVED');
    expect(person.resolution_code).toBe('HISTORICAL_CERTIFICATE_APPLIED');
    expect(person.system_reason).toBe(HISTORICAL_REASON);
    expect(person.rejection_reason).toBeNull();
    expect(read.people[0].system_reason).toBe(HISTORICAL_REASON);
    expect(read.people[0].status).toBe('REMOVED');
    expect(listed?.people[0].system_reason).toBe(HISTORICAL_REASON);
    expect(invested).toBe(1);
    expect(
      events.filter((item) => item.eventType === 'class.completed'),
    ).toHaveLength(0);
  });

  it.each(['present-first', 'approve-first'] as const)(
    'C-1 does not leave a certificate INVESTIDO beside a PENDING when %s',
    async (order) => {
      await prisma.users.update({
        where: { user_id: MEMBER },
        data: { birthday: new Date('2000-01-01T00:00:00.000Z') },
      });
      const enrollment = await prisma.enrollments.findUniqueOrThrow({
        where: { enrollment_id: enrollmentId },
      });
      const serverLog = await openServerLog(url);
      const holder = await holdAdvisory(
        `${INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX}${enrollmentId}`,
      );
      const startPresent = () => present();
      const startApprove = () =>
        approveSubmittedClass({
          userId: MEMBER,
          classId,
          completedAt: new Date('2026-06-01T00:00:00.000Z'),
          reconcile: {
            enrollmentId,
            expectedModifiedAt: enrollment.modified_at,
          },
        });
      try {
        const first =
          order === 'present-first' ? startPresent() : startApprove();
        await waitForAdvisoryWaiters(url, holder.pid, 1);
        const second =
          order === 'present-first' ? startApprove() : startPresent();
        await waitForAdvisoryWaiters(url, holder.pid, 2);
        await holder.release();
        const settled = await Promise.allSettled([first, second]);
        assertNoClientDeadlock(settled, serverLogSince(serverLog));
      } finally {
        try {
          await holder.release();
        } catch {
          // The holder transaction already ended.
        }
      }

      const pending = await prisma.investiture_authorization_people.count({
        where: { enrollment_id: enrollmentId, status: 'PENDING' },
      });
      const row = await prisma.enrollments.findUniqueOrThrow({
        where: { enrollment_id: enrollmentId },
      });
      expect(row.investiture_status === 'INVESTIDO' && pending > 0).toBe(false);
    },
  );

  it.each(['resolve-first', 'approve-first'] as const)(
    'C-1 keeps one INVESTIDO and at most one class.completed when %s races an earlier certificate',
    async (order) => {
      const ana = 'abababab-abab-4aba-8aba-abababababab';
      await pastYear('2019-01-01', '2019-12-31');
      const guide = await prisma.classes.upsert({
        where: { asset_code: 'GM-01' },
        update: { minimum_age: 16, active: true },
        create: {
          name: 'Guia Mayor C-1',
          active: true,
          club_type_id: clubTypeId,
          minimum_age: 16,
          min_duration_years: 1,
          max_duration_years: 1,
          asset_code: 'GM-01',
        },
        select: { class_id: true },
      });
      await prisma.users.upsert({
        where: { user_id: ana },
        update: { birthday: new Date('1990-01-01T00:00:00.000Z') },
        create: {
          user_id: ana,
          email: 'ana-c1@p4.test',
          name: 'Ana',
          active: true,
          birthday: new Date('1990-01-01T00:00:00.000Z'),
        },
      });
      await prisma.club_role_assignments.deleteMany({
        where: { user_id: ana },
      });
      await prisma.club_role_assignments.create({
        data: {
          user_id: ana,
          role_id: roleId,
          ecclesiastical_year_id: yearId,
          start_date: new Date('2026-01-01T00:00:00.000Z'),
          active: true,
          status: 'active',
          club_section_id: sectionId,
        },
      });
      await prisma.enrollments.deleteMany({ where: { user_id: ana } });
      const guideEnrollment = await prisma.enrollments.create({
        data: {
          user_id: ana,
          class_id: guide.class_id,
          ecclesiastical_year_id: yearId,
          investiture_status: 'IN_PROGRESS',
          record_kind: 'OPERATIONAL',
          active: true,
        },
        select: { enrollment_id: true },
      });
      const presented = await service.present(
        marker(),
        ACTOR,
        sectionId,
        yearId,
        DATE,
        [guideEnrollment.enrollment_id],
        INSIDE,
      );
      events.length = 0;
      const serverLog = await openServerLog(url);
      const holder = await holdAdvisory(
        `${INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX}${guideEnrollment.enrollment_id}`,
      );
      const startResolve = () =>
        service.resolve(
          fieldAuth(),
          ACTOR,
          presented.request_id,
          { invest: [{ person_id: presented.people[0].person_id }] },
          INSIDE,
        );
      const startApprove = () =>
        approveSubmittedClass({
          userId: ana,
          classId: guide.class_id,
          completedAt: new Date('2019-06-01T00:00:00.000Z'),
        });
      try {
        const first =
          order === 'resolve-first' ? startResolve() : startApprove();
        await waitForAdvisoryWaiters(url, holder.pid, 1);
        const second =
          order === 'resolve-first' ? startApprove() : startResolve();
        await waitForAdvisoryWaiters(url, holder.pid, 2);
        await holder.release();
        const settled = await Promise.allSettled([first, second]);
        assertNoClientDeadlock(settled, serverLogSince(serverLog));
      } finally {
        try {
          await holder.release();
        } catch {
          // The holder transaction already ended.
        }
      }

      const pending = await prisma.investiture_authorization_people.count({
        where: { user_id: ana, class_id: guide.class_id, status: 'PENDING' },
      });
      const invested = await prisma.enrollments.count({
        where: {
          user_id: ana,
          class_id: guide.class_id,
          investiture_status: 'INVESTIDO',
        },
      });
      const person =
        await prisma.investiture_authorization_people.findUniqueOrThrow({
          where: { person_id: presented.people[0].person_id },
        });
      const completed = events.filter(
        (item) => item.eventType === 'class.completed',
      ).length;
      expect(pending).toBe(0);
      expect(invested).toBe(1);
      expect(completed).toBeLessThanOrEqual(1);
      if (person.status === 'INVESTED') {
        expect(completed).toBe(1);
      }
      if (person.resolution_code === 'HISTORICAL_CERTIFICATE_APPLIED') {
        expect(person.status).toBe('REMOVED');
        expect(person.system_reason).toBe(HISTORICAL_REASON);
        expect(completed).toBe(0);
      }
    },
  );

  async function multiYearEnrollment(assetCode: string, minimumAge: number) {
    const startYearId = await pastYear('2025-01-01', '2025-12-31');
    const klass = await prisma.classes.upsert({
      where: { asset_code: assetCode },
      update: {
        minimum_age: minimumAge,
        min_duration_years: 1,
        max_duration_years: 2,
        active: true,
      },
      create: {
        name: assetCode,
        active: true,
        club_type_id: clubTypeId,
        minimum_age: minimumAge,
        min_duration_years: 1,
        max_duration_years: 2,
        asset_code: assetCode,
      },
      select: { class_id: true },
    });
    await prisma.enrollments.deleteMany({
      where: { class_id: klass.class_id, record_kind: 'OPERATIONAL' },
    });
    const enrollment = await prisma.enrollments.create({
      data: {
        user_id: MEMBER,
        class_id: klass.class_id,
        ecclesiastical_year_id: startYearId,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
      select: { enrollment_id: true, modified_at: true },
    });
    const presented = await service.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [enrollment.enrollment_id],
      INSIDE,
    );
    return { classId: klass.class_id, enrollment, presented };
  }

  it('C1-H1 rejects a same-request-year certificate when the enrollment started earlier', async () => {
    await prisma.users.update({
      where: { user_id: MEMBER },
      data: { birthday: new Date('2000-01-01T00:00:00.000Z') },
    });
    const { classId: multiClassId, presented } = await multiYearEnrollment(
      'C1R-MULTI',
      10,
    );

    await expect(
      approveSubmittedClass({
        userId: MEMBER,
        classId: multiClassId,
        completedAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CERTIFICATE_IMPORT_AUTHORIZATION_PENDING,
    });

    const person =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: presented.people[0].person_id },
      });
    const invested = await prisma.enrollments.count({
      where: {
        user_id: MEMBER,
        class_id: multiClassId,
        investiture_status: 'INVESTIDO',
      },
    });
    expect(person.status).toBe('PENDING');
    expect(invested).toBe(0);
  });

  it('C1-H1 accredits a certificate of the enrollment start when the request year is later', async () => {
    await prisma.users.update({
      where: { user_id: MEMBER },
      data: { birthday: new Date('2000-01-01T00:00:00.000Z') },
    });
    const {
      classId: multiClassId,
      enrollment,
      presented,
    } = await multiYearEnrollment('C1R-MULTI', 10);

    await approveSubmittedClass({
      userId: MEMBER,
      classId: multiClassId,
      completedAt: new Date('2025-06-01T00:00:00.000Z'),
      reconcile: {
        enrollmentId: enrollment.enrollment_id,
        expectedModifiedAt: enrollment.modified_at,
      },
    });

    const person =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: presented.people[0].person_id },
      });
    const invested = await prisma.enrollments.count({
      where: {
        user_id: MEMBER,
        class_id: multiClassId,
        investiture_status: 'INVESTIDO',
      },
    });
    expect(person.status).toBe('REMOVED');
    expect(person.resolution_code).toBe('HISTORICAL_CERTIFICATE_APPLIED');
    expect(person.system_reason).toBe(HISTORICAL_REASON);
    expect(person.rejection_reason).toBeNull();
    expect(invested).toBe(1);
  });

  it('C1-H1 still accredits a 2019 certificate against a later multi-year request', async () => {
    await pastYear('2019-01-01', '2019-12-31');
    await prisma.users.update({
      where: { user_id: MEMBER },
      data: { birthday: new Date('2000-01-01T00:00:00.000Z') },
    });
    const { classId: multiClassId, presented } = await multiYearEnrollment(
      'C1R-MULTI',
      10,
    );

    await approveSubmittedClass({
      userId: MEMBER,
      classId: multiClassId,
      completedAt: new Date('2019-06-01T00:00:00.000Z'),
    });

    const person =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: presented.people[0].person_id },
      });
    const historical = await prisma.enrollments.count({
      where: {
        user_id: MEMBER,
        class_id: multiClassId,
        ecclesiastical_year: {
          start_date: new Date('2019-01-01T00:00:00.000Z'),
        },
        record_kind: 'HISTORICAL_CERTIFICATE',
        investiture_status: 'INVESTIDO',
      },
    });
    expect(person.status).toBe('REMOVED');
    expect(person.resolution_code).toBe('HISTORICAL_CERTIFICATE_APPLIED');
    expect(historical).toBe(1);
  });

  it('C1-H1 does not convert a Guía Mayor enrollment when the certificate matches the request year', async () => {
    const ana = 'abababab-abab-4aba-8aba-abababababab';
    await prisma.users.upsert({
      where: { user_id: ana },
      update: { birthday: new Date('1990-01-01T00:00:00.000Z') },
      create: {
        user_id: ana,
        email: 'ana-c1@p4.test',
        name: 'Ana',
        active: true,
        birthday: new Date('1990-01-01T00:00:00.000Z'),
      },
    });
    const startYearId = await pastYear('2025-01-01', '2025-12-31');
    const guide = await prisma.classes.upsert({
      where: { asset_code: 'GM-01' },
      update: {
        minimum_age: 16,
        min_duration_years: 1,
        max_duration_years: 2,
        active: true,
      },
      create: {
        name: 'Guia Mayor C1-H1',
        active: true,
        club_type_id: clubTypeId,
        minimum_age: 16,
        min_duration_years: 1,
        max_duration_years: 2,
        asset_code: 'GM-01',
      },
      select: { class_id: true },
    });
    await prisma.club_role_assignments.deleteMany({ where: { user_id: ana } });
    await prisma.club_role_assignments.create({
      data: {
        user_id: ana,
        role_id: roleId,
        ecclesiastical_year_id: yearId,
        start_date: new Date('2026-01-01T00:00:00.000Z'),
        active: true,
        status: 'active',
        club_section_id: sectionId,
      },
    });
    await prisma.enrollments.deleteMany({ where: { user_id: ana } });
    const guideEnrollment = await prisma.enrollments.create({
      data: {
        user_id: ana,
        class_id: guide.class_id,
        ecclesiastical_year_id: startYearId,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
      select: { enrollment_id: true },
    });
    const presented = await service.present(
      marker(),
      ACTOR,
      sectionId,
      yearId,
      DATE,
      [guideEnrollment.enrollment_id],
      INSIDE,
    );

    await expect(
      approveSubmittedClass({
        userId: ana,
        classId: guide.class_id,
        completedAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CERTIFICATE_IMPORT_AUTHORIZATION_PENDING,
    });

    const person =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: presented.people[0].person_id },
      });
    const row = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: guideEnrollment.enrollment_id },
    });
    expect(person.status).toBe('PENDING');
    expect(row.record_kind).toBe('OPERATIONAL');
    expect(row.ecclesiastical_year_id).toBe(startYearId);
    expect(row.investiture_status).toBe('IN_PROGRESS');
    await prisma.classes.update({
      where: { class_id: guide.class_id },
      data: { max_duration_years: 1 },
    });
  });

  it('C1-H5 lists the informative request with the smallest request id', async () => {
    const earlier = '11111111-1111-4111-8111-111111111111';
    const later = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await prisma.investiture_authorization_requests.createMany({
      data: [
        {
          request_id: later,
          club_section_id: sectionId,
          ecclesiastical_year_id: yearId,
          created_by_id: ACTOR,
        },
        {
          request_id: earlier,
          club_section_id: sectionId,
          ecclesiastical_year_id: yearId,
          created_by_id: ACTOR,
        },
      ],
    });
    await prisma.investiture_authorization_people.createMany({
      data: [later, earlier].map((requestId, index) => ({
        person_id: `11111111-1111-4111-8111-11111111110${index}`,
        request_id: requestId,
        user_id: MEMBER,
        class_id: classId,
        enrollment_id: enrollmentId,
        investiture_date: new Date('2026-11-01T00:00:00.000Z'),
        status: 'REMOVED' as const,
        single_slot: false,
        resolution_code: 'HISTORICAL_CERTIFICATE_APPLIED',
        system_reason: HISTORICAL_REASON,
      })),
    });

    const listed = await service.list(marker(), sectionId, yearId);
    expect(listed?.request_id).toBe(earlier);
  });

  async function grantedYearShareLocks(): Promise<number> {
    const observer = new Client({ connectionString: url });
    await observer.connect();
    try {
      const result = await observer.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM pg_locks AS locks
         JOIN pg_class AS tables ON tables.oid = locks.relation
         WHERE tables.relname = 'ecclesiastical_years'
           AND locks.mode = 'RowShareLock'
           AND locks.granted`,
      );
      return Number(result.rows[0]?.count ?? 0);
    } finally {
      await observer.end();
    }
  }

  it.each(['close-first', 'approve-first'] as const)(
    'C1-H2 closes the year against a certificate approval when %s without a deadlock',
    async (order) => {
      await prisma.users.update({
        where: { user_id: MEMBER },
        data: { birthday: new Date('2000-01-01T00:00:00.000Z') },
      });
      const extras = await prisma.enrollments.findMany({
        where: {
          user_id: MEMBER,
          class_id: classId,
          NOT: { enrollment_id: enrollmentId },
        },
        select: { enrollment_id: true },
      });
      const extraIds = extras.map((row) => row.enrollment_id);
      if (extraIds.length > 0) {
        await prisma.investiture_validation_history.deleteMany({
          where: { enrollment_id: { in: extraIds } },
        });
        await prisma.enrollments.deleteMany({
          where: { enrollment_id: { in: extraIds } },
        });
      }
      const presented = await present();
      const reviewerId = 'f7f7f7f7-f7f7-4f7f-8f7f-f7f7f7f7f7f7';
      await ensureUser(reviewerId, 'c1h2-reviewer@p4.test', '1985-01-01');
      await prisma.users.update({
        where: { user_id: reviewerId },
        data: { local_field_id: null },
      });
      const reviewerRole = await prisma.roles.upsert({
        where: { role_name: 'super-admin' },
        update: { active: true },
        create: {
          role_name: 'super-admin',
          description: 'C1-H2 reviewer',
          role_category: 'GLOBAL',
          active: true,
        },
      });
      await prisma.users_roles.upsert({
        where: {
          user_id_role_id: {
            user_id: reviewerId,
            role_id: reviewerRole.role_id,
          },
        },
        update: { active: true },
        create: {
          user_id: reviewerId,
          role_id: reviewerRole.role_id,
          active: true,
        },
      });
      const serverLog = await openServerLog(url);
      const holder = await holdAdvisory(
        `${INVESTITURE_REQUEST_USER_LOCK_PREFIX}${MEMBER}`,
      );
      const startClose = () => yearEndService().closeYear(yearId);
      const startApprove = () =>
        approveSubmittedClass({
          userId: MEMBER,
          classId,
          completedAt: new Date('2026-06-01T00:00:00.000Z'),
          reviewerId,
        });
      try {
        const first = order === 'close-first' ? startClose() : startApprove();
        await waitForAdvisoryWaiters(url, holder.pid, 1);
        const second = order === 'close-first' ? startApprove() : startClose();
        await waitForAdvisoryWaiters(url, holder.pid, 2);
        if (order === 'close-first') {
          expect(await grantedYearShareLocks()).toBe(0);
        }
        await holder.release();
        const settled = await Promise.allSettled([first, second]);
        assertNoClientDeadlock(settled, serverLogSince(serverLog));
        const approveResult = order === 'close-first' ? settled[1] : settled[0];
        const closeResult = order === 'close-first' ? settled[0] : settled[1];
        expect(closeResult.status).toBe('fulfilled');
        if (approveResult.status === 'rejected') {
          const reason = approveResult.reason as {
            code?: string;
            message?: string;
          };
          expect([
            ErrorCode.CERTIFICATE_IMPORT_AUTHORIZATION_PENDING,
            'CERTIFICATE_IMPORT_ENROLLMENT_RECONCILIATION_REQUIRED',
          ]).toContain(reason.code ?? reason.message);
        }
      } finally {
        try {
          await holder.release();
        } catch {
          // The holder transaction already ended.
        }
      }

      const year = await prisma.ecclesiastical_years.findUniqueOrThrow({
        where: { year_id: yearId },
      });
      const person =
        await prisma.investiture_authorization_people.findUniqueOrThrow({
          where: { person_id: presented.people[0].person_id },
        });
      expect(year.active).toBe(false);
      expect(person.status).toBe('CLOSED_YEAR');
      const invested = await prisma.enrollments.findUniqueOrThrow({
        where: { enrollment_id: enrollmentId },
        select: { investiture_status: true },
      });
      expect(invested.investiture_status).not.toBe('INVESTIDO');
    },
  );

  async function approveOwnedClass(input: {
    userId: string;
    classId: number;
    completedAt: Date;
  }) {
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: {
        user_id: input.userId,
        status: 'SUBMITTED',
        local_field_id: fieldId,
      },
    });
    const item = await prisma.certificate_bulk_import_items.create({
      data: {
        batch_id: batch.batch_id,
        item_type: 'CLASS',
        class_id: input.classId,
        completed_at: input.completedAt,
        status: 'SUBMITTED',
      },
    });
    const certificates = new CertificateBulkImportApplicationService(
      prisma as never,
    );
    return certificates.approveItem(MEMBER, batch.batch_id, item.item_id, {});
  }

  async function ensureUser(userId: string, email: string, birthday: string) {
    await prisma.users.upsert({
      where: { user_id: userId },
      update: {
        birthday: new Date(`${birthday}T00:00:00.000Z`),
        active: true,
      },
      create: {
        user_id: userId,
        email,
        name: 'C1R',
        active: true,
        birthday: new Date(`${birthday}T00:00:00.000Z`),
      },
    });
  }

  async function draftCrossYearBatch(userId: string, dates: string[]) {
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: userId, status: 'DRAFT' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: `https://files.test/${batch.batch_id}`,
        file_name: 'cert.pdf',
        file_type: 'application/pdf',
        uploaded_by_id: userId,
        upload_status: 'CONFIRMED',
        object_key: `obj/${batch.batch_id}`,
      },
    });
    for (const date of dates) {
      await prisma.certificate_bulk_import_items.create({
        data: {
          batch_id: batch.batch_id,
          item_type: 'CLASS',
          class_id: classId,
          completed_at: new Date(`${date}T00:00:00.000Z`),
          status: 'READY',
        },
      });
    }
    return batch.batch_id;
  }

  async function holdUserRows(userIds: string[]) {
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT user_id FROM users WHERE user_id = ANY($1::uuid[]) FOR UPDATE',
      [userIds],
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

  it.each(['a-then-b', 'b-then-a'] as const)(
    'C1R-N1 submits crossed certificate years when %s without a deadlock',
    async (order) => {
      const firstUser = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
      const secondUser = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2';
      await pastYear('2025-01-01', '2025-12-31');
      await ensureUser(firstUser, 'c1rn1-a@p4.test', '1990-01-01');
      await ensureUser(secondUser, 'c1rn1-b@p4.test', '1990-01-01');
      const laterFirst = await draftCrossYearBatch(firstUser, [
        '2026-06-01',
        '2025-06-01',
      ]);
      const earlierFirst = await draftCrossYearBatch(secondUser, [
        '2025-06-01',
        '2026-06-01',
      ]);
      const imports = new CertificateBulkImportsService(
        prisma as never,
        {} as never,
        null,
      );
      const serverLog = await openServerLog(url);
      const holder = await holdUserRows([firstUser, secondUser]);
      const startFirst = () => imports.submit(firstUser, laterFirst);
      const startSecond = () => imports.submit(secondUser, earlierFirst);
      try {
        const first = order === 'a-then-b' ? startFirst() : startSecond();
        await waitForUngrantedLocks(url, holder.pid, 1);
        const second = order === 'a-then-b' ? startSecond() : startFirst();
        await waitForUngrantedLocks(url, holder.pid, 2);
        await holder.release();
        const settled = await Promise.allSettled([first, second]);
        const log = serverLogSince(serverLog);
        noteServerLog(`C1R-N1 ${order}`, log);
        assertNoClientDeadlock(settled, log);
        expect(settled.map((result) => result.status)).toEqual([
          'fulfilled',
          'fulfilled',
        ]);
      } finally {
        try {
          await holder.release();
        } catch {
          // The holder transaction already ended.
        }
      }
    },
  );

  it.each(['submit-first', 'close-first'] as const)(
    'C1R-N1 closes two ended years against a batch submit when %s without a deadlock',
    async (order) => {
      const userId = 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3';
      const earlierYear = await pastYear('2025-01-01', '2025-12-31');
      await ensureUser(userId, 'c1rn1-c@p4.test', '1990-01-01');
      const batchId = await draftCrossYearBatch(userId, [
        '2026-06-01',
        '2025-06-01',
      ]);
      const yearIds = [earlierYear, yearId].sort((left, right) => left - right);
      const imports = new CertificateBulkImportsService(
        prisma as never,
        {} as never,
        null,
      );
      const startSubmit = () => imports.submit(userId, batchId);
      const startClose = () =>
        prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clubId}, ${yearId})`;
            return closePendingInvestitureAuthorizations(
              tx,
              { ecclesiastical_year_id: { in: yearIds } },
              yearIds,
            );
          },
          { maxWait: 15000, timeout: 15000 },
        );
      const serverLog = await openServerLog(url);
      const holder =
        order === 'submit-first'
          ? await holdUserRows([userId])
          : await holdAdvisory(
              `${INVESTITURE_REQUEST_YEAR_LOCK_PREFIX}${yearIds[0]}`,
            );
      try {
        const first = order === 'submit-first' ? startSubmit() : startClose();
        await waitForUngrantedLocks(url, holder.pid, 1);
        const second = order === 'submit-first' ? startClose() : startSubmit();
        await waitForUngrantedLocks(url, holder.pid, 2);
        await holder.release();
        const settled = await Promise.allSettled([first, second]);
        const log = serverLogSince(serverLog);
        noteServerLog(`C1R-N1 ${order}`, log);
        assertNoClientDeadlock(settled, log);
        expect(settled.map((result) => result.status)).toEqual([
          'fulfilled',
          'fulfilled',
        ]);
      } finally {
        try {
          await holder.release();
        } catch {
          // The holder transaction already ended.
        }
      }
    },
  );

  it('C1R-N2 closes an ended request and accredits a later class certificate', async () => {
    const earlierYear = await pastYear('2025-01-01', '2025-12-31');
    await prisma.ecclesiastical_years.update({
      where: { year_id: earlierYear },
      data: {
        active: false,
        end_date: new Date('2025-12-31T00:00:00.000Z'),
      },
    });
    await prisma.users.update({
      where: { user_id: MEMBER },
      data: { birthday: new Date('1990-01-01T00:00:00.000Z') },
    });
    const klass = await prisma.classes.create({
      data: {
        name: 'C1R clase',
        active: true,
        club_type_id: clubTypeId,
        minimum_age: 10,
        min_duration_years: 1,
        max_duration_years: 1,
      },
      select: { class_id: true },
    });
    const enrollment = await prisma.enrollments.create({
      data: {
        user_id: MEMBER,
        class_id: klass.class_id,
        ecclesiastical_year_id: earlierYear,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
    });
    const request = await prisma.investiture_authorization_requests.create({
      data: {
        club_section_id: sectionId,
        ecclesiastical_year_id: earlierYear,
        created_by_id: MEMBER,
      },
    });
    const person = await prisma.investiture_authorization_people.create({
      data: {
        request_id: request.request_id,
        user_id: MEMBER,
        class_id: klass.class_id,
        enrollment_id: enrollment.enrollment_id,
        investiture_date: new Date('2025-11-01T00:00:00.000Z'),
        status: 'PENDING',
        single_slot: false,
      },
    });
    const before = await prisma.achievement_event_log.count({
      where: { user_id: MEMBER, event_type: 'class.completed' },
    });

    await approveOwnedClass({
      userId: MEMBER,
      classId: klass.class_id,
      completedAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    const closed =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: person.person_id },
      });
    const pending = await prisma.investiture_authorization_people.count({
      where: {
        user_id: MEMBER,
        class_id: klass.class_id,
        status: 'PENDING',
      },
    });
    const invested = await prisma.enrollments.findFirst({
      where: {
        user_id: MEMBER,
        class_id: klass.class_id,
        ecclesiastical_year_id: yearId,
        investiture_status: 'INVESTIDO',
        record_kind: 'HISTORICAL_CERTIFICATE',
      },
    });
    const after = await prisma.achievement_event_log.count({
      where: { user_id: MEMBER, event_type: 'class.completed' },
    });
    expect(closed.status).toBe('CLOSED_YEAR');
    expect(closed.resolution_code).toBe('CLOSED_YEAR');
    expect(closed.system_reason).toBeNull();
    expect(closed.rejection_reason).toBeNull();
    expect(pending).toBe(0);
    expect(invested).not.toBeNull();
    expect(after).toBe(before);
  });

  it('C1R-N2 closes an ended Guía Mayor request and accredits the later certificate', async () => {
    const userId = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
    const earlierYear = await pastYear('2025-01-01', '2025-12-31');
    await prisma.ecclesiastical_years.update({
      where: { year_id: earlierYear },
      data: {
        active: false,
        end_date: new Date('2025-12-31T00:00:00.000Z'),
      },
    });
    await ensureUser(userId, 'c1rn2-gm@p4.test', '1980-01-01');
    const guide = await prisma.classes.upsert({
      where: { asset_code: 'GM-01' },
      update: { minimum_age: 16, active: true },
      create: {
        name: 'Guia Mayor C1R',
        active: true,
        club_type_id: clubTypeId,
        minimum_age: 16,
        min_duration_years: 1,
        max_duration_years: 1,
        asset_code: 'GM-01',
      },
      select: { class_id: true },
    });
    const enrollment = await prisma.enrollments.create({
      data: {
        user_id: userId,
        class_id: guide.class_id,
        ecclesiastical_year_id: earlierYear,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
    });
    const request = await prisma.investiture_authorization_requests.create({
      data: {
        club_section_id: sectionId,
        ecclesiastical_year_id: earlierYear,
        created_by_id: MEMBER,
      },
    });
    const person = await prisma.investiture_authorization_people.create({
      data: {
        request_id: request.request_id,
        user_id: userId,
        class_id: guide.class_id,
        enrollment_id: enrollment.enrollment_id,
        investiture_date: new Date('2025-11-01T00:00:00.000Z'),
        status: 'PENDING',
        single_slot: false,
      },
    });

    await approveOwnedClass({
      userId,
      classId: guide.class_id,
      completedAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    const closed =
      await prisma.investiture_authorization_people.findUniqueOrThrow({
        where: { person_id: person.person_id },
      });
    const pending = await prisma.investiture_authorization_people.count({
      where: { user_id: userId, class_id: guide.class_id, status: 'PENDING' },
    });
    const invested = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: enrollment.enrollment_id },
    });
    expect(closed.status).toBe('CLOSED_YEAR');
    expect(closed.resolution_code).toBe('CLOSED_YEAR');
    expect(closed.system_reason).toBeNull();
    expect(pending).toBe(0);
    expect(invested.record_kind).toBe('HISTORICAL_CERTIFICATE');
    expect(invested.investiture_status).toBe('INVESTIDO');
    expect(invested.ecclesiastical_year_id).toBe(yearId);
  });

  it.each(['approve-first', 'close-first'] as const)(
    'IA-61 approves a same-year certificate against the year-cut sweep when %s',
    async (order) => {
      const userId = 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6';
      const reviewerId = 'f7f7f7f7-f7f7-4f7f-8f7f-f7f7f7f7f7f7';
      const endedYear = await pastYear('2007-01-01', '2007-12-31');
      await prisma.ecclesiastical_years.update({
        where: { year_id: endedYear },
        data: {
          active: false,
          end_date: new Date('2007-12-31T00:00:00.000Z'),
        },
      });
      await ensureUser(userId, 'ia61-member@p4.test', '1990-01-01');
      await ensureUser(reviewerId, 'ia61-reviewer@p4.test', '1985-01-01');
      await prisma.users.update({
        where: { user_id: reviewerId },
        data: { local_field_id: null },
      });
      const role = await prisma.roles.upsert({
        where: { role_name: 'super-admin' },
        update: { active: true },
        create: {
          role_name: 'super-admin',
          description: 'IA-61 reviewer',
          role_category: 'GLOBAL',
          active: true,
        },
      });
      await prisma.users_roles.upsert({
        where: {
          user_id_role_id: { user_id: reviewerId, role_id: role.role_id },
        },
        update: { active: true },
        create: {
          user_id: reviewerId,
          role_id: role.role_id,
          active: true,
        },
      });
      const klass = await prisma.classes.create({
        data: {
          name: `IA61 ${order}`,
          active: true,
          club_type_id: clubTypeId,
          minimum_age: 10,
          min_duration_years: 1,
          max_duration_years: 1,
        },
        select: { class_id: true },
      });
      const enrollment = await prisma.enrollments.create({
        data: {
          user_id: userId,
          class_id: klass.class_id,
          ecclesiastical_year_id: endedYear,
          investiture_status: 'IN_PROGRESS',
          record_kind: 'OPERATIONAL',
          active: true,
        },
      });
      const fresh = await prisma.enrollments.findUniqueOrThrow({
        where: { enrollment_id: enrollment.enrollment_id },
      });
      const request = await prisma.investiture_authorization_requests.create({
        data: {
          club_section_id: sectionId,
          ecclesiastical_year_id: endedYear,
          created_by_id: userId,
        },
      });
      const person = await prisma.investiture_authorization_people.create({
        data: {
          request_id: request.request_id,
          user_id: userId,
          class_id: klass.class_id,
          enrollment_id: enrollment.enrollment_id,
          investiture_date: new Date('2007-11-01T00:00:00.000Z'),
          status: 'PENDING',
          single_slot: false,
        },
      });
      const batch = await prisma.certificate_bulk_import_batches.create({
        data: {
          user_id: userId,
          status: 'SUBMITTED',
          local_field_id: fieldId,
        },
      });
      const item = await prisma.certificate_bulk_import_items.create({
        data: {
          batch_id: batch.batch_id,
          item_type: 'CLASS',
          class_id: klass.class_id,
          completed_at: new Date('2007-06-01T00:00:00.000Z'),
          status: 'SUBMITTED',
        },
      });
      const certificates = new CertificateBulkImportApplicationService(
        prisma as never,
      );
      const beforeCompleted = await prisma.achievement_event_log.count({
        where: { user_id: userId, event_type: 'class.completed' },
      });
      const startApprove = () =>
        certificates.approveItem(reviewerId, batch.batch_id, item.item_id, {
          reconcile_enrollment_id: fresh.enrollment_id,
          expected_modified_at: fresh.modified_at.toISOString(),
        });
      const startClose = () =>
        prisma.$transaction(
          (tx) =>
            closePendingInvestitureAuthorizations(
              tx,
              { ecclesiastical_year_id: endedYear },
              [endedYear],
            ),
          { maxWait: 15000, timeout: 15000 },
        );
      const serverLog = await openServerLog(url);
      const holder =
        order === 'approve-first'
          ? await holdUserRows([userId])
          : await holdAdvisory(
              `${INVESTITURE_REQUEST_YEAR_LOCK_PREFIX}${endedYear}`,
            );
      try {
        const first = order === 'approve-first' ? startApprove() : startClose();
        await waitForUngrantedLocks(url, holder.pid, 1);
        const second =
          order === 'approve-first' ? startClose() : startApprove();
        await waitForUngrantedLocks(url, holder.pid, 2);
        await holder.release();
        const settled = await Promise.allSettled([first, second]);
        const log = serverLogSince(serverLog);
        noteServerLog(`IA-61 ${order}`, log);
        assertNoClientDeadlock(settled, log);
        expect(settled.map((result) => result.status)).toEqual([
          'fulfilled',
          'fulfilled',
        ]);
      } finally {
        try {
          await holder.release();
        } catch {
          // The holder transaction already ended.
        }
      }

      const closed =
        await prisma.investiture_authorization_people.findUniqueOrThrow({
          where: { person_id: person.person_id },
        });
      const invested = await prisma.enrollments.count({
        where: {
          user_id: userId,
          class_id: klass.class_id,
          investiture_status: 'INVESTIDO',
        },
      });
      const afterCompleted = await prisma.achievement_event_log.count({
        where: { user_id: userId, event_type: 'class.completed' },
      });
      expect(closed.status).toBe('CLOSED_YEAR');
      expect(closed.resolution_code).toBe('CLOSED_YEAR');
      expect(closed.system_reason).toBe(LATER_CERTIFICATE_ACCREDITATION_REASON);
      expect(invested).toBe(1);
      expect(afterCompleted).toBe(beforeCompleted);
    },
  );

  it('C1RR-2 keeps pastor authorization and certificate approval on the same side of an active end_date', async () => {
    const field = await prisma.local_fields.findUniqueOrThrow({
      where: { local_field_id: fieldId },
      select: { timezone: true },
    });
    const boundaryYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2025-01-01T00:00:00.000Z'),
        end_date: new Date('2025-12-31T00:00:00.000Z'),
        active: true,
      },
      select: { year_id: true },
    });
    const scenarios = [
      ['America/Tijuana', '2026-01-01T07:30:00.000Z', false],
      ['America/Tijuana', '2026-01-01T08:30:00.000Z', true],
      ['America/Bogota', '2026-01-01T04:30:00.000Z', false],
      ['America/Bogota', '2026-01-01T05:30:00.000Z', true],
    ] as const;
    try {
      for (const [timeZone, instant, ended] of scenarios) {
        await prisma.local_fields.update({
          where: { local_field_id: fieldId },
          data: { timezone: timeZone },
        });
        const userId = randomUUID();
        await ensureUser(userId, `${userId}@c1rr.test`, '2000-01-01');
        const enrollment = await prisma.enrollments.create({
          data: {
            user_id: userId,
            class_id: classId,
            ecclesiastical_year_id: boundaryYear.year_id,
            investiture_status: 'IN_PROGRESS',
            record_kind: 'OPERATIONAL',
            active: true,
          },
          select: { enrollment_id: true },
        });
        const request = await prisma.investiture_authorization_requests.create({
          data: {
            club_section_id: sectionId,
            ecclesiastical_year_id: boundaryYear.year_id,
            created_by_id: ACTOR,
          },
          select: { request_id: true },
        });
        await prisma.investiture_authorization_people.create({
          data: {
            request_id: request.request_id,
            user_id: userId,
            class_id: classId,
            enrollment_id: enrollment.enrollment_id,
            investiture_date: new Date('2025-11-01T00:00:00.000Z'),
            status: 'PENDING',
            single_slot: false,
          },
        });
        const now = new Date(instant);
        const pastor = service
          .present(
            {
              ...marker(),
              grants: {
                ...marker().grants,
                club_assignments: marker().grants.club_assignments.map(
                  (grant) => ({
                    ...grant,
                    ecclesiastical_year_id: boundaryYear.year_id,
                  }),
                ),
              },
            },
            ACTOR,
            sectionId,
            boundaryYear.year_id,
            '2025-11-01',
            [enrollment.enrollment_id],
            now,
          )
          .then(() => null)
          .catch((error: { code?: string }) => error);
        const pastorResult = await pastor;
        if (ended) {
          expect(pastorResult).toMatchObject({
            code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
          });
        } else {
          expect(pastorResult?.code).not.toBe(
            ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
          );
        }
        const certificate = guardCertificateApprovalAuthorization(
          prisma as never,
          {
            userId,
            classId,
            certificateYearId: boundaryYear.year_id,
            now,
          },
        );
        if (ended) {
          await expect(certificate).resolves.toEqual(expect.any(Array));
          const person =
            await prisma.investiture_authorization_people.findFirstOrThrow({
              where: {
                user_id: userId,
                enrollment_id: enrollment.enrollment_id,
              },
            });
          expect(person.status).toBe('CLOSED_YEAR');
        } else {
          await expect(certificate).rejects.toMatchObject({
            code: ErrorCode.CERTIFICATE_IMPORT_AUTHORIZATION_PENDING,
          });
        }
      }
    } finally {
      await prisma.local_fields.update({
        where: { local_field_id: fieldId },
        data: { timezone: field.timezone },
      });
    }
  });

  it('C1RR-3 rejects a foreign server log and a session that does not record WARNING', async () => {
    const foreign = join(tmpdir(), `sacdia-foreign-${randomUUID()}.log`);
    writeFileSync(foreign, 'LOG: not this server\n');
    const visible = `sacdia-pg-warning-${randomUUID()}`;
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(`DO $$ BEGIN RAISE WARNING '${visible}'; END $$;`);
      expect(() => assertServerLogHasWarningMarker(foreign, visible)).toThrow(
        /WARNING/,
      );
      assertServerLogHasWarningMarker(
        requireInvestitureServerLogPath(),
        visible,
      );
      await client.query("SET log_min_messages = 'log'");
      const hidden = `sacdia-pg-warning-${randomUUID()}`;
      const path = requireInvestitureServerLogPath();
      const before = readFileSync(path, 'utf8').length;
      await client.query(`DO $$ BEGIN RAISE WARNING '${hidden}'; END $$;`);
      const after = readFileSync(path, 'utf8');
      expect(after.slice(before)).not.toContain(hidden);
      expect(() => assertServerLogHasWarningMarker(path, hidden)).toThrow(
        /WARNING/,
      );
    } finally {
      await client.end();
    }
  });

  it('does not add a person after the year ends while the lock is held', async () => {
    await rejectAfterClockAdvance({
      operation: 'add',
      before: new Date('2036-01-01T05:59:59.000Z'),
      after: new Date('2036-01-01T06:00:01.000Z'),
      investitureDate: '2035-12-31',
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
      throughYearEnd: true,
    });
  });

  describe('BCR-1 and BCR-8 read paths', () => {
    it('BCR-1 returns the real club type name as section_name for the board and the authorizer', async () => {
      const view = await present();
      expect(view.people[0].section_name).toBe('Conquistadores');
      const asAuthorizer = await service.readForAuthorizer(
        fieldAuth(),
        ACTOR,
        view.request_id,
      );
      expect(asAuthorizer.people[0].section_name).toBe('Conquistadores');
      const asRoot = await service.readForAuthorizer(
        globalAuth('super-admin'),
        'root-1',
        view.request_id,
      );
      expect(asRoot.people[0].section_name).toBe('Conquistadores');
    });

    it('BCR-8 reads with an invalid stored zone while present and resolve keep rejecting it', async () => {
      const view = await present();
      const personId = view.people[0].person_id;
      await prisma.local_fields.update({
        where: { local_field_id: fieldId },
        data: { timezone: 'Not/AZone' },
      });
      try {
        const asAuthorizer = await service.readForAuthorizer(
          fieldAuth(),
          ACTOR,
          view.request_id,
        );
        expect(asAuthorizer.people[0].person_id).toBe(personId);
        const asRoot = await service.readForAuthorizer(
          globalAuth('super-admin'),
          'root-1',
          view.request_id,
        );
        expect(asRoot.people[0].person_id).toBe(personId);
        await expect(present()).rejects.toMatchObject({
          code: ErrorCode.INVESTITURE_REQUEST_TIME_ZONE_INVALID,
        });
        await expect(
          service.resolve(
            fieldAuth(),
            ACTOR,
            view.request_id,
            { invest: [{ person_id: personId }] },
            INSIDE,
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.INVESTITURE_REQUEST_TIME_ZONE_INVALID,
        });
        const stored =
          await prisma.investiture_authorization_people.findUniqueOrThrow({
            where: { person_id: personId },
          });
        expect(stored.status).toBe('PENDING');
      } finally {
        await prisma.local_fields.update({
          where: { local_field_id: fieldId },
          data: { timezone: 'America/Mexico_City' },
        });
      }
    });
  });

  describe('BCR-3, BCR-5 and BCR-6 reminders and pastor eligibility', () => {
    const LIVE_PASTOR = '51000000-0000-4000-8000-000000000001';
    const DELETED_PASTOR = '51000000-0000-4000-8000-000000000002';
    const CASE_PASTOR = '51000000-0000-4000-8000-000000000003';
    const NO_ROLE_PASTOR = '51000000-0000-4000-8000-000000000004';

    async function seedPastors(): Promise<void> {
      await prisma.investiture_message_dispatches.deleteMany();
      await prisma.investiture_reminder_runs.deleteMany();
      await prisma.district_investiture_pastors.deleteMany();
      await prisma.users_roles.deleteMany({
        where: {
          user_id: {
            in: [LIVE_PASTOR, DELETED_PASTOR, CASE_PASTOR, NO_ROLE_PASTOR],
          },
        },
      });
      const lower = await prisma.roles.upsert({
        where: { role_name: 'pastor' },
        update: { active: true, role_category: 'GLOBAL' },
        create: {
          role_name: 'pastor',
          description: 'Pastor',
          role_category: 'GLOBAL',
          active: true,
        },
      });
      const capital = await prisma.roles.upsert({
        where: { role_name: 'Pastor' },
        update: { active: true, role_category: 'GLOBAL' },
        create: {
          role_name: 'Pastor',
          description: 'Pastor (mayúscula)',
          role_category: 'GLOBAL',
          active: true,
        },
      });
      const people: Array<[string, string, boolean]> = [
        [LIVE_PASTOR, 'live', true],
        [DELETED_PASTOR, 'deleted', false],
        [CASE_PASTOR, 'case', true],
        [NO_ROLE_PASTOR, 'norole', true],
      ];
      for (const [id, tag, active] of people) {
        await prisma.users.upsert({
          where: { user_id: id },
          update: {
            active,
            email: active
              ? `${tag}-pastor@p4.test`
              : `deleted-${id}@sacdia.deleted`,
          },
          create: {
            user_id: id,
            email: active
              ? `${tag}-pastor@p4.test`
              : `deleted-${id}@sacdia.deleted`,
            name: tag,
            active,
          },
        });
      }
      await prisma.users_roles.createMany({
        data: [
          { user_id: LIVE_PASTOR, role_id: lower.role_id, active: true },
          { user_id: DELETED_PASTOR, role_id: lower.role_id, active: true },
          { user_id: CASE_PASTOR, role_id: capital.role_id, active: true },
        ],
      });
      for (const id of [
        LIVE_PASTOR,
        DELETED_PASTOR,
        CASE_PASTOR,
        NO_ROLE_PASTOR,
      ]) {
        await prisma.district_investiture_pastors.create({
          data: { districlub_type_id: districtId, user_id: id, active: true },
        });
      }
    }

    it('BCR-6 listing and authorizers mark a deleted account and a missing role, and keep the case variant', async () => {
      await seedPastors();
      const pastorsService = new DistrictInvestiturePastorService(
        prisma as never,
      );
      const listed = await pastorsService.list(fieldAuth(), districtId);
      const byUser = new Map(
        listed.pastors.map((item) => [item.user_id, item]),
      );
      expect(byUser.get(LIVE_PASTOR)).toMatchObject({ can_authorize: true });
      expect(byUser.get(CASE_PASTOR)).toMatchObject({ can_authorize: true });
      expect(byUser.get(DELETED_PASTOR)).toMatchObject({
        can_authorize: false,
        account_inactive: true,
      });
      expect(byUser.get(DELETED_PASTOR)).not.toHaveProperty('role_missing');
      expect(byUser.get(NO_ROLE_PASTOR)).toMatchObject({
        can_authorize: false,
        role_missing: true,
      });
      expect(listed.pastors).toHaveLength(4);
      const authorizers = await pastorsService.authorizersForClub(
        fieldAuth(),
        clubId,
      );
      expect(
        authorizers.authorizers.map((item) => item.user_id).sort(),
      ).toEqual([CASE_PASTOR, LIVE_PASTOR].sort());
    });

    it('BCR-6 resolution refuses a deleted pastor even with a stale pastor role in the token', async () => {
      await seedPastors();
      const view = await present();
      const personId = view.people[0].person_id;
      const attempt = (actor: string) =>
        service.resolve(
          globalAuth('pastor'),
          actor,
          view.request_id,
          { invest: [{ person_id: personId }] },
          INSIDE,
        );
      await expect(attempt(DELETED_PASTOR)).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
      });
      await expect(
        service.listForAuthorizer(globalAuth('pastor'), DELETED_PASTOR, yearId),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
      });
      await expect(attempt(NO_ROLE_PASTOR)).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
      });
      const stored =
        await prisma.investiture_authorization_people.findUniqueOrThrow({
          where: { person_id: personId },
        });
      expect(stored.status).toBe('PENDING');
      const resolved = await attempt(LIVE_PASTOR);
      expect(resolved.invested).toHaveLength(1);
    });

    it('BCR-6 presentation and reminder mails skip a deleted pastor and keep the case variant', async () => {
      await seedPastors();
      const view = await present();
      const outbox = emailOutbox();
      const communications = mailService(outbox);
      await communications.recordPresentation({
        requestId: view.request_id,
        enrollmentIds: [enrollmentId],
      });
      const presentation = await prisma.investiture_message_dispatches.findMany(
        { where: { kind: 'PRESENTATION', role: 'pastor' } },
      );
      expect(presentation.map((row) => row.recipient_user_id).sort()).toEqual(
        [CASE_PASTOR, LIVE_PASTOR].sort(),
      );
      await prisma.investiture_message_dispatches.deleteMany();
      const monday = new Date('2026-10-05T16:00:00.000Z');
      await communications.dispatchReminders(monday);
      const reminders = await prisma.investiture_message_dispatches.findMany({
        where: { kind: 'REMINDER', role: 'pastor' },
      });
      expect(reminders.map((row) => row.recipient_user_id).sort()).toEqual(
        [CASE_PASTOR, LIVE_PASTOR].sort(),
      );
    });

    it('BCR-3 counts every re-queue with two concurrent instances: exactly 5 attempts, then skipped with the cap cause', async () => {
      await seedPastors();
      await prisma.investiture_message_dispatches.create({
        data: {
          kind: 'REMINDER',
          execution_key: '2026-10-05',
          recipient_user_id: LIVE_PASTOR,
          role: 'pastor',
          scope_key: `field:${fieldId}`,
          status: 'queued',
          attempts: 1,
          payload: { channel: 'email', requestIds: [] },
        },
      });
      let requeues = 0;
      const build = () => {
        process.env.INVESTITURE_EMAIL_ENABLED = 'true';
        process.env.EMAIL_ENABLED = 'true';
        return new InvestitureCommunicationsService(
          prisma as never,
          {
            sendInvestitureNotice: async () => undefined,
            inspectInvestitureJob: async () => 'failed' as const,
            retryFailedInvestitureJob: async () => {
              requeues += 1;
            },
          } as never,
          { pushBestEffort: async () => undefined } as never,
          { get: () => 'https://admin.example.test' } as never,
        );
      };
      const first = build();
      const second = build();
      const base = new Date('2026-10-05T16:00:00.000Z').getTime();
      for (let run = 0; run < 20; run += 1) {
        const now = new Date(base + run * 15 * 60 * 1000);
        await Promise.all([
          first.deliverPending(now),
          second.deliverPending(now),
        ]);
      }
      const row = await prisma.investiture_message_dispatches.findFirstOrThrow({
        where: { kind: 'REMINDER', recipient_user_id: LIVE_PASTOR },
      });
      expect({ requeues, attempts: row.attempts, status: row.status }).toEqual({
        requeues: 4,
        attempts: 5,
        status: 'skipped',
      });
      expect(row.last_error).toBe('reminder_retry_limit');
    });

    it('BCR-3 reaches the provider exactly 5 times when the worker fails every claim', async () => {
      await seedPastors();
      await present();
      let providerAttempts = 0;
      const holder: { service?: InvestitureCommunicationsService } = {};
      process.env.INVESTITURE_EMAIL_ENABLED = 'true';
      process.env.EMAIL_ENABLED = 'true';
      const monday = new Date('2026-10-05T16:00:00.000Z');
      const service = new InvestitureCommunicationsService(
        prisma as never,
        {
          sendInvestitureNotice: async ({
            dispatchId,
          }: {
            dispatchId: string;
          }) => {
            const fresh = await holder.service?.prepare(dispatchId);
            if (fresh) {
              providerAttempts += 1;
              await holder.service?.markFailed(dispatchId, 'provider down');
            }
          },
          inspectInvestitureJob: async () => 'missing' as const,
          retryFailedInvestitureJob: async () => undefined,
        } as never,
        { pushBestEffort: async () => undefined } as never,
        { get: () => 'https://admin.example.test' } as never,
      );
      holder.service = service;
      service.bindClock(() => monday);
      await service.dispatchReminders(monday);
      for (let run = 1; run < 20; run += 1) {
        const now = new Date(monday.getTime() + run * 15 * 60 * 1000);
        service.bindClock(() => now);
        await service.deliverPending(now);
      }
      const rows = await prisma.investiture_message_dispatches.findMany({
        where: { kind: 'REMINDER' },
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect({ attempts: row.attempts, status: row.status }).toEqual({
          attempts: 5,
          status: 'skipped',
        });
        expect(row.last_error).toBe('reminder_retry_limit');
      }
      expect(providerAttempts).toBe(5 * rows.length);
    });

    describe('BCR-5 late recovery only when the 10:00 run did not happen', () => {
      // Mexico City is UTC-6 all year: 10:00 local is 16:00Z.
      const at = (day: string, localHour: number, minute = 0) =>
        new Date(
          `${day}T${String(localHour + 6).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
        );
      const MONDAY = '2026-10-05';

      async function removeAssignments(ids: string[]) {
        await prisma.district_investiture_pastors.deleteMany({
          where: { user_id: { in: ids } },
        });
      }

      function instance() {
        return mailService(emailOutbox());
      }

      async function reminderRows() {
        return prisma.investiture_message_dispatches.findMany({
          where: { kind: 'REMINDER' },
          orderBy: { recipient_user_id: 'asc' },
        });
      }

      it('BCR-5 (a) sends nothing at 15:00 when the 10:00 run happened with no pendings', async () => {
        await seedPastors();
        const service = instance();
        expect(await service.dispatchReminders(at(MONDAY, 10))).toBe(0);
        await present();
        expect(await service.dispatchReminders(at(MONDAY, 15))).toBe(0);
        expect(await reminderRows()).toHaveLength(0);
      });

      it('BCR-5 (a2) sends nothing to a recipient who joined after the 10:00 run', async () => {
        await seedPastors();
        await present();
        await removeAssignments([CASE_PASTOR]);
        const service = instance();
        await service.dispatchReminders(at(MONDAY, 10));
        expect(
          (await reminderRows()).map((row) => row.recipient_user_id),
        ).toEqual([LIVE_PASTOR]);
        await prisma.district_investiture_pastors.create({
          data: {
            districlub_type_id: districtId,
            user_id: CASE_PASTOR,
            active: true,
          },
        });
        await service.dispatchReminders(at(MONDAY, 15));
        expect(
          (await reminderRows()).map((row) => row.recipient_user_id),
        ).toEqual([LIVE_PASTOR]);
      });

      it('BCR-5 (b) sends once at 13:00 when the 10:00 run was missed and not again at 14:00', async () => {
        await seedPastors();
        await present();
        const service = instance();
        await service.dispatchReminders(at(MONDAY, 13));
        const first = await reminderRows();
        expect(first.map((row) => row.recipient_user_id).sort()).toEqual(
          [CASE_PASTOR, LIVE_PASTOR].sort(),
        );
        await service.dispatchReminders(at(MONDAY, 14));
        await instance().dispatchReminders(at(MONDAY, 23, 45));
        expect(await reminderRows()).toHaveLength(first.length);
      });

      it('BCR-5 (b2) does not recover a missed day on the next one', async () => {
        await seedPastors();
        await present();
        const service = instance();
        expect(await service.dispatchReminders(at('2026-10-06', 11))).toBe(0);
        expect(await reminderRows()).toHaveLength(0);
      });

      it('BCR-5 (c) does nothing on a day with no schedule', async () => {
        await seedPastors();
        await present();
        const service = instance();
        // Tuesday 2026-10-06 and Thursday 2026-10-08.
        expect(await service.dispatchReminders(at('2026-10-06', 10))).toBe(0);
        expect(await service.dispatchReminders(at('2026-10-08', 15))).toBe(0);
        expect(await reminderRows()).toHaveLength(0);
      });

      it('BCR-5 (d) a Wednesday run reminds the pastors once and the 15:00 run adds nothing', async () => {
        await seedPastors();
        await present();
        const service = instance();
        await service.dispatchReminders(at('2026-10-07', 10));
        const wednesday = await reminderRows();
        expect(
          wednesday.every((row) => row.execution_key === '2026-10-07'),
        ).toBe(true);
        expect(wednesday.length).toBeGreaterThan(0);
        await service.dispatchReminders(at('2026-10-07', 15));
        expect(await reminderRows()).toHaveLength(wednesday.length);
      });

      it('BCR33-N2 a render error at 10:00 does not consume the day; the 11:00 run after the fix sends once', async () => {
        await seedPastors();
        await present();
        const outbox = emailOutbox();
        const broken = mailService(outbox, '');
        expect(await broken.dispatchReminders(at(MONDAY, 10))).toBe(0);
        expect(await reminderRows()).toHaveLength(0);
        expect(
          await prisma.investiture_reminder_runs.count({
            where: { local_field_id: fieldId, local_date: MONDAY },
          }),
        ).toBe(0);
        const fixed = mailService(outbox);
        expect(await fixed.dispatchReminders(at(MONDAY, 11))).toBe(2);
        const sent = await reminderRows();
        expect(sent).toHaveLength(2);
        expect(
          await prisma.investiture_reminder_runs.count({
            where: { local_field_id: fieldId, local_date: MONDAY },
          }),
        ).toBe(3);
        expect(await fixed.dispatchReminders(at(MONDAY, 12))).toBe(0);
        expect(await reminderRows()).toHaveLength(2);
      });

      it('BCR-5 (e) two instances racing the same slot claim the day once', async () => {
        await seedPastors();
        await present();
        const outbox = emailOutbox();
        const first = mailService(outbox);
        const second = mailService(outbox);
        const results = await Promise.all([
          first.dispatchReminders(at(MONDAY, 10)),
          second.dispatchReminders(at(MONDAY, 10)),
        ]);
        const rows = await reminderRows();
        expect(rows).toHaveLength(2);
        expect(results.reduce((sum, value) => sum + value, 0)).toBe(2);
        expect(new Set(outbox.queued).size).toBe(outbox.queued.length);
        const runs = await prisma.investiture_reminder_runs.findMany({
          where: { local_field_id: fieldId, local_date: MONDAY },
        });
        expect(runs.map((run) => run.role).sort()).toEqual([
          'assistant-lf',
          'director-lf',
          'pastor',
        ]);
      });
    });

    function emailOutbox() {
      return { queued: [] as string[], jobs: new Map<string, string>() };
    }

    function mailService(
      outbox: ReturnType<typeof emailOutbox>,
      panelUrl = 'https://admin.example.test',
    ) {
      process.env.INVESTITURE_EMAIL_ENABLED = 'true';
      process.env.EMAIL_ENABLED = 'true';
      return new InvestitureCommunicationsService(
        prisma as never,
        {
          sendInvestitureNotice: async ({
            dispatchId,
          }: {
            dispatchId: string;
          }) => {
            outbox.queued.push(dispatchId);
          },
          inspectInvestitureJob: async () => 'missing' as const,
          retryFailedInvestitureJob: async () => undefined,
        } as never,
        { pushBestEffort: async () => undefined } as never,
        { get: () => panelUrl } as never,
      );
    }
  });
});

async function presentationIntents(
  database: {
    investiture_message_dispatches: {
      findMany: (args: {
        where: { role: string; kind: 'PRESENTATION' };
      }) => Promise<Array<{ payload: unknown }>>;
    };
  },
  enrollmentId: number,
): Promise<number> {
  const rows = await database.investiture_message_dispatches.findMany({
    where: { role: 'intent', kind: 'PRESENTATION' },
  });
  return rows.filter((row) => {
    const payload = row.payload as { enrollmentIds?: number[] };
    return payload.enrollmentIds?.includes(enrollmentId);
  }).length;
}

async function waitForAdvisoryWaiters(
  databaseUrl: string,
  holderPid: number,
  count: number,
): Promise<void> {
  const observer = new Client({ connectionString: databaseUrl });
  await observer.connect();
  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const waiting = await observer.query<{ waiting: string }>(
        `SELECT count(*)::text AS waiting
         FROM pg_locks
         WHERE locktype = 'advisory'
           AND NOT granted
           AND pid <> $1`,
        [holderPid],
      );
      if (Number(waiting.rows[0]?.waiting ?? 0) >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      'la operación no quedó esperando un candado advisory en pg_locks',
    );
  } finally {
    await observer.end();
  }
}

async function waitForUngrantedLocks(
  databaseUrl: string,
  holderPid: number,
  count: number,
): Promise<void> {
  const observer = new Client({ connectionString: databaseUrl });
  await observer.connect();
  try {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const waiting = await observer.query<{ waiting: string }>(
        `SELECT count(DISTINCT pid)::text AS waiting
         FROM pg_locks
         WHERE NOT granted
           AND pid <> $1`,
        [holderPid],
      );
      if (Number(waiting.rows[0]?.waiting ?? 0) >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('la operación no quedó esperando un candado en pg_locks');
  } finally {
    await observer.end();
  }
}

async function openServerLog(
  databaseUrl: string,
): Promise<{ path: string; offset: number }> {
  const path = requireInvestitureServerLogPath();
  const marker = `sacdia-pg-warning-${randomUUID()}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`DO $$ BEGIN RAISE WARNING '${marker}'; END $$;`);
  } finally {
    await client.end();
  }
  assertServerLogHasWarningMarker(path, marker);
  const fd = openSync(path, 'r');
  try {
    return { path, offset: fstatSync(fd).size };
  } finally {
    closeSync(fd);
  }
}

function serverLogSince(mark: { path: string; offset: number }): string {
  const fd = openSync(mark.path, 'r');
  try {
    const size = fstatSync(fd).size;
    const length = Math.max(0, size - mark.offset);
    const buffer = Buffer.alloc(length);
    if (length > 0) {
      readSync(fd, buffer, 0, length, mark.offset);
    }
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function clientDeadlock(error: unknown): boolean {
  const bag = error as { code?: string; message?: string; meta?: unknown };
  const message =
    error instanceof Error ? error.message : String(bag?.message ?? error);
  const text = `${bag?.code ?? ''} ${message} ${JSON.stringify(bag?.meta ?? {})}`;
  return text.includes('40P01') || text.toLowerCase().includes('deadlock');
}

function assertNoClientDeadlock(
  settled: PromiseSettledResult<unknown>[],
  log: string,
): void {
  for (const result of settled) {
    if (result.status === 'rejected') {
      expect(clientDeadlock(result.reason)).toBe(false);
    }
  }
  expect(log).not.toMatch(/deadlock detected/i);
}

function noteServerLog(label: string, log: string): void {
  const deadlockLines = log
    .split('\n')
    .filter((line) => /deadlock detected/i.test(line)).length;
  console.info(
    `${label} postgres-log bytes=${log.length} deadlock_lines=${deadlockLines}`,
  );
}
