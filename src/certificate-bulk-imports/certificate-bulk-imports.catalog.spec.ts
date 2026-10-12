import { I18nContext } from 'nestjs-i18n';
import { CertificateBulkImportsService } from './certificate-bulk-imports.service';
import { CertificateBulkImportItemType } from './certificate-bulk-imports.types';

/**
 * Slice B1: catálogo de clases del flujo, nombres de catálogo en la respuesta
 * del miembro (inconsistencia 3) y rango de fechas (D6) en el servicio.
 */
describe('CertificateBulkImportsService catalog and date range (B1)', () => {
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
    classes: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const prisma = {
    ...tx,
    users: { findUnique: jest.fn() },
    $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
  };
  const ocrProvider = { extract: jest.fn() };
  let service: CertificateBulkImportsService;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    service = new CertificateBulkImportsService(
      prisma as never,
      ocrProvider,
      null,
      {
        assertEligible: jest.fn(),
        photoUrlsFor: jest.fn().mockResolvedValue(new Map()),
      } as never,
    );
    tx.certificate_bulk_import_items.count.mockResolvedValue(1);
    tx.honors.findUnique.mockResolvedValue({ active: true });
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      revision: 0,
    });
  });

  describe('listClassCatalog', () => {
    const rows = [
      {
        class_id: 1,
        name: 'Amigo',
        asset_code: 'CQ-01',
        club_type_id: 2,
        translations: [],
      },
      {
        // Retirada: ya no está en la ventana de disponibilidad de GET /classes.
        class_id: 9,
        name: 'Amigo (plan 1998)',
        asset_code: null,
        club_type_id: 2,
        translations: [],
      },
      {
        class_id: 30,
        name: 'Instructor',
        asset_code: 'GM-03',
        club_type_id: 3,
        translations: [{ locale: 'en', name: 'Instructor (EN)' }],
      },
    ];

    it('includes retired and institutional classes and flags the institutional ones', async () => {
      tx.classes.findMany.mockResolvedValue(rows);
      prisma.classes.findMany.mockResolvedValue(rows);

      const result = await service.listClassCatalog();

      expect(result).toEqual([
        {
          class_id: 1,
          name: 'Amigo',
          asset_code: 'CQ-01',
          club_type_id: 2,
          institutional: false,
        },
        {
          class_id: 9,
          name: 'Amigo (plan 1998)',
          asset_code: null,
          club_type_id: 2,
          institutional: false,
        },
        {
          class_id: 30,
          name: 'Instructor',
          asset_code: 'GM-03',
          club_type_id: 3,
          institutional: true,
        },
      ]);
    });

    it('uses the same rule as assertCatalogChoice and no availability window', async () => {
      prisma.classes.findMany.mockResolvedValue([]);

      await service.listClassCatalog();

      const args = prisma.classes.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        OR: [{ active: true }, { asset_code: { in: ['GM-02', 'GM-03'] } }],
      });
      expect(JSON.stringify(args.where)).not.toContain('available_');
    });

    it('filters by club type when asked', async () => {
      prisma.classes.findMany.mockResolvedValue([]);

      await service.listClassCatalog(2);

      expect(prisma.classes.findMany.mock.calls[0][0].where).toMatchObject({
        club_type_id: 2,
      });
    });

    it('translates the name for the request locale', async () => {
      jest
        .spyOn(I18nContext, 'current')
        .mockReturnValue({ lang: 'en' } as never);
      prisma.classes.findMany.mockResolvedValue([rows[2]]);

      const [instructor] = await service.listClassCatalog();

      expect(instructor.name).toBe('Instructor (EN)');
      expect(
        prisma.classes.findMany.mock.calls[0][0].select.translations,
      ).toEqual({
        where: { locale: 'en' },
        select: { locale: true, name: true },
      });
    });

    it('orders by club type, display order and id', async () => {
      prisma.classes.findMany.mockResolvedValue([]);

      await service.listClassCatalog();

      expect(prisma.classes.findMany.mock.calls[0][0].orderBy).toEqual([
        { club_type_id: 'asc' },
        { display_order: 'asc' },
        { class_id: 'asc' },
      ]);
    });
  });

  describe('getBatch (member response)', () => {
    it('loads honor/category and class/club type and returns class.asset_code', async () => {
      prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
        batch_id: 'batch-1',
        files: [],
        items: [
          {
            item_id: 'item-1',
            class_id: 4,
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

      const result = await service.getBatch('user-1', 'batch-1');

      const include =
        prisma.certificate_bulk_import_batches.findFirst.mock.calls[0][0]
          .include;
      expect(
        include.items.include.honor.select.honors_categories,
      ).toBeDefined();
      expect(include.items.include.class.select.club_types).toBeDefined();
      expect(result.items[0].class).toEqual({
        class_id: 4,
        name: 'Amigo',
        asset_code: 'CQ-01',
        club_type: { club_type_id: 2, name: 'Conquistadores' },
      });
    });
  });

  describe('certificate date range (D6)', () => {
    const existing = {
      item_id: 'item-1',
      status: 'NEEDS_REVIEW',
      item_type: 'HONOR',
      honor_id: 12,
      completed_at: null,
      revision: 0,
    };

    beforeEach(() => {
      tx.certificate_bulk_import_items.findFirst.mockResolvedValue(existing);
      tx.certificate_bulk_import_items.update.mockResolvedValue({
        item_id: 'item-1',
      });
    });

    it('rejects completed_at 1959-12-31 on updateItem with DATE_TOO_OLD', async () => {
      await expect(
        service.updateItem('user-1', 'batch-1', 'item-1', {
          completed_at: '1959-12-31',
        }),
      ).rejects.toThrow('CERTIFICATE_IMPORT_DATE_TOO_OLD');
      expect(tx.certificate_bulk_import_items.update).not.toHaveBeenCalled();
    });

    it('accepts completed_at 1960-01-01 on updateItem', async () => {
      await service.updateItem('user-1', 'batch-1', 'item-1', {
        completed_at: '1960-01-01',
      });

      expect(tx.certificate_bulk_import_items.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completed_at: new Date('1960-01-01T00:00:00.000Z'),
          }),
        }),
      );
    });

    it('rejects tomorrow on updateItem with DATE_IN_FUTURE', async () => {
      const next = new Date();
      next.setUTCDate(next.getUTCDate() + 1);

      await expect(
        service.updateItem('user-1', 'batch-1', 'item-1', {
          completed_at: next.toISOString().slice(0, 10),
        }),
      ).rejects.toThrow('CERTIFICATE_IMPORT_DATE_IN_FUTURE');
    });

    it('rejects an old date on resubmit', async () => {
      tx.certificate_bulk_import_items.findFirst.mockResolvedValue({
        ...existing,
        status: 'REJECTED',
      });

      await expect(
        service.resubmitItem('user-1', 'batch-1', 'item-1', {
          item_type: CertificateBulkImportItemType.HONOR,
          honor_id: 12,
          completed_at: '1959-12-31',
          mark_as_ready: true,
        }),
      ).rejects.toThrow('CERTIFICATE_IMPORT_DATE_TOO_OLD');
    });

    it('BC-9: addItem does not fail on an old date, it is born NEEDS_REVIEW with the code', async () => {
      tx.certificate_bulk_import_items.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          item_id: 'item-new',
          ...data,
        }),
      );

      const item = await service.addItem('user-1', 'batch-1', {
        item_type: CertificateBulkImportItemType.HONOR,
        honor_id: 12,
        completed_at: '1925-05-12',
        mark_as_ready: true,
      });

      expect(item).toMatchObject({
        status: 'NEEDS_REVIEW',
        rejection_reason: 'CERTIFICATE_IMPORT_DATE_TOO_OLD',
      });
    });
  });

  describe('runQueuedOcr with an out-of-range date', () => {
    it('stores the raw date in detected_date and leaves completed_at empty', async () => {
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
          },
        ],
      });
      ocrProvider.extract.mockResolvedValue({
        rawText: 'Especialidad: Mayordomía Fecha: 1925-05-12',
        items: [
          {
            type: 'HONOR',
            detectedName: 'Mayordomía',
            detectedDate: '1925-05-12',
            confidence: 0.48,
            fieldConfidence: { name: 0.7, date: 0 },
          },
        ],
      });
      tx.certificate_bulk_import_items.findMany.mockResolvedValue([]);
      tx.certificate_bulk_import_batches.update.mockResolvedValue({
        batch_id: 'batch-1',
      });

      await service.runQueuedOcr('user-1', 'batch-1');

      const [{ data }] =
        tx.certificate_bulk_import_items.createMany.mock.calls[0];
      expect(data[0].detected_date).toEqual(
        new Date('1925-05-12T00:00:00.000Z'),
      );
      expect(data[0].completed_at).toBeUndefined();
      expect(data[0].field_confidence).toEqual({ name: 0.7, date: 0 });
      expect(data[0].status).toBe('NEEDS_REVIEW');
    });
  });
});
