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
    users_honors: { findMany: jest.fn() },
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
  describe('instructor in the reviewer detail (B2, D7)', () => {
    const DATE = new Date('2026-04-12T00:00:00.000Z');
    const honorItem = (extra: Record<string, unknown> = {}) => ({
      item_id: 'item-1',
      item_type: 'HONOR',
      status: 'SUBMITTED',
      honor_id: 10,
      completed_at: DATE,
      instructor_user_id: null,
      instructor_name: null,
      instructor: null,
      ...extra,
    });
    const detailFor = (
      items: Record<string, unknown>[],
      events: Record<string, unknown>[] = [],
    ) => {
      prisma.users.findUnique.mockResolvedValue({
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'super-admin' } }],
      });
      prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
        batch_id: 'batch-1',
        user_id: 'member-1',
        local_field_id: 7,
        status: 'SUBMITTED',
        files: [{ file_id: 'file-1' }],
        items,
        events,
      });
      return service.getDetail('reviewer-1', 'batch-1');
    };

    it('shows the instructor block without email or photo and flags a pending conflict', async () => {
      prisma.users_honors.findMany.mockResolvedValue([
        {
          honor_id: 10,
          date: DATE,
          instructor_user_id: 'luis',
          instructor_name: null,
        },
      ]);

      const detail = await detailFor([
        honorItem({
          instructor_name: 'Juan López Ruiz',
        }),
        honorItem({
          item_id: 'item-2',
          honor_id: 11,
          instructor_user_id: 'ana',
          instructor: { user_id: 'ana', name: 'Ana', paternal_last_name: 'Pérez', maternal_last_name: null },
        }),
      ]);

      expect(prisma.users_honors.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: 'member-1',
            validation_status: 'APPROVED',
          }),
        }),
      );
      expect(detail.items[0]).toMatchObject({ instructor_conflict: true });
      expect(detail.items[1]).toMatchObject({
        instructor_conflict: false,
        instructor: { kind: 'USER', user_id: 'ana', display_name: 'Ana Pérez' },
      });
      expect(detail.items[1].instructor).not.toHaveProperty('photo_url');
      expect(JSON.stringify(detail.items[1])).not.toContain('email');
    });

    it('does not flag a conflict when the dates differ, nothing was approved or the instructor matches', async () => {
      prisma.users_honors.findMany.mockResolvedValue([
        { honor_id: 10, date: new Date('2025-01-01T00:00:00.000Z'), instructor_user_id: 'luis', instructor_name: null },
        { honor_id: 11, date: DATE, instructor_user_id: 'ana', instructor_name: null },
        { honor_id: 12, date: DATE, instructor_user_id: null, instructor_name: null },
      ]);

      const detail = await detailFor([
        honorItem({ instructor_name: 'Juan López Ruiz' }),
        honorItem({ item_id: 'item-2', honor_id: 11, instructor_user_id: 'ana' }),
        honorItem({ item_id: 'item-3', honor_id: 12, instructor_user_id: 'ana' }),
        honorItem({ item_id: 'item-4', honor_id: 13, instructor_user_id: 'ana' }),
      ]);

      expect(detail.items.map((item) => item.instructor_conflict)).toEqual([
        false,
        false,
        false,
        false,
      ]);
    });

    it('reads the conflict of an approved row from its ITEM_APPROVED event', async () => {
      const detail = await detailFor(
        [honorItem({ status: 'APPROVED' }), honorItem({ item_id: 'item-2', status: 'APPROVED' })],
        [
          { item_id: 'item-1', action: 'ITEM_APPROVED', payload: { instructor_conflict: true } },
          { item_id: 'item-2', action: 'ITEM_APPROVED', payload: { instructor_kind: 'NONE' } },
        ],
      );

      expect(prisma.users_honors.findMany).not.toHaveBeenCalled();
      expect(detail.items.map((item) => item.instructor_conflict)).toEqual([
        true,
        false,
      ]);
    });
  });

  describe('proof pages in the reviewer detail (B4)', () => {
    it('exposes files[].page_count and items[].source_file_id/source_page, null before M2', async () => {
      prisma.users.findUnique.mockResolvedValue({
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'super-admin' } }],
      });
      prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
        batch_id: 'batch-1',
        user_id: 'member-1',
        local_field_id: 7,
        status: 'SUBMITTED',
        files: [
          { file_id: 'file-1', jurisdiction: 'CAMPO_LOCAL', size_bytes: 10n, page_count: 5 },
          { file_id: 'file-2', jurisdiction: 'CAMPO_LOCAL', size_bytes: 10n, page_count: null },
        ],
        items: [
          { item_id: 'item-1', item_type: 'CLASS', source_file_id: 'file-1', source_page: 3 },
          { item_id: 'item-2', item_type: 'CLASS', source_file_id: null, source_page: null },
        ],
        events: [],
      });

      const detail = await service.getDetail('reviewer-1', 'batch-1');

      expect(detail.files.map((file) => file.page_count)).toEqual([5, null]);
      expect(detail.items.map((item) => [item.source_file_id, item.source_page])).toEqual([
        ['file-1', 3],
        [null, null],
      ]);
      expect(() => JSON.stringify(detail)).not.toThrow();
    });
  });

  describe('JSON-safe reviewer responses (BigInt size_bytes)', () => {
    const reviewerFile = () => ({
      file_id: 'file-1',
      batch_id: 'batch-1',
      file_url: 'batches/batch-1/sealed/file-1.pdf',
      file_name: 'cert.pdf',
      file_type: 'application/pdf',
      uploaded_by_id: 'user-1',
      ocr_raw_text: null,
      active: true,
      uploaded_at: new Date('2026-10-01T00:00:00.000Z'),
      upload_status: 'CONFIRMED',
      staging_key: null,
      object_key: 'batches/batch-1/sealed/file-1.pdf',
      size_bytes: BigInt(2_048_576),
      confirmed_at: new Date('2026-10-01T00:01:00.000Z'),
      jurisdiction: 'CAMPO_LOCAL',
    });
    const reviewerBatch = () => ({
      batch_id: 'batch-1',
      user_id: 'user-1',
      local_field_id: 7,
      status: 'SUBMITTED',
      files: [reviewerFile()],
      items: [],
      events: [],
    });

    beforeEach(() => {
      prisma.users.findUnique.mockResolvedValue({
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'super-admin' } }],
      });
    });

    it('getDetail returns honor.category and class.club_type and asks for them', async () => {
      prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
        ...reviewerBatch(),
        items: [
          {
            item_id: 'item-honor',
            item_type: 'HONOR',
            completed_at: new Date('2020-01-01T00:00:00.000Z'),
            honor: {
              honor_id: 12,
              name: 'Primeros Auxilios',
              translations: [],
              honors_categories: {
                honor_category_id: 3,
                name: 'Salud',
                translations: [],
              },
            },
            class: null,
          },
          {
            item_id: 'item-class',
            item_type: 'CLASS',
            completed_at: new Date('2020-01-01T00:00:00.000Z'),
            honor: null,
            class: {
              class_id: 4,
              name: 'Amigo',
              asset_code: 'CQ-01',
              translations: [],
              club_types: {
                club_type_id: 2,
                name: 'Conquistadores',
                translations: [],
              },
            },
          },
        ],
      });

      const detail = await service.getDetail('reviewer-1', 'batch-1');

      const include =
        prisma.certificate_bulk_import_batches.findFirst.mock.calls[0][0]
          .include;
      expect(
        include.items.include.honor.select.honors_categories,
      ).toBeDefined();
      expect(include.items.include.class.select.club_types).toBeDefined();
      expect(detail.items[0].honor).toEqual({
        honor_id: 12,
        name: 'Primeros Auxilios',
        category: { honor_category_id: 3, name: 'Salud' },
      });
      expect(detail.items[1].class).toEqual({
        class_id: 4,
        name: 'Amigo',
        asset_code: 'CQ-01',
        club_type: { club_type_id: 2, name: 'Conquistadores' },
      });
    });

    it('getDetail serializes file sizes as numbers and keeps the viewer fields', async () => {
      prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue(
        reviewerBatch(),
      );

      const detail = await service.getDetail('reviewer-1', 'batch-1');

      const json = JSON.parse(JSON.stringify(detail));
      expect(json.files[0]).toMatchObject({
        file_id: 'file-1',
        batch_id: 'batch-1',
        file_url: 'batches/batch-1/sealed/file-1.pdf',
        file_name: 'cert.pdf',
        file_type: 'application/pdf',
        ocr_raw_text: null,
        jurisdiction: 'CAMPO_LOCAL',
        size_bytes: 2_048_576,
      });
      expect(json.files[0]).toHaveProperty('uploaded_at');
      expect(json.files[0]).not.toHaveProperty('staging_key');
    });

    it('listPending serializes file sizes as numbers', async () => {
      prisma.certificate_bulk_import_batches.findMany.mockResolvedValue([
        reviewerBatch(),
      ]);
      prisma.certificate_bulk_import_batches.count.mockResolvedValue(1);

      const result = await service.listPending('reviewer-1', {
        page: 1,
        limit: 20,
      });

      const json = JSON.parse(JSON.stringify(result));
      expect(json.items[0].files[0].size_bytes).toBe(2_048_576);
      expect(json.items[0].files[0]).not.toHaveProperty('staging_key');
      expect(json.total).toBe(1);
    });
  });
});
