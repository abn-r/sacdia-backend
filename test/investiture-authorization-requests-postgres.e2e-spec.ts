import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg, { Client } from 'pg';
import type { AuthorizationSnapshot } from '../src/common/services/authorization-context.service';
import { ErrorCode } from '../src/common/errors/error-codes';
import { ClassesService } from '../src/classes/classes.service';
import { INVESTITURE_REQUEST_USER_LOCK_PREFIX } from '../src/investiture-requests/investiture-authorization-requests.service';
import { INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX } from '../src/investiture-requests/investiture-request-lock';
import {
  INVESTITURE_SYSTEM_REJECTION_TEXT,
  InvestitureAuthorizationRequestService,
} from '../src/investiture-requests/investiture-authorization-requests.service';
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
  const events: Array<{ eventType: string; userId: string }> = [];

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
          emitEvent: async (dto: { eventType: string; userId: string }) => {
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
    expect(resolved.rejected_by_person[0].rejection_reason).toBe(
      'Faltan evidencias',
    );
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
      service.closePendingByYearEnd(closing.people[0].person_id),
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
          (result) => result.status === 'fulfilled' && result.value === false,
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
    expect(enrollment.investiture_status).toBe('IN_PROGRESS');
    expect(events).toHaveLength(0);
  });
});

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
