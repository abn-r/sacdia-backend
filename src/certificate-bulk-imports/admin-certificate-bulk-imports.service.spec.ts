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
      count: jest.fn(),
    },
    certificate_bulk_import_item_events: { create: jest.fn() },
    $transaction: jest.fn(
      async (callback: (client: typeof prisma) => unknown) => callback(prisma),
    ),
  };

  const application = {
    approveItem: jest.fn(),
    approveItemInTransaction: jest.fn(),
    resolveBatchStatus: jest.fn(),
  };

  const yearResolver = {
    blockersForItems: jest.fn().mockResolvedValue(new Map()),
  };

  let service: AdminCertificateBulkImportsService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof prisma) => unknown) => callback(prisma),
    );
    yearResolver.blockersForItems.mockResolvedValue(new Map());
    prisma.certificate_bulk_import_items.count.mockResolvedValue(0);
    application.resolveBatchStatus.mockResolvedValue('NEEDS_CORRECTION');
    service = new AdminCertificateBulkImportsService(
      prisma as any,
      application as any,
      yearResolver as any,
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

  it('refuses to approve or reject every row in one decision', async () => {
    prisma.users.findUnique.mockResolvedValue({
      local_field_id: 7,
      users_roles: [{ roles: { role_name: 'director-lf' } }],
    });
    prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      local_field_id: 7,
    });

    await expect(
      service.approveBatch('reviewer-1', 'batch-1', { comment: 'ok' }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ITEM_DECISION_REQUIRED');
    await expect(
      service.rejectBatch('reviewer-1', 'batch-1', { reason: 'No coincide' }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ITEM_DECISION_REQUIRED');

    expect(application.approveItemInTransaction).not.toHaveBeenCalled();
    expect(prisma.certificate_bulk_import_items.updateMany).not.toHaveBeenCalled();
    expect(prisma.certificate_bulk_import_batches.update).not.toHaveBeenCalled();
  });

  it('rejects one item and leaves the batch open while another row is pending', async () => {
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
    prisma.certificate_bulk_import_items.updateMany.mockResolvedValue({
      count: 1,
    });
    application.resolveBatchStatus.mockResolvedValue('SUBMITTED');

    await service.rejectItem('reviewer-1', 'batch-1', 'item-1', {
      reason: 'Fecha ilegible',
    });

    expect(prisma.certificate_bulk_import_items.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ item_id: 'item-1' }),
      }),
    );
    expect(prisma.certificate_bulk_import_batches.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUBMITTED' }),
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
    prisma.certificate_bulk_import_items.updateMany.mockResolvedValue({
      count: 1,
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

  it('does not reject a row another review already claimed', async () => {
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
    prisma.certificate_bulk_import_items.updateMany.mockResolvedValue({
      count: 0,
    });

    await expect(
      service.rejectItem('reviewer-1', 'batch-1', 'item-1', {
        reason: 'Fecha ilegible',
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ITEM_NOT_REVIEWABLE');

    expect(prisma.certificate_bulk_import_batches.update).not.toHaveBeenCalled();
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
    expect(prisma.certificate_bulk_import_items.updateMany).not.toHaveBeenCalled();
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

  it('does not reject an institutional class from the general inbox', async () => {
    prisma.users.findUnique.mockResolvedValue({
      local_field_id: null,
      users_roles: [{ roles: { role_name: 'admin' } }],
    });
    prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      local_field_id: null,
    });
    prisma.certificate_bulk_import_items.findFirst.mockResolvedValue({
      item_id: 'item-gm',
      class: { asset_code: 'GM-02' },
    });

    await expect(
      service.rejectItem('admin-1', 'batch-1', 'item-gm', {
        reason: 'No corresponde',
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_ITEM_NOT_FOUND');

    expect(prisma.certificate_bulk_import_items.updateMany).not.toHaveBeenCalled();
  });

  it('shows a missing period on the row and leaves the batch submitted', async () => {
    prisma.users.findUnique.mockResolvedValue({
      local_field_id: null,
      users_roles: [{ roles: { role_name: 'super-admin' } }],
    });
    prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      local_field_id: 7,
      status: 'SUBMITTED',
      files: [{ file_id: 'file-1' }],
      items: [
        {
          item_id: 'item-1',
          item_type: 'CLASS',
          completed_at: new Date('2004-03-15T00:00:00.000Z'),
        },
      ],
    });
    yearResolver.blockersForItems.mockResolvedValue(
      new Map([['item-1', [{ code: 'CERTIFICATE_IMPORT_YEAR_NOT_FOUND' }]]]),
    );

    const detail = await service.getDetail('reviewer-1', 'batch-1');

    expect(detail.status).toBe('SUBMITTED');
    expect(detail.files).toEqual([{ file_id: 'file-1' }]);
    expect(detail.items[0].approval_blockers).toEqual([
      { code: 'CERTIFICATE_IMPORT_YEAR_NOT_FOUND' },
    ]);
    expect(prisma.certificate_bulk_import_batches.update).not.toHaveBeenCalled();
  });

  it('clears the period blocker after the catalog year exists without a new file', async () => {
    prisma.users.findUnique.mockResolvedValue({
      local_field_id: null,
      users_roles: [{ roles: { role_name: 'super-admin' } }],
    });
    prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      local_field_id: 7,
      status: 'SUBMITTED',
      files: [{ file_id: 'file-1' }],
      items: [
        {
          item_id: 'item-1',
          item_type: 'CLASS',
          completed_at: new Date('2004-03-15T00:00:00.000Z'),
        },
      ],
    });
    yearResolver.blockersForItems.mockResolvedValue(
      new Map([['item-1', []]]),
    );

    const detail = await service.getDetail('reviewer-1', 'batch-1');

    expect(detail.items[0].approval_blockers).toEqual([]);
    expect(detail.files).toEqual([{ file_id: 'file-1' }]);
    expect(detail.status).toBe('SUBMITTED');
  });
});
