import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { CertificateBulkImportsService } from './certificate-bulk-imports.service';
import { CertificateBulkImportItemType } from './certificate-bulk-imports.types';

const OWNER = 'owner-1';
const INSTRUCTOR = '7d1f6c52-5a6f-4b8a-9d57-6f6b1a2f3c11';
const OTHER = '0a0a0a0a-5a6f-4b8a-9d57-6f6b1a2f3c22';

describe('CertificateBulkImportsService instructor (B2)', () => {
  const tx = {
    certificate_bulk_import_batches: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
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
    certificate_bulk_import_item_events: { create: jest.fn() },
    honors: { findUnique: jest.fn() },
    classes: { findUnique: jest.fn() },
  };
  const prisma = {
    users: { findUnique: jest.fn() },
    certificate_bulk_import_batches: tx.certificate_bulk_import_batches,
    certificate_bulk_import_items: tx.certificate_bulk_import_items,
    $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
  };
  const ocrProvider = { extract: jest.fn() };
  const instructors = { assertEligible: jest.fn(), photoUrlsFor: jest.fn() };
  let service: CertificateBulkImportsService;

  const honorRow = (extra: Record<string, unknown> = {}) => ({
    item_id: 'item-1',
    status: 'NEEDS_REVIEW',
    item_type: 'HONOR',
    honor_id: 12,
    class_id: null,
    instructor_user_id: null,
    instructor_name: null,
    completed_at: new Date('2026-04-12T00:00:00.000Z'),
    revision: 0,
    ...extra,
  });
  const lastUpdateData = () =>
    tx.certificate_bulk_import_items.update.mock.calls.at(-1)[0].data;
  const lastEvent = (action: string) =>
    tx.certificate_bulk_import_item_events.create.mock.calls
      .map(([arg]) => arg.data)
      .filter((data) => data.action === action)
      .at(-1);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (cb: (client: typeof tx) => unknown) => cb(tx),
    );
    instructors.assertEligible.mockResolvedValue(undefined);
    instructors.photoUrlsFor.mockResolvedValue(new Map());
    service = new CertificateBulkImportsService(
      prisma as never,
      ocrProvider as never,
      null,
      instructors as never,
    );
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: OWNER,
      status: 'DRAFT',
      revision: 0,
    });
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue(honorRow());
    tx.certificate_bulk_import_items.count.mockResolvedValue(1);
    tx.honors.findUnique.mockResolvedValue({ active: true });
    tx.certificate_bulk_import_items.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...honorRow(),
        ...data,
      }),
    );
    tx.certificate_bulk_import_items.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        item_id: 'item-new',
        ...data,
      }),
    );
  });

  describe('updateItem', () => {
    it('assigns a system user, validates against the batch OWNER and clears the free name', async () => {
      tx.certificate_bulk_import_items.findFirst.mockResolvedValue(
        honorRow({ instructor_name: 'Juan López' }),
      );

      await service.updateItem(OWNER, 'batch-1', 'item-1', {
        instructor_user_id: INSTRUCTOR,
      });

      expect(instructors.assertEligible).toHaveBeenCalledWith(
        OWNER,
        INSTRUCTOR,
      );
      expect(lastUpdateData()).toMatchObject({
        instructor_user_id: INSTRUCTOR,
        instructor_name: null,
      });
    });

    it('assigns a free name, clears the user and does not look anyone up', async () => {
      tx.certificate_bulk_import_items.findFirst.mockResolvedValue(
        honorRow({ instructor_user_id: INSTRUCTOR }),
      );

      await service.updateItem(OWNER, 'batch-1', 'item-1', {
        instructor_name: 'Juan López',
      });

      expect(instructors.assertEligible).not.toHaveBeenCalled();
      expect(lastUpdateData()).toMatchObject({
        instructor_user_id: null,
        instructor_name: 'Juan López',
      });
    });

    it('null clears the instructor and undefined leaves it untouched', async () => {
      tx.certificate_bulk_import_items.findFirst.mockResolvedValue(
        honorRow({ instructor_user_id: INSTRUCTOR }),
      );

      await service.updateItem(OWNER, 'batch-1', 'item-1', {
        instructor_user_id: null,
      });
      expect(lastUpdateData()).toMatchObject({
        instructor_user_id: null,
        instructor_name: null,
      });

      await service.updateItem(OWNER, 'batch-1', 'item-1', {
        detected_name: 'Nudos',
      });
      expect(lastUpdateData()).toMatchObject({
        instructor_user_id: INSTRUCTOR,
      });
    });

    it('does not re-validate the instructor that is already stored', async () => {
      tx.certificate_bulk_import_items.findFirst.mockResolvedValue(
        honorRow({ instructor_user_id: INSTRUCTOR }),
      );

      await service.updateItem(OWNER, 'batch-1', 'item-1', {
        instructor_user_id: INSTRUCTOR,
        detected_name: 'Nudos',
      });

      expect(instructors.assertEligible).not.toHaveBeenCalled();
    });

    it('rejects both values with HONOR_INSTRUCTOR_AMBIGUOUS', async () => {
      await expect(
        service.updateItem(OWNER, 'batch-1', 'item-1', {
          instructor_user_id: INSTRUCTOR,
          instructor_name: 'Juan López',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.HONOR_INSTRUCTOR_AMBIGUOUS });
      expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();
    });

    it.each([
      ErrorCode.HONOR_INSTRUCTOR_SELF,
      ErrorCode.HONOR_INSTRUCTOR_INVALID,
    ])('answers 400 %s from the eligibility check', async (code) => {
      instructors.assertEligible.mockRejectedValue(
        new AppBadRequestException(code),
      );

      await expect(
        service.updateItem(OWNER, 'batch-1', 'item-1', {
          instructor_user_id: OTHER,
        }),
      ).rejects.toMatchObject({ code });
      expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();
    });

    it('rejects an instructor on a CLASS row', async () => {
      tx.certificate_bulk_import_items.findFirst.mockResolvedValue(
        honorRow({ item_type: 'CLASS', honor_id: null, class_id: 3 }),
      );

      await expect(
        service.updateItem(OWNER, 'batch-1', 'item-1', {
          instructor_name: 'Juan López',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CERTIFICATE_IMPORT_HONOR_INSTRUCTOR_NOT_ALLOWED,
      });
    });

    it('clears the instructor and the honor when the row becomes CLASS', async () => {
      tx.certificate_bulk_import_items.findFirst.mockResolvedValue(
        honorRow({ instructor_user_id: INSTRUCTOR }),
      );

      await service.updateItem(OWNER, 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: 3,
      });

      expect(lastUpdateData()).toMatchObject({
        item_type: 'CLASS',
        honor_id: null,
        class_id: 3,
        instructor_user_id: null,
        instructor_name: null,
      });
    });

    it('an item_type change drops the previous catalog id without a new one', async () => {
      await service.updateItem(OWNER, 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.CLASS,
      });

      expect(lastUpdateData()).toMatchObject({
        honor_id: null,
        class_id: null,
      });
    });

    it('a PATCH without item_type does not erase the stored honor (inconsistency 4)', async () => {
      await service.updateItem(OWNER, 'batch-1', 'item-1', {
        detected_name: 'Primeros auxilios',
      });
      expect(lastUpdateData()).toMatchObject({
        item_type: 'HONOR',
        honor_id: 12,
      });

      await service.updateItem(OWNER, 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.HONOR,
        detected_name: 'Primeros auxilios',
      });
      expect(lastUpdateData()).toMatchObject({ honor_id: 12 });
    });

    it('a HONOR row becomes READY without instructor (D1)', async () => {
      await service.updateItem(OWNER, 'batch-1', 'item-1', {
        mark_as_ready: true,
        completed_at: '2026-04-12',
      });

      expect(lastUpdateData()).toMatchObject({
        status: 'READY',
        instructor_user_id: null,
        instructor_name: null,
      });
    });

    it('answers MISMATCH when club_type_id disagrees with the class', async () => {
      tx.certificate_bulk_import_items.findFirst.mockResolvedValue(
        honorRow({ item_type: 'CLASS', honor_id: null, class_id: 3 }),
      );
      tx.classes.findUnique.mockResolvedValue({
        club_type_id: 1,
        active: true,
        asset_code: 'CQ-03',
      });

      await expect(
        service.updateItem(OWNER, 'batch-1', 'item-1', { club_type_id: 2 }),
      ).rejects.toMatchObject({
        code: ErrorCode.CERTIFICATE_IMPORT_CLASS_CLUB_TYPE_MISMATCH,
      });
      await expect(
        service.updateItem(OWNER, 'batch-1', 'item-1', { club_type_id: 1 }),
      ).resolves.toBeDefined();
    });

    it('records changed_fields without values (no free name in the audit)', async () => {
      await service.updateItem(OWNER, 'batch-1', 'item-1', {
        instructor_name: 'Juan López',
      });

      const event = lastEvent('ITEM_UPDATED');
      expect(event.payload.changed_fields).toEqual(['instructor_name']);
      expect(JSON.stringify(event.payload)).not.toContain('Juan');
    });

    it('answers the instructor block with a signed photo and no email', async () => {
      instructors.photoUrlsFor.mockResolvedValue(
        new Map([[INSTRUCTOR, 'https://signed/photo']]),
      );
      tx.certificate_bulk_import_items.update.mockResolvedValue({
        ...honorRow({ instructor_user_id: INSTRUCTOR }),
        instructor: {
          user_id: INSTRUCTOR,
          name: 'Ana',
          paternal_last_name: 'Pérez',
          maternal_last_name: 'Gómez',
          user_image: 'users/ana.jpg',
        },
      });

      const result = (await service.updateItem(OWNER, 'batch-1', 'item-1', {
        instructor_user_id: INSTRUCTOR,
      })) as Record<string, unknown>;

      expect(instructors.photoUrlsFor).toHaveBeenCalledWith([
        { user_id: INSTRUCTOR, user_image: 'users/ana.jpg' },
      ]);
      expect(result.instructor).toEqual({
        kind: 'USER',
        user_id: INSTRUCTOR,
        display_name: 'Ana Pérez Gómez',
        photo_url: 'https://signed/photo',
      });
      expect(JSON.stringify(result)).not.toContain('email');
    });
  });

  describe('addItem (BC-9)', () => {
    it('stores a valid system instructor', async () => {
      await service.addItem(OWNER, 'batch-1', {
        item_type: CertificateBulkImportItemType.HONOR,
        honor_id: 12,
        instructor_user_id: INSTRUCTOR,
      });

      expect(instructors.assertEligible).toHaveBeenCalledWith(
        OWNER,
        INSTRUCTOR,
      );
      expect(
        tx.certificate_bulk_import_items.create.mock.calls[0][0].data,
      ).toMatchObject({
        instructor_user_id: INSTRUCTOR,
        instructor_name: null,
      });
    });

    it('is born NEEDS_REVIEW with the code, without storing an ineligible instructor', async () => {
      instructors.assertEligible.mockRejectedValue(
        new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_INVALID),
      );

      const item = await service.addItem(OWNER, 'batch-1', {
        item_type: CertificateBulkImportItemType.HONOR,
        honor_id: 12,
        completed_at: '2026-04-12',
        mark_as_ready: true,
        instructor_user_id: OTHER,
      });

      expect(item).toMatchObject({
        status: 'NEEDS_REVIEW',
        rejection_reason: ErrorCode.HONOR_INSTRUCTOR_INVALID,
        instructor_user_id: null,
        instructor_name: null,
      });
    });

    it('keeps a valid instructor when the catalog choice is what fails', async () => {
      tx.honors.findUnique.mockResolvedValue({ active: false });

      const item = await service.addItem(OWNER, 'batch-1', {
        item_type: CertificateBulkImportItemType.HONOR,
        honor_id: 12,
        completed_at: '2026-04-12',
        mark_as_ready: true,
        instructor_name: 'Juan López',
      });

      expect(item).toMatchObject({
        status: 'NEEDS_REVIEW',
        rejection_reason: 'CERTIFICATE_IMPORT_CATALOG_NOT_FOUND',
        instructor_name: 'Juan López',
      });
    });

    it('is born NEEDS_REVIEW (NOT_ALLOWED) when a CLASS row carries an instructor', async () => {
      tx.classes.findUnique.mockResolvedValue({
        active: true,
        asset_code: 'CQ-03',
      });

      const item = await service.addItem(OWNER, 'batch-1', {
        item_type: CertificateBulkImportItemType.CLASS,
        class_id: 3,
        instructor_name: 'Juan López',
      });

      expect(item).toMatchObject({
        status: 'NEEDS_REVIEW',
        rejection_reason:
          ErrorCode.CERTIFICATE_IMPORT_HONOR_INSTRUCTOR_NOT_ALLOWED,
        instructor_name: null,
      });
    });

    it('a ready HONOR row without instructor is READY (D1)', async () => {
      const item = await service.addItem(OWNER, 'batch-1', {
        item_type: CertificateBulkImportItemType.HONOR,
        honor_id: 12,
        completed_at: '2026-04-12',
        mark_as_ready: true,
      });

      expect(item).toMatchObject({ status: 'READY' });
    });
  });

  describe('createDraft items[]', () => {
    it('validates each instructor against the owner and downgrades the invalid ones', async () => {
      prisma.users.findUnique.mockResolvedValue({ local_field_id: 7 });
      tx.certificate_bulk_import_batches.create.mockResolvedValue({
        batch_id: 'batch-1',
        files: [],
        items: [],
      });
      instructors.assertEligible
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_SELF),
        );
      tx.certificate_bulk_import_items.findMany.mockResolvedValue([]);

      await service.createDraft(OWNER, {
        items: [
          {
            item_type: CertificateBulkImportItemType.HONOR,
            honor_id: 12,
            instructor_user_id: INSTRUCTOR,
          },
          {
            item_type: CertificateBulkImportItemType.HONOR,
            honor_id: 13,
            instructor_user_id: OWNER,
          },
        ],
      } as never);

      const rows =
        tx.certificate_bulk_import_items.createMany.mock.calls[0][0].data;
      expect(rows[0]).toMatchObject({ instructor_user_id: INSTRUCTOR });
      expect(rows[1]).toMatchObject({
        instructor_user_id: null,
        status: 'NEEDS_REVIEW',
        rejection_reason: ErrorCode.HONOR_INSTRUCTOR_SELF,
      });
    });
  });

  describe('runQueuedOcr re-run', () => {
    it('keeps rows the member already touched or completed', async () => {
      tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
        batch_id: 'batch-1',
        user_id: OWNER,
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
      const pending = {
        status: 'NEEDS_REVIEW',
        honor_id: null,
        class_id: null,
      };
      tx.certificate_bulk_import_items.findMany.mockResolvedValue([
        {
          item_id: 'pristine',
          ...pending,
          revision: 0,
          instructor_name: null,
          instructor_user_id: null,
        },
        {
          item_id: 'edited',
          ...pending,
          revision: 2,
          instructor_name: null,
          instructor_user_id: null,
        },
        {
          item_id: 'named',
          ...pending,
          revision: 0,
          instructor_name: 'Juan López',
          instructor_user_id: null,
        },
        {
          item_id: 'user',
          ...pending,
          revision: 0,
          instructor_name: null,
          instructor_user_id: INSTRUCTOR,
        },
      ]);
      ocrProvider.extract.mockResolvedValue({ rawText: '', items: [] });
      tx.certificate_bulk_import_batches.update.mockResolvedValue({
        batch_id: 'batch-1',
      });

      await service.runQueuedOcr(OWNER, 'batch-1');

      expect(tx.certificate_bulk_import_items.updateMany).toHaveBeenCalledWith({
        where: { item_id: { in: ['pristine'] } },
        data: { active: false },
      });
    });
  });
});
