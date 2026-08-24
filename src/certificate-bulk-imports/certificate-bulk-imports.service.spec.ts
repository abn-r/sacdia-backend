import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { CertificateBulkImportsService } from './certificate-bulk-imports.service';
import { CertificateBulkImportItemType } from './certificate-bulk-imports.types';

describe('CertificateBulkImportsService', () => {
  const tx = {
    certificate_bulk_import_batches: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    certificate_bulk_import_items: {
      createMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
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

    await service.processOcr('user-1', 'batch-1');

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

  it('throws not found when member does not own the batch', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue(null);

    await expect(
      service.getBatch('user-1', 'batch-404'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
