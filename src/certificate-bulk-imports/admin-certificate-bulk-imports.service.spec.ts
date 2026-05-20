import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    certificate_bulk_import_item_events: { create: jest.fn() },
    $transaction: jest.fn(
      async (callback: (client: typeof prisma) => unknown) => callback(prisma),
    ),
  };

  const application = {
    approveItem: jest.fn(),
    approveItemInTransaction: jest.fn(),
  };

  let service: AdminCertificateBulkImportsService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof prisma) => unknown) => callback(prisma),
    );
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

    expect(
      prisma.certificate_bulk_import_batches.findMany,
    ).toHaveBeenCalledWith(
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

    await expect(
      service.getDetail('reviewer-1', 'batch-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
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
    application.approveItemInTransaction.mockResolvedValue({
      status: 'APPROVED',
    });
    prisma.certificate_bulk_import_batches.update.mockResolvedValue({
      batch_id: 'batch-1',
      status: 'APPROVED',
    });

    await expect(
      service.approveBatch('reviewer-1', 'batch-1', { comment: 'ok' }),
    ).resolves.toMatchObject({ status: 'APPROVED' });

    expect(application.approveItem).not.toHaveBeenCalled();
    expect(application.approveItemInTransaction).toHaveBeenCalledTimes(2);
    expect(application.approveItemInTransaction).toHaveBeenCalledWith(
      prisma,
      'reviewer-1',
      'batch-1',
      'item-1',
      { comment: 'ok' },
    );
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
    prisma.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-1',
      batch_id: 'batch-1',
      status: 'SUBMITTED',
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

  it('does not reject an item that does not belong to the selected batch', async () => {
    prisma.users.findUnique.mockResolvedValue({
      local_field_id: 7,
      users_roles: [{ roles: { role_name: 'assistant-lf' } }],
    });
    prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      local_field_id: 7,
    });
    prisma.certificate_bulk_import_items.findFirst.mockResolvedValue(null);

    await expect(
      service.rejectItem('reviewer-1', 'batch-1', 'item-from-other-batch', {
        reason: 'No corresponde',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.certificate_bulk_import_items.update).not.toHaveBeenCalled();
    expect(prisma.certificate_bulk_import_items.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          item_id: 'item-from-other-batch',
          batch_id: 'batch-1',
          status: { in: ['SUBMITTED', 'RESUBMITTED'] },
        }),
      }),
    );
  });
});
