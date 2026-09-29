/**
 * Recorrido del expediente sin llamar a OCR.space.
 * La lectura vacía la hace un proveedor falso. La base es la de prueba local.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { CertificateBulkImportsService } from '../src/certificate-bulk-imports/certificate-bulk-imports.service';
import { CertificateBulkImportApplicationService } from '../src/certificate-bulk-imports/certificate-bulk-imports-application.service';
import { AdminCertificateBulkImportsService } from '../src/certificate-bulk-imports/admin-certificate-bulk-imports.service';
import { CertificateImportYearResolver } from '../src/certificate-bulk-imports/certificate-import-year-resolver.service';
import { InstitutionalCertificateRequestsService } from '../src/certificate-bulk-imports/institutional-certificate-requests.service';
import { CertificateImportFilesService } from '../src/certificate-bulk-imports/certificate-import-files.service';
import { InvestitureService } from '../src/investiture/investiture.service';
import { NextClassResolver } from '../src/classes/next-class.resolver';
import { ClassEnrollmentWriter } from '../src/classes/class-enrollment-writer.service';
import { ClassesService } from '../src/classes/classes.service';
import { ErrorCode } from '../src/common/errors/error-codes';
import { CertificateBulkImportItemType } from '../src/certificate-bulk-imports/certificate-bulk-imports.types';
import { CertificateOcrParser } from '../src/certificate-bulk-imports/ocr/certificate-ocr.parser';
import {
  prepareAnnualCycleDatabase,
  withClient,
} from './helpers/annual-cycle-db.helper';

jest.setTimeout(180000);

const SQL = [
  'prisma/migrations/20260921140000_historical_certificate_enrollments/migration.sql',
  'prisma/migrations/20260921153000_ecclesiastical_year_no_overlap/migration.sql',
  'prisma/migrations/20260921190000_institutional_certificate_requests/migration.sql',
].map((relative) => readFileSync(join(__dirname, '..', relative), 'utf8'));

describe('certificate import journey', () => {
  let prisma: PrismaClient;
  let pool: pg.Pool;
  let imports: CertificateBulkImportsService;
  let admin: AdminCertificateBulkImportsService;
  let institutional: InstitutionalCertificateRequestsService;
  const ocr = {
    extract: jest.fn().mockResolvedValue({ rawText: 'sin etiquetas', items: [] }),
  };

  beforeAll(async () => {
    const url = await prepareAnnualCycleDatabase();
    await withClient(url, async (client) => {
      for (const statement of SQL) {
        await client.query(statement);
      }
      await client.query(`
        INSERT INTO roles (role_name, description, role_category, active)
        VALUES ('super-admin', 'Super', 'GLOBAL', true)
        ON CONFLICT (role_name) DO NOTHING
      `);
    });
    pool = new pg.Pool({ connectionString: url });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    imports = new CertificateBulkImportsService(prisma as never, ocr, null);
    const application = new CertificateBulkImportApplicationService(prisma as never);
    admin = new AdminCertificateBulkImportsService(
      prisma as never,
      application,
      new CertificateImportYearResolver(prisma as never),
    );
    institutional = new InstitutionalCertificateRequestsService(prisma as never);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  it('goes from an empty reading to a historical class through rejection and correction', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-owner@certificate-import.test',
        name: 'Owner',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-reviewer@certificate-import.test',
        name: 'Reviewer',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Tipo journey', active: true },
    });
    await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2004-01-01T00:00:00.000Z'),
        end_date: new Date('2004-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const amigo = await prisma.classes.create({
      data: {
        name: 'Amigo journey',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 10,
        display_order: 1,
        asset_code: 'JRN01',
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/journey.jpg',
        file_name: 'journey.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/journey.jpg',
        confirmed_at: new Date(),
      },
    });

    await imports.runQueuedOcr(owner.user_id, batch.batch_id);
    expect(ocr.extract).toHaveBeenCalledWith([
      expect.objectContaining({ objectKey: 'batches/sealed/journey.jpg' }),
    ]);
    expect(
      await prisma.certificate_bulk_import_items.count({
        where: { batch_id: batch.batch_id, active: true },
      }),
    ).toBe(0);

    const added = await imports.addItem(owner.user_id, batch.batch_id, {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: amigo.class_id,
      completed_at: '2004-06-01',
      mark_as_ready: true,
      expected_revision: 0,
    });
    await imports.runQueuedOcr(owner.user_id, batch.batch_id);
    const kept = await prisma.certificate_bulk_import_items.findFirst({
      where: { item_id: added.item_id, active: true },
    });
    expect(kept?.status).toBe('READY');

    await imports.submit(owner.user_id, batch.batch_id);
    await admin.rejectItem(reviewer.user_id, batch.batch_id, added.item_id, {
      reason: 'Fecha ilegible',
    });
    const rejected = await prisma.certificate_bulk_import_items.findUniqueOrThrow({
      where: { item_id: added.item_id },
    });
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejection_reason).toBe('Fecha ilegible');

    await imports.resubmitItem(owner.user_id, batch.batch_id, added.item_id, {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: amigo.class_id,
      completed_at: '2004-06-01',
      mark_as_ready: true,
    });
    await admin.approveItem(reviewer.user_id, batch.batch_id, added.item_id, {});
    await admin.approveItem(reviewer.user_id, batch.batch_id, added.item_id, {});

    const rows = await prisma.enrollments.findMany({
      where: { user_id: owner.user_id, class_id: amigo.class_id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      record_kind: 'HISTORICAL_CERTIFICATE',
      investiture_status: 'INVESTIDO',
      active: true,
    });
    expect(rows[0].investiture_date?.toISOString().slice(0, 10)).toBe('2004-06-01');
    expect(
      await prisma.investiture_validation_history.count({
        where: { enrollment_id: rows[0].enrollment_id, action: 'INVESTIDO' },
      }),
    ).toBe(1);
    const closed = await prisma.certificate_bulk_import_batches.findUniqueOrThrow({
      where: { batch_id: batch.batch_id },
    });
    expect(closed.status).toBe('APPROVED');
  });

  it('keeps an institutional certificate out of enrollments until a period exists', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-gm@certificate-import.test',
        name: 'Guia',
        active: true,
        approval_status: 'approved',
      },
    });
    const superAdmin = await prisma.users.create({
      data: {
        email: 'journey-super@certificate-import.test',
        name: 'Super',
        active: true,
        approval_status: 'approved',
      },
    });
    const campo = await prisma.users.create({
      data: {
        email: 'journey-campo@certificate-import.test',
        name: 'Campo',
        active: true,
        approval_status: 'approved',
      },
    });
    const superRole = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    const campoRole = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'director-lf' },
    });
    await prisma.users_roles.createMany({
      data: [
        { user_id: superAdmin.user_id, role_id: superRole.role_id, active: true },
        { user_id: campo.user_id, role_id: campoRole.role_id, active: true },
      ],
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Tipo institucional', active: true },
    });
    const advanced = await prisma.classes.create({
      data: {
        name: 'Guía Mayor Avanzado',
        active: false,
        club_type_id: clubType.club_type_id,
        minimum_age: 16,
        display_order: 9,
        asset_code: 'GM-02',
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    const file = await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/gm02.jpg',
        file_name: 'gm02.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/gm02.jpg',
        confirmed_at: new Date(),
      },
    });

    const request = await institutional.submit(owner.user_id, {
      class_id: advanced.class_id,
      file_id: file.file_id,
      completed_at: '1991-05-05',
      source: 'MANUAL',
    });
    await expect(institutional.listForReview(campo.user_id)).rejects.toThrow(
      'CERTIFICATE_IMPORT_INSTITUTIONAL_FORBIDDEN',
    );
    await expect(
      institutional.approve(superAdmin.user_id, request.request_id, {
        expected_revision: request.revision,
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_YEAR_NOT_FOUND');
    const pending = await institutional.getMine(owner.user_id, request.request_id);
    expect(pending.status).toBe('PENDING_REVIEW');
    expect(pending.enrollment_created).toBe(false);

    await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('1991-01-01T00:00:00.000Z'),
        end_date: new Date('1991-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const approved = await institutional.approve(
      superAdmin.user_id,
      request.request_id,
      { expected_revision: request.revision },
    );
    expect(approved.status).toBe('APPROVED');
    expect(approved.enrollment_created).toBe(false);
    expect(
      await prisma.enrollments.count({ where: { user_id: owner.user_id } }),
    ).toBe(0);
    const mine = await institutional.getMine(owner.user_id, request.request_id);
    expect(mine.status).toBe('APPROVED');
  });

  it('keeps one institutional decision when approve and reject race', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-race@certificate-import.test',
        name: 'Carrera',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-race-super@certificate-import.test',
        name: 'Revisor',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Tipo carrera', active: true },
    });
    await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('1992-01-01T00:00:00.000Z'),
        end_date: new Date('1992-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const instructor = await prisma.classes.create({
      data: {
        name: 'Instructor journey',
        active: false,
        club_type_id: clubType.club_type_id,
        minimum_age: 18,
        display_order: 10,
        asset_code: 'GM-03',
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    const file = await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/gm03.jpg',
        file_name: 'gm03.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/gm03.jpg',
        confirmed_at: new Date(),
      },
    });
    const request = await institutional.submit(owner.user_id, {
      class_id: instructor.class_id,
      file_id: file.file_id,
      completed_at: '1992-03-03',
      source: 'MANUAL',
    });

    const results = await Promise.allSettled([
      institutional.approve(reviewer.user_id, request.request_id, {
        expected_revision: request.revision,
      }),
      institutional.reject(reviewer.user_id, request.request_id, {
        expected_revision: request.revision,
        reason: 'No coincide con la persona',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((result) => result.status === 'rejected');
    expect(lost?.status).toBe('rejected');
    if (lost?.status === 'rejected') {
      const message =
        lost.reason instanceof Error ? lost.reason.message : String(lost.reason);
      expect(message).toMatch(
        /CERTIFICATE_IMPORT_REVISION_CONFLICT|CERTIFICATE_IMPORT_DECISION_IMMUTABLE/,
      );
    }

    const stored = await prisma.institutional_certificate_requests.findUniqueOrThrow({
      where: { request_id: request.request_id },
    });
    expect(['APPROVED', 'REJECTED']).toContain(stored.status);
    expect(
      await prisma.institutional_certificate_request_events.count({
        where: {
          request_id: request.request_id,
          action: { in: ['REQUEST_APPROVED', 'REQUEST_REJECTED'] },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.enrollments.count({ where: { user_id: owner.user_id } }),
    ).toBe(0);
  });

  it('substitutes the current Guía Mayor and accredits Amigo plus Explorador without Compañero', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-gm-sub@certificate-import.test',
        name: 'Sustitucion',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-gm-sub-reviewer@certificate-import.test',
        name: 'Revisor GM',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Tipo sustitucion', active: true },
    });
    const currentYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2026-01-01T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const amigo = await prisma.classes.create({
      data: {
        name: 'Amigo sustitucion',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 10,
        display_order: 1,
        asset_code: 'SUBA',
      },
    });
    const explorador = await prisma.classes.create({
      data: {
        name: 'Explorador sustitucion',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 12,
        display_order: 3,
        asset_code: 'SUBE',
      },
    });
    const guide = await prisma.classes.create({
      data: {
        name: 'Guia Mayor sustitucion',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 16,
        display_order: 8,
        asset_code: 'GM-01',
      },
    });
    const current = await prisma.enrollments.create({
      data: {
        user_id: owner.user_id,
        class_id: guide.class_id,
        ecclesiastical_year_id: currentYear.year_id,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/gm-sub.jpg',
        file_name: 'gm-sub.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/gm-sub.jpg',
        confirmed_at: new Date(),
      },
    });

    const amigoItem = await imports.addItem(owner.user_id, batch.batch_id, {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: amigo.class_id,
      completed_at: '2005-06-01',
      mark_as_ready: true,
      expected_revision: 0,
    });
    const exploradorItem = await imports.addItem(owner.user_id, batch.batch_id, {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: explorador.class_id,
      completed_at: '2005-08-01',
      mark_as_ready: true,
      expected_revision: 1,
    });
    const guideItem = await imports.addItem(owner.user_id, batch.batch_id, {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: guide.class_id,
      completed_at: '2005-03-15',
      mark_as_ready: true,
      expected_revision: 2,
    });
    await imports.submit(owner.user_id, batch.batch_id);

    await expect(
      admin.approveItem(reviewer.user_id, batch.batch_id, amigoItem.item_id, {}),
    ).rejects.toThrow('CERTIFICATE_IMPORT_YEAR_NOT_FOUND');
    const untouched = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: current.enrollment_id },
    });
    expect(untouched).toMatchObject({
      ecclesiastical_year_id: currentYear.year_id,
      investiture_status: 'IN_PROGRESS',
      record_kind: 'OPERATIONAL',
    });
    expect(
      await prisma.enrollments.count({ where: { user_id: owner.user_id } }),
    ).toBe(1);

    const historicalYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2005-01-01T00:00:00.000Z'),
        end_date: new Date('2005-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    await admin.approveItem(reviewer.user_id, batch.batch_id, amigoItem.item_id, {});
    await admin.approveItem(
      reviewer.user_id,
      batch.batch_id,
      exploradorItem.item_id,
      {},
    );
    await admin.approveItem(reviewer.user_id, batch.batch_id, guideItem.item_id, {});
    await admin.approveItem(reviewer.user_id, batch.batch_id, guideItem.item_id, {});

    const rows = await prisma.enrollments.findMany({
      where: { user_id: owner.user_id },
      orderBy: { class_id: 'asc' },
    });
    expect(rows).toHaveLength(3);
    const byClass = new Map(rows.map((row) => [row.class_id, row]));
    expect(byClass.get(amigo.class_id)).toMatchObject({
      record_kind: 'HISTORICAL_CERTIFICATE',
      investiture_status: 'INVESTIDO',
      ecclesiastical_year_id: historicalYear.year_id,
      active: true,
    });
    expect(byClass.get(explorador.class_id)).toMatchObject({
      record_kind: 'HISTORICAL_CERTIFICATE',
      investiture_status: 'INVESTIDO',
      ecclesiastical_year_id: historicalYear.year_id,
      active: true,
    });
    const substituted = byClass.get(guide.class_id);
    expect(substituted?.enrollment_id).toBe(current.enrollment_id);
    expect(substituted).toMatchObject({
      record_kind: 'HISTORICAL_CERTIFICATE',
      investiture_status: 'INVESTIDO',
      ecclesiastical_year_id: historicalYear.year_id,
      active: true,
    });
    expect(substituted?.investiture_date?.toISOString().slice(0, 10)).toBe(
      '2005-03-15',
    );
    expect(
      await prisma.investiture_validation_history.count({
        where: { enrollment_id: current.enrollment_id, action: 'INVESTIDO' },
      }),
    ).toBe(1);
    const stillInactive = await prisma.ecclesiastical_years.findUniqueOrThrow({
      where: { year_id: historicalYear.year_id },
    });
    expect(stillInactive.active).toBe(false);

    const laterYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2027-01-01T00:00:00.000Z'),
        end_date: new Date('2027-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    await expect(
      pool.query(
        `INSERT INTO enrollments (user_id, class_id, ecclesiastical_year_id)
         VALUES ($1, $2, $3)`,
        [owner.user_id, guide.class_id, laterYear.year_id],
      ),
    ).rejects.toThrow(/ENROLLMENT_GM_SINGLE_ROW/);
    expect(
      await prisma.enrollments.count({
        where: { user_id: owner.user_id, class_id: guide.class_id },
      }),
    ).toBe(1);
  });

  it('accredits an honor in users_honors and does not open an enrollment', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-honor@certificate-import.test',
        name: 'Honor',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-honor-reviewer@certificate-import.test',
        name: 'Revisor honor',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Tipo honor', active: true },
    });
    const category = await prisma.honors_categories.create({
      data: { name: 'Categoria journey', active: true },
    });
    const honor = await prisma.honors.create({
      data: {
        name: 'Primeros auxilios journey',
        honor_image: 'honors/journey.png',
        honors_category_id: category.honor_category_id,
        material_url: 'materials/journey',
        club_type_id: clubType.club_type_id,
        active: true,
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/honor.jpg',
        file_name: 'honor.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/honor.jpg',
        confirmed_at: new Date(),
      },
    });
    const item = await imports.addItem(owner.user_id, batch.batch_id, {
      item_type: CertificateBulkImportItemType.HONOR,
      honor_id: honor.honor_id,
      completed_at: '2003-04-04',
      mark_as_ready: true,
      expected_revision: 0,
    });
    await imports.submit(owner.user_id, batch.batch_id);
    await admin.approveItem(reviewer.user_id, batch.batch_id, item.item_id, {});
    await admin.approveItem(reviewer.user_id, batch.batch_id, item.item_id, {});

    const honors = await prisma.users_honors.findMany({
      where: { user_id: owner.user_id, honor_id: honor.honor_id },
    });
    expect(honors).toHaveLength(1);
    expect(honors[0]).toMatchObject({
      validation_status: 'APPROVED',
      active: true,
      certificate: 'batches/sealed/honor.jpg',
    });
    expect(honors[0].date.toISOString().slice(0, 10)).toBe('2003-04-04');
    expect(
      await prisma.evidence_files.count({
        where: { user_honor_id: honors[0].user_honor_id },
      }),
    ).toBe(1);
    expect(
      await prisma.enrollments.count({ where: { user_id: owner.user_id } }),
    ).toBe(0);
    const closed = await prisma.certificate_bulk_import_batches.findUniqueOrThrow({
      where: { batch_id: batch.batch_id },
    });
    expect(closed.status).toBe('APPROVED');
  });

  it('keeps Guía Mayor Avanzado away from generic admins and Union', async () => {
    await pool.query(`
      INSERT INTO roles (role_name, description, role_category, active)
      VALUES
        ('admin', 'Admin', 'GLOBAL', true),
        ('assistant-admin', 'Assistant admin', 'GLOBAL', true),
        ('director-union', 'Union', 'GLOBAL', true),
        ('assistant-union', 'Assistant union', 'GLOBAL', true)
      ON CONFLICT (role_name) DO NOTHING
    `);
    const owner = await prisma.users.create({
      data: {
        email: 'journey-jurisdiction-owner@certificate-import.test',
        name: 'Dueno',
        active: true,
        approval_status: 'approved',
      },
    });
    const superAdmin = await prisma.users.create({
      data: {
        email: 'journey-jurisdiction-super@certificate-import.test',
        name: 'Super',
        active: true,
        approval_status: 'approved',
      },
    });
    const outsiders = await Promise.all(
      ['admin', 'assistant-admin', 'director-union', 'assistant-union'].map(
        async (roleName) => {
          const user = await prisma.users.create({
            data: {
              email: `journey-jurisdiction-${roleName}@certificate-import.test`,
              name: roleName,
              active: true,
              approval_status: 'approved',
            },
          });
          const role = await prisma.roles.findFirstOrThrow({
            where: { role_name: roleName },
          });
          await prisma.users_roles.create({
            data: { user_id: user.user_id, role_id: role.role_id, active: true },
          });
          return { roleName, userId: user.user_id };
        },
      ),
    );
    const superRole = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: {
        user_id: superAdmin.user_id,
        role_id: superRole.role_id,
        active: true,
      },
    });
    let advanced = await prisma.classes.findFirst({
      where: { asset_code: 'GM-02' },
    });
    if (!advanced) {
      const clubType = await prisma.club_types.create({
        data: { name: 'Tipo jurisdiccion', active: true },
      });
      advanced = await prisma.classes.create({
        data: {
          name: 'Guia Mayor Avanzado jurisdiccion',
          active: false,
          club_type_id: clubType.club_type_id,
          minimum_age: 16,
          display_order: 9,
          asset_code: 'GM-02',
        },
      });
    }
    await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('1990-01-01T00:00:00.000Z'),
        end_date: new Date('1990-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'SUBMITTED' },
    });
    const file = await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/jurisdiction.jpg',
        file_name: 'jurisdiction.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/jurisdiction.jpg',
        confirmed_at: new Date(),
      },
    });
    const request = await institutional.submit(owner.user_id, {
      class_id: advanced.class_id,
      file_id: file.file_id,
      completed_at: '1990-02-02',
      source: 'MANUAL',
    });
    const planted = await prisma.certificate_bulk_import_items.create({
      data: {
        batch_id: batch.batch_id,
        item_type: 'CLASS',
        class_id: advanced.class_id,
        completed_at: new Date('1990-02-02T00:00:00.000Z'),
        status: 'SUBMITTED',
      },
    });

    for (const outsider of outsiders) {
      await expect(institutional.listForReview(outsider.userId)).rejects.toThrow(
        'CERTIFICATE_IMPORT_INSTITUTIONAL_FORBIDDEN',
      );
      await expect(
        institutional.approve(outsider.userId, request.request_id, {
          expected_revision: request.revision,
        }),
      ).rejects.toThrow('CERTIFICATE_IMPORT_INSTITUTIONAL_FORBIDDEN');
      await expect(
        institutional.reject(outsider.userId, request.request_id, {
          expected_revision: request.revision,
          reason: 'No corresponde',
        }),
      ).rejects.toThrow('CERTIFICATE_IMPORT_INSTITUTIONAL_FORBIDDEN');
    }
    const pending = await institutional.getMine(owner.user_id, request.request_id);
    expect(pending.status).toBe('PENDING_REVIEW');

    const storage = { getSignedDownloadUrl: jest.fn() };
    const files = new CertificateImportFilesService(
      prisma as never,
      storage as never,
    );
    for (const outsider of outsiders) {
      await expect(
        files.download(outsider.userId, batch.batch_id, file.file_id),
      ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_FORBIDDEN');
    }
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();

    const genericAdmin = outsiders.find((outsider) => outsider.roleName === 'admin');
    const union = outsiders.find(
      (outsider) => outsider.roleName === 'director-union',
    );
    await expect(
      admin.getDetail(genericAdmin!.userId, batch.batch_id),
    ).rejects.toThrow('CERTIFICATE_IMPORT_BATCH_NOT_FOUND');
    await expect(
      admin.getDetail(superAdmin.user_id, batch.batch_id),
    ).rejects.toThrow('CERTIFICATE_IMPORT_BATCH_NOT_FOUND');
    const commonList = await admin.listPending(genericAdmin!.userId);
    expect(commonList.items.map((entry) => entry.batch_id)).not.toContain(
      batch.batch_id,
    );
    await expect(
      admin.approveItem(genericAdmin!.userId, batch.batch_id, planted.item_id, {}),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ITEM_NOT_FOUND');
    await expect(
      admin.rejectItem(genericAdmin!.userId, batch.batch_id, planted.item_id, {
        reason: 'No corresponde',
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ITEM_NOT_FOUND');
    await expect(
      admin.approveItem(union!.userId, batch.batch_id, planted.item_id, {}),
    ).rejects.toThrow('CERTIFICATE_IMPORT_REVIEWER_SCOPE_REQUIRED');

    const queue = await institutional.listForReview(superAdmin.user_id);
    expect(queue.items.map((entry) => entry.request_id)).toContain(
      request.request_id,
    );
    const storedItem = await prisma.certificate_bulk_import_items.findUniqueOrThrow({
      where: { item_id: planted.item_id },
    });
    expect(storedItem.status).toBe('SUBMITTED');
    expect(
      await prisma.enrollments.count({ where: { user_id: owner.user_id } }),
    ).toBe(0);
  });

  it('keeps one Campo Local decision when approve and reject race', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-campo-race@certificate-import.test',
        name: 'Carrera campo',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-campo-race-reviewer@certificate-import.test',
        name: 'Revisor campo',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Tipo carrera campo', active: true },
    });
    await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('1989-01-01T00:00:00.000Z'),
        end_date: new Date('1989-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const amigo = await prisma.classes.create({
      data: {
        name: 'Amigo carrera campo',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 10,
        display_order: 1,
        asset_code: 'RACEA',
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'SUBMITTED' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/campo-race.jpg',
        file_name: 'campo-race.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/campo-race.jpg',
        confirmed_at: new Date(),
      },
    });
    const item = await prisma.certificate_bulk_import_items.create({
      data: {
        batch_id: batch.batch_id,
        item_type: 'CLASS',
        class_id: amigo.class_id,
        completed_at: new Date('1989-06-01T00:00:00.000Z'),
        status: 'SUBMITTED',
      },
    });

    const results = await Promise.allSettled([
      admin.approveItem(reviewer.user_id, batch.batch_id, item.item_id, {}),
      admin.rejectItem(reviewer.user_id, batch.batch_id, item.item_id, {
        reason: 'No coincide',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((result) => result.status === 'rejected');
    expect(lost?.status).toBe('rejected');
    if (lost?.status === 'rejected') {
      const message =
        lost.reason instanceof Error ? lost.reason.message : String(lost.reason);
      expect(message).toMatch(
        /CERTIFICATE_IMPORT_ITEM_NOT_REVIEWABLE|CERTIFICATE_IMPORT_ITEM_NOT_FOUND/,
      );
    }

    const stored = await prisma.certificate_bulk_import_items.findUniqueOrThrow({
      where: { item_id: item.item_id },
    });
    const enrollments = await prisma.enrollments.count({
      where: { user_id: owner.user_id, class_id: amigo.class_id },
    });
    const decisionEvents = await prisma.certificate_bulk_import_item_events.count({
      where: {
        item_id: item.item_id,
        action: { in: ['ITEM_APPROVED', 'ITEM_REJECTED'] },
      },
    });
    expect(decisionEvents).toBe(1);
    if (stored.status === 'APPROVED') {
      expect(enrollments).toBe(1);
      expect(stored.applied_entity_id).not.toBeNull();
    } else {
      expect(stored.status).toBe('REJECTED');
      expect(enrollments).toBe(0);
      expect(stored.applied_entity_id).toBeNull();
    }
  });

  it('keeps a substituted Guía Mayor invested, without a new class or another row', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-gm-stay@certificate-import.test',
        name: 'Permanece',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-gm-stay-reviewer@certificate-import.test',
        name: 'Revisor permanece',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    let guide = await prisma.classes.findFirst({
      where: { asset_code: 'GM-01' },
      include: { club_types: true },
    });
    if (!guide) {
      const clubType = await prisma.club_types.create({
        data: { name: 'Guías Mayores', active: true },
      });
      guide = await prisma.classes.create({
        data: {
          name: 'Guia Mayor permanece',
          active: true,
          club_type_id: clubType.club_type_id,
          minimum_age: 16,
          display_order: 8,
          asset_code: 'GM-01',
        },
        include: { club_types: true },
      });
    }
    const courseYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('1987-01-01T00:00:00.000Z'),
        end_date: new Date('1987-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const certificateYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('1988-01-01T00:00:00.000Z'),
        end_date: new Date('1988-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const laterYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2028-01-01T00:00:00.000Z'),
        end_date: new Date('2028-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const current = await prisma.enrollments.create({
      data: {
        user_id: owner.user_id,
        class_id: guide.class_id,
        ecclesiastical_year_id: courseYear.year_id,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'SUBMITTED' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/gm-stay.jpg',
        file_name: 'gm-stay.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/gm-stay.jpg',
        confirmed_at: new Date(),
      },
    });
    const item = await prisma.certificate_bulk_import_items.create({
      data: {
        batch_id: batch.batch_id,
        item_type: 'CLASS',
        class_id: guide.class_id,
        completed_at: new Date('1988-03-15T00:00:00.000Z'),
        status: 'SUBMITTED',
      },
    });
    await admin.approveItem(reviewer.user_id, batch.batch_id, item.item_id, {});

    const amigo = await prisma.classes.create({
      data: {
        name: 'Amigo permanece',
        active: true,
        club_type_id: guide.club_type_id,
        minimum_age: 10,
        display_order: 1,
        asset_code: 'STAYA',
      },
    });
    const overdue = await prisma.enrollments.create({
      data: {
        user_id: owner.user_id,
        class_id: amigo.class_id,
        ecclesiastical_year_id: courseYear.year_id,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
      },
    });

    const investiture = new InvestitureService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const expired = await investiture.expireOverdueEnrollments(reviewer.user_id, {
      ecclesiastical_year_id: laterYear.year_id,
    });
    expect(expired.enrollment_ids).toContain(overdue.enrollment_id);
    expect(expired.enrollment_ids).not.toContain(current.enrollment_id);

    const substituted = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: current.enrollment_id },
    });
    expect(substituted).toMatchObject({
      record_kind: 'HISTORICAL_CERTIFICATE',
      investiture_status: 'INVESTIDO',
      ecclesiastical_year_id: certificateYear.year_id,
      active: true,
      locked_for_validation: true,
    });
    expect(substituted.investiture_date?.toISOString().slice(0, 10)).toBe(
      '1988-03-15',
    );
    expect(
      await prisma.enrollments.count({
        where: {
          user_id: owner.user_id,
          class_id: guide.class_id,
          record_kind: 'OPERATIONAL',
          investiture_status: 'IN_PROGRESS',
        },
      }),
    ).toBe(0);

    const section = await prisma.club_sections.create({
      data: { active: true, club_type_id: guide.club_type_id },
    });
    const nextClass = new NextClassResolver(prisma as never, {
      ageAtDate: () => 30,
    } as never);
    await expect(
      nextClass.resolve(owner.user_id, section.club_section_id, laterYear.year_id),
    ).resolves.toEqual({ kind: 'journey_complete' });

    const writer = new ClassEnrollmentWriter(prisma as never);
    await expect(
      writer.upsert(prisma as never, {
        userId: owner.user_id,
        classId: guide.class_id,
        ecclesiasticalYearId: laterYear.year_id,
        crossType: false,
        ifExists: 'return',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CLASS_ALREADY_ENROLLED });
    expect(
      await prisma.enrollments.count({
        where: { user_id: owner.user_id, class_id: guide.class_id },
      }),
    ).toBe(1);
    const years = await prisma.ecclesiastical_years.findMany({
      where: { year_id: { in: [certificateYear.year_id, laterYear.year_id] } },
    });
    expect(years.every((year) => year.active === false)).toBe(true);
  });

  it('accredits a class and an honor from the same sealed document', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-mixed@certificate-import.test',
        name: 'Mixto',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-mixed-reviewer@certificate-import.test',
        name: 'Revisor mixto',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Tipo mixto', active: true },
    });
    const year = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2002-01-01T00:00:00.000Z'),
        end_date: new Date('2002-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const amigo = await prisma.classes.create({
      data: {
        name: 'Amigo mixto',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 10,
        display_order: 1,
        asset_code: 'MIXA',
      },
    });
    const category = await prisma.honors_categories.create({
      data: { name: 'Categoria mixta', active: true },
    });
    const honor = await prisma.honors.create({
      data: {
        name: 'Natacion mixta',
        honor_image: 'honors/mixed.png',
        honors_category_id: category.honor_category_id,
        material_url: 'materials/mixed',
        club_type_id: clubType.club_type_id,
        active: true,
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    const file = await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/mixed.jpg',
        file_name: 'mixed.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/mixed.jpg',
        confirmed_at: new Date(),
      },
    });
    const classItem = await imports.addItem(owner.user_id, batch.batch_id, {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: amigo.class_id,
      completed_at: '2002-06-01',
      mark_as_ready: true,
      expected_revision: 0,
    });
    const honorItem = await imports.addItem(owner.user_id, batch.batch_id, {
      item_type: CertificateBulkImportItemType.HONOR,
      honor_id: honor.honor_id,
      completed_at: '2003-04-04',
      mark_as_ready: true,
      expected_revision: 1,
    });
    await imports.submit(owner.user_id, batch.batch_id);

    await admin.approveItem(reviewer.user_id, batch.batch_id, classItem.item_id, {});
    const halfway = await prisma.certificate_bulk_import_batches.findUniqueOrThrow({
      where: { batch_id: batch.batch_id },
    });
    expect(halfway.status).toBe('SUBMITTED');
    const openHonor = await prisma.certificate_bulk_import_items.findUniqueOrThrow({
      where: { item_id: honorItem.item_id },
    });
    expect(openHonor.status).toBe('SUBMITTED');
    expect(
      await prisma.enrollments.count({ where: { user_id: owner.user_id } }),
    ).toBe(1);
    expect(
      await prisma.users_honors.count({ where: { user_id: owner.user_id } }),
    ).toBe(0);

    await admin.approveItem(reviewer.user_id, batch.batch_id, honorItem.item_id, {});
    await admin.approveItem(reviewer.user_id, batch.batch_id, classItem.item_id, {});
    await admin.approveItem(reviewer.user_id, batch.batch_id, honorItem.item_id, {});

    const enrollments = await prisma.enrollments.findMany({
      where: { user_id: owner.user_id, class_id: amigo.class_id },
    });
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0]).toMatchObject({
      record_kind: 'HISTORICAL_CERTIFICATE',
      investiture_status: 'INVESTIDO',
      ecclesiastical_year_id: year.year_id,
      active: true,
    });
    expect(enrollments[0].investiture_date?.toISOString().slice(0, 10)).toBe(
      '2002-06-01',
    );

    const honors = await prisma.users_honors.findMany({
      where: { user_id: owner.user_id, honor_id: honor.honor_id },
    });
    expect(honors).toHaveLength(1);
    expect(honors[0]).toMatchObject({
      validation_status: 'APPROVED',
      active: true,
      certificate: file.file_url,
    });
    expect(honors[0].date.toISOString().slice(0, 10)).toBe('2003-04-04');
    expect(
      await prisma.evidence_files.count({
        where: { user_honor_id: honors[0].user_honor_id, file_url: file.file_url },
      }),
    ).toBe(1);

    const storedItems = await prisma.certificate_bulk_import_items.findMany({
      where: { batch_id: batch.batch_id, active: true },
    });
    expect(storedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item_id: classItem.item_id,
          status: 'APPROVED',
          applied_entity_type: 'ENROLLMENT',
          applied_entity_id: enrollments[0].enrollment_id,
        }),
        expect.objectContaining({
          item_id: honorItem.item_id,
          status: 'APPROVED',
          applied_entity_type: 'USER_HONOR',
          applied_entity_id: honors[0].user_honor_id,
        }),
      ]),
    );
    expect(
      await prisma.certificate_bulk_import_item_events.count({
        where: { batch_id: batch.batch_id, action: 'ITEM_APPROVED' },
      }),
    ).toBe(2);
    const closed = await prisma.certificate_bulk_import_batches.findUniqueOrThrow({
      where: { batch_id: batch.batch_id },
    });
    expect(closed.status).toBe('APPROVED');
    const storedYear = await prisma.ecclesiastical_years.findUniqueOrThrow({
      where: { year_id: year.year_id },
    });
    expect(storedYear.active).toBe(false);
  });

  it('rejects one row of a mixed document and leaves the other pending', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-separate@certificate-import.test',
        name: 'Separado',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-separate-reviewer@certificate-import.test',
        name: 'Revisor separado',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Tipo separado', active: true },
    });
    const year = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2001-01-01T00:00:00.000Z'),
        end_date: new Date('2001-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const amigo = await prisma.classes.create({
      data: {
        name: 'Amigo separado',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 10,
        display_order: 1,
        asset_code: 'MIXB',
      },
    });
    const category = await prisma.honors_categories.create({
      data: { name: 'Categoria separada', active: true },
    });
    const honor = await prisma.honors.create({
      data: {
        name: 'Natacion separada',
        honor_image: 'honors/separate.png',
        honors_category_id: category.honor_category_id,
        material_url: 'materials/separate',
        club_type_id: clubType.club_type_id,
        active: true,
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/separate.jpg',
        file_name: 'separate.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/separate.jpg',
        confirmed_at: new Date(),
      },
    });
    const classItem = await imports.addItem(owner.user_id, batch.batch_id, {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: amigo.class_id,
      completed_at: '2001-05-05',
      mark_as_ready: true,
      expected_revision: 0,
    });
    const honorItem = await imports.addItem(owner.user_id, batch.batch_id, {
      item_type: CertificateBulkImportItemType.HONOR,
      honor_id: honor.honor_id,
      completed_at: '2001-08-08',
      mark_as_ready: true,
      expected_revision: 1,
    });
    await imports.submit(owner.user_id, batch.batch_id);

    await expect(
      admin.approveBatch(reviewer.user_id, batch.batch_id, {}),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ITEM_DECISION_REQUIRED');
    await expect(
      admin.rejectBatch(reviewer.user_id, batch.batch_id, {
        reason: 'No corresponde',
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ITEM_DECISION_REQUIRED');

    await admin.rejectItem(reviewer.user_id, batch.batch_id, honorItem.item_id, {
      reason: 'La especialidad no coincide',
    });
    const afterReject = await prisma.certificate_bulk_import_items.findMany({
      where: { batch_id: batch.batch_id, active: true },
    });
    expect(afterReject).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item_id: classItem.item_id,
          status: 'SUBMITTED',
        }),
        expect.objectContaining({
          item_id: honorItem.item_id,
          status: 'REJECTED',
          rejection_reason: 'La especialidad no coincide',
        }),
      ]),
    );
    expect(
      (
        await prisma.certificate_bulk_import_batches.findUniqueOrThrow({
          where: { batch_id: batch.batch_id },
        })
      ).status,
    ).toBe('SUBMITTED');

    await admin.approveItem(reviewer.user_id, batch.batch_id, classItem.item_id, {});
    expect(
      await prisma.enrollments.count({
        where: { user_id: owner.user_id, class_id: amigo.class_id },
      }),
    ).toBe(1);
    expect(
      await prisma.users_honors.count({ where: { user_id: owner.user_id } }),
    ).toBe(0);
    const closed = await prisma.certificate_bulk_import_batches.findUniqueOrThrow({
      where: { batch_id: batch.batch_id },
    });
    expect(closed.status).toBe('NEEDS_CORRECTION');
    const storedYear = await prisma.ecclesiastical_years.findUniqueOrThrow({
      where: { year_id: year.year_id },
    });
    expect(storedYear.active).toBe(false);
  });

  it('keeps the sealed file when storage cannot be read', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-storage@certificate-import.test',
        name: 'Archivo',
        active: true,
        approval_status: 'approved',
      },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Tipo archivo', active: true },
    });
    const amigo = await prisma.classes.create({
      data: {
        name: 'Amigo archivo',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 10,
        display_order: 1,
        asset_code: 'FILEA',
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    const file = await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/storage.jpg',
        file_name: 'storage.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/storage.jpg',
        confirmed_at: new Date(),
      },
    });
    const item = await imports.addItem(owner.user_id, batch.batch_id, {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: amigo.class_id,
      completed_at: '2000-01-01',
      mark_as_ready: true,
      expected_revision: 0,
    });
    ocr.extract.mockRejectedValueOnce(
      new Error('CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE'),
    );

    await expect(imports.runQueuedOcr(owner.user_id, batch.batch_id)).rejects.toThrow(
      'CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE',
    );

    const storedFile = await prisma.certificate_bulk_import_files.findUniqueOrThrow({
      where: { file_id: file.file_id },
    });
    expect(storedFile).toMatchObject({
      upload_status: 'CONFIRMED',
      object_key: 'batches/sealed/storage.jpg',
      active: true,
    });
    const storedItem = await prisma.certificate_bulk_import_items.findUniqueOrThrow({
      where: { item_id: item.item_id },
    });
    expect(storedItem).toMatchObject({ status: 'READY', active: true });
    const storedBatch = await prisma.certificate_bulk_import_batches.findUniqueOrThrow({
      where: { batch_id: batch.batch_id },
    });
    expect(storedBatch.status).toBe('DRAFT');
    expect(storedBatch.raw_ocr_payload).toBeNull();
    expect(
      await prisma.certificate_bulk_import_item_events.count({
        where: { batch_id: batch.batch_id, action: 'OCR_PROCESSED' },
      }),
    ).toBe(0);
  });

  it('retries a sealed confirm and refuses edits after the document is sent', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-retry@certificate-import.test',
        name: 'Reintento',
        active: true,
        approval_status: 'approved',
      },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Tipo reintento', active: true },
    });
    const amigo = await prisma.classes.create({
      data: {
        name: 'Amigo reintento',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 10,
        display_order: 1,
        asset_code: 'EDGEA',
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    const pending = await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'staging/edge.jpg',
        file_name: 'edge.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'PENDING_UPLOAD',
        staging_key: 'staging/edge.jpg',
        size_bytes: 4,
      },
    });
    const storage = {
      getObjectInfo: jest.fn().mockResolvedValue({
        size: 4,
        contentType: 'image/jpeg',
      }),
      getObjectPrefix: jest
        .fn()
        .mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0x00])),
      copyObject: jest.fn(async (_bucket: string, _source: string, destination: string) => ({
        key: destination,
      })),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    };
    const files = new CertificateImportFilesService(
      prisma as never,
      storage as never,
    );

    const first = await files.confirm(owner.user_id, batch.batch_id, pending.file_id);
    const second = await files.confirm(owner.user_id, batch.batch_id, pending.file_id);
    expect(second.object_key).toBe(first.object_key);
    expect(first.object_key).toContain('/sealed/');
    expect(storage.copyObject).toHaveBeenCalledTimes(1);
    const sealed = await prisma.certificate_bulk_import_files.findUniqueOrThrow({
      where: { file_id: pending.file_id },
    });
    expect(sealed).toMatchObject({
      upload_status: 'CONFIRMED',
      object_key: first.object_key,
      active: true,
    });

    const item = await imports.addItem(owner.user_id, batch.batch_id, {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: amigo.class_id,
      completed_at: '1995-06-01',
      mark_as_ready: true,
      expected_revision: 0,
    });
    await imports.submit(owner.user_id, batch.batch_id);

    await expect(
      imports.updateItem(owner.user_id, batch.batch_id, item.item_id, {
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: amigo.class_id,
        completed_at: '1995-07-01',
        mark_as_ready: true,
        expected_revision: 0,
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_CANNOT_UPDATE_ITEM');
    await expect(
      imports.addItem(owner.user_id, batch.batch_id, {
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: amigo.class_id,
        completed_at: '1995-08-01',
        mark_as_ready: true,
        expected_revision: 0,
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_CANNOT_ADD_ITEM');
    await expect(imports.submit(owner.user_id, batch.batch_id)).rejects.toThrow(
      'CERTIFICATE_IMPORT_CANNOT_SUBMIT',
    );

    const storedItem = await prisma.certificate_bulk_import_items.findUniqueOrThrow({
      where: { item_id: item.item_id },
    });
    expect(storedItem.status).toBe('SUBMITTED');
    expect(storedItem.completed_at?.toISOString().slice(0, 10)).toBe('1995-06-01');
    expect(
      await prisma.certificate_bulk_import_items.count({
        where: { batch_id: batch.batch_id, active: true },
      }),
    ).toBe(1);
    const storedBatch = await prisma.certificate_bulk_import_batches.findUniqueOrThrow({
      where: { batch_id: batch.batch_id },
    });
    expect(storedBatch.status).toBe('SUBMITTED');
  });

  it('retries an institutional submit without a second request', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-institutional-retry@certificate-import.test',
        name: 'Institucional',
        active: true,
        approval_status: 'approved',
      },
    });
    let advanced = await prisma.classes.findFirst({
      where: { asset_code: 'GM-02' },
    });
    if (!advanced) {
      const clubType = await prisma.club_types.create({
        data: { name: 'Tipo institucional reintento', active: true },
      });
      advanced = await prisma.classes.create({
        data: {
          name: 'Guia Mayor Avanzado reintento',
          active: false,
          club_type_id: clubType.club_type_id,
          minimum_age: 16,
          display_order: 9,
          asset_code: 'GM-02',
        },
      });
    }
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    const file = await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/institutional-retry.jpg',
        file_name: 'institutional-retry.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/institutional-retry.jpg',
        confirmed_at: new Date(),
      },
    });

    const first = await institutional.submit(owner.user_id, {
      class_id: advanced.class_id,
      file_id: file.file_id,
      completed_at: '1993-02-02',
    });
    const second = await institutional.submit(owner.user_id, {
      class_id: advanced.class_id,
      file_id: file.file_id,
      completed_at: '1993-02-02',
    });
    expect(second.request_id).toBe(first.request_id);
    expect(
      await prisma.institutional_certificate_requests.count({
        where: { user_id: owner.user_id, file_id: file.file_id },
      }),
    ).toBe(1);
    expect(
      await prisma.institutional_certificate_request_events.count({
        where: { request_id: first.request_id, action: 'REQUEST_SUBMITTED' },
      }),
    ).toBe(1);
    expect(
      await prisma.enrollments.count({ where: { user_id: owner.user_id } }),
    ).toBe(0);

    const raced = await Promise.all([
      institutional.submit(owner.user_id, {
        class_id: advanced.class_id,
        file_id: file.file_id,
        completed_at: '1994-02-02',
      }),
      institutional.submit(owner.user_id, {
        class_id: advanced.class_id,
        file_id: file.file_id,
        completed_at: '1994-02-02',
      }),
    ]);
    expect(raced[0].request_id).toBe(raced[1].request_id);
    expect(
      await prisma.institutional_certificate_requests.count({
        where: {
          user_id: owner.user_id,
          file_id: file.file_id,
          completed_at: new Date('1994-02-02T00:00:00.000Z'),
        },
      }),
    ).toBe(1);
    expect(
      await prisma.institutional_certificate_request_events.count({
        where: { request_id: raced[0].request_id, action: 'REQUEST_SUBMITTED' },
      }),
    ).toBe(1);
  });

  it('stores a suggestion only when the reading has a class or honor label', async () => {
    const parser = new CertificateOcrParser();
    const owner = await prisma.users.create({
      data: {
        email: 'journey-parser@certificate-import.test',
        name: 'Lector',
        active: true,
        approval_status: 'approved',
      },
    });

    const unlabeled = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: unlabeled.batch_id,
        file_url: 'batches/sealed/unlabeled.jpg',
        file_name: 'unlabeled.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/unlabeled.jpg',
        confirmed_at: new Date(),
      },
    });
    ocr.extract.mockResolvedValueOnce(
      parser.parse(
        'Se certifica que la persona completó Amigo el 12/04/2006',
      ),
    );
    await imports.runQueuedOcr(owner.user_id, unlabeled.batch_id);
    expect(
      await prisma.certificate_bulk_import_items.count({
        where: { batch_id: unlabeled.batch_id, active: true },
      }),
    ).toBe(0);

    const labeled = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: labeled.batch_id,
        file_url: 'batches/sealed/labeled.jpg',
        file_name: 'labeled.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/labeled.jpg',
        confirmed_at: new Date(),
      },
    });
    ocr.extract.mockResolvedValueOnce(
      parser.parse(`
        Clase: Explorador
        Honor: Natación
        Especialidad: Nudos
        Fecha: 12/04/2006
      `),
    );
    await imports.runQueuedOcr(owner.user_id, labeled.batch_id);

    const suggestions = await prisma.certificate_bulk_import_items.findMany({
      where: { batch_id: labeled.batch_id, active: true },
    });
    expect(suggestions).toHaveLength(3);
    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item_type: 'CLASS',
          detected_name: 'Explorador',
          status: 'NEEDS_REVIEW',
          class_id: null,
          honor_id: null,
        }),
        expect.objectContaining({
          item_type: 'HONOR',
          detected_name: 'Natación',
          status: 'NEEDS_REVIEW',
          class_id: null,
          honor_id: null,
        }),
        expect.objectContaining({
          item_type: 'HONOR',
          detected_name: 'Nudos',
          status: 'NEEDS_REVIEW',
          class_id: null,
          honor_id: null,
        }),
      ]),
    );
    expect(
      await prisma.enrollments.count({ where: { user_id: owner.user_id } }),
    ).toBe(0);
    expect(
      await prisma.users_honors.count({ where: { user_id: owner.user_id } }),
    ).toBe(0);
    const stored = await prisma.certificate_bulk_import_batches.findUniqueOrThrow({
      where: { batch_id: labeled.batch_id },
    });
    expect(stored.status).toBe('DRAFT');
  });

  it('replaces only untouched suggestions and does not open an institutional request', async () => {
    const parser = new CertificateOcrParser();
    const owner = await prisma.users.create({
      data: {
        email: 'journey-reread@certificate-import.test',
        name: 'Relectura',
        active: true,
        approval_status: 'approved',
      },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Tipo segunda lectura', active: true },
    });
    const explorador = await prisma.classes.create({
      data: {
        name: 'Explorador segunda',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 10,
        display_order: 3,
        asset_code: 'RERUN',
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'DRAFT' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/reread.jpg',
        file_name: 'reread.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/reread.jpg',
        confirmed_at: new Date(),
      },
    });

    ocr.extract.mockResolvedValueOnce(
      parser.parse(`
        Clase: Explorador
        Clase: Guía Mayor Avanzado
        Fecha: 12/04/2006
      `),
    );
    await imports.runQueuedOcr(owner.user_id, batch.batch_id);

    const firstPass = await prisma.certificate_bulk_import_items.findMany({
      where: { batch_id: batch.batch_id, active: true },
    });
    expect(firstPass).toHaveLength(2);
    const suggestion = firstPass.find((item) => item.detected_name === 'Explorador');
    const institutionalSuggestion = firstPass.find(
      (item) => item.detected_name === 'Guía Mayor Avanzado',
    );
    expect(suggestion?.status).toBe('NEEDS_REVIEW');
    expect(suggestion?.class_id).toBeNull();
    expect(institutionalSuggestion?.field_confidence).toMatchObject({
      institutional: 1,
    });
    expect(
      await prisma.institutional_certificate_requests.count({
        where: { user_id: owner.user_id },
      }),
    ).toBe(0);

    await imports.updateItem(owner.user_id, batch.batch_id, suggestion!.item_id, {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: explorador.class_id,
      completed_at: '2006-04-12',
      mark_as_ready: true,
      expected_revision: 0,
    });

    ocr.extract.mockResolvedValueOnce(
      parser.parse(`
        Honor: Natación
        Fecha: 12/04/2006
      `),
    );
    await imports.runQueuedOcr(owner.user_id, batch.batch_id);

    const kept = await prisma.certificate_bulk_import_items.findUniqueOrThrow({
      where: { item_id: suggestion!.item_id },
    });
    expect(kept).toMatchObject({
      active: true,
      status: 'READY',
      class_id: explorador.class_id,
    });
    expect(kept.completed_at?.toISOString().slice(0, 10)).toBe('2006-04-12');

    const replaced = await prisma.certificate_bulk_import_items.findUniqueOrThrow({
      where: { item_id: institutionalSuggestion!.item_id },
    });
    expect(replaced.active).toBe(false);

    const active = await prisma.certificate_bulk_import_items.findMany({
      where: { batch_id: batch.batch_id, active: true },
    });
    expect(active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item_id: suggestion!.item_id, status: 'READY' }),
        expect.objectContaining({
          item_type: 'HONOR',
          detected_name: 'Natación',
          status: 'NEEDS_REVIEW',
          honor_id: null,
        }),
      ]),
    );
    expect(active).toHaveLength(2);
    expect(
      await prisma.institutional_certificate_requests.count({
        where: { user_id: owner.user_id },
      }),
    ).toBe(0);
    expect(
      await prisma.enrollments.count({ where: { user_id: owner.user_id } }),
    ).toBe(0);
    const stored = await prisma.certificate_bulk_import_batches.findUniqueOrThrow({
      where: { batch_id: batch.batch_id },
    });
    expect(stored.status).toBe('DRAFT');
  });

  it('treats a historical investiture as a prerequisite and as invested Guía Mayor', async () => {
    const classes = new ClassesService(
      prisma as never,
      {} as never,
      { emitEvent: async () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const owner = await prisma.users.create({
      data: {
        email: 'journey-prereq@certificate-import.test',
        name: 'Prerequisito',
        active: true,
        approval_status: 'approved',
      },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Conquistadores reconocimiento', active: true },
    });
    const pastYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('1996-01-01T00:00:00.000Z'),
        end_date: new Date('1996-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const nextYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('1997-01-01T00:00:00.000Z'),
        end_date: new Date('1997-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const amigo = await prisma.classes.create({
      data: {
        name: 'Amigo reconocimiento',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 10,
        display_order: 1,
        asset_code: 'HISTA',
      },
    });
    const companero = await prisma.classes.create({
      data: {
        name: 'Companero reconocimiento',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 11,
        display_order: 2,
        asset_code: 'HISTB',
      },
    });
    const explorador = await prisma.classes.create({
      data: {
        name: 'Explorador reconocimiento',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 12,
        display_order: 3,
        asset_code: 'HISTC',
      },
    });
    await prisma.class_prerequisites.create({
      data: {
        class_id: companero.class_id,
        prerequisite_class_id: amigo.class_id,
        active: true,
      },
    });
    await prisma.enrollments.create({
      data: {
        user_id: owner.user_id,
        class_id: amigo.class_id,
        ecclesiastical_year_id: pastYear.year_id,
        record_kind: 'HISTORICAL_CERTIFICATE',
        investiture_status: 'INVESTIDO',
        investiture_date: new Date('1996-06-01T00:00:00.000Z'),
        locked_for_validation: true,
        active: true,
      },
    });

    await expect(
      classes.enrollUser(owner.user_id, explorador.class_id, nextYear.year_id),
    ).rejects.toMatchObject({ code: ErrorCode.CLASS_LEVEL_TOO_HIGH });
    expect(
      await prisma.enrollments.count({
        where: { user_id: owner.user_id, class_id: explorador.class_id },
      }),
    ).toBe(0);

    const opened = await classes.enrollUser(
      owner.user_id,
      companero.class_id,
      nextYear.year_id,
    );
    expect(opened).toMatchObject({
      class_id: companero.class_id,
      record_kind: 'OPERATIONAL',
      investiture_status: 'IN_PROGRESS',
      cross_type_enrollment: false,
    });
    const historical = await prisma.enrollments.findFirstOrThrow({
      where: { user_id: owner.user_id, class_id: amigo.class_id },
    });
    expect(historical).toMatchObject({
      record_kind: 'HISTORICAL_CERTIFICATE',
      investiture_status: 'INVESTIDO',
    });

    const guideOwner = await prisma.users.create({
      data: {
        email: 'journey-gm-cross@certificate-import.test',
        name: 'Cruce',
        active: true,
        approval_status: 'approved',
      },
    });
    let guide = await prisma.classes.findFirst({ where: { asset_code: 'GM-01' } });
    if (!guide) {
      const guideType = await prisma.club_types.create({
        data: { name: 'Guías Mayores', active: true },
      });
      guide = await prisma.classes.create({
        data: {
          name: 'Guia Mayor reconocimiento',
          active: true,
          club_type_id: guideType.club_type_id,
          minimum_age: 16,
          display_order: 8,
          asset_code: 'GM-01',
        },
      });
    }
    const guideYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('1986-01-01T00:00:00.000Z'),
        end_date: new Date('1986-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const otherScaleYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('1998-01-01T00:00:00.000Z'),
        end_date: new Date('1998-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    await prisma.enrollments.create({
      data: {
        user_id: guideOwner.user_id,
        class_id: guide.class_id,
        ecclesiastical_year_id: guideYear.year_id,
        record_kind: 'HISTORICAL_CERTIFICATE',
        investiture_status: 'INVESTIDO',
        investiture_date: new Date('1986-03-01T00:00:00.000Z'),
        locked_for_validation: true,
        active: true,
      },
    });

    const cross = await classes.enrollUser(
      guideOwner.user_id,
      amigo.class_id,
      otherScaleYear.year_id,
    );
    expect(cross).toMatchObject({
      class_id: amigo.class_id,
      record_kind: 'OPERATIONAL',
      investiture_status: 'IN_PROGRESS',
      cross_type_enrollment: true,
    });
    expect(
      await prisma.enrollments.count({
        where: { user_id: guideOwner.user_id, class_id: guide.class_id },
      }),
    ).toBe(1);
  });

  it('rolls back Guía Mayor substitution when the history write fails', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-gm-rollback@certificate-import.test',
        name: 'Rollback',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-gm-rollback-reviewer@certificate-import.test',
        name: 'Revisor rollback',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    let guide = await prisma.classes.findFirst({ where: { asset_code: 'GM-01' } });
    if (!guide) {
      const clubType = await prisma.club_types.create({
        data: { name: 'Guías rollback', active: true },
      });
      guide = await prisma.classes.create({
        data: {
          name: 'Guia Mayor rollback',
          active: true,
          club_type_id: clubType.club_type_id,
          minimum_age: 16,
          display_order: 8,
          asset_code: 'GM-01',
        },
      });
    }
    const courseYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('1999-01-01T00:00:00.000Z'),
        end_date: new Date('1999-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2007-01-01T00:00:00.000Z'),
        end_date: new Date('2007-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const current = await prisma.enrollments.create({
      data: {
        user_id: owner.user_id,
        class_id: guide.class_id,
        ecclesiastical_year_id: courseYear.year_id,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
    });
    const module = await prisma.class_modules.create({
      data: {
        name: 'Modulo rollback',
        class_id: guide.class_id,
        active: true,
      },
    });
    const progress = await prisma.class_module_progress.create({
      data: {
        user_id: owner.user_id,
        class_id: guide.class_id,
        module_id: module.module_id,
        score: 4,
        enrollment_id: current.enrollment_id,
      },
    });
    const priorHistory = await prisma.investiture_validation_history.create({
      data: {
        enrollment_id: current.enrollment_id,
        action: 'SUBMITTED',
        performed_by: reviewer.user_id,
        comments: 'progreso del curso vigente',
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'SUBMITTED' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/gm-rollback.jpg',
        file_name: 'gm-rollback.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/gm-rollback.jpg',
        confirmed_at: new Date(),
      },
    });
    const item = await prisma.certificate_bulk_import_items.create({
      data: {
        batch_id: batch.batch_id,
        item_type: 'CLASS',
        class_id: guide.class_id,
        completed_at: new Date('2007-06-01T00:00:00.000Z'),
        status: 'SUBMITTED',
      },
    });

    await pool.query(`
      CREATE OR REPLACE FUNCTION fail_certificate_import_history_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $fn$
      BEGIN
        RAISE EXCEPTION 'CERTIFICATE_IMPORT_HISTORY_FORCED_FAILURE';
      END;
      $fn$
    `);
    await pool.query(
      'DROP TRIGGER IF EXISTS fail_certificate_import_history_insert ON investiture_validation_history',
    );
    await pool.query(`
      CREATE TRIGGER fail_certificate_import_history_insert
      BEFORE INSERT ON investiture_validation_history
      FOR EACH ROW
      EXECUTE FUNCTION fail_certificate_import_history_insert()
    `);

    try {
      await admin.approveItem(reviewer.user_id, batch.batch_id, item.item_id, {});
      throw new Error('expected the history write to abort the substitution');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('CERTIFICATE_IMPORT_HISTORY_FORCED_FAILURE');
    } finally {
      await pool.query(
        'DROP TRIGGER IF EXISTS fail_certificate_import_history_insert ON investiture_validation_history',
      );
      await pool.query('DROP FUNCTION IF EXISTS fail_certificate_import_history_insert()');
    }

    const kept = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: current.enrollment_id },
    });
    expect(kept).toMatchObject({
      enrollment_id: current.enrollment_id,
      ecclesiastical_year_id: courseYear.year_id,
      record_kind: 'OPERATIONAL',
      investiture_status: 'IN_PROGRESS',
      active: true,
      locked_for_validation: false,
      investiture_date: null,
    });
    const keptProgress = await prisma.class_module_progress.findUniqueOrThrow({
      where: { module_progress_id: progress.module_progress_id },
    });
    expect(keptProgress).toMatchObject({
      enrollment_id: current.enrollment_id,
      score: 4,
      active: true,
    });
    const history = await prisma.investiture_validation_history.findMany({
      where: { enrollment_id: current.enrollment_id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      history_id: priorHistory.history_id,
      action: 'SUBMITTED',
    });
    const storedItem = await prisma.certificate_bulk_import_items.findUniqueOrThrow({
      where: { item_id: item.item_id },
    });
    expect(storedItem).toMatchObject({
      status: 'SUBMITTED',
      applied_entity_id: null,
    });
    const storedBatch = await prisma.certificate_bulk_import_batches.findUniqueOrThrow({
      where: { batch_id: batch.batch_id },
    });
    expect(storedBatch.status).toBe('SUBMITTED');
    expect(
      await prisma.enrollments.count({
        where: { user_id: owner.user_id, class_id: guide.class_id },
      }),
    ).toBe(1);
  });

  it('accredits two same-year classes in reverse order without using the operational slot or another enrollment', async () => {
    const classes = new ClassesService(
      prisma as never,
      {} as never,
      { emitEvent: async () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const owner = await prisma.users.create({
      data: {
        email: 'journey-slot-owner@certificate-import.test',
        name: 'Cupo',
        active: true,
        approval_status: 'approved',
      },
    });
    const bystander = await prisma.users.create({
      data: {
        email: 'journey-slot-bystander@certificate-import.test',
        name: 'Ajeno',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-slot-reviewer@certificate-import.test',
        name: 'Revisor cupo',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Conquistadores cupo', active: true },
    });
    const year = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2010-01-01T00:00:00.000Z'),
        end_date: new Date('2010-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const amigo = await prisma.classes.create({
      data: {
        name: 'Amigo cupo',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 10,
        display_order: 1,
        asset_code: 'CUPA',
      },
    });
    const companero = await prisma.classes.create({
      data: {
        name: 'Companero cupo',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 11,
        display_order: 2,
        asset_code: 'CUPB',
      },
    });
    const explorador = await prisma.classes.create({
      data: {
        name: 'Explorador cupo',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 12,
        display_order: 3,
        asset_code: 'CUPC',
      },
    });
    await prisma.class_prerequisites.create({
      data: {
        class_id: companero.class_id,
        prerequisite_class_id: amigo.class_id,
        active: true,
      },
    });
    const foreign = await prisma.enrollments.create({
      data: {
        user_id: bystander.user_id,
        class_id: companero.class_id,
        ecclesiastical_year_id: year.year_id,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
    });

    const submittedClass = async (classId: number, completedAt: string, key: string) => {
      const batch = await prisma.certificate_bulk_import_batches.create({
        data: { user_id: owner.user_id, status: 'SUBMITTED' },
      });
      await prisma.certificate_bulk_import_files.create({
        data: {
          batch_id: batch.batch_id,
          file_url: `batches/sealed/${key}.jpg`,
          file_name: `${key}.jpg`,
          file_type: 'image/jpeg',
          uploaded_by_id: owner.user_id,
          upload_status: 'CONFIRMED',
          object_key: `batches/sealed/${key}.jpg`,
          confirmed_at: new Date(),
        },
      });
      return prisma.certificate_bulk_import_items.create({
        data: {
          batch_id: batch.batch_id,
          item_type: 'CLASS',
          class_id: classId,
          completed_at: new Date(`${completedAt}T00:00:00.000Z`),
          status: 'SUBMITTED',
        },
      });
    };

    const exploradorItem = await submittedClass(
      explorador.class_id,
      '2010-09-01',
      'slot-explorador',
    );
    const amigoItem = await submittedClass(amigo.class_id, '2010-02-01', 'slot-amigo');
    await admin.approveItem(
      reviewer.user_id,
      exploradorItem.batch_id,
      exploradorItem.item_id,
      {},
    );
    await admin.approveItem(reviewer.user_id, amigoItem.batch_id, amigoItem.item_id, {});

    const accredited = await prisma.enrollments.findMany({
      where: { user_id: owner.user_id },
      orderBy: { class_id: 'asc' },
    });
    expect(accredited).toHaveLength(2);
    expect(accredited.every((row) => row.record_kind === 'HISTORICAL_CERTIFICATE')).toBe(
      true,
    );
    expect(accredited.every((row) => row.investiture_status === 'INVESTIDO')).toBe(true);
    expect(accredited.every((row) => row.ecclesiastical_year_id === year.year_id)).toBe(
      true,
    );
    expect(
      await prisma.investiture_validation_history.count({
        where: {
          enrollment_id: { in: accredited.map((row) => row.enrollment_id) },
          action: 'INVESTIDO',
        },
      }),
    ).toBe(2);

    const keptForeign = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: foreign.enrollment_id },
    });
    expect(keptForeign).toMatchObject({
      user_id: bystander.user_id,
      class_id: companero.class_id,
      ecclesiastical_year_id: year.year_id,
      record_kind: 'OPERATIONAL',
      investiture_status: 'IN_PROGRESS',
      active: true,
    });

    const opened = await classes.enrollUser(
      owner.user_id,
      companero.class_id,
      year.year_id,
    );
    expect(opened).toMatchObject({
      class_id: companero.class_id,
      ecclesiastical_year_id: year.year_id,
      record_kind: 'OPERATIONAL',
      investiture_status: 'IN_PROGRESS',
      cross_type_enrollment: false,
    });
    expect(
      await prisma.enrollments.count({
        where: {
          user_id: owner.user_id,
          record_kind: 'OPERATIONAL',
          ecclesiastical_year_id: year.year_id,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.enrollments.count({ where: { user_id: bystander.user_id } }),
    ).toBe(1);
    const storedYear = await prisma.ecclesiastical_years.findUniqueOrThrow({
      where: { year_id: year.year_id },
    });
    expect(storedYear.active).toBe(false);
  });

  it('keeps one Guía Mayor row when substitution races a new enrollment', async () => {
    const writer = new ClassEnrollmentWriter(prisma as never);
    const owner = await prisma.users.create({
      data: {
        email: 'journey-gm-race-owner@certificate-import.test',
        name: 'Carrera GM',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-gm-race-reviewer@certificate-import.test',
        name: 'Revisor carrera',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    let guide = await prisma.classes.findFirst({ where: { asset_code: 'GM-01' } });
    if (!guide) {
      const clubType = await prisma.club_types.create({
        data: { name: 'Guías carrera', active: true },
      });
      guide = await prisma.classes.create({
        data: {
          name: 'Guia Mayor carrera',
          active: true,
          club_type_id: clubType.club_type_id,
          minimum_age: 16,
          display_order: 8,
          asset_code: 'GM-01',
        },
      });
    }
    const courseYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2011-01-01T00:00:00.000Z'),
        end_date: new Date('2011-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const certificateYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2012-01-01T00:00:00.000Z'),
        end_date: new Date('2012-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const laterYear = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2013-01-01T00:00:00.000Z'),
        end_date: new Date('2013-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const current = await prisma.enrollments.create({
      data: {
        user_id: owner.user_id,
        class_id: guide.class_id,
        ecclesiastical_year_id: courseYear.year_id,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'SUBMITTED' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/gm-race.jpg',
        file_name: 'gm-race.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/gm-race.jpg',
        confirmed_at: new Date(),
      },
    });
    const item = await prisma.certificate_bulk_import_items.create({
      data: {
        batch_id: batch.batch_id,
        item_type: 'CLASS',
        class_id: guide.class_id,
        completed_at: new Date('2012-04-04T00:00:00.000Z'),
        status: 'SUBMITTED',
      },
    });

    const settled = await Promise.allSettled([
      admin.approveItem(reviewer.user_id, batch.batch_id, item.item_id, {}),
      writer.upsert(prisma as never, {
        userId: owner.user_id,
        classId: guide.class_id,
        ecclesiasticalYearId: laterYear.year_id,
        crossType: false,
        ifExists: 'return',
      }),
    ]);

    expect(settled[0].status).toBe('fulfilled');
    expect(settled[1].status).toBe('rejected');
    if (settled[1].status === 'rejected') {
      expect(settled[1].reason).toMatchObject({
        code: ErrorCode.CLASS_ALREADY_ENROLLED,
      });
    }
    const rows = await prisma.enrollments.findMany({
      where: { user_id: owner.user_id, class_id: guide.class_id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      enrollment_id: current.enrollment_id,
      ecclesiastical_year_id: certificateYear.year_id,
      record_kind: 'HISTORICAL_CERTIFICATE',
      investiture_status: 'INVESTIDO',
      active: true,
    });
    expect(rows[0].investiture_date?.toISOString().slice(0, 10)).toBe('2012-04-04');
    expect(
      await prisma.ecclesiastical_years.findUniqueOrThrow({
        where: { year_id: certificateYear.year_id },
      }),
    ).toMatchObject({ active: false });
    expect(
      await prisma.ecclesiastical_years.findUniqueOrThrow({
        where: { year_id: laterYear.year_id },
      }),
    ).toMatchObject({ active: false });
  });

  it('invests the current enrollment when the reviewer confirms that row', async () => {
    const owner = await prisma.users.create({
      data: {
        email: 'journey-reconcile@certificate-import.test',
        name: 'Conciliar',
        active: true,
        approval_status: 'approved',
      },
    });
    const reviewer = await prisma.users.create({
      data: {
        email: 'journey-reconcile-reviewer@certificate-import.test',
        name: 'Revisor conciliar',
        active: true,
        approval_status: 'approved',
      },
    });
    const role = await prisma.roles.findFirstOrThrow({
      where: { role_name: 'super-admin' },
    });
    await prisma.users_roles.create({
      data: { user_id: reviewer.user_id, role_id: role.role_id, active: true },
    });
    const clubType = await prisma.club_types.create({
      data: { name: 'Conquistadores conciliar', active: true },
    });
    const year = await prisma.ecclesiastical_years.create({
      data: {
        start_date: new Date('2014-01-01T00:00:00.000Z'),
        end_date: new Date('2014-12-31T00:00:00.000Z'),
        active: false,
      },
    });
    const amigo = await prisma.classes.create({
      data: {
        name: 'Amigo conciliar',
        active: true,
        club_type_id: clubType.club_type_id,
        minimum_age: 10,
        display_order: 1,
        asset_code: 'RECON',
      },
    });
    const started = new Date('2014-02-01T00:00:00.000Z');
    const current = await prisma.enrollments.create({
      data: {
        user_id: owner.user_id,
        class_id: amigo.class_id,
        ecclesiastical_year_id: year.year_id,
        enrollment_date: started,
        investiture_status: 'IN_PROGRESS',
        record_kind: 'OPERATIONAL',
        active: true,
      },
    });
    const module = await prisma.class_modules.create({
      data: { name: 'Modulo conciliar', class_id: amigo.class_id, active: true },
    });
    const progress = await prisma.class_module_progress.create({
      data: {
        user_id: owner.user_id,
        class_id: amigo.class_id,
        module_id: module.module_id,
        score: 4,
        enrollment_id: current.enrollment_id,
      },
    });
    const batch = await prisma.certificate_bulk_import_batches.create({
      data: { user_id: owner.user_id, status: 'SUBMITTED' },
    });
    await prisma.certificate_bulk_import_files.create({
      data: {
        batch_id: batch.batch_id,
        file_url: 'batches/sealed/reconcile.jpg',
        file_name: 'reconcile.jpg',
        file_type: 'image/jpeg',
        uploaded_by_id: owner.user_id,
        upload_status: 'CONFIRMED',
        object_key: 'batches/sealed/reconcile.jpg',
        confirmed_at: new Date(),
      },
    });
    const item = await prisma.certificate_bulk_import_items.create({
      data: {
        batch_id: batch.batch_id,
        item_type: 'CLASS',
        class_id: amigo.class_id,
        completed_at: new Date('2014-08-20T00:00:00.000Z'),
        status: 'SUBMITTED',
      },
    });

    await expect(
      admin.approveItem(reviewer.user_id, batch.batch_id, item.item_id, {}),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ENROLLMENT_RECONCILIATION_REQUIRED');
    await expect(
      admin.approveItem(reviewer.user_id, batch.batch_id, item.item_id, {
        reconcile_enrollment_id: current.enrollment_id + 99,
        expected_modified_at: current.modified_at.toISOString(),
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ENROLLMENT_MISMATCH');
    await expect(
      admin.approveItem(reviewer.user_id, batch.batch_id, item.item_id, {
        reconcile_enrollment_id: current.enrollment_id,
        expected_modified_at: '1990-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ENROLLMENT_VERSION_CONFLICT');

    const fresh = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: current.enrollment_id },
    });
    await admin.approveItem(reviewer.user_id, batch.batch_id, item.item_id, {
      reconcile_enrollment_id: fresh.enrollment_id,
      expected_modified_at: fresh.modified_at.toISOString(),
    });

    const invested = await prisma.enrollments.findUniqueOrThrow({
      where: { enrollment_id: current.enrollment_id },
    });
    expect(invested).toMatchObject({
      enrollment_id: current.enrollment_id,
      record_kind: 'OPERATIONAL',
      investiture_status: 'INVESTIDO',
      ecclesiastical_year_id: year.year_id,
      active: true,
      locked_for_validation: true,
    });
    expect(invested.enrollment_date.toISOString()).toBe(started.toISOString());
    expect(invested.investiture_date?.toISOString().slice(0, 10)).toBe('2014-08-20');
    const keptProgress = await prisma.class_module_progress.findUniqueOrThrow({
      where: { module_progress_id: progress.module_progress_id },
    });
    expect(keptProgress).toMatchObject({
      enrollment_id: current.enrollment_id,
      score: 4,
    });
    expect(
      await prisma.investiture_validation_history.count({
        where: { enrollment_id: current.enrollment_id, action: 'INVESTIDO' },
      }),
    ).toBe(1);
    expect(
      await prisma.enrollments.count({
        where: { user_id: owner.user_id, class_id: amigo.class_id },
      }),
    ).toBe(1);
  });
});
