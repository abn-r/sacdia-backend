import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCertificateImportItemDto } from './dto';
import { CertificateBulkImportsService } from './certificate-bulk-imports.service';
import { CertificateBulkImportItemType } from './certificate-bulk-imports.types';

const FILE_A = '11111111-1111-4111-8111-111111111111';
const FILE_B = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';

describe('CertificateBulkImportsService source file and page (B4)', () => {
  const tx = {
    certificate_bulk_import_batches: {
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
  };
  const prisma = {
    certificate_bulk_import_batches: tx.certificate_bulk_import_batches,
    certificate_bulk_import_items: tx.certificate_bulk_import_items,
    $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
  };
  const ocrProvider = { extract: jest.fn() };
  const instructors = { assertEligible: jest.fn(), photoUrlsFor: jest.fn() };
  let service: CertificateBulkImportsService;

  const file = (fileId: string, name: string) => ({
    file_id: fileId,
    file_url: `evidence/${name}`,
    file_name: name,
    file_type: 'application/pdf',
    upload_status: 'CONFIRMED',
    object_key: `batches/batch-1/sealed/${name}`,
    active: true,
    confirmed_at: new Date('2026-10-02T00:00:00.000Z'),
  });
  const candidate = (extra: Record<string, unknown>) => ({
    type: CertificateBulkImportItemType.HONOR,
    detectedName: 'Nudos',
    completedAt: '2024-05-12',
    confidence: 0.72,
    fieldConfidence: { date: 0.7 },
    ...extra,
  });
  const createdRows = () =>
    tx.certificate_bulk_import_items.createMany.mock.calls[0][0].data;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (cb: (client: typeof tx) => unknown) => cb(tx),
    );
    instructors.photoUrlsFor.mockResolvedValue(new Map());
    service = new CertificateBulkImportsService(
      prisma as never,
      ocrProvider as never,
      null,
      instructors as never,
    );
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
      files: [file(FILE_A, 'a.pdf'), file(FILE_B, 'b.pdf')],
    });
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([]);
    tx.certificate_bulk_import_batches.update.mockResolvedValue({
      batch_id: 'batch-1',
    });
  });

  describe('runQueuedOcr', () => {
    it('stores the file and page of each suggested row', async () => {
      ocrProvider.extract.mockResolvedValue({
        rawText: 'x',
        files: [],
        items: [
          candidate({ sourceFileId: FILE_A, sourcePage: 3 }),
          candidate({
            detectedName: 'Natación',
            sourceFileId: FILE_B,
            sourcePage: 1,
          }),
        ],
      });

      await service.runQueuedOcr('user-1', 'batch-1');

      expect(createdRows()).toEqual([
        expect.objectContaining({ source_file_id: FILE_A, source_page: 3 }),
        expect.objectContaining({ source_file_id: FILE_B, source_page: 1 }),
      ]);
    });

    it('leaves both null when the parser could not locate the row', async () => {
      ocrProvider.extract.mockResolvedValue({
        rawText: 'x',
        files: [],
        items: [candidate({})],
      });

      await service.runQueuedOcr('user-1', 'batch-1');

      expect(createdRows()[0]).toMatchObject({
        source_file_id: null,
        source_page: null,
      });
    });

    it('drops a file that is not part of the readable batch files, and its page with it', async () => {
      ocrProvider.extract.mockResolvedValue({
        rawText: 'x',
        files: [],
        items: [candidate({ sourceFileId: STRANGER, sourcePage: 2 })],
      });

      await service.runQueuedOcr('user-1', 'batch-1');

      expect(createdRows()[0]).toMatchObject({
        source_file_id: null,
        source_page: null,
      });
    });

    it('does not put the per-page text in the stored payload', async () => {
      ocrProvider.extract.mockResolvedValue({
        rawText: 'x',
        files: [{ fileId: FILE_A, pages: [{ pageNumber: 1, text: 'pagina' }] }],
        items: [candidate({ sourceFileId: FILE_A, sourcePage: 1 })],
      });

      await service.runQueuedOcr('user-1', 'batch-1');

      const payload =
        tx.certificate_bulk_import_batches.update.mock.calls[0][0].data
          .raw_ocr_payload;
      expect(payload).not.toHaveProperty('files');
      expect(payload.items[0]).toMatchObject({
        sourceFileId: FILE_A,
        sourcePage: 1,
      });
    });
  });

  describe('manual rows and edits', () => {
    beforeEach(() => {
      instructors.assertEligible.mockResolvedValue(undefined);
      tx.certificate_bulk_import_items.count.mockResolvedValue(1);
      tx.honors.findUnique.mockResolvedValue({ active: true });
      tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
        item_id: 'item-1',
        status: 'NEEDS_REVIEW',
        item_type: 'HONOR',
        honor_id: 12,
        class_id: null,
        revision: 0,
        source_file_id: FILE_A,
        source_page: 3,
      });
      tx.certificate_bulk_import_items.update.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          item_id: 'item-1',
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

    it('a manual row is born without source file or page', async () => {
      await service.addItem('user-1', 'batch-1', {
        item_type: CertificateBulkImportItemType.HONOR,
        honor_id: 12,
      });

      const data =
        tx.certificate_bulk_import_items.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('source_file_id');
      expect(data).not.toHaveProperty('source_page');
    });

    it('editing a row never touches where the OCR read it', async () => {
      await service.updateItem('user-1', 'batch-1', 'item-1', {
        item_type: CertificateBulkImportItemType.HONOR,
        honor_id: 13,
        detected_name: 'Nudos y amarras',
        completed_at: '2024-05-12',
        mark_as_ready: true,
      });

      const data =
        tx.certificate_bulk_import_items.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('source_file_id');
      expect(data).not.toHaveProperty('source_page');
    });

    it('the member DTO does not accept source_page or source_file_id', async () => {
      const dto = plainToInstance(UpdateCertificateImportItemDto, {
        source_page: 2,
        source_file_id: FILE_A,
      });

      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      expect(errors.map((error) => error.property).sort()).toEqual([
        'source_file_id',
        'source_page',
      ]);
    });
  });
});
