import { CertificateBulkImportsService } from './certificate-bulk-imports.service';

/** Carga por certificado: auto-match exacto de la especialidad detectada. */
describe('CertificateBulkImportsService honor auto-match', () => {
  const tx = {
    certificate_bulk_import_batches: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    certificate_bulk_import_items: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    certificate_bulk_import_item_events: { create: jest.fn() },
    honors: { findMany: jest.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
  };
  const ocrProvider = { extract: jest.fn() };
  let service: CertificateBulkImportsService;

  const ocrItem = (type: string, detectedName: string) => ({
    type,
    detectedName,
    completedAt: '2026-04-12',
    confidence: 0.9,
    fieldConfidence: { name: 0.9 },
  });

  const run = async (items: unknown[]) => {
    ocrProvider.extract.mockResolvedValue({ rawText: 'x', items });
    await service.runQueuedOcr('user-1', 'batch-1');
    const calls = tx.certificate_bulk_import_items.createMany.mock.calls;
    return calls.length ? calls[0][0].data : [];
  };

  beforeEach(() => {
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
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      user_id: 'user-1',
      status: 'DRAFT',
      files: [
        {
          file_id: 'f1',
          file_url: 'evidence/cert.jpg',
          file_name: 'cert.jpg',
          file_type: 'image/jpeg',
          upload_status: 'CONFIRMED',
          object_key: 'batches/batch-1/sealed/cert.jpg',
        },
      ],
    });
    tx.certificate_bulk_import_batches.update.mockResolvedValue({
      batch_id: 'batch-1',
    });
    tx.certificate_bulk_import_items.findMany.mockResolvedValue([]);
    tx.honors.findMany.mockResolvedValue([
      { honor_id: 7, name: 'Natación I' },
      { honor_id: 8, name: 'Natación II' },
      { honor_id: 20, name: 'Nudos' },
      { honor_id: 21, name: 'nudos ' },
    ]);
  });

  it('sets honor_id and the marker on a unique exact match', async () => {
    const [row] = await run([ocrItem('HONOR', 'Natación I')]);

    expect(row.honor_id).toBe(7);
    expect(row.field_confidence).toEqual({ name: 0.9, honor_auto_match: 1 });
    expect(tx.honors.findMany).toHaveBeenCalledWith({
      where: { active: true },
      select: { honor_id: true, name: true },
    });
  });

  it('ignores case, accents and inner whitespace', async () => {
    const [row] = await run([ocrItem('HONOR', '  natacion   i ')]);

    expect(row.honor_id).toBe(7);
    expect(row.field_confidence.honor_auto_match).toBe(1);
  });

  it('leaves honor_id null when two honors share the normalized name', async () => {
    const [row] = await run([ocrItem('HONOR', 'Nudos')]);

    expect(row).not.toHaveProperty('honor_id');
    expect(row.field_confidence).toEqual({ name: 0.9 });
  });

  it('leaves honor_id null for an honor outside the member catalog', async () => {
    // El catálogo solo trae activos: "Buceo" (inactivo) no está en la lista.
    const [row] = await run([ocrItem('HONOR', 'Buceo')]);

    expect(row).not.toHaveProperty('honor_id');
    expect(row.field_confidence).toEqual({ name: 0.9 });
  });

  it('does not match fuzzily', async () => {
    const [row] = await run([ocrItem('HONOR', 'Natación')]);

    expect(row).not.toHaveProperty('honor_id');
  });

  it('does not touch CLASS rows and loads the catalog once per run', async () => {
    const rows = await run([
      ocrItem('CLASS', 'Natación I'),
      ocrItem('HONOR', 'Natación I'),
      ocrItem('HONOR', 'Natación II'),
    ]);

    expect(rows[0]).not.toHaveProperty('honor_id');
    expect(rows[1].honor_id).toBe(7);
    expect(rows[2].honor_id).toBe(8);
    expect(tx.honors.findMany).toHaveBeenCalledTimes(1);
  });

  it('marks the row READY when the date was read with confidence', async () => {
    const [ready, doubtful, unmatched] = await run([
      { ...ocrItem('HONOR', 'Natación I'), fieldConfidence: { date: 0.9 } },
      { ...ocrItem('HONOR', 'Natación II'), fieldConfidence: { date: 0.6 } },
      { ...ocrItem('HONOR', 'Buceo'), fieldConfidence: { date: 0.9 } },
    ]);

    expect(ready.status).toBe('READY');
    // Fecha dudosa: la especialidad queda elegida, el miembro confirma la fecha.
    expect(doubtful.honor_id).toBe(8);
    expect(doubtful.status).toBe('NEEDS_REVIEW');
    expect(unmatched.status).toBe('NEEDS_REVIEW');
  });

  it('keeps a match without date waiting for the member', async () => {
    const [row] = await run([
      {
        ...ocrItem('HONOR', 'Natación I'),
        completedAt: undefined,
        fieldConfidence: { date: 0 },
      },
    ]);

    expect(row.honor_id).toBe(7);
    expect(row.status).toBe('NEEDS_REVIEW');
  });

  it('skips the catalog query when there are no honor rows', async () => {
    await run([ocrItem('CLASS', 'Amigo')]);

    expect(tx.honors.findMany).not.toHaveBeenCalled();
  });

  describe('reprocess', () => {
    const base = {
      status: 'NEEDS_REVIEW',
      class_id: null,
      instructor_user_id: null,
      instructor_name: null,
      revision: 0,
    };

    it('discards an untouched auto-matched row and keeps an edited one', async () => {
      tx.certificate_bulk_import_items.findMany.mockResolvedValue([
        {
          ...base,
          item_id: 'auto',
          honor_id: 7,
          field_confidence: { name: 0.9, honor_auto_match: 1 },
        },
        {
          ...base,
          item_id: 'edited',
          honor_id: 7,
          revision: 2,
          field_confidence: { name: 0.9, honor_auto_match: 1 },
        },
        {
          ...base,
          item_id: 'with-instructor',
          honor_id: 7,
          instructor_name: 'Ana',
          field_confidence: { honor_auto_match: 1 },
        },
        {
          ...base,
          item_id: 'member-picked',
          honor_id: 8,
          field_confidence: { name: 0.9 },
        },
        { ...base, item_id: 'plain', honor_id: null, field_confidence: {} },
        {
          ...base,
          item_id: 'auto-ready',
          status: 'READY',
          honor_id: 7,
          field_confidence: { date: 0.9, honor_auto_match: 1 },
        },
        {
          ...base,
          item_id: 'member-ready',
          status: 'READY',
          honor_id: 8,
          revision: 1,
          field_confidence: { date: 0.9 },
        },
      ]);

      await run([ocrItem('HONOR', 'Natación I')]);

      expect(tx.certificate_bulk_import_items.updateMany).toHaveBeenCalledWith({
        where: { item_id: { in: ['auto', 'plain', 'auto-ready'] } },
        data: { active: false },
      });
    });
  });
});
