import { ForbiddenException } from '@nestjs/common';
import { AdminCertificateBulkImportsService } from './admin-certificate-bulk-imports.service';

describe('AdminCertificateBulkImportsService', () => {
  const prisma = {
    users: { findUnique: jest.fn() },
    certificate_bulk_import_batches: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    certificate_bulk_import_items: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    certificate_bulk_import_item_events: { create: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof prisma) => unknown) =>
      callback(prisma),
    ),
  };

  const application = {
    approveItem: jest.fn(),
  };

  let service: AdminCertificateBulkImportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminCertificateBulkImportsService(
      prisma as any,
      application as any,
    );
  });

  it('filters pending batches to the local field of director-lf reviewers', async () => {
    prisma.users.findUnique.mockResolvedValue({
      local_field_id: 7,
      users_roles: [{ roles: { role_name: 'director-lf' } }],
    });
    prisma.certificate_bulk_import_batches.findMany.mockResolvedValue([]);
    prisma.certificate_bulk_import_batches.count.mockResolvedValue(0);

    await service.listPending('reviewer-1', { page: 1, limit: 20 });

    expect(prisma.certificate_bulk_import_batches.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ local_field_id: 7 }),
      }),
    );
  });

  it('blocks local-field reviewers from another local field', async () => {
    prisma.users.findUnique.mockResolvedValue({
      local_field_id: 7,
      users_roles: [{ roles: { role_name: 'assistant-lf' } }],
    });
    prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      local_field_id: 9,
    });

    await expect(service.getDetail('reviewer-1', 'batch-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('approves every submitted item in a batch and marks the batch approved', async () => {
    prisma.users.findUnique.mockResolvedValue({
      local_field_id: 7,
      users_roles: [{ roles: { role_name: 'director-lf' } }],
    });
    prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      local_field_id: 7,
    });
    prisma.certificate_bulk_import_items.findMany.mockResolvedValue([
      { item_id: 'item-1' },
      { item_id: 'item-2' },
    ]);
    application.approveItem.mockResolvedValue({ status: 'APPROVED' });
    prisma.certificate_bulk_import_batches.update.mockResolvedValue({
      batch_id: 'batch-1',
      status: 'APPROVED',
    });

    await expect(
      service.approveBatch('reviewer-1', 'batch-1', { comment: 'ok' }),
    ).resolves.toMatchObject({ status: 'APPROVED' });

    expect(application.approveItem).toHaveBeenCalledTimes(2);
    expect(prisma.certificate_bulk_import_batches.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
  });

  it('rejects an item and marks the batch as needing correction', async () => {
    prisma.users.findUnique.mockResolvedValue({
      local_field_id: 7,
      users_roles: [{ roles: { role_name: 'assistant-lf' } }],
    });
    prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      local_field_id: 7,
    });
    prisma.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-1',
      status: 'REJECTED',
    });

    await expect(
      service.rejectItem('reviewer-1', 'batch-1', 'item-1', {
        reason: 'Fecha ilegible',
      }),
    ).resolves.toMatchObject({ status: 'REJECTED' });

    expect(prisma.certificate_bulk_import_batches.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'NEEDS_CORRECTION' }),
      }),
    );
  });
});
