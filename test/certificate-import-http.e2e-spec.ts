/**
 * HTTP boundary for certificate imports.
 *
 * Simulated: BetterAuthService and the year-cut cron, via bootstrapAnnualCycleApp.
 * Redis is cleared before AppModule loads, so process-ocr must not report a
 * finished reading. This suite does not call OCR.space and is not SQL proof.
 * Slot, GM substitution, and the institutional unique index stay in
 * certificate-import-postgres.e2e-spec.ts.
 */
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  bootstrapAnnualCycleApp,
  prepareAnnualCycleDatabase,
  seedAnnualCycleFixture,
  withClient,
} from './helpers/annual-cycle-db.helper';
import {
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

jest.setTimeout(180000);

describe('certificate import HTTP', () => {
  let app: Awaited<ReturnType<typeof bootstrapAnnualCycleApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootstrapAnnualCycleApp>>['prisma'];
  let jwtService: JwtService;
  let ownerId: string;
  let strangerId: string;
  let otherFieldReviewerId: string;
  let genericAdminId: string;
  let unionReviewerId: string;
  let batchId: string;

  const bearer = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(jwtService, userId)}`,
  });

  beforeAll(async () => {
    const url = await prepareAnnualCycleDatabase();
    await seedAnnualCycleFixture(url);
    await withClient(url, async (client) => {
      const owner = await client.query<{ user_id: string }>(
        `INSERT INTO users (email, name, active, approval_status)
         VALUES ('owner@certificate-import.test', 'Owner', true, 'approved')
         RETURNING user_id`,
      );
      const stranger = await client.query<{ user_id: string }>(
        `INSERT INTO users (email, name, active, approval_status)
         VALUES ('stranger@certificate-import.test', 'Stranger', true, 'approved')
         RETURNING user_id`,
      );
      ownerId = owner.rows[0].user_id;
      strangerId = stranger.rows[0].user_id;
      const batch = await client.query<{ batch_id: string }>(
        `INSERT INTO certificate_bulk_import_batches (user_id, status)
         VALUES ($1, 'DRAFT')
         RETURNING batch_id`,
        [ownerId],
      );
      batchId = batch.rows[0].batch_id;
      const fields = await client.query<{ local_field_id: number; abbreviation: string }>(
        `SELECT local_field_id, abbreviation FROM local_fields`,
      );
      const homeField = fields.rows.find((row) => row.abbreviation === 'CNT');
      const otherField = fields.rows.find((row) => row.abbreviation === 'CAT');
      if (!homeField || !otherField) {
        throw new Error('certificate import HTTP fixture is missing local fields');
      }
      await client.query(
        `UPDATE certificate_bulk_import_batches
         SET local_field_id = $2
         WHERE batch_id = $1`,
        [batchId, homeField.local_field_id],
      );
      await client.query(`
        INSERT INTO roles (role_name, description, role_category, active)
        VALUES
          ('admin', 'Admin', 'GLOBAL', true),
          ('director-union', 'Union', 'GLOBAL', true)
        ON CONFLICT (role_name) DO NOTHING
      `);
      const insertReviewer = async (email: string, roleName: string, fieldId: number | null) => {
        const user = await client.query<{ user_id: string }>(
          `INSERT INTO users (email, name, active, approval_status, local_field_id)
           VALUES ($1, $2, true, 'approved', $3)
           RETURNING user_id`,
          [email, roleName, fieldId],
        );
        await client.query(
          `INSERT INTO users_roles (user_id, role_id, active)
           SELECT $1, role_id, true FROM roles WHERE role_name = $2`,
          [user.rows[0].user_id, roleName],
        );
        return user.rows[0].user_id;
      };
      otherFieldReviewerId = await insertReviewer(
        'other-field@certificate-import.test',
        'director-lf',
        otherField.local_field_id,
      );
      genericAdminId = await insertReviewer(
        'generic-admin@certificate-import.test',
        'admin',
        null,
      );
      unionReviewerId = await insertReviewer(
        'union@certificate-import.test',
        'director-union',
        null,
      );
      await client.query(
        `INSERT INTO certificate_bulk_import_files (
           batch_id, file_url, file_name, file_type, uploaded_by_id,
           upload_status, staging_key, object_key, size_bytes, confirmed_at
         ) VALUES (
           $1, 'batches/sealed/cert.jpg', 'cert.jpg', 'image/jpeg', $2,
           'CONFIRMED', 'batches/staging/cert.jpg', 'batches/sealed/cert.jpg',
           2097152, now()
         )`,
        [batchId, ownerId],
      );
    });

    const boot = await bootstrapAnnualCycleApp();
    app = boot.app;
    prisma = boot.prisma;
    jwtService = createTestJwtService();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('rejects anonymous list, OCR, and the institutional inbox', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/certificate-bulk-imports')
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/certificate-bulk-imports/${batchId}/process-ocr`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/certificate-import-institutional-requests')
      .expect(401);
  });

  it('does not report OCR success when the queue is absent', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/certificate-bulk-imports/${batchId}/process-ocr`)
      .set(bearer(ownerId))
      .expect(400);

    expect(JSON.stringify(response.body)).toContain(
      'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
    );
    const processed = await prisma.certificate_bulk_import_item_events.count({
      where: { batch_id: batchId, action: 'OCR_PROCESSED' },
    });
    expect(processed).toBe(0);
  });

  it('hides another member batch', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/certificate-bulk-imports/${batchId}/process-ocr`)
      .set(bearer(strangerId))
      .expect(404);
  });

  it('keeps the institutional inbox off a member token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/certificate-import-institutional-requests')
      .set(bearer(ownerId))
      .expect(403);
  });

  it('hides a batch from a reviewer of another local field', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/certificate-bulk-imports/${batchId}`)
      .set(bearer(otherFieldReviewerId))
      .expect(403);

    expect(JSON.stringify(response.body)).toContain(
      'CERTIFICATE_IMPORT_BATCH_FORBIDDEN',
    );
  });

  it('keeps the institutional inbox off a generic admin and a union reviewer', async () => {
    for (const userId of [genericAdminId, unionReviewerId]) {
      const list = await request(app.getHttpServer())
        .get('/api/v1/admin/certificate-import-institutional-requests')
        .set(bearer(userId))
        .expect(403);
      expect(JSON.stringify(list.body)).toContain('GUARD_PERMISSION_DENIED');

      const decision = await request(app.getHttpServer())
        .post(
          '/api/v1/admin/certificate-import-institutional-requests/11111111-1111-1111-1111-111111111111/approve',
        )
        .set(bearer(userId))
        .send({ expected_revision: 0 })
        .expect(403);
      expect(JSON.stringify(decision.body)).toContain('GUARD_PERMISSION_DENIED');
    }

    const commonInbox = await request(app.getHttpServer())
      .get(`/api/v1/admin/certificate-bulk-imports/${batchId}`)
      .set(bearer(unionReviewerId))
      .expect(403);
    // director-lf admite director-union por alias del guard; el servicio niega el ámbito.
    expect(JSON.stringify(commonInbox.body)).toContain(
      'CERTIFICATE_IMPORT_REVIEWER_SCOPE_REQUIRED',
    );
  });
  describe('batch responses with a presigned file (BigInt size_bytes)', () => {
    // size_bytes is BigInt in Prisma. These GETs used to answer 500
    // "Do not know how to serialize a BigInt" as soon as a batch had a file.
    const expectFileView = (file: Record<string, unknown>) => {
      expect(file).toMatchObject({
        batch_id: batchId,
        file_url: 'batches/sealed/cert.jpg',
        file_name: 'cert.jpg',
        file_type: 'image/jpeg',
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/cert.jpg',
        size_bytes: 2097152,
      });
      expect(typeof file.file_id).toBe('string');
      expect(typeof file.uploaded_at).toBe('string');
      expect(file).not.toHaveProperty('staging_key');
    };

    it('lets the owner read the batch with its file size as a number', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/certificate-bulk-imports/${batchId}`)
        .set(bearer(ownerId))
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.batch_id).toBe(batchId);
      expect(response.body.data.files).toHaveLength(1);
      expectFileView(response.body.data.files[0]);
    });

    it('lists the owner batches with their files', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/certificate-bulk-imports')
        .set(bearer(ownerId))
        .expect(200);

      const listed = response.body.data.items.find(
        (item: { batch_id: string }) => item.batch_id === batchId,
      );
      expect(listed.files).toHaveLength(1);
      expect(listed.files[0]).toHaveProperty('upload_status', 'CONFIRMED');
    });

    it('lets a global reviewer read the batch detail with the file size as a number', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/admin/certificate-bulk-imports/${batchId}`)
        .set(bearer(genericAdminId))
        .expect(200);

      expect(response.body.data.batch_id).toBe(batchId);
      expect(response.body.data.files).toHaveLength(1);
      expectFileView(response.body.data.files[0]);
    });
  });
});
