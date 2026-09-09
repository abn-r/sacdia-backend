jest.setTimeout(180000);

import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  ANNUAL_CYCLE_IDS,
  YEAR_CUT_NOW,
  bootstrapAnnualCycleApp,
  prepareAnnualCycleDatabase,
  seedAnnualCycleFixture,
  type AnnualCycleFixture,
} from './helpers/annual-cycle-db.helper';
import {
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

describe('T8 annual-membership HTTP', () => {
  let fixture: AnnualCycleFixture;
  let app: Awaited<ReturnType<typeof bootstrapAnnualCycleApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootstrapAnnualCycleApp>>['prisma'];
  let jwtService: JwtService;

  const bearer = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(jwtService, userId)}`,
  });

  const listUrl = (sectionId: number) =>
    `/api/v1/club-sections/${sectionId}/annual-continuations`;

  const designationPayload = (response: {
    body: {
      data?: {
        succession_id?: string;
        user_id?: string;
        version?: number;
      };
      succession_id?: string;
      user_id?: string;
      version?: number;
    };
  }) => response.body.data ?? response.body;

  beforeAll(async () => {
    await prepareAnnualCycleDatabase();
    fixture = await seedAnnualCycleFixture(
      process.env.DATABASE_URL as string,
      'operational',
    );
    const boot = await bootstrapAnnualCycleApp({ now: () => YEAR_CUT_NOW });
    app = boot.app;
    prisma = boot.prisma;
    jwtService = createTestJwtService();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('A02: GET lists the returned GM member without a prior GM CRA', async () => {
    const priorGm = await prisma.club_role_assignments.findFirst({
      where: {
        user_id: ANNUAL_CYCLE_IDS.returnedMember,
        club_section_id: fixture.gmSectionId,
        ecclesiastical_year_id: fixture.yearPrev,
      },
    });
    expect(priorGm).toBeNull();

    const response = await request(app.getHttpServer())
      .get(listUrl(fixture.gmSectionId))
      .set(bearer(ANNUAL_CYCLE_IDS.gmDirector))
      .expect(200);

    const ids = response.body.data.data.map(
      (item: { user_id: string }) => item.user_id,
    );
    expect(ids).toContain(ANNUAL_CYCLE_IDS.returnedMember);
    const item = response.body.data.data.find(
      (row: { user_id: string }) =>
        row.user_id === ANNUAL_CYCLE_IDS.returnedMember,
    );
    expect(item.annual_status).toBe('not_enrolled');
    expect(item.ecclesiastical_year_id).toBe(fixture.yearCurrent);
  });

  it('A03/A15: directive enrolls; owner, other section and foreign LF are 403; autoenroll is blocked', async () => {
    const gmDirectorPost = await request(app.getHttpServer())
      .post(listUrl(fixture.gmSectionId))
      .set(bearer(ANNUAL_CYCLE_IDS.cqDirector))
      .send({ user_ids: [ANNUAL_CYCLE_IDS.returnedMember] })
      .expect(403);

    const ownerPost = await request(app.getHttpServer())
      .post(listUrl(fixture.gmSectionId))
      .set(bearer(ANNUAL_CYCLE_IDS.ownerGhost))
      .send({ user_ids: [ANNUAL_CYCLE_IDS.ownerGhost] })
      .expect(403);

    const foreignPost = await request(app.getHttpServer())
      .post(listUrl(fixture.gmSectionId))
      .set(bearer(ANNUAL_CYCLE_IDS.foreignLfAdmin))
      .send({ user_ids: [ANNUAL_CYCLE_IDS.returnedMember] })
      .expect(403);

    expect(gmDirectorPost.body.status).toBe('error');
    expect(ownerPost.body.status).toBe('error');
    expect(foreignPost.body.status).toBe('error');

    const autoenroll = await request(app.getHttpServer())
      .post(
        `/api/v1/users/${ANNUAL_CYCLE_IDS.returnedMember}/membership/annual-enroll`,
      )
      .set(bearer(ANNUAL_CYCLE_IDS.returnedMember))
      .send({ club_section_id: fixture.gmSectionId })
      .expect(403);
    expect(autoenroll.body.code).toBe('ANNUAL_ENROLL_REQUIRES_DIRECTIVE');

    const stillInactive = await prisma.club_role_assignments.findFirst({
      where: {
        user_id: ANNUAL_CYCLE_IDS.returnedMember,
        club_section_id: fixture.gmSectionId,
        ecclesiastical_year_id: fixture.yearCurrent,
      },
    });
    expect(stillInactive?.status).toBe('inactive');
  });

  it('A07 HTTP: concurrent enroll of the same member does not duplicate the annual row', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const [left, right] = await Promise.all([
      request(app.getHttpServer())
        .post(listUrl(fixture.cqSectionId))
        .set(bearer(ANNUAL_CYCLE_IDS.cqDirector))
        .send({ user_ids: [ANNUAL_CYCLE_IDS.cqContinuing] }),
      request(app.getHttpServer())
        .post(listUrl(fixture.cqSectionId))
        .set(bearer(ANNUAL_CYCLE_IDS.cqDirector))
        .send({ user_ids: [ANNUAL_CYCLE_IDS.cqContinuing] }),
    ]);
    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    const outcomes = [
      left.body.data.results[0].outcome,
      right.body.data.results[0].outcome,
    ];
    expect(
      outcomes.every(
        (outcome) =>
          outcome === 'enrolled' || outcome === 'already_enrolled',
      ),
    ).toBe(true);
    expect(outcomes).toContain('enrolled');

    const members = await prisma.club_role_assignments.findMany({
      where: {
        user_id: ANNUAL_CYCLE_IDS.cqContinuing,
        club_section_id: fixture.cqSectionId,
        ecclesiastical_year_id: fixture.yearCurrent,
        status: { in: ['active', 'inactive'] },
      },
    });
    expect(members).toHaveLength(1);
    expect(members[0].status).toBe('active');
  });

  it('A11: GM invested return is blocked without writing; CQ enroll is idempotent', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const blocked = await request(app.getHttpServer())
      .post(listUrl(fixture.gmSectionId))
      .set(bearer(ANNUAL_CYCLE_IDS.gmDirector))
      .send({ user_ids: [ANNUAL_CYCLE_IDS.returnedMember] })
      .expect(200);
    expect(blocked.body.data.results[0].outcome).toBe('blocked');
    expect(blocked.body.data.results[0].error_code).toBe(
      'ANNUAL_CLASS_POLICY_UNRESOLVED',
    );

    const stillInactive = await prisma.club_role_assignments.findFirst({
      where: {
        user_id: ANNUAL_CYCLE_IDS.returnedMember,
        club_section_id: fixture.gmSectionId,
        ecclesiastical_year_id: fixture.yearCurrent,
      },
    });
    expect(stillInactive?.status).toBe('inactive');

    const already = await request(app.getHttpServer())
      .post(listUrl(fixture.cqSectionId))
      .set(bearer(ANNUAL_CYCLE_IDS.cqDirector))
      .send({ user_ids: [ANNUAL_CYCLE_IDS.cqContinuing] })
      .expect(200);
    expect(already.body.data.results[0].outcome).toBe('already_enrolled');
    const cqEnrollment = await prisma.enrollments.findFirst({
      where: {
        user_id: ANNUAL_CYCLE_IDS.cqContinuing,
        ecclesiastical_year_id: fixture.yearCurrent,
      },
    });
    expect(cqEnrollment?.enrollment_id).toEqual(expect.any(Number));

    const otherSection = await request(app.getHttpServer())
      .post(listUrl(fixture.gmSectionId))
      .set(bearer(ANNUAL_CYCLE_IDS.gmDirector))
      .send({ user_ids: [ANNUAL_CYCLE_IDS.cqDirector] })
      .expect(200);
    expect(otherSection.body.data.results[0].outcome).not.toBe(
      'already_enrolled',
    );
  });

  it('A12: previous CQ class without investiture advances to CQ-02', async () => {
    const enrollment = await prisma.enrollments.findFirst({
      where: {
        user_id: ANNUAL_CYCLE_IDS.cqContinuing,
        ecclesiastical_year_id: fixture.yearCurrent,
      },
    });
    expect(enrollment?.class_id).toBe(fixture.nextCqClassId);
  });

  it('A13: historical progress PATCH is forbidden even for the owner; GET remains allowed', async () => {
    const historical = await prisma.enrollments.findFirst({
      where: {
        user_id: ANNUAL_CYCLE_IDS.cqContinuing,
        ecclesiastical_year_id: fixture.yearPrev,
        class_id: fixture.cqClassId,
      },
    });
    expect(historical).toBeTruthy();

    const patch = await request(app.getHttpServer())
      .patch(
        `/api/v1/users/${ANNUAL_CYCLE_IDS.cqContinuing}/classes/${fixture.cqClassId}/progress`,
      )
      .set(bearer(ANNUAL_CYCLE_IDS.cqContinuing))
      .send({
        module_id: 1,
        section_id: 1,
        score: 10,
        enrollment_id: historical!.enrollment_id,
      })
      .expect(403);
    expect(patch.body.code).toBe('CLASS_PROGRESS_YEAR_NOT_OPERATIONAL');

    await request(app.getHttpServer())
      .get(
        `/api/v1/users/${ANNUAL_CYCLE_IDS.cqContinuing}/classes/${fixture.cqClassId}/progress`,
      )
      .query({ enrollmentId: historical!.enrollment_id })
      .set(bearer(ANNUAL_CYCLE_IDS.cqDirector))
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const submit = await request(app.getHttpServer())
      .post(
        `/api/v1/users/${ANNUAL_CYCLE_IDS.cqContinuing}/classes/${fixture.cqClassId}/sections/1/submit`,
      )
      .query({ enrollmentId: historical!.enrollment_id })
      .set(bearer(ANNUAL_CYCLE_IDS.cqContinuing))
      .expect(403);
    expect(submit.body.code).toBe('CLASS_PROGRESS_YEAR_NOT_OPERATIONAL');
  });

  it('A14: cross-type class enroll does not create an AV/CQ membership (D02 gate documented)', async () => {
    const enroll = await request(app.getHttpServer())
      .post(`/api/v1/users/${ANNUAL_CYCLE_IDS.returnedMember}/classes/enroll`)
      .set(bearer(ANNUAL_CYCLE_IDS.returnedMember))
      .send({
        class_id: fixture.cqClassId,
        ecclesiastical_year_id: fixture.yearCurrent,
      });

    if (enroll.status === 201 || enroll.status === 200) {
      expect(enroll.body.cross_type_enrollment ?? enroll.body.data?.cross_type_enrollment).toBe(
        true,
      );
      const cqMember = await prisma.club_role_assignments.findFirst({
        where: {
          user_id: ANNUAL_CYCLE_IDS.returnedMember,
          club_section_id: fixture.cqSectionId,
          ecclesiastical_year_id: fixture.yearCurrent,
          status: 'active',
        },
      });
      expect(cqMember).toBeNull();
    } else {
      expect([400, 403, 409]).toContain(enroll.status);
    }
  });

  it('schedules a future director concurrently without duplicating the open plan', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const futureYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2027-01-01'),
        end_date: new Date('2027-12-31'),
        active: false,
      },
    });

    const url = `/api/v1/clubs/${fixture.clubId}/sections/${fixture.cqSectionId}/director-designation`;
    const body = {
      user_id: ANNUAL_CYCLE_IDS.gmSuccessor,
      ecclesiastical_year_id: futureYear.year_id,
    };
    const auth = bearer(ANNUAL_CYCLE_IDS.lfScheduler);
    const keyA = 'annual-cycle-desig-a';
    const keyB = 'annual-cycle-desig-b';

    const [left, right] = await Promise.all([
      request(app.getHttpServer())
        .post(url)
        .set({ ...auth, 'Idempotency-Key': keyA })
        .send(body),
      request(app.getHttpServer())
        .post(url)
        .set({ ...auth, 'Idempotency-Key': keyB })
        .send(body),
    ]);

    const statuses = [left.status, right.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
    const created = [left, right].find((row) => row.status === 201)!;
    const conflict = [left, right].find((row) => row.status === 409)!;
    expect(conflict.body.code).toBe('CLUB_DIRECTOR_PLAN_CONFLICT');
    const successionId = designationPayload(created).succession_id as string;
    expect(successionId).toBeTruthy();

    const winnerKey = left.status === 201 ? keyA : keyB;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const replay = await request(app.getHttpServer())
      .post(url)
      .set({ ...auth, 'Idempotency-Key': winnerKey })
      .send(body)
      .expect(201);
    expect(designationPayload(replay).succession_id).toBe(successionId);

    const listed = await request(app.getHttpServer())
      .get(url)
      .query({ yearId: futureYear.year_id })
      .set(auth)
      .expect(200);
    expect(designationPayload(listed).succession_id).toBe(successionId);
    expect(designationPayload(listed).version).toBe(1);

    const patched = await request(app.getHttpServer())
      .patch(url)
      .set(auth)
      .send({
        succession_id: successionId,
        version: 1,
        successor_user_id: ANNUAL_CYCLE_IDS.returnedMember,
      })
      .expect(200);
    expect(designationPayload(patched).user_id).toBe(
      ANNUAL_CYCLE_IDS.returnedMember,
    );
    expect(designationPayload(patched).version).toBe(2);

    const afterPatch = await request(app.getHttpServer())
      .get(url)
      .query({ yearId: futureYear.year_id })
      .set(auth)
      .expect(200);
    expect(designationPayload(afterPatch).user_id).toBe(
      ANNUAL_CYCLE_IDS.returnedMember,
    );
    expect(designationPayload(afterPatch).version).toBe(2);
  });
});
