import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InstitutionalCertificateRequestsService } from './institutional-certificate-requests.service';

const completedAt = new Date('2008-07-07T00:00:00.000Z');

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    request_id: 'request-1',
    user_id: 'owner-1',
    class_id: 9,
    file_id: 'file-1',
    status: 'PENDING_REVIEW',
    revision: 0,
    completed_at: completedAt,
    ecclesiastical_year_id: null,
    decision_reason: null,
    reviewed_at: null,
    class: { asset_code: 'GM-02', name: 'Guía Mayor Avanzado' },
    ...overrides,
  };
}

describe('InstitutionalCertificateRequestsService', () => {
  const tx = {
    institutional_certificate_requests: { create: jest.fn() },
    certificate_bulk_import_files: { update: jest.fn() },
    institutional_certificate_request_events: { create: jest.fn() },
  };

  const prisma = {
    classes: { findUnique: jest.fn() },
    certificate_bulk_import_files: { findFirst: jest.fn(), update: jest.fn() },
    institutional_certificate_requests: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    institutional_certificate_request_events: { create: jest.fn() },
    ecclesiastical_years: { findMany: jest.fn() },
    users: { findUnique: jest.fn() },
    enrollments: { create: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  let service: InstitutionalCertificateRequestsService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    service = new InstitutionalCertificateRequestsService(prisma as any);
    prisma.classes.findUnique.mockResolvedValue({
      class_id: 9,
      asset_code: 'GM-02',
      name: 'Guía Mayor Avanzado',
      active: false,
    });
    prisma.certificate_bulk_import_files.findFirst.mockResolvedValue({
      file_id: 'file-1',
      upload_status: 'CONFIRMED',
      object_key: 'sealed-key',
      batch: { user_id: 'owner-1', batch_id: 'batch-1' },
    });
    prisma.institutional_certificate_requests.findFirst.mockResolvedValue(null);
    prisma.ecclesiastical_years.findMany.mockResolvedValue([
      {
        year_id: 2008,
        start_date: new Date('2008-01-01T00:00:00.000Z'),
        end_date: new Date('2008-12-31T00:00:00.000Z'),
        active: false,
      },
    ]);
    prisma.users.findUnique.mockResolvedValue({
      users_roles: [{ roles: { role_name: 'super-admin' } }],
    });
  });

  it('creates one institutional request and does not enroll the class', async () => {
    tx.institutional_certificate_requests.create.mockResolvedValue(
      requestRow({ ecclesiastical_year_id: 2008, batch_id: 'batch-1' }),
    );

    const view = await service.submit('owner-1', {
      class_id: 9,
      file_id: 'file-1',
      completed_at: '2008-07-07',
    });

    expect(view).toMatchObject({
      status: 'PENDING_REVIEW',
      asset_code: 'GM-02',
      enrollment_created: false,
      approval_blockers: [],
      batch_id: 'batch-1',
    });
    expect(tx.certificate_bulk_import_files.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { jurisdiction: 'INSTITUTIONAL' },
      }),
    );
    expect(prisma.enrollments.create).not.toHaveBeenCalled();
  });

  it('returns the winning request when a parallel submit hits the open unique index', async () => {
    prisma.institutional_certificate_requests.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(requestRow({ batch_id: 'batch-1' }));
    tx.institutional_certificate_requests.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const view = await service.submit('owner-1', {
      class_id: 9,
      file_id: 'file-1',
      completed_at: '2008-07-07',
    });

    expect(view.request_id).toBe('request-1');
    expect(tx.institutional_certificate_request_events.create).not.toHaveBeenCalled();
    expect(prisma.enrollments.create).not.toHaveBeenCalled();
  });

  it('reuses an open request instead of creating a second one', async () => {
    prisma.institutional_certificate_requests.findFirst.mockResolvedValue(
      requestRow(),
    );

    const view = await service.submit('owner-1', {
      class_id: 9,
      file_id: 'file-1',
      completed_at: '2008-07-07',
    });

    expect(view.request_id).toBe('request-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.enrollments.create).not.toHaveBeenCalled();
  });

  it('rejects an ordinary class and an unconfirmed file', async () => {
    prisma.classes.findUnique.mockResolvedValue({
      class_id: 1,
      asset_code: 'CQ-01',
      active: true,
    });

    await expect(
      service.submit('owner-1', {
        class_id: 1,
        file_id: 'file-1',
        completed_at: '2008-07-07',
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_CLASS_NOT_INSTITUTIONAL');

    prisma.classes.findUnique.mockResolvedValue({
      class_id: 9,
      asset_code: 'GM-02',
      active: false,
    });
    prisma.certificate_bulk_import_files.findFirst.mockResolvedValue({
      file_id: 'file-1',
      upload_status: 'PENDING_UPLOAD',
      object_key: null,
      batch: { user_id: 'owner-1', batch_id: 'batch-1' },
    });

    await expect(
      service.submit('owner-1', {
        class_id: 9,
        file_id: 'file-1',
        completed_at: '2008-07-07',
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
  });

  it('denies Campo Local, generic admin and Union', async () => {
    for (const roleName of [
      'director-lf',
      'admin',
      'assistant-admin',
      'director-union',
      'assistant-union',
    ]) {
      prisma.users.findUnique.mockResolvedValue({
        users_roles: [{ roles: { role_name: roleName } }],
      });
      await expect(
        service.listForReview('reviewer-1', 1, 20),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(
      prisma.institutional_certificate_requests.findMany,
    ).not.toHaveBeenCalled();
  });

  it('approves without creating an enrollment and keeps a repeated approval quiet', async () => {
    prisma.institutional_certificate_requests.findFirst
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce(
        requestRow({ status: 'APPROVED', ecclesiastical_year_id: 2008, revision: 1 }),
      );
    prisma.institutional_certificate_requests.updateMany.mockResolvedValue({
      count: 1,
    });

    const approved = await service.approve('super-1', 'request-1', {
      expected_revision: 0,
    });

    expect(approved).toMatchObject({
      status: 'APPROVED',
      enrollment_created: false,
    });
    expect(prisma.enrollments.create).not.toHaveBeenCalled();

    prisma.institutional_certificate_requests.findFirst.mockResolvedValue(
      requestRow({ status: 'APPROVED', revision: 1 }),
    );
    await service.approve('super-1', 'request-1', { expected_revision: 1 });
    expect(
      prisma.institutional_certificate_request_events.create,
    ).toHaveBeenCalledTimes(1);
  });

  it('blocks approval when the historical period is missing', async () => {
    prisma.institutional_certificate_requests.findFirst.mockResolvedValue(
      requestRow(),
    );
    prisma.ecclesiastical_years.findMany.mockResolvedValue([]);

    await expect(
      service.approve('super-1', 'request-1', { expected_revision: 0 }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_YEAR_NOT_FOUND');
    expect(
      prisma.institutional_certificate_requests.updateMany,
    ).not.toHaveBeenCalled();
    expect(prisma.enrollments.create).not.toHaveBeenCalled();
  });

  it('rejects a stale revision and a decision that contradicts a final one', async () => {
    prisma.institutional_certificate_requests.findFirst.mockResolvedValue(
      requestRow({ revision: 2 }),
    );

    await expect(
      service.reject('super-1', 'request-1', {
        expected_revision: 1,
        reason: 'No coincide la persona',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.institutional_certificate_requests.findFirst.mockResolvedValue(
      requestRow({ status: 'APPROVED', revision: 1 }),
    );
    await expect(
      service.reject('super-1', 'request-1', {
        expected_revision: 1,
        reason: 'No coincide la persona',
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_DECISION_IMMUTABLE');
    expect(
      prisma.institutional_certificate_requests.updateMany,
    ).not.toHaveBeenCalled();
  });
});
