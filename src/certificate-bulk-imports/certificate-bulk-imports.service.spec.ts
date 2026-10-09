import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { CertificateBulkImportsService } from './certificate-bulk-imports.service';
import { CertificateBulkImportItemType } from './certificate-bulk-imports.types';

describe('CertificateBulkImportsService', () => {
  const tx = {
    certificate_bulk_import_batches: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    certificate_bulk_import_files: {
      count: jest.fn(),
    },
    certificate_bulk_import_items: {
      create: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    honors: { findUnique: jest.fn() },
    classes: { findUnique: jest.fn() },
    users: { findUnique: jest.fn() },
    ecclesiastical_years: { findMany: jest.fn() },
    enrollments: { findMany: jest.fn() },
    investiture_authorization_people: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    certificate_bulk_import_item_events: {
      create: jest.fn(),
    },
  };

  const prisma = {
    users: { findUnique: jest.fn() },
    certificate_bulk_import_batches: tx.certificate_bulk_import_batches,
    certificate_bulk_import_items: tx.certificate_bulk_import_items,
    certificate_bulk_import_item_events: tx.certificate_bulk_import_item_events,
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  const ocrProvider = {
    extract: jest.fn(),
  };

  let service: CertificateBulkImportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CertificateBulkImportsService(prisma as any, ocrProvider);
    prisma.users.findUnique.mockResolvedValue({ local_field_id: 7 });
    tx.certificate_bulk_import_items.count.mockResolvedValue(1);
    tx.certificate_bulk_import_files.count.mockResolvedValue(1);
    tx.honors.findUnique.mockResolvedValue({ active: true });
    tx.classes.findUnique.mockResolvedValue({
      active: true,
      asset_code: 'CQ-01',
      minimum_age: 10,
    });
    tx.users.findUnique.mockResolvedValue({
      birthday: new Date('2000-01-01T00:00:00.000Z'),
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2026,
        start_date: new Date('2026-01-01T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
        active: true,
      },
    ]);
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([]);
    tx.enrollments.findMany.mockResolvedValue([]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([]);
    tx.investiture_authorization_people.updateMany.mockResolvedValue({
      count: 0,
    });
  });

  it('creates a draft batch for the owner and stores proof files', async () => {
    tx.certificate_bulk_import_batches.create.mockResolvedValue({
      batch_id: 'batch-1',
      status: 'DRAFT',
      user_id: 'user-1',
    });

    const result = await service.createDraft('user-1', {
      files: [
        {
          file_url: 'evidence/cert.jpg',
          file_name: 'cert.jpg',
          file_type: 'image/jpeg',
        },
      ],
    });

    expect(result).toMatchObject({ batch_id: 'batch-1', status: 'DRAFT' });
    expect(tx.certificate_bulk_import_batches.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'user-1',
          local_field_id: 7,
          files: {
            create: [
              expect.objectContaining({
                file_url: 'evidence/cert.jpg',
                uploaded_by_id: 'user-1',
              }),
            ],
          },
        }),
      }),
    );
  });

  it('rejects a draft file_url that is not a storage key or allowed https host', async () => {
    await expect(
      service.createDraft('user-1', {
        files: [
          {
            file_url: 'http://127.0.0.1/latest/meta-data',
            file_name: 'cert.jpg',
            file_type: 'image/jpeg',
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CERTIFICATE_IMPORT_FILE_URL_INVALID,
    });
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
    expect(tx.certificate_bulk_import_batches.create).not.toHaveBeenCalled();
  });

  it('accepts an https file_url when the host is an R2 public URL', async () => {
    const previous = process.env.R2_PUBLIC_URL_EVIDENCE_FILES;
    process.env.R2_PUBLIC_URL_EVIDENCE_FILES = 'https://files.example';
    tx.certificate_bulk_import_batches.create.mockResolvedValue({
      batch_id: 'batch-1',
      status: 'DRAFT',
      user_id: 'user-1',
    });

    try {
      await service.createDraft('user-1', {
        files: [
          {
            file_url: 'https://files.example/evidence/cert.jpg',
            file_name: 'cert.jpg',
            file_type: 'image/jpeg',
          },
        ],
      });
    } finally {
      if (previous === undefined) {
        delete process.env.R2_PUBLIC_URL_EVIDENCE_FILES;
      } else {
        process.env.R2_PUBLIC_URL_EVIDENCE_FILES = previous;
      }
    }

    expect(tx.certificate_bulk_import_batches.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          files: {
            create: [
              expect.objectContaining({
                file_url: 'https://files.example/evidence/cert.jpg',
              }),
            ],
          },
        }),
      }),
    );
  });

  it('processes OCR and creates editable draft items', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      files: [
        {
          file_url: 'evidence/cert.jpg',
          file_name: 'cert.jpg',
          file_type: 'image/jpeg',
          upload_status: 'CONFIRMED',
          object_key: 'batches/batch-1/sealed/cert.jpg',
          ocr_raw_text: 'Especialidad: Mayordomía',
        },
      ],
    });
    ocrProvider.extract.mockResolvedValue({
      rawText: 'Especialidad: Mayordomía',
      items: [
        {
          type: 'HONOR',
          detectedName: 'Mayordomía',
          completedAt: '2026-04-12',
          confidence: 0.7,
          fieldConfidence: { name: 0.7 },
        },
      ],
    });
    tx.certificate_bulk_import_items.createMany.mockResolvedValue({ count: 1 });
    tx.certificate_bulk_import_batches.update.mockResolvedValue({
      batch_id: 'batch-1',
      items: [{ detected_name: 'Mayordomía' }],
    });

    await service.runQueuedOcr('user-1', 'batch-1');

    expect(tx.certificate_bulk_import_items.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          batch_id: 'batch-1',
          item_type: 'HONOR',
          detected_name: 'Mayordomía',
          completed_at: new Date('2026-04-12T00:00:00.000Z'),
          status: 'NEEDS_REVIEW',
        }),
      ],
    });
  });

  it('does not run OCR when a stored file_url is not an allowed reference', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      files: [
        {
          file_url: 'https://169.254.169.254/latest/meta-data',
          file_name: 'cert.jpg',
          file_type: 'image/jpeg',
        },
      ],
    });

    await expect(service.processOcr('user-1', 'batch-1')).rejects.toMatchObject(
      {
        code: ErrorCode.CERTIFICATE_IMPORT_FILE_URL_INVALID,
      },
    );
    expect(ocrProvider.extract).not.toHaveBeenCalled();
  });

  it('does not call the vendor on the request when Redis is absent', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      files: [
        {
          file_url: 'evidence/cert.jpg',
          file_name: 'cert.jpg',
          file_type: 'image/jpeg',
          upload_status: 'CONFIRMED',
          object_key: 'batches/batch-1/sealed/cert.jpg',
          active: true,
        },
      ],
    });

    await expect(service.processOcr('user-1', 'batch-1')).rejects.toThrow(
      'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
    );
    expect(ocrProvider.extract).not.toHaveBeenCalled();
    expect(
      tx.certificate_bulk_import_item_events.create,
    ).not.toHaveBeenCalled();
  });

  it('enqueues the read and leaves extraction to the worker', async () => {
    const queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    const queued = new CertificateBulkImportsService(
      prisma as never,
      ocrProvider,
      queue,
    );
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      files: [
        {
          file_url: 'evidence/cert.jpg',
          file_name: 'cert.jpg',
          file_type: 'image/jpeg',
          upload_status: 'CONFIRMED',
          object_key: 'batches/batch-1/sealed/cert.jpg',
          active: true,
        },
      ],
    });

    await queued.processOcr('user-1', 'batch-1');

    expect(queue.add).toHaveBeenCalledWith(
      'read',
      { userId: 'user-1', batchId: 'batch-1' },
      expect.objectContaining({
        jobId: 'certificate-ocr-batch-1',
        attempts: 2,
      }),
    );
    expect(JSON.stringify(queue.add.mock.calls[0])).not.toContain(
      'sealed/cert.jpg',
    );
    expect(ocrProvider.extract).not.toHaveBeenCalled();
    expect(tx.certificate_bulk_import_item_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'OCR_QUEUED' }),
      }),
    );
  });

  it.each([
    'CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE',
    'CERTIFICATE_IMPORT_OCR_QUOTA',
    'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
    'CERTIFICATE_IMPORT_OCR_FAILED',
    'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
    'CERTIFICATE_IMPORT_PDF_INVALID',
    'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
  ])(
    'does not record a successful read when provider fails with %s',
    async (code) => {
      tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
        batch_id: 'batch-1',
        user_id: 'user-1',
        status: 'DRAFT',
        files: [
          {
            file_url: 'evidence/cert.jpg',
            file_name: 'cert.jpg',
            file_type: 'image/jpeg',
            upload_status: 'CONFIRMED',
            object_key: 'batches/batch-1/sealed/cert.jpg',
            active: true,
          },
        ],
      });
      tx.certificate_bulk_import_items.findMany.mockResolvedValue([
        {
          item_id: 'kept',
          status: 'READY',
          honor_id: 12,
          class_id: null,
        },
      ]);
      ocrProvider.extract.mockRejectedValue(new BadRequestException(code));

      await expect(service.runQueuedOcr('user-1', 'batch-1')).rejects.toThrow(
        code,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(
        tx.certificate_bulk_import_items.updateMany,
      ).not.toHaveBeenCalled();
      expect(
        tx.certificate_bulk_import_item_events.create,
      ).not.toHaveBeenCalled();
    },
  );

  it('does not replace a row a person already corrected', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      files: [
        {
          file_url: 'evidence/cert.jpg',
          file_name: 'cert.jpg',
          file_type: 'image/jpeg',
          upload_status: 'CONFIRMED',
          object_key: 'batches/batch-1/sealed/cert.jpg',
          active: true,
        },
      ],
    });
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([
      {
        item_id: 'kept',
        status: 'READY',
        honor_id: 12,
        class_id: null,
      },
      {
        item_id: 'draft',
        status: 'NEEDS_REVIEW',
        honor_id: null,
        class_id: null,
      },
    ]);
    ocrProvider.extract.mockResolvedValue({ rawText: '', items: [] });
    tx.certificate_bulk_import_batches.update.mockResolvedValue({
      batch_id: 'batch-1',
    });

    await service.runQueuedOcr('user-1', 'batch-1');

    expect(tx.certificate_bulk_import_items.updateMany).toHaveBeenCalledWith({
      where: { item_id: { in: ['draft'] } },
      data: { active: false },
    });
    expect(ocrProvider.extract).toHaveBeenCalledWith([
      expect.objectContaining({
        objectKey: 'batches/batch-1/sealed/cert.jpg',
      }),
    ]);
  });

  it('passes the sealed file id and confirmed_at into extraction', async () => {
    const confirmedAt = new Date('2026-10-02T15:04:05.006Z');
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      files: [
        {
          file_id: '11111111-1111-4111-8111-111111111111',
          file_url: 'evidence/cert.jpg',
          file_name: 'cert.jpg',
          file_type: 'image/jpeg',
          upload_status: 'CONFIRMED',
          object_key: 'batches/batch-1/sealed/cert.jpg',
          confirmed_at: confirmedAt,
          active: true,
        },
      ],
    });
    ocrProvider.extract.mockResolvedValue({ rawText: '', items: [] });
    tx.certificate_bulk_import_batches.update.mockResolvedValue({
      batch_id: 'batch-1',
    });

    await service.runQueuedOcr('user-1', 'batch-1');

    expect(ocrProvider.extract).toHaveBeenCalledWith([
      expect.objectContaining({
        fileId: '11111111-1111-4111-8111-111111111111',
        confirmedAt,
      }),
    ]);
    const payload = JSON.stringify(ocrProvider.extract.mock.calls[0][0]);
    expect(payload).not.toContain('user-1');
  });

  it('rejects another owner before storage or HTTP extraction', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue(null);

    await expect(service.runQueuedOcr('user-2', 'batch-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(ocrProvider.extract).not.toHaveBeenCalled();
  });

  it('moves an item to READY when required fields are corrected', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'NEEDS_REVIEW',
    });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-1',
      status: 'READY',
    });

    await service.updateItem('user-1', 'batch-1', 'item-1', {
      item_type: CertificateBulkImportItemType.HONOR,
      honor_id: 12,
      completed_at: '2026-04-12',
      mark_as_ready: true,
    });

    expect(tx.certificate_bulk_import_items.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'READY' }),
      }),
    );
  });

  it('does not mark a 2025 Amigo row ready when historical age is below 10', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-2016',
      status: 'DRAFT',
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'NEEDS_REVIEW',
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: 1,
    });
    tx.users.findUnique.mockResolvedValue({
      birthday: new Date('2016-01-01T00:00:00.000Z'),
    });
    tx.classes.findUnique.mockResolvedValue({
      active: true,
      asset_code: 'CQ-01',
      minimum_age: 10,
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2025,
        start_date: new Date('2025-01-01T00:00:00.000Z'),
        end_date: new Date('2025-12-31T00:00:00.000Z'),
      },
    ]);

    await expect(
      service.updateItem('user-2016', 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: 1,
        completed_at: '2025-06-01',
        mark_as_ready: true,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CERTIFICATE_IMPORT_AGE_BELOW_MINIMUM,
    });
    expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();
  });

  it.each([undefined, false])(
    'returns a READY Amigo row to review when the edited date fails historical age (mark_as_ready=%s)',
    async (markAsReady) => {
      tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
        batch_id: 'batch-1',
        user_id: 'user-2016',
        status: 'DRAFT',
      });
      tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
        item_id: 'item-1',
        status: 'READY',
        revision: 0,
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: 1,
        completed_at: new Date('2026-03-01T00:00:00.000Z'),
      });
      tx.users.findUnique.mockResolvedValue({
        birthday: new Date('2016-01-01T00:00:00.000Z'),
      });
      tx.classes.findUnique.mockResolvedValue({
        active: true,
        asset_code: 'CQ-01',
        minimum_age: 10,
      });
      tx.ecclesiastical_years.findMany.mockResolvedValue([
        {
          year_id: 2025,
          start_date: new Date('2025-01-01T00:00:00.000Z'),
          end_date: new Date('2025-12-31T00:00:00.000Z'),
        },
      ]);

      await service.updateItem('user-2016', 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: 1,
        completed_at: '2025-06-01',
        expected_revision: 0,
        ...(markAsReady === false ? { mark_as_ready: false } : {}),
      });

      expect(tx.users.findUnique).toHaveBeenCalled();
      expect(tx.certificate_bulk_import_items.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'NEEDS_REVIEW' }),
        }),
      );
    },
  );

  it('does not submit or resubmit that Amigo row', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-2016',
      status: 'DRAFT',
      revision: 1,
    });
    tx.users.findUnique.mockResolvedValue({
      birthday: new Date('2016-01-01T00:00:00.000Z'),
    });
    tx.classes.findUnique.mockResolvedValue({
      active: true,
      asset_code: 'CQ-01',
      minimum_age: 10,
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2025,
        start_date: new Date('2025-01-01T00:00:00.000Z'),
        end_date: new Date('2025-12-31T00:00:00.000Z'),
      },
    ]);
    tx.certificate_bulk_import_items.findMany.mockImplementation(
      async (args: {
        where?: { status?: { in?: string[] }; item_type?: string };
      }) => {
        if (args.where?.status?.in) {
          return [
            {
              class_id: 1,
              completed_at: new Date('2025-06-01T00:00:00.000Z'),
            },
          ];
        }
        if (args.where?.item_type === CertificateBulkImportItemType.CLASS) {
          return [{ item_id: 'item-1', class: { asset_code: 'CQ-01' } }];
        }
        return [];
      },
    );

    await expect(service.submit('user-2016', 'batch-1')).rejects.toMatchObject({
      code: ErrorCode.CERTIFICATE_IMPORT_AGE_BELOW_MINIMUM,
    });
    expect(tx.certificate_bulk_import_items.updateMany).not.toHaveBeenCalled();

    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-2016',
      status: 'NEEDS_CORRECTION',
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'REJECTED',
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: 1,
    });
    await expect(
      service.resubmitItem('user-2016', 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: 1,
        completed_at: '2025-06-01',
        mark_as_ready: true,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CERTIFICATE_IMPORT_AGE_BELOW_MINIMUM,
    });
    expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();
  });

  it('does not submit a batch while active items are incomplete', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
    });
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([
      { item_id: 'item-1', status: 'NEEDS_REVIEW' },
    ]);

    await expect(service.submit('user-1', 'batch-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('submits ready items and moves the batch to SUBMITTED', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
    });
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([]);
    tx.certificate_bulk_import_items.updateMany.mockResolvedValue({ count: 2 });
    tx.certificate_bulk_import_batches.update.mockResolvedValue({
      batch_id: 'batch-1',
      status: 'SUBMITTED',
    });

    await expect(service.submit('user-1', 'batch-1')).resolves.toMatchObject({
      status: 'SUBMITTED',
    });
    expect(tx.certificate_bulk_import_items.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SUBMITTED' } }),
    );
  });

  it('resubmits a rejected item after correction', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'NEEDS_CORRECTION',
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'REJECTED',
    });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-1',
      status: 'RESUBMITTED',
    });

    await expect(
      service.resubmitItem('user-1', 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: 4,
        completed_at: '2026-04-12',
        mark_as_ready: true,
      }),
    ).resolves.toMatchObject({ status: 'RESUBMITTED' });
  });

  it('keeps a stored honor when a later patch only marks the row ready', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 2,
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'NEEDS_REVIEW',
      item_type: 'HONOR',
      honor_id: 12,
      class_id: null,
      completed_at: new Date('2026-04-12T00:00:00.000Z'),
      revision: 1,
    });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-1',
      status: 'READY',
    });

    await service.updateItem('user-1', 'batch-1', 'item-1', {
      mark_as_ready: true,
      expected_revision: 1,
    });

    expect(tx.certificate_bulk_import_items.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'READY', revision: 2 }),
      }),
    );
    expect(tx.honors.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { honor_id: 12 } }),
    );
  });

  it('rejects a future certificate date and a stale revision', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'NEEDS_REVIEW',
      item_type: 'HONOR',
      honor_id: 12,
      completed_at: null,
      revision: 3,
    });

    await expect(
      service.updateItem('user-1', 'batch-1', 'item-1', {
        completed_at: '2999-01-01',
        expected_revision: 3,
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_DATE_IN_FUTURE');

    await expect(
      service.updateItem('user-1', 'batch-1', 'item-1', {
        mark_as_ready: true,
        expected_revision: 1,
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_REVISION_CONFLICT');
    expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();
  });

  it('does not submit a draft without a sealed file', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
    });
    tx.certificate_bulk_import_files.count.mockResolvedValue(0);

    await expect(service.submit('user-1', 'batch-1')).rejects.toThrow(
      'CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED',
    );
    expect(tx.certificate_bulk_import_items.updateMany).not.toHaveBeenCalled();
  });

  it('does not send an institutional class to Campo Local', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
    });
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([
      { item_id: 'item-1', class: { asset_code: 'GM-02' } },
    ]);

    await expect(service.submit('user-1', 'batch-1')).rejects.toThrow(
      'CERTIFICATE_IMPORT_INSTITUTIONAL_REVIEW_REQUIRED',
    );
    expect(tx.certificate_bulk_import_batches.update).not.toHaveBeenCalled();
  });

  it('lists the owner drafts', async () => {
    tx.certificate_bulk_import_batches.findMany.mockResolvedValue([]);
    tx.certificate_bulk_import_batches.count.mockResolvedValue(0);

    await expect(service.listMine('user-1', 1, 20)).resolves.toMatchObject({
      total: 0,
      page: 1,
    });
    expect(tx.certificate_bulk_import_batches.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'user-1', active: true },
      }),
    );
  });

  it('throws not found when member does not own the batch', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue(null);

    await expect(
      service.getBatch('user-1', 'batch-404'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('JSON-safe batch responses (BigInt size_bytes)', () => {
    // Prisma returns certificate_bulk_import_files.size_bytes as bigint and
    // Express res.json cannot serialize it. Every member response that
    // carries a file row must survive JSON.stringify.
    const presignedFile = () => ({
      file_id: 'file-1',
      batch_id: 'batch-1',
      file_url: 'batches/batch-1/staging/file-1.pdf',
      file_name: 'cert.pdf',
      file_type: 'application/pdf',
      uploaded_by_id: 'user-1',
      ocr_raw_text: null,
      active: true,
      uploaded_at: new Date('2026-10-01T00:00:00.000Z'),
      upload_status: 'PENDING_UPLOAD',
      staging_key: 'batches/batch-1/staging/file-1.pdf',
      object_key: null,
      size_bytes: BigInt(2_048_576),
      confirmed_at: null,
      jurisdiction: 'CAMPO_LOCAL',
    });
    const batchWithFile = () => ({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
      files: [presignedFile()],
      items: [],
      events: [],
    });

    function expectJsonSafeFile(result: { files: Array<Record<string, any>> }) {
      const json = JSON.parse(JSON.stringify(result));
      expect(json.files).toHaveLength(1);
      expect(json.files[0]).toMatchObject({
        file_id: 'file-1',
        batch_id: 'batch-1',
        file_url: 'batches/batch-1/staging/file-1.pdf',
        file_name: 'cert.pdf',
        file_type: 'application/pdf',
        upload_status: 'PENDING_UPLOAD',
        size_bytes: 2_048_576,
        jurisdiction: 'CAMPO_LOCAL',
      });
      expect(json.files[0]).not.toHaveProperty('staging_key');
    }

    it('getBatch serializes a presigned file size as a number', async () => {
      tx.certificate_bulk_import_batches.findFirst.mockResolvedValue(
        batchWithFile(),
      );

      const result = await service.getBatch('user-1', 'batch-1');

      expectJsonSafeFile(result);
    });

    it('createDraft serializes file sizes as numbers', async () => {
      tx.certificate_bulk_import_batches.create.mockResolvedValue(
        batchWithFile(),
      );

      const result = await service.createDraft('user-1', {});

      expectJsonSafeFile(result);
    });

    it('submit serializes file sizes as numbers', async () => {
      tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
        batch_id: 'batch-1',
        user_id: 'user-1',
        status: 'DRAFT',
      });
      tx.certificate_bulk_import_items.findMany.mockResolvedValue([]);
      tx.certificate_bulk_import_items.updateMany.mockResolvedValue({
        count: 1,
      });
      tx.certificate_bulk_import_batches.update.mockResolvedValue({
        ...batchWithFile(),
        status: 'SUBMITTED',
      });

      const result = await service.submit('user-1', 'batch-1');

      expectJsonSafeFile(result);
    });

    it('processOcr serializes file sizes as numbers when it returns the batch', async () => {
      const queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
      const queued = new CertificateBulkImportsService(
        prisma as never,
        ocrProvider,
        queue,
      );
      tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
        ...batchWithFile(),
        files: [
          {
            ...presignedFile(),
            upload_status: 'CONFIRMED',
            object_key: 'batches/batch-1/sealed/file-1.pdf',
          },
        ],
      });

      const result = await queued.processOcr('user-1', 'batch-1');

      const json = JSON.parse(JSON.stringify(result));
      expect(json.files[0].size_bytes).toBe(2_048_576);
      expect(json.files[0]).not.toHaveProperty('staging_key');
    });

    it('keeps the file size null when the row has none', async () => {
      tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
        ...batchWithFile(),
        files: [{ ...presignedFile(), size_bytes: null }],
      });

      const result = await service.getBatch('user-1', 'batch-1');

      expect(JSON.parse(JSON.stringify(result)).files[0].size_bytes).toBeNull();
    });
  });

  function sameYearPending() {
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2026,
        record_kind: 'OPERATIONAL',
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      {
        person_id: 'person-pedro',
        enrollment_id: 40,
        request: { ecclesiastical_year_id: 2026 },
        enrollment: {
          ecclesiastical_year_id: 2026,
          record_kind: 'OPERATIONAL',
        },
      },
    ]);
  }

  it('C1-H1 warns when the certificate year is the request year of a multi-year enrollment', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'NEEDS_REVIEW',
      revision: 0,
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: 4,
    });
    tx.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2026,
        start_date: new Date('2026-01-01T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
        active: true,
      },
    ]);
    tx.enrollments.findMany.mockResolvedValue([
      {
        enrollment_id: 40,
        ecclesiastical_year_id: 2025,
        record_kind: 'OPERATIONAL',
      },
    ]);
    tx.investiture_authorization_people.findMany.mockResolvedValue([
      {
        person_id: 'person-pedro',
        enrollment_id: 40,
        request: { ecclesiastical_year_id: 2026 },
        enrollment: {
          ecclesiastical_year_id: 2025,
          record_kind: 'OPERATIONAL',
        },
      },
    ]);

    await expect(
      service.updateItem('user-1', 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: 4,
        completed_at: '2026-04-12',
        mark_as_ready: true,
        expected_revision: 0,
      }),
    ).rejects.toMatchObject({
      code: 'CERTIFICATE_IMPORT_AUTHORIZATION_PENDING',
    });
  });

  it('C-1 warns before marking a same-year certificate ready', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'NEEDS_REVIEW',
      revision: 0,
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: 4,
    });
    sameYearPending();

    await expect(
      service.updateItem('user-1', 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: 4,
        completed_at: '2026-04-12',
        mark_as_ready: true,
        expected_revision: 0,
      }),
    ).rejects.toMatchObject({
      code: 'CERTIFICATE_IMPORT_AUTHORIZATION_PENDING',
    });
    expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();
  });

  it('C-1 warns before submitting a same-year certificate', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 1,
    });
    tx.certificate_bulk_import_items.findMany.mockImplementation(
      async (args: {
        where?: { status?: { in?: string[] }; item_type?: string };
      }) => {
        if (args.where?.status?.in) {
          return [
            {
              class_id: 4,
              completed_at: new Date('2026-04-12T00:00:00.000Z'),
            },
          ];
        }
        if (args.where?.item_type === CertificateBulkImportItemType.CLASS) {
          return [{ item_id: 'item-1', class: { asset_code: 'CQ-01' } }];
        }
        return [];
      },
    );
    sameYearPending();

    await expect(service.submit('user-1', 'batch-1')).rejects.toMatchObject({
      code: 'CERTIFICATE_IMPORT_AUTHORIZATION_PENDING',
    });
    expect(tx.certificate_bulk_import_items.updateMany).not.toHaveBeenCalled();
  });

  it('C-1 warns before resubmitting a same-year certificate', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'NEEDS_CORRECTION',
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      status: 'REJECTED',
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: 4,
    });
    sameYearPending();

    await expect(
      service.resubmitItem('user-1', 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: 4,
        completed_at: '2026-04-12',
        mark_as_ready: true,
      }),
    ).rejects.toMatchObject({
      code: 'CERTIFICATE_IMPORT_AUTHORIZATION_PENDING',
    });
    expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();
  });

  it('BC-9 keeps a valid ready item and sends an invalid age to review', async () => {
    tx.certificate_bulk_import_batches.create.mockResolvedValue({
      batch_id: 'batch-1',
      status: 'DRAFT',
      user_id: 'user-1',
    });
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([
      {
        item_id: 'item-valid',
        item_type: 'CLASS',
        class_id: 4,
        completed_at: new Date('2026-06-01T00:00:00.000Z'),
        status: 'READY',
      },
    ]);
    await service.createDraft('user-1', {
      items: [
        {
          item_type: CertificateBulkImportItemType.CLASS,
          class_id: 4,
          completed_at: '2026-06-01',
          mark_as_ready: true,
        },
      ],
    });
    expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();

    tx.certificate_bulk_import_items.update.mockClear();
    tx.users.findUnique.mockResolvedValue({
      birthday: new Date('2018-01-01T00:00:00.000Z'),
    });
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([
      {
        item_id: 'item-young',
        item_type: 'CLASS',
        class_id: 4,
        completed_at: new Date('2026-06-01T00:00:00.000Z'),
        status: 'READY',
      },
    ]);
    await service.createDraft('user-1', {
      items: [
        {
          item_type: CertificateBulkImportItemType.CLASS,
          class_id: 4,
          completed_at: '2026-06-01',
          mark_as_ready: true,
        },
      ],
    });
    expect(tx.certificate_bulk_import_items.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { item_id: 'item-young' },
        data: expect.objectContaining({ status: 'NEEDS_REVIEW' }),
      }),
    );
  });

  it('BCR-9 sends a ready item with a future completed_at to review on draft creation', async () => {
    tx.certificate_bulk_import_batches.create.mockResolvedValue({
      batch_id: 'batch-1',
      status: 'DRAFT',
      user_id: 'user-1',
    });
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([
      {
        item_id: 'item-future',
        item_type: 'CLASS',
        class_id: 4,
        completed_at: future,
        status: 'READY',
      },
    ]);

    await service.createDraft('user-1', {
      items: [
        {
          item_type: CertificateBulkImportItemType.CLASS,
          class_id: 4,
          completed_at: future.toISOString().slice(0, 10),
          mark_as_ready: true,
        },
      ],
    });

    expect(tx.certificate_bulk_import_items.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { item_id: 'item-future' },
        data: expect.objectContaining({
          status: 'NEEDS_REVIEW',
          rejection_reason: 'CERTIFICATE_IMPORT_DATE_IN_FUTURE',
        }),
      }),
    );
  });

  it('BCR-9 sends an added ready item with a future completed_at to review', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
    });
    tx.certificate_bulk_import_items.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        item_id: 'item-new',
        ...data,
      }),
    );
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const item = await service.addItem('user-1', 'batch-1', {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: 4,
      completed_at: future,
      mark_as_ready: true,
    });

    expect(item).toMatchObject({
      status: 'NEEDS_REVIEW',
      rejection_reason: 'CERTIFICATE_IMPORT_DATE_IN_FUTURE',
    });
  });

  it('BCR33-N3 sends a ready item with an invalid catalog to review on draft creation instead of failing the batch', async () => {
    tx.certificate_bulk_import_batches.create.mockResolvedValue({
      batch_id: 'batch-1',
      status: 'DRAFT',
      user_id: 'user-1',
    });
    tx.honors.findUnique.mockResolvedValue({ active: false });
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([
      {
        item_id: 'item-honor',
        item_type: 'HONOR',
        honor_id: 99,
        completed_at: new Date('2026-06-01T00:00:00.000Z'),
        status: 'READY',
      },
    ]);

    await expect(
      service.createDraft('user-1', {
        items: [
          {
            item_type: CertificateBulkImportItemType.HONOR,
            honor_id: 99,
            completed_at: '2026-06-01',
            mark_as_ready: true,
          },
        ],
      }),
    ).resolves.toBeDefined();

    expect(tx.certificate_bulk_import_items.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { item_id: 'item-honor' },
        data: expect.objectContaining({
          status: 'NEEDS_REVIEW',
          rejection_reason: 'CERTIFICATE_IMPORT_CATALOG_NOT_FOUND',
        }),
      }),
    );
  });

  it('BCR33-N3 adds a ready item with an unknown class as NEEDS_REVIEW with the catalog code', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
    });
    tx.classes.findUnique.mockResolvedValue(null);
    tx.certificate_bulk_import_items.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        item_id: 'item-new',
        ...data,
      }),
    );

    const item = await service.addItem('user-1', 'batch-1', {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: 404,
      completed_at: '2026-06-01',
      mark_as_ready: true,
    });

    expect(item).toMatchObject({
      status: 'NEEDS_REVIEW',
      rejection_reason: 'CERTIFICATE_IMPORT_CATALOG_NOT_FOUND',
    });
  });

  it('BCR33-N5 documents that a future date is born NEEDS_REVIEW on creation but is a 400 on updateItem', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
    });
    tx.certificate_bulk_import_items.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        item_id: 'item-new',
        ...data,
      }),
    );
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const created = await service.addItem('user-1', 'batch-1', {
      item_type: CertificateBulkImportItemType.CLASS,
      class_id: 4,
      completed_at: future,
      mark_as_ready: false,
    });
    expect(created).toMatchObject({
      status: 'NEEDS_REVIEW',
      rejection_reason: 'CERTIFICATE_IMPORT_DATE_IN_FUTURE',
    });

    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      batch_id: 'batch-1',
      item_type: 'CLASS',
      class_id: 4,
      completed_at: new Date('2026-06-01T00:00:00.000Z'),
      status: 'NEEDS_REVIEW',
      revision: 0,
    });
    await expect(
      service.updateItem('user-1', 'batch-1', 'item-1', {
        completed_at: future,
        mark_as_ready: false,
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_DATE_IN_FUTURE');
  });

  it('BCR33-N3 keeps updateItem mark_as_ready returning 400 for an invalid catalog', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      batch_id: 'batch-1',
      item_type: 'HONOR',
      honor_id: 99,
      detected_name: 'Nudos',
      completed_at: new Date('2026-06-01T00:00:00.000Z'),
      status: 'NEEDS_REVIEW',
      revision: 0,
    });
    tx.honors.findUnique.mockResolvedValue({ active: false });

    await expect(
      service.updateItem('user-1', 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.HONOR,
        honor_id: 99,
        completed_at: '2026-06-01',
        mark_as_ready: true,
      }),
    ).rejects.toMatchObject({
      message: 'CERTIFICATE_IMPORT_CATALOG_NOT_FOUND',
    });
    expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();
  });

  it('BCR-9 keeps a ready item with a past completed_at as READY on creation', async () => {
    tx.certificate_bulk_import_batches.create.mockResolvedValue({
      batch_id: 'batch-1',
      status: 'DRAFT',
      user_id: 'user-1',
    });
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([
      {
        item_id: 'item-past',
        item_type: 'CLASS',
        class_id: 4,
        completed_at: new Date('2026-06-01T00:00:00.000Z'),
        status: 'READY',
      },
    ]);

    await service.createDraft('user-1', {
      items: [
        {
          item_type: CertificateBulkImportItemType.CLASS,
          class_id: 4,
          completed_at: '2026-06-01',
          mark_as_ready: true,
        },
      ],
    });

    expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();
  });
});
