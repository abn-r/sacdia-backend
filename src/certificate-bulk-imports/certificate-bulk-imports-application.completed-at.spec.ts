import { CertificateBulkImportApplicationService } from './certificate-bulk-imports-application.service';

const MEMBER = 'member-1';
const DONE = new Date('2026-04-12T00:00:00.000Z');
const START = new Date('2026-04-01T00:00:00.000Z');

describe('CertificateBulkImportApplicationService completed_at (M5)', () => {
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

  const item = (completed_at: Date = DONE) => ({
    item_id: 'item-1',
    status: 'SUBMITTED',
    item_type: 'HONOR',
    honor_id: 10,
    completed_at,
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
  });
  const existing = (extra: Record<string, unknown> = {}) => ({
    user_honor_id: 77,
    active: true,
    date: START,
    completed_at: null,
    validation_status: 'IN_PROGRESS',
    instructor_user_id: null,
    instructor_name: null,
    ...extra,
  });
  const approve = (row: ReturnType<typeof item>) => {
    tx.certificate_bulk_import_items.findFirst.mockResolvedValue(row);
    return service.approveItem('reviewer-1', 'batch-1', 'item-1', {});
  };
  const updateData = () => tx.users_honors.update.mock.calls[0][0].data;

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

  it('writes completed_at on a new row, and date mirrors it because the start is unknown', async () => {
    await approve(item());

    expect(tx.users_honors.create.mock.calls[0][0].data).toMatchObject({
      date: DONE,
      completed_at: DONE,
      validation_status: 'APPROVED',
    });
  });

  it('writes completed_at on an open normal-flow row without overwriting its start date', async () => {
    tx.users_honors.findFirst.mockResolvedValue(existing());

    await approve(item());

    expect(updateData()).toMatchObject({
      validation_status: 'APPROVED',
      completed_at: DONE,
    });
    expect(updateData()).not.toHaveProperty('date');
  });

  it('approves an open row whose start date equals the certificate date (start is not completion)', async () => {
    tx.users_honors.findFirst.mockResolvedValue(
      existing({ date: DONE, validation_status: 'IN_PROGRESS' }),
    );

    await approve(item());

    expect(updateData()).toMatchObject({
      validate: true,
      validation_status: 'APPROVED',
      validated_by_id: 'reviewer-1',
    });
  });

  it('compares completed_at, not date, on an APPROVED row', async () => {
    // date (start) coincide con el ítem, pero la finalización aprobada es otra.
    tx.users_honors.findFirst.mockResolvedValue(
      existing({
        validation_status: 'APPROVED',
        date: DONE,
        completed_at: new Date('2026-04-20T00:00:00.000Z'),
      }),
    );

    await expect(approve(item())).rejects.toThrow(
      'CERTIFICATE_IMPORT_FINAL_DATE_CONFLICT',
    );
    expect(tx.users_honors.update).not.toHaveBeenCalled();
  });

  it('treats an APPROVED row as identical when completed_at matches even if the start date differs', async () => {
    tx.users_honors.findFirst.mockResolvedValue(
      existing({
        validation_status: 'APPROVED',
        date: START,
        completed_at: DONE,
      }),
    );

    await approve(item());

    expect(updateData()).toEqual({
      active: true,
      certificate: 'https://cdn.sacdia.app/cert.jpg',
      images: ['https://cdn.sacdia.app/cert.jpg'],
    });
  });

  it('falls back to date on a legacy APPROVED row without completed_at and confirms it when identical', async () => {
    tx.users_honors.findFirst.mockResolvedValue(
      existing({ validation_status: 'APPROVED', date: DONE }),
    );

    await approve(item());

    expect(updateData()).toMatchObject({ completed_at: DONE });
    expect(updateData()).not.toHaveProperty('validation_status');
  });

  it('keeps the FINAL_DATE_CONFLICT on a legacy APPROVED row whose date differs', async () => {
    tx.users_honors.findFirst.mockResolvedValue(
      existing({ validation_status: 'APPROVED', date: START }),
    );

    await expect(approve(item())).rejects.toThrow(
      'CERTIFICATE_IMPORT_FINAL_DATE_CONFLICT',
    );
    expect(tx.users_honors.update).not.toHaveBeenCalled();
  });

  it('rejects a pre-D6 item older than 1960 instead of failing on the CHECK', async () => {
    await expect(
      approve(item(new Date('1959-12-31T00:00:00.000Z'))),
    ).rejects.toThrow('CERTIFICATE_IMPORT_DATE_TOO_OLD');

    expect(tx.users_honors.create).not.toHaveBeenCalled();
    expect(tx.users_honors.update).not.toHaveBeenCalled();
  });
});
