jest.setTimeout(180000);

import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { Client } from 'pg';
import { YearCutService } from '../src/year-cut/year-cut.service';
import { AnnualMembershipPolicyService } from '../src/annual-membership/annual-membership-policy.service';
import { EcclesiasticalYearService } from '../src/common/services/ecclesiastical-year.service';
import { AuthorizationContextService } from '../src/common/services/authorization-context.service';
import {
  ANNUAL_CYCLE_IDS,
  SACDIA_TEST_DATABASE_URL_ENV,
  UnsafeTestDatabaseUrlError,
  YEAR_CUT_NOW,
  applyIsolatedTestDatabaseFromEnv,
  assertSafeTestDatabaseUrl,
  bootstrapAnnualCycleApp,
  prepareAnnualCycleDatabase,
  seedAnnualCycleFixture,
  withClient,
  type AnnualCycleFixture,
} from './helpers/annual-cycle-db.helper';
import {
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

describe('T8 annual-cycle isolated URL', () => {
  const originalDedicated = process.env[SACDIA_TEST_DATABASE_URL_ENV];
  const originalDatabase = process.env.DATABASE_URL;
  const originalDirect = process.env.DATABASE_DIRECT_URL;

  afterEach(() => {
    if (originalDedicated === undefined) {
      delete process.env[SACDIA_TEST_DATABASE_URL_ENV];
    } else {
      process.env[SACDIA_TEST_DATABASE_URL_ENV] = originalDedicated;
    }
    if (originalDatabase === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabase;
    }
    if (originalDirect === undefined) {
      delete process.env.DATABASE_DIRECT_URL;
    } else {
      process.env.DATABASE_DIRECT_URL = originalDirect;
    }
  });

  it('rejects a missing dedicated test URL', () => {
    delete process.env[SACDIA_TEST_DATABASE_URL_ENV];
    expect(() => applyIsolatedTestDatabaseFromEnv()).toThrow(
      UnsafeTestDatabaseUrlError,
    );
    try {
      applyIsolatedTestDatabaseFromEnv();
    } catch (error) {
      expect((error as UnsafeTestDatabaseUrlError).message).toBe(
        'SACDIA_TEST_DATABASE_URL_REQUIRED',
      );
    }
  });

  it('does not treat DATABASE_URL as the isolated destination', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@db.neon.tech/neondb';
    delete process.env[SACDIA_TEST_DATABASE_URL_ENV];
    expect(() => applyIsolatedTestDatabaseFromEnv()).toThrow(
      /SACDIA_TEST_DATABASE_URL_REQUIRED/,
    );
  });

  it('rejects a non-loopback host', () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        'postgresql://postgres:postgres@8.8.8.8:5432/sacdia_annual_cycle_test',
      ),
    ).toThrow(/SACDIA_TEST_DATABASE_URL_NOT_LOOPBACK/);
  });

  it('rejects a database name without _test suffix', () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        'postgresql://postgres:postgres@127.0.0.1:5432/sacdia',
      ),
    ).toThrow(/SACDIA_TEST_DATABASE_URL_NAME_MUST_END_WITH_TEST/);
  });

  it('accepts a loopback URL whose database name ends with _test', () => {
    const parsed = assertSafeTestDatabaseUrl(
      'postgresql://postgres:postgres@127.0.0.1:55432/sacdia_annual_cycle_test',
    );
    expect(parsed.hostname).toBe('127.0.0.1');
    expect(parsed.pathname.endsWith('_test')).toBe(true);
  });
});

describe('T8 annual-cycle PostgreSQL', () => {
  let url: string;
  let fixture: AnnualCycleFixture;
  let app: Awaited<ReturnType<typeof bootstrapAnnualCycleApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootstrapAnnualCycleApp>>['prisma'];
  let jwtService: JwtService;
  let yearCut: YearCutService;
  let policy: AnnualMembershipPolicyService;
  let ecclesiasticalYear: EcclesiasticalYearService;
  const clock = { now: () => YEAR_CUT_NOW };

  const bearer = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(jwtService, userId)}`,
  });

  beforeAll(async () => {
    url = await prepareAnnualCycleDatabase();
    fixture = await seedAnnualCycleFixture(url, 'year-cut');
    const boot = await bootstrapAnnualCycleApp(clock);
    app = boot.app;
    prisma = boot.prisma;
    jwtService = createTestJwtService();
    yearCut = app.get(YearCutService);
    policy = app.get(AnnualMembershipPolicyService);
    ecclesiasticalYear = app.get(EcclesiasticalYearService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('applies SQL-only unique indexes and the slot-limit trigger', async () => {
    await withClient(url, async (client) => {
      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE indexname IN (
           'uniq_cra_director_status_section_year',
           'uniq_cra_annual_member_section_year',
           'uniq_director_succession_open_section_year'
         )`,
      );
      expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([
        'uniq_cra_annual_member_section_year',
        'uniq_cra_director_status_section_year',
        'uniq_director_succession_open_section_year',
      ]);

      const trigger = await client.query(
        `SELECT 1 FROM pg_trigger
         WHERE tgname = 'trg_enforce_club_role_slot_limits'`,
      );
      expect(trigger.rowCount).toBe(1);
    });
  });

  it('A01/A04/A05/A10: cut ends CQ cargo, keeps GM director, does not enroll or rewrite history', async () => {
    const enrollmentsBefore = await prisma.enrollments.count();

    const summary = await yearCut.applyCut(YEAR_CUT_NOW);
    expect(summary.ended).toBeGreaterThan(0);
    expect(summary.activated).toBe(1);

    const cqDirectorRows = await prisma.club_role_assignments.findMany({
      where: { user_id: ANNUAL_CYCLE_IDS.cqDirector },
    });
    expect(
      cqDirectorRows.some(
        (row) =>
          row.club_section_id === fixture.cqSectionId &&
          row.ecclesiastical_year_id === fixture.yearPrev &&
          row.status === 'ended',
      ),
    ).toBe(true);
    expect(
      cqDirectorRows.some(
        (row) =>
          row.club_section_id === fixture.gmSectionId &&
          row.ecclesiastical_year_id === fixture.yearCurrent &&
          row.status === 'inactive',
      ),
    ).toBe(true);
    expect(
      cqDirectorRows.some(
        (row) =>
          row.club_section_id === fixture.gmSectionId &&
          row.status === 'active' &&
          row.ecclesiastical_year_id === fixture.yearCurrent,
      ),
    ).toBe(false);

    const successor = await prisma.club_role_assignments.findFirst({
      where: {
        user_id: ANNUAL_CYCLE_IDS.gmSuccessor,
        club_section_id: fixture.gmSectionId,
        ecclesiastical_year_id: fixture.yearCurrent,
        status: 'active',
      },
    });
    expect(successor).toBeTruthy();

    const successorMember = await prisma.club_role_assignments.findFirst({
      where: {
        user_id: ANNUAL_CYCLE_IDS.gmSuccessor,
        club_section_id: fixture.gmSectionId,
        ecclesiastical_year_id: fixture.yearCurrent,
        status: 'inactive',
      },
    });
    expect(successorMember).toBeNull();

    const gmPrev = await prisma.club_role_assignments.findFirst({
      where: {
        user_id: ANNUAL_CYCLE_IDS.gmDirector,
        club_section_id: fixture.gmSectionId,
        ecclesiastical_year_id: fixture.yearPrev,
      },
    });
    expect(gmPrev?.status).toBe('ended');
    expect(gmPrev?.ecclesiastical_year_id).toBe(fixture.yearPrev);

    const enrollmentsAfter = await prisma.enrollments.count();
    expect(enrollmentsAfter).toBe(enrollmentsBefore);
    expect(
      await prisma.enrollments.count({
        where: { ecclesiastical_year_id: fixture.yearCurrent },
      }),
    ).toBe(0);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(ANNUAL_CYCLE_IDS.cqDirector))
      .expect(200);
    const cqGrant = me.body.data.authorization.grants.club_assignments.find(
      (grant: { section: { club_section_id: number }; operational: boolean }) =>
        grant.section.club_section_id === fixture.cqSectionId &&
        grant.operational,
    );
    expect(cqGrant).toBeUndefined();

    const successorMe = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(ANNUAL_CYCLE_IDS.gmSuccessor))
      .expect(200);
    const successorGrant =
      successorMe.body.data.authorization.grants.club_assignments.find(
        (grant: {
          role_name: string;
          operational: boolean;
          section: { club_section_id: number };
        }) =>
          grant.role_name === 'director' &&
          grant.section.club_section_id === fixture.gmSectionId &&
          grant.operational,
      );
    expect(successorGrant).toBeTruthy();
    expect(
      JSON.stringify(successorMe.body.data).includes('gm-2026-plan'),
    ).toBe(false);
  });

  it('A07: concurrent applyCut completes one transition and stays idempotent', async () => {
    const [first, second] = await Promise.all([
      yearCut.applyCut(YEAR_CUT_NOW),
      yearCut.applyCut(YEAR_CUT_NOW),
    ]);
    expect(first.ended + second.ended).toBeGreaterThanOrEqual(0);

    const transitions = await prisma.club_year_transitions.findMany({
      where: {
        club_id: fixture.clubId,
        ecclesiastical_year_id: fixture.yearCurrent,
      },
    });
    expect(transitions).toHaveLength(1);
    expect(transitions[0].status).toBe('completed');

    const directors = await prisma.club_role_assignments.findMany({
      where: {
        club_section_id: fixture.gmSectionId,
        ecclesiastical_year_id: fixture.yearCurrent,
        status: 'active',
        roles: { role_name: 'director' },
      },
    });
    expect(directors).toHaveLength(1);
  });

  it('A08: slot limits allow two members and two deputies; reject a second director', async () => {
    const extra = [
      '13131313-1313-4131-8131-131313131313',
      '14141414-1414-4141-8141-141414141414',
      '15151515-1515-4151-8151-151515151515',
      '16161616-1616-4161-8161-161616161616',
      '17171717-1717-4171-8171-171717171717',
      '18181818-1818-4181-8181-181818181818',
    ] as const;

    await withClient(url, async (client) => {
      const memberRole = await client.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_name = 'member'`,
      );
      const deputyRole = await client.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_name = 'deputy-director'`,
      );
      const directorRole = await client.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_name = 'director'`,
      );

      for (const [index, userId] of extra.entries()) {
        await client.query(
          `INSERT INTO users (user_id, email, name, paternal_last_name, active, approval_status, local_field_id)
           VALUES ($1, $2, $3, $4, true, 'approved', $5)`,
          [
            userId,
            `extra${index}@test.local`,
            'Extra',
            `User${index}`,
            fixture.localFieldId,
          ],
        );
      }

      await client.query(
        `INSERT INTO club_role_assignments
          (user_id, role_id, club_section_id, ecclesiastical_year_id, start_date, active, status)
         VALUES
           ($1, $2, $3, $4, '2026-01-01', true, 'active'),
           ($5, $2, $3, $4, '2026-01-01', true, 'active')`,
        [
          extra[0],
          memberRole.rows[0].role_id,
          fixture.gmSectionId,
          fixture.yearCurrent,
          extra[1],
        ],
      );

      await client.query(
        `INSERT INTO club_role_assignments
          (user_id, role_id, club_section_id, ecclesiastical_year_id, start_date, active, status)
         VALUES
           ($1, $2, $3, $4, '2026-01-01', true, 'active'),
           ($5, $2, $3, $4, '2026-01-01', true, 'active')`,
        [
          extra[2],
          deputyRole.rows[0].role_id,
          fixture.gmSectionId,
          fixture.yearCurrent,
          extra[3],
        ],
      );

      await client.query(
        `INSERT INTO club_role_assignments
          (user_id, role_id, club_section_id, ecclesiastical_year_id, start_date, active, status)
         VALUES ($1, $2, $3, $4, '2026-01-01', true, 'active')`,
        [
          extra[4],
          directorRole.rows[0].role_id,
          fixture.foreignSectionId,
          fixture.yearCurrent,
        ],
      );

      try {
        await client.query(
          `INSERT INTO club_role_assignments
            (user_id, role_id, club_section_id, ecclesiastical_year_id, start_date, active, status)
           VALUES ($1, $2, $3, $4, '2026-01-01', true, 'active')`,
          [
            extra[5],
            directorRole.rows[0].role_id,
            fixture.foreignSectionId,
            fixture.yearCurrent,
          ],
        );
        throw new Error('second director insert should fail');
      } catch (error) {
        expect(['23514', '23505']).toContain((error as { code?: string }).code);
      }

      await expect(
        client.query(
          `INSERT INTO club_role_assignments
            (user_id, role_id, club_section_id, ecclesiastical_year_id, start_date, active, status)
           VALUES ($1, $2, $3, $4, '2026-01-01', true, 'inactive')`,
          [
            extra[0],
            memberRole.rows[0].role_id,
            fixture.gmSectionId,
            fixture.yearCurrent,
          ],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('A06: calendar jump drops expired CQ permissions; pending cut is not operational', async () => {
    clock.now = () => new Date('2026-01-01T05:59:00.000Z');
    const late2025 = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(ANNUAL_CYCLE_IDS.cqDirector))
      .expect(200);
    expect(late2025.body.data.authorization).toBeDefined();

    clock.now = () => YEAR_CUT_NOW;
    const afterJump = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(ANNUAL_CYCLE_IDS.cqDirector))
      .expect(200);
    const operationalCq =
      afterJump.body.data.authorization.grants.club_assignments.find(
        (grant: { operational: boolean; role_name: string }) =>
          grant.operational && grant.role_name === 'director',
      );
    expect(operationalCq).toBeUndefined();

    await prisma.club_year_transitions.updateMany({
      where: {
        club_id: fixture.clubId,
        ecclesiastical_year_id: fixture.yearCurrent,
      },
      data: { status: 'in_progress', completed_at: null },
    });
    await app
      .get(AuthorizationContextService)
      .invalidateUserAuthorizationCache(ANNUAL_CYCLE_IDS.gmSuccessor);

    const pending = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(ANNUAL_CYCLE_IDS.gmSuccessor))
      .expect(200);
    const pendingDirector =
      pending.body.data.authorization.grants.club_assignments.find(
        (grant: { operational: boolean; role_name: string }) =>
          grant.operational && grant.role_name === 'director',
      );
    expect(pendingDirector).toBeUndefined();

    await prisma.club_year_transitions.updateMany({
      where: {
        club_id: fixture.clubId,
        ecclesiastical_year_id: fixture.yearCurrent,
      },
      data: { status: 'completed', completed_at: new Date() },
    });
  });

  it('A09: overlapping years are ambiguous; inactive GM does not invent a base', async () => {
    await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-06-30'),
        active: true,
      },
    });
    await expect(ecclesiasticalYear.getCurrentYear(YEAR_CUT_NOW)).rejects.toMatchObject(
      { code: 'ECCLESIASTICAL_YEAR_AMBIGUOUS' },
    );
    await prisma.ecclesiastical_years.deleteMany({
      where: {
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-06-30'),
      },
    });

    await prisma.club_sections.update({
      where: { club_section_id: fixture.gmSectionId },
      data: { active: false },
    });
    const unresolved = await policy
      .resolveBase(prisma, ANNUAL_CYCLE_IDS.cqDirector, {
        sourceClubId: fixture.clubId,
        sourceSectionId: fixture.cqSectionId,
      })
      .catch((error: { code?: string }) => error);
    expect(unresolved).toMatchObject({
      code: 'ANNUAL_MEMBERSHIP_BASE_UNRESOLVED',
    });
    await prisma.club_sections.update({
      where: { club_section_id: fixture.gmSectionId },
      data: { active: true },
    });
  });

  it('rolls back a mid-cut write and dry-runs legacy conflicts', async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE club_role_assignments
         SET status = 'ended'
         WHERE user_id = $1 AND ecclesiastical_year_id = $2`,
        [ANNUAL_CYCLE_IDS.gmSuccessor, fixture.yearCurrent],
      );
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }

    const stillActive = await prisma.club_role_assignments.findFirst({
      where: {
        user_id: ANNUAL_CYCLE_IDS.gmSuccessor,
        ecclesiastical_year_id: fixture.yearCurrent,
        status: 'active',
      },
    });
    expect(stillActive).toBeTruthy();

    const report = await policy.reportLegacyConflicts(prisma);
    expect(report.duplicateMemberGroups).toEqual([]);
    expect(report.designatedRows).toBe(0);
  });
});
