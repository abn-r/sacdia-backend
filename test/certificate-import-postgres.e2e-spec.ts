import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg, { Client } from 'pg';
import { ErrorCode } from '../src/common/errors/error-codes';
import { CertificateBulkImportApplicationService } from '../src/certificate-bulk-imports/certificate-bulk-imports-application.service';
import { InstitutionalCertificateRequestsService } from '../src/certificate-bulk-imports/institutional-certificate-requests.service';
import {
  prepareAnnualCycleDatabase,
  withClient,
} from './helpers/annual-cycle-db.helper';

jest.setTimeout(180000);

const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '../prisma/migrations/20260921140000_historical_certificate_enrollments/migration.sql',
  ),
  'utf8',
);

const INSTITUTIONAL_SQL = readFileSync(
  join(
    __dirname,
    '../prisma/migrations/20260921190000_institutional_certificate_requests/migration.sql',
  ),
  'utf8',
);

const YEAR_OVERLAP_SQL = readFileSync(
  join(
    __dirname,
    '../prisma/migrations/20260921153000_ecclesiastical_year_no_overlap/migration.sql',
  ),
  'utf8',
);

type Fixture = {
  userId: string;
  yearId: number;
  otherYearId: number;
  amigoId: number;
  companeroId: number;
  exploradorId: number;
  gmId: number;
};

describe('certificate import enrollment slots', () => {
  let url: string;

  beforeAll(async () => {
    url = await prepareAnnualCycleDatabase();
    await withClient(url, async (client) => {
      await client.query(MIGRATION_SQL);
      await client.query(YEAR_OVERLAP_SQL);
      await client.query(INSTITUTIONAL_SQL);
    });
  });

  async function seed(label: string, withGuideMajor = false): Promise<Fixture> {
    return withClient(url, async (client) => {
      const type = await client.query<{ club_type_id: number }>(
        `INSERT INTO club_types (name, active)
         VALUES ($1, true)
         RETURNING club_type_id`,
        [`Tipo ${label}`],
      );
      const clubTypeId = type.rows[0].club_type_id;
      await client.query(
        `INSERT INTO ecclesiastical_years (start_date, end_date, active)
         SELECT start_date, end_date, active
         FROM (
           VALUES
             (DATE '2004-01-01', DATE '2004-12-31', false),
             (DATE '2026-01-01', DATE '2026-12-31', false)
         ) AS seed(start_date, end_date, active)
         WHERE NOT EXISTS (
           SELECT 1
           FROM ecclesiastical_years existing
           WHERE existing.start_date = seed.start_date
             AND existing.end_date = seed.end_date
         )`,
      );
      const years = await client.query<{ year_id: number; start_date: string }>(
        `SELECT year_id, start_date::text AS start_date
         FROM ecclesiastical_years
         WHERE start_date IN (DATE '2004-01-01', DATE '2026-01-01')`,
      );
      const currentYear = years.rows.find((row) =>
        row.start_date.startsWith('2026'),
      );
      const pastYear = years.rows.find((row) =>
        row.start_date.startsWith('2004'),
      );
      const amigoCode = `A${label}`;
      const companeroCode = `C${label}`;
      const exploradorCode = `E${label}`;
      const classes = await client.query<{ class_id: number; asset_code: string }>(
        `INSERT INTO classes (name, active, club_type_id, minimum_age, display_order, asset_code)
         VALUES
           ($2, true, $1, 10, 1, $3),
           ($4, true, $1, 11, 2, $5),
           ($6, true, $1, 12, 3, $7)
         RETURNING class_id, asset_code`,
        [
          clubTypeId,
          `Amigo ${label}`,
          amigoCode,
          `Compañero ${label}`,
          companeroCode,
          `Explorador ${label}`,
          exploradorCode,
        ],
      );
      let gmId = 0;
      if (withGuideMajor) {
        const existing = await client.query<{ class_id: number }>(
          `SELECT class_id FROM classes WHERE asset_code = 'GM-01' LIMIT 1`,
        );
        if (existing.rows[0]) {
          gmId = existing.rows[0].class_id;
        } else {
          const gm = await client.query<{ class_id: number }>(
            `INSERT INTO classes (name, active, club_type_id, minimum_age, display_order, asset_code)
             VALUES ($2, true, $1, 16, 8, 'GM-01')
             RETURNING class_id`,
            [clubTypeId, `Guía Mayor ${label}`],
          );
          gmId = gm.rows[0].class_id;
        }
      }
      const byCode = new Map(
        classes.rows.map((row) => [row.asset_code, row.class_id]),
      );
      const user = await client.query<{ user_id: string }>(
        `INSERT INTO users (email, name, active, approval_status)
         VALUES ($1, $2, true, 'approved')
         RETURNING user_id`,
        [`${label}@certificate-import.test`, label],
      );
      return {
        userId: user.rows[0].user_id,
        yearId: currentYear!.year_id,
        otherYearId: pastYear!.year_id,
        amigoId: byCode.get(amigoCode)!,
        companeroId: byCode.get(companeroCode)!,
        exploradorId: byCode.get(exploradorCode)!,
        gmId,
      };
    });
  }

  it('rolls back two operational classes in the same period', async () => {
    const fixture = await seed('opc1');

    await withClient(url, async (client) => {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO enrollments (user_id, class_id, ecclesiastical_year_id)
         VALUES ($1, $2, $3)`,
        [fixture.userId, fixture.amigoId, fixture.yearId],
      );
      await expect(
        client.query(
          `INSERT INTO enrollments (user_id, class_id, ecclesiastical_year_id)
           VALUES ($1, $2, $3)`,
          [fixture.userId, fixture.companeroId, fixture.yearId],
        ),
      ).rejects.toThrow(/uniq_enrollments_active_user_year_regular/);
      await client.query('ROLLBACK');

      const remaining = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM enrollments WHERE user_id = $1`,
        [fixture.userId],
      );
      expect(remaining.rows[0].count).toBe('0');
    });
  });

  it('keeps one operational course beside two historical facts in the same period', async () => {
    const fixture = await seed('hsh1');

    await withClient(url, async (client) => {
      await client.query(
        `INSERT INTO enrollments (
           user_id, class_id, ecclesiastical_year_id, investiture_status
         ) VALUES ($1, $2, $3, 'IN_PROGRESS')`,
        [fixture.userId, fixture.amigoId, fixture.yearId],
      );
      await client.query(
        `INSERT INTO enrollments (
           user_id, class_id, ecclesiastical_year_id, record_kind,
           investiture_status, investiture_date, active, locked_for_validation
         ) VALUES
           ($1, $2, $3, 'HISTORICAL_CERTIFICATE', 'INVESTIDO', '2004-03-15', true, true),
           ($1, $4, $3, 'HISTORICAL_CERTIFICATE', 'INVESTIDO', '2004-06-01', true, true)`,
        [
          fixture.userId,
          fixture.companeroId,
          fixture.yearId,
          fixture.exploradorId,
        ],
      );

      const rows = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM enrollments WHERE user_id = $1`,
        [fixture.userId],
      );
      expect(rows.rows[0].count).toBe('3');
    });
  });

  it('still rejects a second operational course when the first is already INVESTIDO', async () => {
    const fixture = await seed('opi1');

    await withClient(url, async (client) => {
      await client.query(
        `INSERT INTO enrollments (
           user_id, class_id, ecclesiastical_year_id,
           investiture_status, investiture_date
         ) VALUES ($1, $2, $3, 'INVESTIDO', '2026-05-01')`,
        [fixture.userId, fixture.amigoId, fixture.yearId],
      );
      await expect(
        client.query(
          `INSERT INTO enrollments (user_id, class_id, ecclesiastical_year_id)
           VALUES ($1, $2, $3)`,
          [fixture.userId, fixture.companeroId, fixture.yearId],
        ),
      ).rejects.toThrow(/uniq_enrollments_active_user_year_regular/);
    });
  });

  it('rejects a historical row that is not an invested locked fact', async () => {
    const fixture = await seed('hsp1');

    await withClient(url, async (client) => {
      await expect(
        client.query(
          `INSERT INTO enrollments (
             user_id, class_id, ecclesiastical_year_id, record_kind,
             investiture_status, active, locked_for_validation
           ) VALUES ($1, $2, $3, 'HISTORICAL_CERTIFICATE', 'IN_PROGRESS', true, true)`,
          [fixture.userId, fixture.amigoId, fixture.yearId],
        ),
      ).rejects.toThrow(/enrollments_historical_certificate_shape/);
    });
  });

  it('allows only one Guía Mayor row for the same person', async () => {
    const fixture = await seed('gm01', true);

    await withClient(url, async (client) => {
      await client.query(
        `INSERT INTO enrollments (
           user_id, class_id, ecclesiastical_year_id, record_kind,
           investiture_status, investiture_date, active, locked_for_validation
         ) VALUES (
           $1, $2, $3, 'HISTORICAL_CERTIFICATE', 'INVESTIDO', '2004-03-15', true, true
         )`,
        [fixture.userId, fixture.gmId, fixture.otherYearId],
      );
      await expect(
        client.query(
          `INSERT INTO enrollments (user_id, class_id, ecclesiastical_year_id)
           VALUES ($1, $2, $3)`,
          [fixture.userId, fixture.gmId, fixture.yearId],
        ),
      ).rejects.toThrow(/ENROLLMENT_GM_SINGLE_ROW/);

      const rows = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM enrollments
         WHERE user_id = $1 AND class_id = $2`,
        [fixture.userId, fixture.gmId],
      );
      expect(rows.rows[0].count).toBe('1');
    });
  });

  it('converts the existing Guía Mayor row instead of inserting a second one', async () => {
    const fixture = await seed('gmsub', true);

    await withClient(url, async (client) => {
      const inserted = await client.query<{ enrollment_id: number }>(
        `INSERT INTO enrollments (
           user_id, class_id, ecclesiastical_year_id, investiture_status
         ) VALUES ($1, $2, $3, 'IN_PROGRESS')
         RETURNING enrollment_id`,
        [fixture.userId, fixture.gmId, fixture.yearId],
      );
      const enrollmentId = inserted.rows[0].enrollment_id;

      await client.query(
        `UPDATE enrollments
         SET ecclesiastical_year_id = $2,
             record_kind = 'HISTORICAL_CERTIFICATE',
             investiture_status = 'INVESTIDO',
             investiture_date = '2004-03-15',
             locked_for_validation = true,
             active = true
         WHERE enrollment_id = $1`,
        [enrollmentId, fixture.otherYearId],
      );

      await expect(
        client.query(
          `INSERT INTO enrollments (user_id, class_id, ecclesiastical_year_id)
           VALUES ($1, $2, $3)`,
          [fixture.userId, fixture.gmId, fixture.yearId],
        ),
      ).rejects.toThrow(/ENROLLMENT_GM_SINGLE_ROW/);

      const rows = await client.query<{
        count: string;
        year_id: number;
        record_kind: string;
      }>(
        `SELECT COUNT(*)::text AS count,
                MAX(ecclesiastical_year_id) AS year_id,
                MAX(record_kind) AS record_kind
         FROM enrollments
         WHERE user_id = $1 AND class_id = $2`,
        [fixture.userId, fixture.gmId],
      );
      expect(rows.rows[0]).toMatchObject({
        count: '1',
        year_id: fixture.otherYearId,
        record_kind: 'HISTORICAL_CERTIFICATE',
      });
    });
  });

  it('rejects a concurrent insert that overlaps an ecclesiastical period', async () => {
    const first = new Client({ connectionString: url });
    const second = new Client({ connectionString: url });
    await first.connect();
    await second.connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await first.query(
        `INSERT INTO ecclesiastical_years (start_date, end_date, active)
         VALUES ('1990-01-01', '1990-12-31', false)`,
      );
      const overlapping = second.query(
        `INSERT INTO ecclesiastical_years (start_date, end_date, active)
         VALUES ('1990-06-01', '1991-05-31', false)`,
      );
      await first.query('COMMIT');
      let insertRejected = false;
      try {
        await overlapping;
      } catch (error) {
        insertRejected = true;
        expect(String(error)).toMatch(/ecclesiastical_years_no_overlap|23P01/);
      }
      if (!insertRejected) {
        await expect(second.query('COMMIT')).rejects.toThrow(
          /ecclesiastical_years_no_overlap|23P01/,
        );
      }
      await second.query('ROLLBACK');
    } finally {
      await first.end();
      await second.end();
    }
  });

  it('keeps a single open institutional request and does not enroll the class', async () => {
    const fixture = await seed('t9dup');

    await withClient(url, async (client) => {
      const klass = await client.query<{ class_id: number }>(
        `INSERT INTO classes (name, active, club_type_id, minimum_age, display_order, asset_code)
         SELECT 'Avanzado t9dup', false, club_type_id, 16, 9, 'T9DUP'
         FROM classes
         WHERE class_id = $1
         RETURNING class_id`,
        [fixture.amigoId],
      );
      const batch = await client.query<{ batch_id: string }>(
        `INSERT INTO certificate_bulk_import_batches (user_id)
         VALUES ($1)
         RETURNING batch_id`,
        [fixture.userId],
      );
      const file = await client.query<{ file_id: string }>(
        `INSERT INTO certificate_bulk_import_files (
           batch_id, file_url, file_name, file_type, uploaded_by_id,
           upload_status, object_key, jurisdiction
         ) VALUES ($1, 'sealed', 'cert.pdf', 'application/pdf', $2, 'CONFIRMED', 'sealed-key', 'INSTITUTIONAL')
         RETURNING file_id`,
        [batch.rows[0].batch_id, fixture.userId],
      );
      await client.query(
        `INSERT INTO institutional_certificate_requests (
           user_id, class_id, file_id, batch_id, completed_at
         ) VALUES ($1, $2, $3, $4, DATE '2008-07-07')`,
        [
          fixture.userId,
          klass.rows[0].class_id,
          file.rows[0].file_id,
          batch.rows[0].batch_id,
        ],
      );

      await expect(
        client.query(
          `INSERT INTO institutional_certificate_requests (
             user_id, class_id, file_id, batch_id, completed_at
           ) VALUES ($1, $2, $3, $4, DATE '2008-07-07')`,
          [
            fixture.userId,
            klass.rows[0].class_id,
            file.rows[0].file_id,
            batch.rows[0].batch_id,
          ],
        ),
      ).rejects.toThrow(/uniq_institutional_certificate_request_open/);

      await client.query(
        `UPDATE institutional_certificate_requests
         SET status = 'REJECTED'
         WHERE user_id = $1`,
        [fixture.userId],
      );
      await client.query(
        `INSERT INTO institutional_certificate_requests (
           user_id, class_id, file_id, batch_id, completed_at, predecessor_request_id
         )
         SELECT $1, $2, $3, $4, DATE '2008-07-07', request_id
         FROM institutional_certificate_requests
         WHERE user_id = $1 AND status = 'REJECTED'`,
        [
          fixture.userId,
          klass.rows[0].class_id,
          file.rows[0].file_id,
          batch.rows[0].batch_id,
        ],
      );

      const requests = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM institutional_certificate_requests
         WHERE user_id = $1`,
        [fixture.userId],
      );
      const enrollments = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM enrollments WHERE user_id = $1`,
        [fixture.userId],
      );
      expect(requests.rows[0].count).toBe('2');
      expect(enrollments.rows[0].count).toBe('0');
    });
  });

  it('keeps one historical enrollment when two approvals race', async () => {
    const fixture = await seed('race');
    const reviewer = await withClient(url, async (client) => {
      const user = await client.query<{ user_id: string }>(
        `INSERT INTO users (email, name, active, approval_status)
         VALUES ('race-reviewer@certificate-import.test', 'Reviewer', true, 'approved')
         RETURNING user_id`,
      );
      const batch = await client.query<{ batch_id: string }>(
        `INSERT INTO certificate_bulk_import_batches (user_id, status)
         VALUES ($1, 'SUBMITTED')
         RETURNING batch_id`,
        [fixture.userId],
      );
      await client.query(
        `INSERT INTO certificate_bulk_import_files (
           batch_id, file_url, file_name, file_type, uploaded_by_id,
           upload_status, object_key, confirmed_at
         ) VALUES (
           $1, 'batches/sealed/race.jpg', 'race.jpg', 'image/jpeg', $2,
           'CONFIRMED', 'batches/sealed/race.jpg', now()
         )`,
        [batch.rows[0].batch_id, fixture.userId],
      );
      const item = await client.query<{ item_id: string }>(
        `INSERT INTO certificate_bulk_import_items (
           batch_id, item_type, class_id, completed_at, status
         ) VALUES ($1, 'CLASS', $2, DATE '2004-06-01', 'SUBMITTED')
         RETURNING item_id`,
        [batch.rows[0].batch_id, fixture.amigoId],
      );
      return {
        reviewerId: user.rows[0].user_id,
        batchId: batch.rows[0].batch_id,
        itemId: item.rows[0].item_id,
      };
    });

    const pool = new pg.Pool({ connectionString: url });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const service = new CertificateBulkImportApplicationService(prisma as never);
    try {
      const results = await Promise.allSettled([
        service.approveItem(reviewer.reviewerId, reviewer.batchId, reviewer.itemId, {}),
        service.approveItem(reviewer.reviewerId, reviewer.batchId, reviewer.itemId, {}),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
      const rows = await prisma.enrollments.count({
        where: { user_id: fixture.userId, class_id: fixture.amigoId },
      });
      const events = await prisma.certificate_bulk_import_item_events.count({
        where: { item_id: reviewer.itemId, action: 'ITEM_APPROVED' },
      });
      expect(rows).toBe(1);
      expect(events).toBe(1);
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  });

  it('keeps institutional approval and the age read in one locked transaction', async () => {
    const fixture = await seed('iage');
    const seeded = await withClient(url, async (client) => {
      await client.query(
        `INSERT INTO roles (role_name, description, role_category, active)
         VALUES ('super-admin', 'Super admin', 'GLOBAL', true)
         ON CONFLICT (role_name) DO NOTHING`,
      );
      await client.query(
        `INSERT INTO ecclesiastical_years (start_date, end_date, active)
         VALUES (DATE '2008-01-01', DATE '2008-12-31', false)`,
      );
      const year = await client.query<{ year_id: number }>(
        `SELECT year_id FROM ecclesiastical_years
         WHERE start_date = DATE '2008-01-01' AND end_date = DATE '2008-12-31'`,
      );
      await client.query(
        `UPDATE users SET birthday = DATE '1980-01-01' WHERE user_id = $1`,
        [fixture.userId],
      );
      const reviewer = await client.query<{ user_id: string }>(
        `INSERT INTO users (email, name, active, approval_status)
         VALUES ('reviewer-iage@certificate-import.test', 'Revisor', true, 'approved')
         RETURNING user_id`,
      );
      await client.query(
        `INSERT INTO users_roles (user_id, role_id, active)
         SELECT $1, role_id, true FROM roles WHERE role_name = 'super-admin'`,
        [reviewer.rows[0].user_id],
      );
      const klass = await client.query<{ class_id: number }>(
        `INSERT INTO classes (name, active, club_type_id, minimum_age, display_order, asset_code)
         SELECT 'Avanzado iage', false, club_type_id, 16, 91, 'IAGE'
         FROM classes
         WHERE class_id = $1
         RETURNING class_id`,
        [fixture.amigoId],
      );
      const young = await client.query<{ user_id: string }>(
        `INSERT INTO users (email, name, active, approval_status, birthday)
         VALUES (
           'young-iage@certificate-import.test', 'Menor', true, 'approved', DATE '2010-01-01'
         )
         RETURNING user_id`,
      );

      const requestFor = async (userId: string) => {
        const batch = await client.query<{ batch_id: string }>(
          `INSERT INTO certificate_bulk_import_batches (user_id)
           VALUES ($1)
           RETURNING batch_id`,
          [userId],
        );
        const file = await client.query<{ file_id: string }>(
          `INSERT INTO certificate_bulk_import_files (
             batch_id, file_url, file_name, file_type, uploaded_by_id,
             upload_status, object_key, jurisdiction
           ) VALUES (
             $1, 'sealed', 'cert.pdf', 'application/pdf', $2,
             'CONFIRMED', 'sealed-key', 'INSTITUTIONAL'
           )
           RETURNING file_id`,
          [batch.rows[0].batch_id, userId],
        );
        const request = await client.query<{ request_id: string }>(
          `INSERT INTO institutional_certificate_requests (
             user_id, class_id, file_id, batch_id, completed_at
           ) VALUES ($1, $2, $3, $4, DATE '2008-07-07')
           RETURNING request_id`,
          [
            userId,
            klass.rows[0].class_id,
            file.rows[0].file_id,
            batch.rows[0].batch_id,
          ],
        );
        return request.rows[0].request_id;
      };

      return {
        reviewerId: reviewer.rows[0].user_id,
        yearId: year.rows[0].year_id,
        classId: klass.rows[0].class_id,
        youngUserId: young.rows[0].user_id,
        adultRequestId: await requestFor(fixture.userId),
        youngRequestId: await requestFor(young.rows[0].user_id),
      };
    });

    const pool = new pg.Pool({ connectionString: url });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const service = new InstitutionalCertificateRequestsService(
      prisma as never,
    );
    const holder = new Client({ connectionString: url });
    await holder.connect();
    try {
      await expect(
        service.approve(seeded.reviewerId, seeded.youngRequestId, {
          expected_revision: 0,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CERTIFICATE_IMPORT_AGE_BELOW_MINIMUM,
      });
      expect(
        await prisma.institutional_certificate_requests.findFirst({
          where: { request_id: seeded.youngRequestId },
          select: { status: true },
        }),
      ).toMatchObject({ status: 'PENDING_REVIEW' });
      expect(
        await prisma.institutional_certificate_request_events.count({
          where: {
            request_id: seeded.youngRequestId,
            action: 'REQUEST_APPROVED',
          },
        }),
      ).toBe(0);
      expect(
        await prisma.enrollments.count({
          where: { user_id: seeded.youngUserId },
        }),
      ).toBe(0);

      await holder.query('BEGIN');
      await holder.query(
        'SELECT user_id FROM users WHERE user_id = $1::uuid FOR UPDATE',
        [fixture.userId],
      );
      let settled = false;
      const approval = service
        .approve(seeded.reviewerId, seeded.adultRequestId, {
          expected_revision: 0,
        })
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const waiting = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n
         FROM pg_stat_activity
         WHERE state = 'active' AND wait_event_type = 'Lock'`,
      );
      expect(settled).toBe(false);
      expect(waiting.rows[0].n).toBeGreaterThan(0);
      await holder.query('ROLLBACK');
      await expect(approval).resolves.toMatchObject({
        status: 'APPROVED',
        enrollment_created: false,
        ecclesiastical_year_id: seeded.yearId,
      });
      expect(
        await prisma.enrollments.count({
          where: { user_id: fixture.userId, class_id: seeded.classId },
        }),
      ).toBe(0);
      expect(
        await prisma.institutional_certificate_request_events.count({
          where: {
            request_id: seeded.adultRequestId,
            action: 'REQUEST_APPROVED',
          },
        }),
      ).toBe(1);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
      await prisma.$disconnect();
      await pool.end();
    }
  });
});
