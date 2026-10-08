import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CertificateBulkImportApplicationService } from './certificate-bulk-imports-application.service';
import { BadRequestException } from '@nestjs/common';

const certificateScenarios = JSON.parse(
  readFileSync(
    join(__dirname, '../../test/fixtures/certificate-import/scenarios.json'),
    'utf8',
  ),
) as {
  memberId: string;
  classes: Record<
    string,
    {
      classId: number;
      name: string;
      assetCode: string;
      institutionalReview?: boolean;
    }
  >;
  scenarios: Array<Record<string, unknown>>;
};

describe('CertificateBulkImportApplicationService', () => {
  const batchFiles = [
    {
      file_url: 'https://cdn.sacdia.app/cert.jpg',
      file_name: 'cert.jpg',
      file_type: 'image/jpeg',
      uploaded_by_id: 'member-1',
    },
  ];

  const tx = {
    certificate_bulk_import_items: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    certificate_bulk_import_batches: {
      update: jest.fn(),
    },
    users_honors: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    evidence_files: {
      createMany: jest.fn(),
    },
    ecclesiastical_years: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    classes: {
      findUnique: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
    enrollments: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    investiture_validation_history: {
      create: jest.fn(),
    },
    certificate_bulk_import_item_events: {
      create: jest.fn(),
    },
    investiture_authorization_people: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
    },
  };

  const prisma = {
    ...tx,
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  let service: CertificateBulkImportApplicationService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    service = new CertificateBulkImportApplicationService(prisma as any);
    tx.certificate_bulk_import_batches.update.mockResolvedValue({});
    tx.certificate_bulk_import_items.count.mockResolvedValue(0);
    tx.certificate_bulk_import_items.updateMany.mockResolvedValue({ count: 1 });
    tx.users.findUnique.mockResolvedValue({
      birthday: new Date('1990-01-01T00:00:00.000Z'),
    });
    tx.classes.findUnique.mockResolvedValue({
      asset_code: 'CQ-03',
      minimum_age: 10,
      active: true,
    });
    tx.enrollments.findMany.mockResolvedValue([]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([]);
    tx.investiture_authorization_people.updateMany.mockResolvedValue({
      count: 0,
    });
    delete (tx as { $executeRaw?: unknown }).$executeRaw;
  });

  it('approves an HONOR item into users_honors and evidence_files', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'SUBMITTED',
      item_type: 'HONOR',
      honor_id: 10,
      completed_at: new Date('2026-04-12T00:00:00.000Z'),
      applied_entity_id: null,
      batch: {
        batch_id: 'batch-1',
        user_id: 'member-1',
        files: batchFiles,
      },
    });
    tx.users_honors.findFirst.mockResolvedValue(null);
    tx.users_honors.create.mockResolvedValue({ user_honor_id: 50 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-1',
      status: 'APPROVED',
      applied_entity_type: 'USER_HONOR',
      applied_entity_id: 50,
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-1', {
      comment: 'Aprobado',
    });

    expect(tx.users_honors.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'member-1',
          honor_id: 10,
          validate: true,
          validation_status: 'APPROVED',
          validated_by_id: 'reviewer-1',
          certificate: 'https://cdn.sacdia.app/cert.jpg',
        }),
      }),
    );
    expect(tx.evidence_files.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          user_honor_id: 50,
          file_url: 'https://cdn.sacdia.app/cert.jpg',
        }),
      ],
      skipDuplicates: true,
    });
    expect(tx.certificate_bulk_import_items.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          applied_entity_type: 'USER_HONOR',
          applied_entity_id: 50,
        }),
      }),
    );
  });

  it('reuses an existing active HONOR row without duplicating it', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'SUBMITTED',
      item_type: 'HONOR',
      honor_id: 10,
      completed_at: new Date('2026-04-12T00:00:00.000Z'),
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.users_honors.findFirst.mockResolvedValue({
      user_honor_id: 77,
      active: true,
    });
    tx.users_honors.update.mockResolvedValue({ user_honor_id: 77 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-1',
      status: 'APPROVED',
      applied_entity_id: 77,
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-1', {});

    expect(tx.users_honors.create).not.toHaveBeenCalled();
    expect(tx.users_honors.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_honor_id: 77 } }),
    );
  });

  it('approves a CLASS item into enrollments and investiture history', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-2',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2026-04-12T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2026,
        start_date: new Date('2026-01-01T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
        active: true,
      },
    ]);
    tx.enrollments.findFirst.mockResolvedValue(null);
    tx.enrollments.create.mockResolvedValue({ enrollment_id: 90 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-2',
      status: 'APPROVED',
      applied_entity_type: 'ENROLLMENT',
      applied_entity_id: 90,
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-2', {
      comment: 'Clase validada por comprobante',
    });

    expect(tx.enrollments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'member-1',
          class_id: 4,
          ecclesiastical_year_id: 2026,
          record_kind: 'HISTORICAL_CERTIFICATE',
          investiture_status: 'INVESTIDO',
          investiture_date: new Date('2026-04-12T00:00:00.000Z'),
          validated_by: 'reviewer-1',
          submitted_for_validation: false,
        }),
      }),
    );
    expect(tx.investiture_validation_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enrollment_id: 90,
        action: 'INVESTIDO',
        performed_by: 'reviewer-1',
      }),
    });
  });

  it('is idempotent when an item was already applied', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'APPROVED',
      item_type: 'HONOR',
      applied_entity_type: 'USER_HONOR',
      applied_entity_id: 50,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });

    await expect(
      service.approveItem('reviewer-1', 'batch-1', 'item-1', {}),
    ).resolves.toMatchObject({ applied_entity_id: 50 });

    expect(tx.users_honors.create).not.toHaveBeenCalled();
    expect(tx.enrollments.create).not.toHaveBeenCalled();
  });

  it('does not approve an item that was not submitted for review', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'READY',
      item_type: 'HONOR',
      honor_id: 10,
      completed_at: new Date('2026-04-12T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });

    await expect(
      service.approveItem('reviewer-1', 'batch-1', 'item-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.certificate_bulk_import_items.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          item_id: 'item-1',
          batch_id: 'batch-1',
          OR: expect.arrayContaining([
            { status: { in: ['SUBMITTED', 'RESUBMITTED'] } },
          ]),
        }),
      }),
    );

    expect(tx.users_honors.create).not.toHaveBeenCalled();
    expect(tx.enrollments.create).not.toHaveBeenCalled();
  });

  it('accredits an independent CLASS as INVESTIDO on the certificate date without a current enrollment', async () => {
    const scenario = certificateScenarios.scenarios.find(
      (entry) => entry.id === 'no-current-enrollment',
    );
    const completedAt = new Date('2016-08-20T00:00:00.000Z');
    const explorador = certificateScenarios.classes.explorador;

    expect(scenario).toMatchObject({ currentEnrollment: null });

    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-explorador',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: explorador.classId,
      completed_at: completedAt,
      applied_entity_id: null,
      batch: {
        batch_id: 'batch-1',
        user_id: certificateScenarios.memberId,
        files: batchFiles,
      },
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2016,
        start_date: new Date('2016-01-01T00:00:00.000Z'),
        end_date: new Date('2016-12-31T00:00:00.000Z'),
        active: false,
      },
    ]);
    tx.enrollments.findFirst.mockResolvedValue(null);
    tx.enrollments.create.mockResolvedValue({ enrollment_id: 91 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-explorador',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-explorador', {});

    expect(tx.enrollments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          class_id: explorador.classId,
          ecclesiastical_year_id: 2016,
          investiture_status: 'INVESTIDO',
          investiture_date: completedAt,
        }),
      }),
    );
    expect(tx.investiture_validation_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'INVESTIDO',
      }),
    });
    expect(tx.certificate_bulk_import_items.updateMany).toHaveBeenCalledWith({
      where: {
        item_id: 'item-explorador',
        active: true,
        status: { in: ['SUBMITTED', 'RESUBMITTED'] },
        applied_entity_id: null,
      },
      data: { revision: { increment: 1 } },
    });
  });

  it('does not accredit again when another review already claimed the row', async () => {
    const completedAt = new Date('2016-08-20T00:00:00.000Z');
    const submitted = {
      item_id: 'item-explorador',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: certificateScenarios.classes.explorador.classId,
      completed_at: completedAt,
      applied_entity_id: null,
      batch: {
        batch_id: 'batch-1',
        user_id: certificateScenarios.memberId,
        files: batchFiles,
      },
    };
    tx.certificate_bulk_import_items.findFirst
      .mockResolvedValueOnce(submitted)
      .mockResolvedValueOnce({
        ...submitted,
        status: 'APPROVED',
        applied_entity_id: 91,
      });
    tx.certificate_bulk_import_items.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.approveItem('reviewer-1', 'batch-1', 'item-explorador', {}),
    ).resolves.toMatchObject({ applied_entity_id: 91, status: 'APPROVED' });

    expect(tx.enrollments.create).not.toHaveBeenCalled();
    expect(tx.investiture_validation_history.create).not.toHaveBeenCalled();
  });

  it('replaces the current Guía Mayor enrollment instead of keeping two rows', async () => {
    const guiaMayor = certificateScenarios.classes.guiaMayor;
    const completedAt = new Date('2004-03-15T00:00:00.000Z');

    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-gm',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: guiaMayor.classId,
      completed_at: completedAt,
      applied_entity_id: null,
      class: guiaMayor,
      batch: {
        batch_id: 'batch-gm',
        user_id: certificateScenarios.memberId,
        files: batchFiles,
      },
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2004,
        start_date: new Date('2004-01-01T00:00:00.000Z'),
        end_date: new Date('2004-12-31T00:00:00.000Z'),
        active: false,
      },
    ]);
    tx.classes.findUnique.mockResolvedValue({
      asset_code: 'GM-01',
      minimum_age: 10,
      active: true,
    });
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 15,
        ecclesiastical_year_id: 2026,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
      },
    ]);
    tx.enrollments.create.mockResolvedValue({ enrollment_id: 99 });
    tx.enrollments.update.mockResolvedValue({ enrollment_id: 15 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-gm',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-gm', 'item-gm', {
      comment: 'Sustituir inscripción GM actual',
    });

    expect(tx.enrollments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enrollment_id: 15 },
        data: expect.objectContaining({
          ecclesiastical_year_id: 2004,
          investiture_status: 'INVESTIDO',
          investiture_date: completedAt,
        }),
      }),
    );
    expect(tx.enrollments.create).not.toHaveBeenCalled();
  });

  it.each(['guiaMayorAvanzado', 'instructor'] as const)(
    'does not create an enrollment when Campo Local approves %s',
    async (classKey) => {
      const discontinued = certificateScenarios.classes[classKey];

      tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
        item_id: `item-${classKey}`,
        status: 'SUBMITTED',
        item_type: 'CLASS',
        class_id: discontinued.classId,
        completed_at: new Date('2008-07-07T00:00:00.000Z'),
        applied_entity_id: null,
        class: discontinued,
        batch: {
          batch_id: 'batch-institutional',
          user_id: certificateScenarios.memberId,
          files: batchFiles,
        },
      });
      tx.ecclesiastical_years.findMany.mockResolvedValue([
        {
          year_id: 2008,
          start_date: new Date('2008-01-01T00:00:00.000Z'),
          end_date: new Date('2008-12-31T00:00:00.000Z'),
          active: false,
        },
      ]);
      tx.classes.findUnique.mockResolvedValue({
        asset_code: discontinued.assetCode,
        minimum_age: 16,
        active: false,
      });
      tx.enrollments.findMany.mockResolvedValue([]);
      tx.enrollments.create.mockResolvedValue({ enrollment_id: 100 });
      tx.certificate_bulk_import_items.update.mockResolvedValue({
        item_id: `item-${classKey}`,
        status: 'APPROVED',
      });

      await expect(
        service.approveItem(
          'reviewer-1',
          'batch-institutional',
          `item-${classKey}`,
          {},
        ),
      ).rejects.toThrow('CERTIFICATE_IMPORT_INSTITUTIONAL_REVIEW_REQUIRED');

      expect(tx.enrollments.create).not.toHaveBeenCalled();
      expect(tx.enrollments.update).not.toHaveBeenCalled();
    },
  );

  it('does not overwrite an approved honor when the certificate date differs', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'SUBMITTED',
      item_type: 'HONOR',
      honor_id: 10,
      completed_at: new Date('2026-04-12T00:00:00.000Z'),
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.users_honors.findFirst.mockResolvedValue({
      user_honor_id: 77,
      active: true,
      date: new Date('2010-01-01T00:00:00.000Z'),
      validation_status: 'APPROVED',
    });

    await expect(
      service.approveItem('reviewer-1', 'batch-1', 'item-1', {}),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FINAL_DATE_CONFLICT');

    expect(tx.users_honors.update).not.toHaveBeenCalled();
  });

  it('links an identical honor without changing its original date or validator', async () => {
    const completedAt = new Date('2026-04-12T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'SUBMITTED',
      item_type: 'HONOR',
      honor_id: 10,
      completed_at: completedAt,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.users_honors.findFirst.mockResolvedValue({
      user_honor_id: 77,
      active: true,
      date: completedAt,
      validation_status: 'APPROVED',
    });
    tx.users_honors.update.mockResolvedValue({ user_honor_id: 77 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-1',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-1', {});

    expect(tx.users_honors.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          active: true,
          certificate: batchFiles[0].file_url,
          images: [batchFiles[0].file_url],
        },
      }),
    );
  });

  it('does not convert an ordinary in-progress enrollment into a historical fact', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-2',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 3,
      completed_at: new Date('2016-08-20T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2016,
        start_date: new Date('2016-01-01T00:00:00.000Z'),
        end_date: new Date('2016-12-31T00:00:00.000Z'),
        active: false,
      },
    ]);
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2016,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
      },
    ]);

    await expect(
      service.approveItem('reviewer-1', 'batch-1', 'item-2', {}),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ENROLLMENT_RECONCILIATION_REQUIRED');

    expect(tx.enrollments.create).not.toHaveBeenCalled();
    expect(tx.enrollments.update).not.toHaveBeenCalled();
    expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
  });

  it('invests the matching operational enrollment and keeps its kind', async () => {
    const modifiedAt = new Date('2016-01-02T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-2',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 3,
      completed_at: new Date('2016-08-20T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2016,
        start_date: new Date('2016-01-01T00:00:00.000Z'),
        end_date: new Date('2016-12-31T00:00:00.000Z'),
        active: false,
      },
    ]);
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2016,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: modifiedAt,
      },
    ]);
    tx.enrollments.updateMany.mockResolvedValue({ count: 1 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-2',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-2', {
      reconcile_enrollment_id: 40,
      expected_modified_at: modifiedAt.toISOString(),
    });

    const write = tx.enrollments.updateMany.mock.calls[0][0];
    expect(write.where).toMatchObject({
      enrollment_id: 40,
      record_kind: 'OPERATIONAL',
      ecclesiastical_year_id: 2016,
    });
    expect(write.data.investiture_status).toBe('INVESTIDO');
    expect(write.data).not.toHaveProperty('record_kind');
    expect(write.data).not.toHaveProperty('enrollment_date');
    expect(tx.enrollments.create).not.toHaveBeenCalled();
  });

  it('keeps the batch submitted while another row is still open', async () => {
    tx.certificate_bulk_import_items.count.mockResolvedValueOnce(1);

    await expect(
      service.resolveBatchStatus(tx as never, 'batch-1'),
    ).resolves.toBe('SUBMITTED');
  });

  it('asks for correction only after every row has been decided and one was rejected', async () => {
    tx.certificate_bulk_import_items.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    await expect(
      service.resolveBatchStatus(tx as never, 'batch-1'),
    ).resolves.toBe('NEEDS_CORRECTION');
  });

  it('blocks an Amigo certificate from 2025 when the person was 9 at that year start', async () => {
    const pending2026 = {
      enrollment_id: 77,
      ecclesiastical_year_id: 2026,
      investiture_status: 'IN_PROGRESS',
      investiture_date: null,
      record_kind: 'OPERATIONAL',
      modified_at: new Date('2026-02-01T00:00:00.000Z'),
    };
    tx.users.findUnique.mockResolvedValue({
      birthday: new Date('2016-01-01T00:00:00.000Z'),
    });
    tx.classes.findUnique.mockResolvedValue({
      asset_code: 'CQ-01',
      minimum_age: 10,
      active: true,
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo-2025',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 1,
      completed_at: new Date('2025-06-01T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-2016', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2025,
        start_date: new Date('2025-01-01T00:00:00.000Z'),
        end_date: new Date('2025-12-31T00:00:00.000Z'),
        active: false,
      },
    ]);
    tx.enrollments.findMany.mockResolvedValue([pending2026]);
    tx.enrollments.create.mockResolvedValue({ enrollment_id: 501 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-amigo-2025',
      status: 'APPROVED',
    });

    await expect(
      service.approveItem('reviewer-1', 'batch-1', 'item-amigo-2025', {}),
    ).rejects.toMatchObject({
      code: 'CERTIFICATE_IMPORT_AGE_BELOW_MINIMUM',
    });

    expect(tx.enrollments.create).not.toHaveBeenCalled();
    expect(tx.enrollments.update).not.toHaveBeenCalled();
    expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
    expect(tx.investiture_validation_history.create).not.toHaveBeenCalled();
  });

  it('marks the batch approved when the last reviewable item is approved', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-2',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2026-04-12T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2026,
        start_date: new Date('2026-01-01T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
        active: true,
      },
    ]);
    tx.enrollments.create.mockResolvedValue({ enrollment_id: 90 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-2',
      status: 'APPROVED',
    });
    tx.certificate_bulk_import_items.count.mockResolvedValue(0);

    await service.approveItem('reviewer-1', 'batch-1', 'item-2', {});

    expect(tx.certificate_bulk_import_batches.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
  });

  const yearRow = (yearId: number, start: string, active = false) => ({
    year_id: yearId,
    start_date: new Date(`${start}T00:00:00.000Z`),
    end_date: new Date(`${start.slice(0, 4)}-12-31T00:00:00.000Z`),
    active,
  });

  function pendingPerson(
    personId: string,
    enrollmentId: number,
    enrollmentYearId: number,
    requestYearId = enrollmentYearId,
  ) {
    return {
      person_id: personId,
      enrollment_id: enrollmentId,
      request: { ecclesiastical_year_id: requestYearId },
      enrollment: {
        ecclesiastical_year_id: enrollmentYearId,
        record_kind: 'OPERATIONAL',
      },
    };
  }

  it('C-1 rejects a same-year certificate while that class is PENDING', async () => {
    const modifiedAt = new Date('2026-02-01T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2026-06-01T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockImplementation(
      async (args: { where?: { year_id?: { in?: number[] } } }) =>
        args?.where?.year_id?.in
          ? [yearRow(2026, '2026-01-01', true)]
          : [yearRow(2026, '2026-01-01', true)],
    );
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2026,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: modifiedAt,
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      pendingPerson('person-pedro', 40, 2026),
    ]);
    tx.enrollments.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {
        reconcile_enrollment_id: 40,
        expected_modified_at: modifiedAt.toISOString(),
      }),
    ).rejects.toMatchObject({
      code: 'CERTIFICATE_IMPORT_AUTHORIZATION_PENDING',
    });

    expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
    expect(tx.enrollments.update).not.toHaveBeenCalled();
    expect(tx.enrollments.create).not.toHaveBeenCalled();
    expect(tx.investiture_validation_history.create).not.toHaveBeenCalled();
    expect(
      tx.certificate_bulk_import_item_events.create,
    ).not.toHaveBeenCalled();
    expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();
    expect(
      tx.investiture_authorization_people.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('C-1 still accredits a same-year certificate when nothing is PENDING', async () => {
    const modifiedAt = new Date('2026-02-01T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2026-06-01T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      yearRow(2026, '2026-01-01', true),
    ]);
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2026,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: modifiedAt,
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([]);
    tx.enrollments.updateMany.mockResolvedValue({ count: 1 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {
      reconcile_enrollment_id: 40,
      expected_modified_at: modifiedAt.toISOString(),
    });

    expect(tx.enrollments.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ investiture_status: 'INVESTIDO' }),
      }),
    );
    expect(
      tx.investiture_authorization_people.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('C-1 accredits a same-year certificate after the request was removed', async () => {
    const modifiedAt = new Date('2026-02-01T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2026-06-01T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      yearRow(2026, '2026-01-01', true),
    ]);
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2026,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: modifiedAt,
      },
    ]);
    tx.investiture_authorization_people.findMany.mockImplementation(
      async (args: { where?: { status?: string } }) =>
        args?.where?.status === 'PENDING' ? [] : [{ status: 'REMOVED' }],
    );
    tx.enrollments.updateMany.mockResolvedValue({ count: 1 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {
      reconcile_enrollment_id: 40,
      expected_modified_at: modifiedAt.toISOString(),
    });

    expect(
      tx.enrollments.updateMany.mock.calls[0][0].data.investiture_status,
    ).toBe('INVESTIDO');
  });

  it('C1-H1 rejects a certificate of the request year when the enrollment started earlier', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2026-06-01T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockImplementation(
      async (args: { where?: { year_id?: { in?: number[] } } }) =>
        args?.where?.year_id?.in
          ? [yearRow(2025, '2025-01-01'), yearRow(2026, '2026-01-01', true)]
          : [yearRow(2026, '2026-01-01', true)],
    );
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2025,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: new Date('2025-02-01T00:00:00.000Z'),
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      pendingPerson('person-pedro', 40, 2025, 2026),
    ]);

    await expect(
      service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {}),
    ).rejects.toMatchObject({
      code: 'CERTIFICATE_IMPORT_AUTHORIZATION_PENDING',
    });
    expect(tx.enrollments.create).not.toHaveBeenCalled();
    expect(tx.enrollments.update).not.toHaveBeenCalled();
    expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
    expect(
      tx.investiture_authorization_people.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('C1-H1 retires a pending request when the certificate matches the enrollment start and not the request year', async () => {
    const completedAt = new Date('2025-06-01T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: completedAt,
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockImplementation(
      async (args: { where?: { year_id?: { in?: number[] } } }) =>
        args?.where?.year_id?.in
          ? [yearRow(2025, '2025-01-01'), yearRow(2026, '2026-01-01', true)]
          : [yearRow(2025, '2025-01-01')],
    );
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2025,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: new Date('2025-02-01T00:00:00.000Z'),
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      pendingPerson('person-pedro', 40, 2025, 2026),
    ]);
    tx.enrollments.updateMany.mockResolvedValue({ count: 1 });
    tx.investiture_authorization_people.updateMany.mockResolvedValue({
      count: 1,
    });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {
      reconcile_enrollment_id: 40,
      expected_modified_at: '2025-02-01T00:00:00.000Z',
    });

    expect(tx.investiture_authorization_people.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REMOVED',
          resolution_code: 'HISTORICAL_CERTIFICATE_APPLIED',
        }),
      }),
    );
  });

  it('C1-H1 rejects a Guía Mayor certificate of the request year without converting the enrollment', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-gm',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 8,
      completed_at: new Date('2026-06-01T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-gm', user_id: 'member-1', files: batchFiles },
    });
    tx.users.findUnique.mockResolvedValue({
      birthday: new Date('1980-01-01T00:00:00.000Z'),
    });
    tx.classes.findUnique.mockResolvedValue({
      asset_code: 'GM-01',
      minimum_age: 16,
      active: true,
    });
    tx.ecclesiastical_years.findMany.mockImplementation(
      async (args: { where?: { year_id?: { in?: number[] } } }) =>
        args?.where?.year_id?.in
          ? [yearRow(2025, '2025-01-01'), yearRow(2026, '2026-01-01', true)]
          : [yearRow(2026, '2026-01-01', true)],
    );
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 15,
        ecclesiastical_year_id: 2025,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: new Date('2025-01-02T00:00:00.000Z'),
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      pendingPerson('person-ana', 15, 2025, 2026),
    ]);

    await expect(
      service.approveItem('reviewer-1', 'batch-gm', 'item-gm', {}),
    ).rejects.toMatchObject({
      code: 'CERTIFICATE_IMPORT_AUTHORIZATION_PENDING',
    });
    expect(tx.enrollments.update).not.toHaveBeenCalled();
    expect(
      tx.investiture_authorization_people.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('C1-H1 still retires a 2019 certificate against a later request year', async () => {
    const completedAt = new Date('2019-06-01T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: completedAt,
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockImplementation(
      async (args: { where?: { year_id?: { in?: number[] } } }) =>
        args?.where?.year_id?.in
          ? [yearRow(2019, '2019-01-01'), yearRow(2026, '2026-01-01', true)]
          : [yearRow(2019, '2019-01-01')],
    );
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2025,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: new Date('2025-02-01T00:00:00.000Z'),
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      pendingPerson('person-pedro', 40, 2025, 2026),
    ]);
    tx.enrollments.create.mockResolvedValue({ enrollment_id: 77 });
    tx.investiture_authorization_people.updateMany.mockResolvedValue({
      count: 1,
    });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {});

    expect(tx.investiture_authorization_people.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolution_code: 'HISTORICAL_CERTIFICATE_APPLIED',
        }),
      }),
    );
    expect(tx.enrollments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          record_kind: 'HISTORICAL_CERTIFICATE',
          investiture_status: 'INVESTIDO',
        }),
      }),
    );
  });

  it('C-1 accredits an earlier Guía Mayor certificate and retires the pending person', async () => {
    const completedAt = new Date('2004-03-15T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-gm',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 8,
      completed_at: completedAt,
      applied_entity_id: null,
      batch: { batch_id: 'batch-gm', user_id: 'member-1', files: batchFiles },
    });
    tx.users.findUnique.mockResolvedValue({
      birthday: new Date('1980-01-01T00:00:00.000Z'),
    });
    tx.classes.findUnique.mockResolvedValue({
      asset_code: 'GM-01',
      minimum_age: 16,
      active: true,
    });
    tx.ecclesiastical_years.findMany.mockImplementation(
      async (args: { where?: { year_id?: { in?: number[] } } }) =>
        args?.where?.year_id?.in
          ? [yearRow(2004, '2004-01-01'), yearRow(2026, '2026-01-01', true)]
          : [yearRow(2004, '2004-01-01')],
    );
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 15,
        ecclesiastical_year_id: 2026,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      pendingPerson('person-ana', 15, 2026),
    ]);
    tx.enrollments.update.mockResolvedValue({ enrollment_id: 15 });
    tx.investiture_authorization_people.updateMany.mockResolvedValue({
      count: 1,
    });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-gm',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-gm', 'item-gm', {});

    expect(tx.enrollments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enrollment_id: 15 },
        data: expect.objectContaining({
          ecclesiastical_year_id: 2004,
          record_kind: 'HISTORICAL_CERTIFICATE',
          investiture_status: 'INVESTIDO',
        }),
      }),
    );
    expect(tx.investiture_authorization_people.updateMany).toHaveBeenCalledWith(
      {
        where: { person_id: { in: ['person-ana'] }, status: 'PENDING' },
        data: {
          status: 'REMOVED',
          resolution_code: 'HISTORICAL_CERTIFICATE_APPLIED',
          system_reason:
            'Investidura aplicada por certificado de un año anterior',
          rejection_reason: null,
        },
      },
    );
    expect(
      JSON.stringify(tx.investiture_authorization_people.updateMany.mock.calls),
    ).not.toContain('Falta de requisitos');
  });

  it('C-1 accredits an earlier class certificate and retires the pending person', async () => {
    const completedAt = new Date('2019-06-01T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: completedAt,
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockImplementation(
      async (args: { where?: { year_id?: { in?: number[] } } }) =>
        args?.where?.year_id?.in
          ? [yearRow(2019, '2019-01-01'), yearRow(2026, '2026-01-01', true)]
          : [yearRow(2019, '2019-01-01')],
    );
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2026,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      pendingPerson('person-pedro', 40, 2026),
    ]);
    tx.enrollments.create.mockResolvedValue({ enrollment_id: 90 });
    tx.investiture_authorization_people.updateMany.mockResolvedValue({
      count: 1,
    });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {});

    expect(tx.enrollments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ecclesiastical_year_id: 2019,
          record_kind: 'HISTORICAL_CERTIFICATE',
          investiture_status: 'INVESTIDO',
        }),
      }),
    );
    expect(tx.enrollments.update).not.toHaveBeenCalled();
    expect(tx.investiture_authorization_people.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REMOVED',
          resolution_code: 'HISTORICAL_CERTIFICATE_APPLIED',
          system_reason:
            'Investidura aplicada por certificado de un año anterior',
        }),
      }),
    );
  });

  it('C-1 locks the user before each enrollment inside certificate approval', async () => {
    const keys: string[] = [];
    (tx as { $executeRaw?: unknown }).$executeRaw = jest.fn(
      async (query: { values?: unknown[] }) => {
        const value = query?.values?.[0];
        if (typeof value === 'string') keys.push(value);
        return 0;
      },
    );
    const modifiedAt = new Date('2026-02-01T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2026-06-01T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      yearRow(2026, '2026-01-01', true),
    ]);
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 20,
        ecclesiastical_year_id: 2026,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: modifiedAt,
      },
      {
        enrollment_id: 5,
        ecclesiastical_year_id: 2026,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: modifiedAt,
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      pendingPerson('person-pedro', 5, 2026),
    ]);

    await expect(
      service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {
        reconcile_enrollment_id: 5,
        expected_modified_at: modifiedAt.toISOString(),
      }),
    ).rejects.toMatchObject({
      code: 'CERTIFICATE_IMPORT_AUTHORIZATION_PENDING',
    });

    expect(keys[0]).toContain('investiture-authorization-year:2026');
    expect(keys[1]).toContain('investiture-authorization-user:member-1');
    expect(keys[2]).toContain('investiture-authorization-enrollment:5');
    expect(keys[3]).toContain('investiture-authorization-enrollment:20');
    expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
  });

  it('C1R-N2 closes an ended request and accredits a later certificate', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2026-06-01T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findMany.mockImplementation(
      async (args: { where?: { year_id?: { in?: number[] } } }) =>
        args?.where?.year_id?.in
          ? [yearRow(2025, '2025-01-01'), yearRow(2026, '2026-01-01', true)]
          : [yearRow(2026, '2026-01-01', true)],
    );
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2025,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: new Date('2025-02-01T00:00:00.000Z'),
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      pendingPerson('person-pedro', 40, 2025, 2025),
    ]);
    tx.enrollments.create.mockResolvedValue({ enrollment_id: 91 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {});

    expect(tx.investiture_authorization_people.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'CLOSED_YEAR',
          resolution_code: 'CLOSED_YEAR',
        },
      }),
    );
    expect(tx.enrollments.create).toHaveBeenCalled();
    expect(
      JSON.stringify(tx.investiture_authorization_people.updateMany.mock.calls),
    ).not.toContain('Falta de requisitos para investidura');
  });

  it('C1R-N2 closes an ended Guía Mayor request instead of leaving it pending', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-gm',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 8,
      completed_at: new Date('2026-06-01T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-gm', user_id: 'member-1', files: batchFiles },
    });
    tx.users.findUnique.mockResolvedValue({
      birthday: new Date('1980-01-01T00:00:00.000Z'),
    });
    tx.classes.findUnique.mockResolvedValue({
      asset_code: 'GM-01',
      minimum_age: 16,
      active: true,
    });
    tx.ecclesiastical_years.findMany.mockImplementation(
      async (args: { where?: { year_id?: { in?: number[] } } }) =>
        args?.where?.year_id?.in
          ? [yearRow(2025, '2025-01-01'), yearRow(2026, '2026-01-01', true)]
          : [yearRow(2026, '2026-01-01', true)],
    );
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 15,
        ecclesiastical_year_id: 2025,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: new Date('2025-01-02T00:00:00.000Z'),
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      pendingPerson('person-ana', 15, 2025, 2025),
    ]);
    tx.enrollments.update.mockResolvedValue({ enrollment_id: 15 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-gm',
      status: 'APPROVED',
    });

    await service.approveItem('reviewer-1', 'batch-gm', 'item-gm', {});

    expect(tx.investiture_authorization_people.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'CLOSED_YEAR',
          resolution_code: 'CLOSED_YEAR',
        },
      }),
    );
    expect(tx.enrollments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          record_kind: 'HISTORICAL_CERTIFICATE',
          investiture_status: 'INVESTIDO',
        }),
      }),
    );
  });

  const LATER_CERTIFICATE_NOTE =
    'Investidura acreditada posteriormente mediante certificado validado';

  function endedSameYearPerson(status: 'CLOSED_YEAR' | 'PENDING') {
    return {
      person_id: 'person-pedro',
      enrollment_id: 40,
      status,
      request: {
        ecclesiastical_year_id: 2025,
        club_section_id: 4,
      },
      enrollment: {
        ecclesiastical_year_id: 2025,
        record_kind: 'OPERATIONAL',
      },
    };
  }

  function stubEndedSameYearApproval(
    roleName: string | null,
    localFieldId: number | null,
  ) {
    const modifiedAt = new Date('2025-02-01T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2025-06-01T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.users.findUnique.mockResolvedValue({
      birthday: new Date('1990-01-01T00:00:00.000Z'),
      local_field_id: localFieldId,
      users_roles: roleName ? [{ roles: { role_name: roleName } }] : [],
    });
    tx.ecclesiastical_years.findMany.mockImplementation(
      async (args: { where?: { year_id?: { in?: number[] } } }) =>
        args?.where?.year_id?.in
          ? [yearRow(2025, '2025-01-01')]
          : [yearRow(2025, '2025-01-01')],
    );
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2025,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: modifiedAt,
      },
    ]);
    tx.club_sections.findUnique.mockResolvedValue({
      clubs: {
        local_field_id: 7,
        local_fields: { timezone: 'America/Mexico_City' },
      },
    });
    tx.enrollments.updateMany.mockResolvedValue({ count: 1 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'APPROVED',
    });
    return modifiedAt;
  }

  it.each([
    ['director-lf', 7],
    ['assistant-lf', 7],
    ['admin', null],
    ['assistant-admin', null],
    ['super-admin', 99],
  ] as const)(
    'IA-61 accredits a same-year certificate after CLOSED_YEAR when the reviewer is %s',
    async (roleName, localFieldId) => {
      const modifiedAt = stubEndedSameYearApproval(roleName, localFieldId);
      tx.investiture_authorization_people.findMany.mockResolvedValue([
        endedSameYearPerson('CLOSED_YEAR'),
      ]);

      await service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {
        reconcile_enrollment_id: 40,
        expected_modified_at: modifiedAt.toISOString(),
      });

      expect(tx.enrollments.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ investiture_status: 'INVESTIDO' }),
        }),
      );
      expect(
        tx.investiture_authorization_people.updateMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            system_reason: LATER_CERTIFICATE_NOTE,
          }),
        }),
      );
      const statusWrites =
        tx.investiture_authorization_people.updateMany.mock.calls
          .map((call) => call[0]?.data?.status)
          .filter((status) => status != null);
      expect(statusWrites.every((status) => status === 'CLOSED_YEAR')).toBe(
        true,
      );
    },
  );

  it('IA-61 rejects a director-lf of another field without effects', async () => {
    const modifiedAt = stubEndedSameYearApproval('director-lf', 8);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      endedSameYearPerson('CLOSED_YEAR'),
    ]);

    await expect(
      service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {
        reconcile_enrollment_id: 40,
        expected_modified_at: modifiedAt.toISOString(),
      }),
    ).rejects.toMatchObject({
      code: 'CERTIFICATE_IMPORT_ENDED_YEAR_FIELD_FORBIDDEN',
    });

    expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
    expect(tx.enrollments.create).not.toHaveBeenCalled();
    expect(
      JSON.stringify(tx.investiture_authorization_people.updateMany.mock.calls),
    ).not.toContain(LATER_CERTIFICATE_NOTE);
  });

  it.each([
    ['director-lf', null],
    ['assistant-lf', null],
    [null, null],
  ] as const)(
    'IA61-H2 rejects %s without a usable field by itself',
    async (roleName, localFieldId) => {
      const modifiedAt = stubEndedSameYearApproval(roleName, localFieldId);
      tx.investiture_authorization_people.findMany.mockResolvedValue([
        endedSameYearPerson('CLOSED_YEAR'),
      ]);

      await expect(
        service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {
          reconcile_enrollment_id: 40,
          expected_modified_at: modifiedAt.toISOString(),
        }),
      ).rejects.toMatchObject({
        code: 'CERTIFICATE_IMPORT_ENDED_YEAR_FIELD_FORBIDDEN',
      });

      expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
      expect(tx.enrollments.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['admin', 8],
    ['assistant-lf', 8],
  ] as const)(
    'IA61-H5 rejects %s of another field with a coded 403',
    async (roleName, localFieldId) => {
      const modifiedAt = stubEndedSameYearApproval(roleName, localFieldId);
      tx.investiture_authorization_people.findMany.mockResolvedValue([
        endedSameYearPerson('CLOSED_YEAR'),
      ]);

      const rejection = await service
        .approveItem('reviewer-1', 'batch-1', 'item-amigo', {
          reconcile_enrollment_id: 40,
          expected_modified_at: modifiedAt.toISOString(),
        })
        .catch((error: { code?: string; getStatus?: () => number }) => error);

      expect(rejection).toMatchObject({
        code: 'CERTIFICATE_IMPORT_ENDED_YEAR_FIELD_FORBIDDEN',
      });
      expect(rejection.getStatus?.()).toBe(403);
      expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['America/Tijuana', '2026-01-01T07:30:00.000Z', 'open'],
    ['America/Tijuana', '2026-01-01T08:30:00.000Z', 'ended'],
    ['America/Bogota', '2026-01-01T04:30:00.000Z', 'open'],
    ['America/Bogota', '2026-01-01T05:30:00.000Z', 'ended'],
  ] as const)(
    'C1RR-2 certificate approval agrees with an active year in %s at %s (%s)',
    async (timeZone, instant, expectation) => {
      jest.useFakeTimers({ now: new Date(instant) });
      try {
        const modifiedAt = stubEndedSameYearApproval('director-lf', 7);
        tx.ecclesiastical_years.findMany.mockResolvedValue([
          yearRow(2025, '2025-01-01', true),
        ]);
        tx.club_sections.findUnique.mockResolvedValue({
          clubs: {
            local_field_id: 7,
            local_fields: { timezone: timeZone },
          },
        });
        tx.investiture_authorization_people.findMany.mockResolvedValue([
          endedSameYearPerson('PENDING'),
        ]);
        const approval = service.approveItem(
          'reviewer-1',
          'batch-1',
          'item-amigo',
          {
            reconcile_enrollment_id: 40,
            expected_modified_at: modifiedAt.toISOString(),
          },
        );
        if (expectation === 'open') {
          await expect(approval).rejects.toMatchObject({
            code: 'CERTIFICATE_IMPORT_AUTHORIZATION_PENDING',
          });
          expect(
            JSON.stringify(
              tx.investiture_authorization_people.updateMany.mock.calls,
            ),
          ).not.toContain('CLOSED_YEAR');
        } else {
          await approval;
          expect(
            tx.investiture_authorization_people.updateMany,
          ).toHaveBeenCalledWith(
            expect.objectContaining({
              data: {
                status: 'CLOSED_YEAR',
                resolution_code: 'CLOSED_YEAR',
              },
            }),
          );
        }
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('IA-61 closes an ended PENDING and accredits the same-year certificate in one approval', async () => {
    const modifiedAt = stubEndedSameYearApproval('director-lf', 7);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      endedSameYearPerson('PENDING'),
    ]);

    await service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {
      reconcile_enrollment_id: 40,
      expected_modified_at: modifiedAt.toISOString(),
    });

    expect(tx.investiture_authorization_people.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'CLOSED_YEAR',
          resolution_code: 'CLOSED_YEAR',
        },
      }),
    );
    expect(tx.investiture_authorization_people.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          system_reason: LATER_CERTIFICATE_NOTE,
        }),
      }),
    );
    expect(tx.enrollments.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ investiture_status: 'INVESTIDO' }),
      }),
    );
  });

  it('IA-61 keeps IA-57 while the request year is still open', async () => {
    const modifiedAt = new Date('2026-02-01T00:00:00.000Z');
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-amigo',
      status: 'SUBMITTED',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2026-06-01T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.users.findUnique.mockResolvedValue({
      birthday: new Date('1990-01-01T00:00:00.000Z'),
      local_field_id: 7,
      users_roles: [{ roles: { role_name: 'director-lf' } }],
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      yearRow(2026, '2026-01-01', true),
    ]);
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2026,
        investiture_status: 'IN_PROGRESS',
        investiture_date: null,
        record_kind: 'OPERATIONAL',
        modified_at: modifiedAt,
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      {
        person_id: 'person-pedro',
        enrollment_id: 40,
        status: 'PENDING',
        request: { ecclesiastical_year_id: 2026, club_section_id: 4 },
        enrollment: {
          ecclesiastical_year_id: 2026,
          record_kind: 'OPERATIONAL',
        },
      },
    ]);

    await expect(
      service.approveItem('reviewer-1', 'batch-1', 'item-amigo', {
        reconcile_enrollment_id: 40,
        expected_modified_at: modifiedAt.toISOString(),
      }),
    ).rejects.toMatchObject({
      code: 'CERTIFICATE_IMPORT_AUTHORIZATION_PENDING',
    });

    expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
  });
});
