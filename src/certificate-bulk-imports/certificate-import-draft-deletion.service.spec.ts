import { Logger, NotFoundException } from '@nestjs/common';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { StorageBucketAlias } from '../common/services/file-storage.service';
import { CertificateImportDraftDeletionService } from './certificate-import-draft-deletion.service';

const SECRET_KEY = 'batches/batch-1/sealed/file-1-uuid.pdf';

describe('CertificateImportDraftDeletionService', () => {
  const tx = {
    certificate_bulk_import_batches: {
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
    institutional_certificate_requests: { count: jest.fn() },
  };
  const prisma = {
    certificate_bulk_import_batches: { findFirst: jest.fn() },
    $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
  };
  const storage = { deleteMany: jest.fn() };
  const queue = { getJob: jest.fn() };

  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  let service: CertificateImportDraftDeletionService;

  const draftFiles = [
    {
      staging_key: 'batches/batch-1/staging/file-1.pdf',
      object_key: SECRET_KEY,
      file_url: SECRET_KEY,
    },
    {
      staging_key: 'batches/batch-1/staging/file-2.jpg',
      object_key: null,
      file_url: 'https://cdn.example.com/legacy.jpg',
    },
  ];

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      status: 'DRAFT',
    });
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      status: 'DRAFT',
      files: draftFiles,
    });
    tx.certificate_bulk_import_batches.deleteMany.mockResolvedValue({
      count: 1,
    });
    tx.institutional_certificate_requests.count.mockResolvedValue(0);
    storage.deleteMany.mockResolvedValue(undefined);
    queue.getJob.mockResolvedValue(null);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    service = new CertificateImportDraftDeletionService(
      prisma as never,
      storage as never,
      queue as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const conflictCode = async (work: Promise<unknown>) => {
    const error = await work.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppConflictException);
    return (error as AppConflictException).code;
  };

  it('deletes the draft rows then the R2 objects for the owner', async () => {
    const order: string[] = [];
    tx.certificate_bulk_import_batches.deleteMany.mockImplementation(
      async () => {
        order.push('db');
        return { count: 1 };
      },
    );
    storage.deleteMany.mockImplementation(async () => {
      order.push('r2');
    });

    await expect(service.deleteDraft('user-1', 'batch-1')).resolves.toEqual({
      batch_id: 'batch-1',
      deleted: true,
    });

    expect(order).toEqual(['db', 'r2']);
    expect(tx.certificate_bulk_import_batches.deleteMany).toHaveBeenCalledWith({
      where: { batch_id: 'batch-1', user_id: 'user-1', status: 'DRAFT' },
    });
    // Unique keys only; legacy https references are not storage keys.
    expect(storage.deleteMany).toHaveBeenCalledWith(
      StorageBucketAlias.CERTIFICATE_IMPORTS,
      [
        'batches/batch-1/staging/file-1.pdf',
        SECRET_KEY,
        'batches/batch-1/staging/file-2.jpg',
      ],
    );
  });

  it('answers 404 for a non-owner or missing batch without touching the queue', async () => {
    prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue(null);

    await expect(service.deleteDraft('intruder', 'batch-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(
      prisma.certificate_bulk_import_batches.findFirst,
    ).toHaveBeenCalledWith({
      where: { batch_id: 'batch-1', user_id: 'intruder', active: true },
      select: { status: true },
    });
    expect(queue.getJob).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['SUBMITTED', 'NEEDS_CORRECTION', 'APPROVED', 'REJECTED'])(
    'answers 409 NOT_DELETABLE for a %s batch',
    async (status) => {
      prisma.certificate_bulk_import_batches.findFirst.mockResolvedValue({
        status,
      });

      expect(await conflictCode(service.deleteDraft('user-1', 'batch-1'))).toBe(
        ErrorCode.CERTIFICATE_IMPORT_BATCH_NOT_DELETABLE,
      );
      expect(
        tx.certificate_bulk_import_batches.deleteMany,
      ).not.toHaveBeenCalled();
      expect(storage.deleteMany).not.toHaveBeenCalled();
    },
  );

  it.each(['waiting', 'delayed', 'active', 'prioritized'])(
    'answers 409 OCR_IN_PROGRESS and deletes nothing for a %s job',
    async (state) => {
      const remove = jest.fn();
      queue.getJob.mockResolvedValue({
        getState: async () => state,
        remove,
      });

      expect(await conflictCode(service.deleteDraft('user-1', 'batch-1'))).toBe(
        ErrorCode.CERTIFICATE_IMPORT_OCR_IN_PROGRESS,
      );
      expect(queue.getJob).toHaveBeenCalledWith('certificate-ocr-batch-1');
      expect(remove).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(storage.deleteMany).not.toHaveBeenCalled();
    },
  );

  it.each(['failed', 'completed'])(
    'removes a %s job and deletes the draft',
    async (state) => {
      const remove = jest.fn().mockResolvedValue(undefined);
      queue.getJob.mockResolvedValue({ getState: async () => state, remove });

      await expect(service.deleteDraft('user-1', 'batch-1')).resolves.toEqual({
        batch_id: 'batch-1',
        deleted: true,
      });
      expect(remove).toHaveBeenCalledTimes(1);
      expect(tx.certificate_bulk_import_batches.deleteMany).toHaveBeenCalled();
      expect(storage.deleteMany).toHaveBeenCalled();
    },
  );

  it('does not fail the delete when the finished job cannot be removed', async () => {
    queue.getJob.mockResolvedValue({
      getState: async () => 'failed',
      remove: jest.fn().mockRejectedValue(new Error('redis://secret@host')),
    });

    await expect(service.deleteDraft('user-1', 'batch-1')).resolves.toEqual({
      batch_id: 'batch-1',
      deleted: true,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });

  it('continues without the job check when Redis is down or absent', async () => {
    queue.getJob.mockRejectedValue(new Error('ECONNREFUSED redis://secret'));
    await expect(service.deleteDraft('user-1', 'batch-1')).resolves.toEqual({
      batch_id: 'batch-1',
      deleted: true,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');

    const noQueue = new CertificateImportDraftDeletionService(
      prisma as never,
      storage as never,
      null,
    );
    await expect(noQueue.deleteDraft('user-1', 'batch-1')).resolves.toEqual({
      batch_id: 'batch-1',
      deleted: true,
    });
  });

  it('still succeeds when R2 fails and logs neither keys nor error messages', async () => {
    storage.deleteMany.mockRejectedValue(
      new Error(
        `boom ${SECRET_KEY} https://acct.r2.cloudflarestorage.com/x?sig=abc`,
      ),
    );

    await expect(service.deleteDraft('user-1', 'batch-1')).resolves.toEqual({
      batch_id: 'batch-1',
      deleted: true,
    });

    expect(tx.certificate_bulk_import_batches.deleteMany).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify([...warn.mock.calls, ...log.mock.calls]);
    expect(logged).not.toContain(SECRET_KEY);
    expect(logged).not.toContain('batches/');
    expect(logged).not.toContain('r2.cloudflarestorage');
    expect(logged).not.toContain('sig=');
  });

  it('answers 409 and skips R2 when submit wins the race (nothing deleted)', async () => {
    tx.certificate_bulk_import_batches.deleteMany.mockResolvedValue({
      count: 0,
    });

    expect(await conflictCode(service.deleteDraft('user-1', 'batch-1'))).toBe(
      ErrorCode.CERTIFICATE_IMPORT_BATCH_NOT_DELETABLE,
    );
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('answers 409 when the batch was submitted between the pre-check and the transaction', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      status: 'SUBMITTED',
      files: [],
    });

    expect(await conflictCode(service.deleteDraft('user-1', 'batch-1'))).toBe(
      ErrorCode.CERTIFICATE_IMPORT_BATCH_NOT_DELETABLE,
    );
    expect(
      tx.certificate_bulk_import_batches.deleteMany,
    ).not.toHaveBeenCalled();
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('answers 409 when an institutional request references the batch', async () => {
    tx.institutional_certificate_requests.count.mockResolvedValue(1);

    expect(await conflictCode(service.deleteDraft('user-1', 'batch-1'))).toBe(
      ErrorCode.CERTIFICATE_IMPORT_BATCH_NOT_DELETABLE,
    );
    expect(
      tx.certificate_bulk_import_batches.deleteMany,
    ).not.toHaveBeenCalled();
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('maps a foreign-key violation from a concurrent institutional request to 409', async () => {
    tx.certificate_bulk_import_batches.deleteMany.mockRejectedValue(
      Object.assign(new Error('fk'), { code: 'P2003' }),
    );

    expect(await conflictCode(service.deleteDraft('user-1', 'batch-1'))).toBe(
      ErrorCode.CERTIFICATE_IMPORT_BATCH_NOT_DELETABLE,
    );
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('skips storage when the draft had no files', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      status: 'DRAFT',
      files: [],
    });

    await service.deleteDraft('user-1', 'batch-1');

    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('records who deleted the draft in the structured log', async () => {
    await service.deleteDraft('user-1', 'batch-1');

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('batch=batch-1 by=user-1'),
    );
  });
});
