import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg, { Client } from 'pg';
import { ErrorCode } from '../src/common/errors/error-codes';
import { EvidenceReviewService } from '../src/evidence-review/evidence-review.service';
import { ClassesService } from '../src/classes/classes.service';
import { INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX } from '../src/investiture-requests/investiture-request-lock';
import {
  prepareAnnualCycleDatabase,
  withClient,
} from './helpers/annual-cycle-db.helper';

/**
 * BCR-2: la guarda INVESTIDO/EXPIRED de la revision de evidencias y de
 * submitSection corre dentro de la transaccion que escribe, bajo el candado
 * advisory del enrollment. La resolucion que inviste toma ese mismo candado
 * antes de escribir INVESTIDO (investiture-authorization-requests.service.ts).
 * Aqui esa resolucion se emula con una transaccion que toma el candado y
 * actualiza el enrollment, para controlar el orden con precision.
 */
jest.setTimeout(180000);

const MEMBER = '41414141-4141-4141-8141-414141414141';
const REVIEWER = '42424242-4242-4242-8242-424242424242';

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

describe('BCR-2 evidence review and submitSection guard on isolated PostgreSQL', () => {
  let url: string;
  let pool: pg.Pool;
  let prisma: PrismaClient;
  let evidenceReview: EvidenceReviewService;
  let classes: ClassesService;
  let enrollmentId: number;
  let classId: number;
  let moduleId: number;
  let sectionCounter = 0;

  beforeAll(async () => {
    ensureTestDatabaseUrl();
    try {
      url = await prepareAnnualCycleDatabase();
    } catch (error) {
      throw scrub(error);
    }
    try {
      const seeded = await withClient(url, async (client) => {
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
           VALUES ('Amigo BCR2', true, $1, 10, 1, 1)
           RETURNING class_id`,
          [clubType.rows[0].club_type_id],
        );
        const moduleRow = await client.query<{ module_id: number }>(
          `INSERT INTO class_modules (name, class_id, active)
           VALUES ('Modulo BCR2', $1, true)
           RETURNING module_id`,
          [classRow.rows[0].class_id],
        );
        for (const [userId, email] of [
          [MEMBER, 'member-bcr2@bcr2.test'],
          [REVIEWER, 'reviewer-bcr2@bcr2.test'],
        ] as const) {
          await client.query(
            `INSERT INTO users (user_id, email, name, active)
             VALUES ($1, $2, 'BCR2', true)`,
            [userId, email],
          );
        }
        const enrollment = await client.query<{ enrollment_id: number }>(
          `INSERT INTO enrollments (
             user_id, class_id, ecclesiastical_year_id, investiture_status, record_kind, active
           )
           VALUES ($1, $2, $3, 'IN_PROGRESS', 'OPERATIONAL', true)
           RETURNING enrollment_id`,
          [MEMBER, classRow.rows[0].class_id, year.rows[0].year_id],
        );
        return {
          classId: classRow.rows[0].class_id,
          moduleId: moduleRow.rows[0].module_id,
          enrollmentId: enrollment.rows[0].enrollment_id,
        };
      });
      classId = seeded.classId;
      moduleId = seeded.moduleId;
      enrollmentId = seeded.enrollmentId;
      pool = new pg.Pool({ connectionString: url, max: 8 });
      prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
      evidenceReview = new EvidenceReviewService(
        prisma as never,
        { approve: jest.fn(), reject: jest.fn() } as never,
        {
          resolveCoordinatorLikeSectionScope: jest
            .fn()
            .mockResolvedValue(undefined),
          getEffectiveCoordinatorSectionIds: jest.fn().mockResolvedValue([]),
        } as never,
        { getSignedDownloadUrl: jest.fn() } as never,
      );
      classes = new ClassesService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {
          assertCanAccessProgress: jest.fn().mockResolvedValue(undefined),
        } as never,
        {} as never,
        {
          assertOperationalYearWrite: jest.fn().mockResolvedValue(undefined),
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
    await prisma.validation_logs.deleteMany();
    await prisma.evidence_files.deleteMany();
    await prisma.class_section_progress.deleteMany();
    await prisma.enrollments.update({
      where: { enrollment_id: enrollmentId },
      data: {
        investiture_status: 'IN_PROGRESS',
        locked_for_validation: false,
      },
    });
  });

  async function seedProgress(
    status: 'SUBMITTED' | 'PENDING',
    withEvidence = false,
  ): Promise<number> {
    sectionCounter += 1;
    const section = await prisma.class_sections.create({
      data: {
        name: `Seccion BCR2 ${sectionCounter}`,
        module_id: moduleId,
        active: true,
      },
    });
    const progress = await prisma.class_section_progress.create({
      data: {
        user_id: MEMBER,
        class_id: classId,
        module_id: moduleId,
        section_id: section.section_id,
        score: 0,
        enrollment_id: enrollmentId,
        status,
        submitted_by_id: status === 'SUBMITTED' ? MEMBER : null,
        submitted_at: status === 'SUBMITTED' ? new Date() : null,
      },
    });
    if (withEvidence) {
      await prisma.evidence_files.create({
        data: {
          section_progress_id: progress.section_progress_id,
          file_url: 'https://r2.test.invalid/e.pdf',
          file_name: 'e.pdf',
          file_type: 'pdf',
          uploaded_by_id: MEMBER,
        },
      });
    }
    return progress.section_progress_id;
  }

  /** Transaccion que inviste: toma el candado del enrollment y escribe. */
  async function openInvestingTransaction(status = 'INVESTIDO'): Promise<{
    pid: number;
    commit: () => Promise<void>;
  }> {
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX}${enrollmentId}`],
    );
    await client.query(
      `UPDATE enrollments SET investiture_status = $2::investiture_status_enum
       WHERE enrollment_id = $1`,
      [enrollmentId, status],
    );
    const pid = await client.query<{ pid: number }>(
      'SELECT pg_backend_pid() AS pid',
    );
    return {
      pid: pid.rows[0].pid,
      commit: async () => {
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
          `SELECT pid FROM pg_locks
           WHERE locktype = 'advisory' AND NOT granted AND pid <> $1
           LIMIT 1`,
          [holderPid],
        );
        if ((waiting.rowCount ?? 0) > 0) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(
        'la operacion no quedo esperando un candado advisory en pg_locks',
      );
    } finally {
      await observer.end();
    }
  }

  async function progressRow(id: number) {
    return prisma.class_section_progress.findUniqueOrThrow({
      where: { section_progress_id: id },
    });
  }

  async function reviewLogs(): Promise<number> {
    return prisma.validation_logs.count();
  }

  const operations = [
    [
      'approve',
      (id: number) => evidenceReview.approve('class', id, REVIEWER, {}),
    ],
    [
      'reject',
      (id: number) =>
        evidenceReview.reject('class', id, REVIEWER, { reason: 'No cumple' }),
    ],
  ] as const;

  describe.each(operations)('evidence %s', (_name, run) => {
    it.each(['INVESTIDO', 'EXPIRED'])(
      'INVESTIDO/EXPIRED committed first: the queued write is rejected and nothing is written (%s)',
      async (status) => {
        const id = await seedProgress('SUBMITTED');
        const investing = await openInvestingTransaction(status);

        const attempt = run(id);
        void attempt.catch(() => undefined);
        await waitForAdvisoryWaiter(investing.pid);
        await investing.commit();

        await expect(attempt).rejects.toMatchObject({
          code: ErrorCode.CLASS_PROGRESS_LOCKED,
        });
        const row = await progressRow(id);
        expect(row.status).toBe('SUBMITTED');
        expect(row.validated_by_id).toBeNull();
        expect(row.validated_at).toBeNull();
        expect(await reviewLogs()).toBe(0);
      },
    );

    it('evidence first: the write commits and INVESTIDO lands afterwards', async () => {
      const id = await seedProgress('SUBMITTED');
      // Sostiene el candado con una transaccion neutra, deja que la revision
      // haga cola primero y despues la que inviste.
      const holder = new Client({ connectionString: url });
      await holder.connect();
      await holder.query('BEGIN');
      await holder.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX}${enrollmentId}`],
      );
      const holderPid = (
        await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0].pid;

      const order: string[] = [];
      const review = run(id).then(() => {
        order.push('review');
      });
      void review.catch(() => undefined);
      await waitForAdvisoryWaiter(holderPid);

      const investor = new Client({ connectionString: url });
      await investor.connect();
      const investing = (async () => {
        await investor.query('BEGIN');
        await investor.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX}${enrollmentId}`],
        );
        await investor.query(
          `UPDATE enrollments SET investiture_status = 'INVESTIDO'
           WHERE enrollment_id = $1`,
          [enrollmentId],
        );
        await investor.query('COMMIT');
        order.push('invest');
      })();
      void investing.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(order).toEqual([]);

      await holder.query('COMMIT');
      await holder.end();
      await Promise.all([review, investing]);
      await investor.end();

      expect(order).toEqual(['review', 'invest']);
      const row = await progressRow(id);
      expect(['VALIDATED', 'REJECTED']).toContain(row.status);
      expect(await reviewLogs()).toBe(1);
      const enrollment = await prisma.enrollments.findUniqueOrThrow({
        where: { enrollment_id: enrollmentId },
        select: { investiture_status: true },
      });
      expect(enrollment.investiture_status).toBe('INVESTIDO');
    });

    it('legacy pipeline states behave as in 113d8ba: the write goes through', async () => {
      for (const [investiture_status, locked] of [
        ['SUBMITTED_FOR_VALIDATION', false],
        ['CLUB_APPROVED', false],
        ['IN_PROGRESS', true],
      ] as const) {
        await prisma.class_section_progress.deleteMany();
        await prisma.validation_logs.deleteMany();
        await prisma.enrollments.update({
          where: { enrollment_id: enrollmentId },
          data: { investiture_status, locked_for_validation: locked },
        });
        const id = await seedProgress('SUBMITTED');

        await expect(run(id)).resolves.toMatchObject({ id, type: 'class' });

        expect(['VALIDATED', 'REJECTED']).toContain(
          (await progressRow(id)).status,
        );
      }
    });
  });

  it('stress: with a racing invest, a fulfilled approval is always serialized before INVESTIDO', async () => {
    const rounds = 20;
    let rejectedByGuard = 0;
    let approvedBefore = 0;
    for (let round = 0; round < rounds; round += 1) {
      await prisma.class_section_progress.deleteMany();
      await prisma.validation_logs.deleteMany();
      await prisma.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: { investiture_status: 'IN_PROGRESS' },
      });
      const id = await seedProgress('SUBMITTED');

      const invest = withClient(url, async (client) => {
        await client.query('BEGIN');
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX}${enrollmentId}`],
        );
        await client.query(
          `UPDATE enrollments SET investiture_status = 'INVESTIDO'
           WHERE enrollment_id = $1`,
          [enrollmentId],
        );
        await client.query('COMMIT');
      });
      const approve = evidenceReview.approve('class', id, REVIEWER, {});
      const [investResult, approveResult] = await Promise.allSettled([
        invest,
        approve,
      ]);
      expect(investResult.status).toBe('fulfilled');

      const row = await progressRow(id);
      if (approveResult.status === 'rejected') {
        expect(approveResult.reason).toMatchObject({
          code: ErrorCode.CLASS_PROGRESS_LOCKED,
        });
        expect(row.status).toBe('SUBMITTED');
        expect(await reviewLogs()).toBe(0);
        rejectedByGuard += 1;
      } else {
        // La aprobacion escribio: su fila tiene que ser anterior (xid menor)
        // a la fila del enrollment que quedo INVESTIDO.
        const xids = await withClient(url, (client) =>
          client.query<{ progress_xmin: string; enrollment_xmin: string }>(
            `SELECT
               (SELECT xmin::text FROM class_section_progress WHERE section_progress_id = $1) AS progress_xmin,
               (SELECT xmin::text FROM enrollments WHERE enrollment_id = $2) AS enrollment_xmin`,
            [id, enrollmentId],
          ),
        );
        expect(row.status).toBe('VALIDATED');
        expect(Number(xids.rows[0].progress_xmin)).toBeLessThan(
          Number(xids.rows[0].enrollment_xmin),
        );
        approvedBefore += 1;
      }
    }
    expect(rejectedByGuard + approvedBefore).toBe(rounds);
  });

  describe('submitSection', () => {
    it.each(['INVESTIDO', 'EXPIRED'])(
      'INVESTIDO/EXPIRED committed while the submit waits on the lock: rejected, status untouched (%s)',
      async (status) => {
        const id = await seedProgress('PENDING', true);
        const investing = await openInvestingTransaction(status);

        const attempt = classes.submitSection(
          MEMBER,
          MEMBER,
          classId,
          (await progressRow(id)).section_id,
          enrollmentId,
        );
        void attempt.catch(() => undefined);
        await waitForAdvisoryWaiter(investing.pid);
        await investing.commit();

        await expect(attempt).rejects.toMatchObject({
          code: ErrorCode.CLASS_PROGRESS_LOCKED,
        });
        expect((await progressRow(id)).status).toBe('PENDING');
      },
    );

    it('legacy pipeline states do not block submit (113d8ba behavior)', async () => {
      await prisma.enrollments.update({
        where: { enrollment_id: enrollmentId },
        data: {
          investiture_status: 'CLUB_APPROVED',
          locked_for_validation: true,
        },
      });
      const id = await seedProgress('PENDING', true);

      const result = await classes.submitSection(
        MEMBER,
        MEMBER,
        classId,
        (await progressRow(id)).section_id,
        enrollmentId,
      );

      expect(result.status).toBe('SUBMITTED');
    });
  });
});
