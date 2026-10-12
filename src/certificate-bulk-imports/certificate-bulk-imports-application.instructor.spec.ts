import { CertificateBulkImportApplicationService } from './certificate-bulk-imports-application.service';

const MEMBER = 'member-1';
const ANA = '7d1f6c52-5a6f-4b8a-9d57-6f6b1a2f3c11';
const LUIS = '0a0a0a0a-5a6f-4b8a-9d57-6f6b1a2f3c22';
const DATE = new Date('2026-04-12T00:00:00.000Z');

describe('CertificateBulkImportApplicationService instructor (B2, D7)', () => {
  const tx = {
    certificate_bulk_import_items: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    certificate_bulk_import_batches: { update: jest.fn() },
    users_honors: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    evidence_files: { createMany: jest.fn() },
    certificate_bulk_import_item_events: { create: jest.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
  };
  let service: CertificateBulkImportApplicationService;

  const item = (extra: Record<string, unknown> = {}) => ({
    item_id: 'item-1',
    status: 'SUBMITTED',
    item_type: 'HONOR',
    honor_id: 10,
    completed_at: DATE,
    applied_entity_id: null,
    instructor_user_id: null,
    instructor_name: null,
    batch: {
      batch_id: 'batch-1',
      user_id: MEMBER,
      files: [
        {
          file_url: 'https://cdn.sacdia.app/cert.jpg',
          file_name: 'cert.jpg',
          file_type: 'image/jpeg',
          uploaded_by_id: MEMBER,
        },
      ],
    },
    ...extra,
  });
  const existing = (extra: Record<string, unknown> = {}) => ({
    user_honor_id: 77,
    active: true,
    date: DATE,
    validation_status: 'IN_PROGRESS',
    instructor_user_id: null,
    instructor_name: null,
    ...extra,
  });
  const approve = (row: Record<string, unknown>) => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue(row);
    return service.approveItem('reviewer-1', 'batch-1', 'item-1', {});
  };
  const eventPayload = () =>
    tx.certificate_bulk_import_item_events.create.mock.calls[0][0].data.payload;
  const writtenData = () =>
    (tx.users_honors.update.mock.calls[0] ??
      tx.users_honors.create.mock.calls[0])[0].data;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (cb: (client: typeof tx) => unknown) => cb(tx),
    );
    service = new CertificateBulkImportApplicationService(prisma as never);
    tx.certificate_bulk_import_items.updateMany.mockResolvedValue({ count: 1 });
    tx.certificate_bulk_import_items.count.mockResolvedValue(0);
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-1',
    });
    tx.certificate_bulk_import_batches.update.mockResolvedValue({});
    tx.users_honors.create.mockResolvedValue({ user_honor_id: 50 });
    tx.users_honors.update.mockResolvedValue({ user_honor_id: 77 });
    tx.users_honors.findFirst.mockResolvedValue(null);
  });

  it('creates users_honors with a system instructor and audits only the kind and id', async () => {
    const result = await approve(item({ instructor_user_id: ANA }));

    expect(writtenData()).toMatchObject({
      instructor_user_id: ANA,
      instructor_name: null,
    });
    expect(eventPayload()).toMatchObject({
      instructor_kind: 'USER',
      instructor_user_id: ANA,
    });
    expect(result).toMatchObject({ instructor_conflict: false });
  });

  it('creates users_honors with an external instructor and keeps the free name out of the event', async () => {
    await approve(item({ instructor_name: 'Juan López Ruiz' }));

    expect(writtenData()).toMatchObject({
      instructor_user_id: null,
      instructor_name: 'Juan López Ruiz',
    });
    expect(eventPayload()).toMatchObject({ instructor_kind: 'EXTERNAL' });
    expect(JSON.stringify(eventPayload())).not.toContain('Juan');
  });

  it('creates it without instructor when the row has none', async () => {
    await approve(item());

    expect(eventPayload()).toMatchObject({ instructor_kind: 'NONE' });
  });

  it('replaces the instructor of a not-yet-approved row and records previous_instructor_kind', async () => {
    tx.users_honors.findFirst.mockResolvedValue(
      existing({
        date: new Date('2026-01-01T00:00:00.000Z'),
        instructor_user_id: LUIS,
      }),
    );

    await approve(item({ instructor_name: 'Juan López Ruiz' }));

    expect(writtenData()).toMatchObject({
      validation_status: 'APPROVED',
      instructor_user_id: null,
      instructor_name: 'Juan López Ruiz',
    });
    expect(eventPayload()).toMatchObject({ previous_instructor_kind: 'USER' });
    expect(eventPayload().instructor_conflict).toBeUndefined();
  });

  it('never erases the existing instructor of a not-yet-approved row by omission', async () => {
    tx.users_honors.findFirst.mockResolvedValue(
      existing({
        date: new Date('2026-01-01T00:00:00.000Z'),
        instructor_user_id: LUIS,
      }),
    );

    await approve(item());

    expect(writtenData()).not.toHaveProperty('instructor_user_id');
    expect(writtenData()).not.toHaveProperty('instructor_name');
  });

  it('keeps an APPROVED row with another date untouched (FINAL_DATE_CONFLICT)', async () => {
    tx.users_honors.findFirst.mockResolvedValue(
      existing({
        validation_status: 'APPROVED',
        date: new Date('2025-01-01T00:00:00.000Z'),
        instructor_user_id: LUIS,
      }),
    );

    await expect(approve(item({ instructor_user_id: ANA }))).rejects.toThrow(
      'CERTIFICATE_IMPORT_FINAL_DATE_CONFLICT',
    );
    expect(tx.users_honors.update).not.toHaveBeenCalled();
  });

  it('completes the instructor of an APPROVED row with the same date that had none', async () => {
    tx.users_honors.findFirst.mockResolvedValue(
      existing({ validation_status: 'APPROVED' }),
    );

    const result = await approve(item({ instructor_user_id: ANA }));

    expect(writtenData()).toMatchObject({ instructor_user_id: ANA });
    expect(result).toMatchObject({ instructor_conflict: false });
  });

  it('keeps the existing instructor of an APPROVED row and flags instructor_conflict', async () => {
    tx.users_honors.findFirst.mockResolvedValue(
      existing({ validation_status: 'APPROVED', instructor_user_id: LUIS }),
    );

    const result = await approve(item({ instructor_name: 'Juan López Ruiz' }));

    expect(writtenData()).not.toHaveProperty('instructor_user_id');
    expect(writtenData()).not.toHaveProperty('instructor_name');
    expect(eventPayload()).toMatchObject({
      instructor_conflict: true,
      kept_instructor_kind: 'USER',
      kept_instructor_user_id: LUIS,
    });
    expect(JSON.stringify(eventPayload())).not.toContain('Juan');
    expect(result).toMatchObject({ instructor_conflict: true });
  });

  it('keeps an external instructor without exposing its name, and compares names case-insensitively', async () => {
    tx.users_honors.findFirst.mockResolvedValue(
      existing({
        validation_status: 'APPROVED',
        instructor_name: 'Marta Díaz',
      }),
    );

    const conflict = await approve(item({ instructor_user_id: ANA }));
    expect(conflict).toMatchObject({ instructor_conflict: true });
    expect(eventPayload()).toMatchObject({ kept_instructor_kind: 'EXTERNAL' });
    expect(eventPayload()).not.toHaveProperty('kept_instructor_user_id');
    expect(JSON.stringify(eventPayload())).not.toContain('Marta');

    jest.clearAllMocks();
    tx.certificate_bulk_import_items.updateMany.mockResolvedValue({ count: 1 });
    tx.certificate_bulk_import_items.update.mockResolvedValue({
      item_id: 'item-1',
    });
    tx.certificate_bulk_import_batches.update.mockResolvedValue({});
    tx.users_honors.update.mockResolvedValue({ user_honor_id: 77 });
    tx.users_honors.findFirst.mockResolvedValue(
      existing({
        validation_status: 'APPROVED',
        instructor_name: 'Marta Díaz',
      }),
    );
    const same = await approve(item({ instructor_name: 'marta díaz' }));
    expect(same).toMatchObject({ instructor_conflict: false });
  });
});
