import { CertificateBulkImportApplicationService } from './certificate-bulk-imports-application.service';

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
    },
    enrollments: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    investiture_validation_history: {
      create: jest.fn(),
    },
    certificate_bulk_import_item_events: {
      create: jest.fn(),
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
    jest.clearAllMocks();
    service = new CertificateBulkImportApplicationService(prisma as any);
    tx.certificate_bulk_import_batches.update.mockResolvedValue({});
  });

  it('approves an HONOR item into users_honors and evidence_files', async () => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
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
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2026-04-12T00:00:00.000Z'),
      applied_entity_id: null,
      batch: { batch_id: 'batch-1', user_id: 'member-1', files: batchFiles },
    });
    tx.ecclesiastical_years.findFirst.mockResolvedValue({ year_id: 2026 });
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
          investiture_status: 'FIELD_APPROVED',
          submitted_for_validation: true,
          validated_by: 'reviewer-1',
        }),
      }),
    );
    expect(tx.investiture_validation_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enrollment_id: 90,
        action: 'FIELD_APPROVED',
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
});
