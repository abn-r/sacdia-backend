import { PDFDocument } from 'pdf-lib';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppInternalServerErrorException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { StorageBucketAlias } from '../common/services/file-storage.service';
import { CertificateImportFilesService } from './certificate-import-files.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

describe('CertificateImportFilesService', () => {
  const storage = {
    getSignedUploadUrl: jest.fn(),
    getObjectInfo: jest.fn(),
    getObjectPrefix: jest.fn(),
    getObject: jest.fn(),
    copyObject: jest.fn(),
    upload: jest.fn(),
    deleteMany: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
  };

  const tx = {
    certificate_bulk_import_batches: { findFirst: jest.fn() },
    certificate_bulk_import_files: { count: jest.fn(), create: jest.fn() },
  };

  const prisma = {
    ...tx,
    certificate_bulk_import_files: {
      ...tx.certificate_bulk_import_files,
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    certificate_bulk_import_items: { count: jest.fn() },
    users: { findUnique: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  let service: CertificateImportFilesService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    service = new CertificateImportFilesService(prisma as any, storage as any);
    storage.getSignedUploadUrl.mockResolvedValue({
      url: 'https://r2.example/put',
      key: 'certificate-imports/batches/batch-1/staging/file.jpg',
      expiresInSeconds: 900,
    });
    storage.getObjectInfo.mockResolvedValue({
      size: 1200,
      contentType: 'image/jpeg',
    });
    storage.getObjectPrefix.mockResolvedValue(JPEG);
    storage.copyObject.mockResolvedValue({
      key: 'certificate-imports/batches/batch-1/sealed/file.jpg',
    });
    storage.upload.mockResolvedValue({
      key: 'certificate-imports/batches/batch-1/sealed/file.pdf',
    });
    storage.deleteMany.mockResolvedValue(undefined);
    storage.getSignedDownloadUrl.mockResolvedValue('https://r2.example/get');
  });

  it('presigns one staging object for the batch owner', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      status: 'DRAFT',
    });
    tx.certificate_bulk_import_files.count.mockResolvedValue(0);
    tx.certificate_bulk_import_files.create.mockResolvedValue({
      file_id: 'file-1',
    });

    const result = await service.presign('owner-1', 'batch-1', {
      file_name: 'cert.jpg',
      mime_type: 'image/jpeg',
      file_size: 1200,
    });

    expect(result.upload_url).toBe('https://r2.example/put');
    expect(result.required_headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
      StorageBucketAlias.CERTIFICATE_IMPORTS,
      expect.stringMatching(/^batches\/batch-1\/staging\//),
      expect.objectContaining({
        contentType: 'image/jpeg',
        contentLength: 1200,
      }),
    );
    expect(tx.certificate_bulk_import_files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          upload_status: 'PENDING_UPLOAD',
          uploaded_by_id: 'owner-1',
        }),
      }),
    );
  });

  it('rejects a second document and a file outside the allowed types', async () => {
    tx.certificate_bulk_import_batches.findFirst.mockResolvedValue({
      batch_id: 'batch-1',
      status: 'DRAFT',
    });
    tx.certificate_bulk_import_files.count.mockResolvedValue(1);

    await expect(
      service.presign('owner-1', 'batch-1', {
        file_name: 'otro.jpg',
        mime_type: 'image/jpeg',
        file_size: 1200,
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_LIMIT');

    await expect(
      service.presign('owner-1', 'batch-1', {
        file_name: 'nota.txt',
        mime_type: 'text/plain',
        file_size: 20,
      }),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_TYPE_INVALID');
    expect(storage.getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('seals a confirmed object and does not copy again on retry', async () => {
    prisma.certificate_bulk_import_files.findFirst.mockResolvedValueOnce({
      file_id: 'file-1',
      file_type: 'image/jpeg',
      file_url: 'staging-key',
      upload_status: 'PENDING_UPLOAD',
      staging_key: 'staging-key',
      object_key: null,
      size_bytes: 1200n,
      confirmed_at: null,
      jurisdiction: 'CAMPO_LOCAL',
      batch: { user_id: 'owner-1', local_field_id: 7, status: 'DRAFT' },
    });
    prisma.certificate_bulk_import_files.update.mockResolvedValue({
      file_id: 'file-1',
      object_key: 'certificate-imports/batches/batch-1/sealed/file-1.jpg',
      size_bytes: 1200n,
      file_type: 'image/jpeg',
      confirmed_at: new Date('2026-09-21T00:00:00.000Z'),
    });

    const sealed = await service.confirm('owner-1', 'batch-1', 'file-1');

    expect(sealed.object_key).toContain('/sealed/');
    expect(storage.copyObject).toHaveBeenCalledWith(
      StorageBucketAlias.CERTIFICATE_IMPORTS,
      'staging-key',
      expect.stringMatching(/sealed\/file-1\.jpg$/),
    );

    prisma.certificate_bulk_import_files.findFirst.mockResolvedValueOnce({
      file_id: 'file-1',
      file_type: 'image/jpeg',
      upload_status: 'CONFIRMED',
      staging_key: null,
      object_key: sealed.object_key,
      size_bytes: 1200n,
      confirmed_at: sealed.confirmed_at,
      jurisdiction: 'CAMPO_LOCAL',
      batch: { user_id: 'owner-1', local_field_id: 7, status: 'DRAFT' },
    });

    await service.confirm('owner-1', 'batch-1', 'file-1');
    expect(storage.copyObject).toHaveBeenCalledTimes(1);
  });

  async function preparePdf(pages: number, mutate?: (bytes: Buffer) => Buffer) {
    const document = await PDFDocument.create();
    for (let n = 0; n < pages; n++) document.addPage();
    const generated = Buffer.from(
      await document.save({ addDefaultPage: false }),
    );
    const bytes = mutate ? mutate(generated) : generated;
    prisma.certificate_bulk_import_files.findFirst.mockResolvedValue({
      file_id: 'file-1',
      file_type: 'application/pdf',
      upload_status: 'PENDING_UPLOAD',
      staging_key: 'staging-key',
      object_key: null,
      size_bytes: BigInt(bytes.length),
      confirmed_at: null,
      jurisdiction: 'CAMPO_LOCAL',
      batch: { user_id: 'owner-1', local_field_id: 7, status: 'DRAFT' },
    });
    storage.getObjectInfo.mockResolvedValue({
      size: bytes.length,
      contentType: 'application/pdf',
    });
    storage.getObjectPrefix.mockResolvedValue(bytes.subarray(0, 16));
    storage.getObject.mockResolvedValue(bytes);
    prisma.certificate_bulk_import_files.update.mockResolvedValue({
      file_id: 'file-1',
      object_key: 'sealed/file.pdf',
      size_bytes: BigInt(bytes.length),
      file_type: 'application/pdf',
      confirmed_at: new Date(),
    });
    return bytes;
  }

  it.each([1, 5])(
    'parses a complete %i-page PDF before sealing',
    async (pages) => {
      const bytes = await preparePdf(pages);
      await service.confirm('owner-1', 'batch-1', 'file-1');
      expect(storage.getObject).toHaveBeenCalledWith(
        StorageBucketAlias.CERTIFICATE_IMPORTS,
        'staging-key',
        10 * 1024 * 1024,
      );
      expect(storage.getObject.mock.invocationCallOrder[0]).toBeLessThan(
        storage.upload.mock.invocationCallOrder[0],
      );
      expect(storage.upload).toHaveBeenCalledWith(
        StorageBucketAlias.CERTIFICATE_IMPORTS,
        expect.stringMatching(
          /^batches\/batch-1\/sealed\/file-1-[0-9a-f-]{36}\.pdf$/,
        ),
        bytes,
        { contentType: 'application/pdf', overwrite: false },
      );
      expect(storage.copyObject).not.toHaveBeenCalled();
      expect(prisma.certificate_bulk_import_files.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ size_bytes: BigInt(bytes.length) }),
        }),
      );
    },
  );

  it('seals the validated bytes even when staging is subsequently replaced', async () => {
    const validated = await preparePdf(1);
    const other = await PDFDocument.create();
    for (let n = 0; n < 6; n++) other.addPage();
    const replaced = Buffer.from(await other.save());
    storage.getObject.mockImplementationOnce(async () => {
      storage.getObject.mockResolvedValue(replaced);
      return validated;
    });
    await service.confirm('owner-1', 'batch-1', 'file-1');
    expect(storage.upload.mock.calls[0][2]).toEqual(validated);
    expect(storage.copyObject).not.toHaveBeenCalled();
  });

  it('cleans only its own seal after a DB failure and retries with a new key', async () => {
    await preparePdf(1);
    const failure = new Error('database unavailable');
    const allocated: string[] = [];
    storage.upload.mockImplementation(async (_bucket, key) => {
      allocated.push(key);
      return { key: 'certificate-imports/' + key };
    });
    prisma.certificate_bulk_import_files.update.mockRejectedValueOnce(failure);
    await expect(
      service.confirm('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow(failure);
    expect(storage.deleteMany).toHaveBeenCalledTimes(1);
    expect(storage.deleteMany).toHaveBeenCalledWith(
      StorageBucketAlias.CERTIFICATE_IMPORTS,
      ['certificate-imports/' + allocated[0]],
    );
    await service.confirm('owner-1', 'batch-1', 'file-1');
    expect(allocated[1]).not.toBe(allocated[0]);
    expect(storage.deleteMany).toHaveBeenLastCalledWith(
      StorageBucketAlias.CERTIFICATE_IMPORTS,
      ['staging-key'],
    );
  });

  it('does not delete a seal referenced after an ambiguous successful DB commit', async () => {
    await preparePdf(1);
    const pending =
      prisma.certificate_bulk_import_files.findFirst.getMockImplementation()!;
    let sealKey = '';
    storage.upload.mockImplementation(async (_bucket, key) => {
      sealKey = 'certificate-imports/' + key;
      return { key: sealKey };
    });
    prisma.certificate_bulk_import_files.findFirst
      .mockImplementationOnce(pending)
      .mockImplementation(async () => ({ object_key: sealKey }));
    prisma.certificate_bulk_import_files.update.mockRejectedValueOnce(
      new Error('ambiguous commit'),
    );
    await expect(
      service.confirm('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('ambiguous commit');
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('preserves the seal when DB reread cannot determine whether commit succeeded', async () => {
    await preparePdf(1);
    const pending =
      prisma.certificate_bulk_import_files.findFirst.getMockImplementation()!;
    prisma.certificate_bulk_import_files.findFirst
      .mockImplementationOnce(pending)
      .mockRejectedValueOnce(new Error('read unavailable'));
    prisma.certificate_bulk_import_files.update.mockRejectedValueOnce(
      new Error('ambiguous commit'),
    );
    await expect(
      service.confirm('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('ambiguous commit');
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('maps PDF upload failure safely without confirming or deleting staging', async () => {
    await preparePdf(1);
    storage.upload.mockRejectedValueOnce(
      new AppInternalServerErrorException(ErrorCode.R2_UPLOAD_FAILED),
    );
    await expect(
      service.confirm('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE');
    expect(prisma.certificate_bulk_import_files.update).not.toHaveBeenCalled();
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    [6, 'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES'],
    [0, 'CERTIFICATE_IMPORT_PDF_INVALID'],
  ])('does not seal a rejected %i-page PDF', async (pages, code) => {
    await preparePdf(pages as number);
    await expect(
      service.confirm('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow(code as string);
    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.certificate_bulk_import_files.update).not.toHaveBeenCalled();
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects corrupt PDF bytes before sealing', async () => {
    await preparePdf(1, () => Buffer.from('%PDF-1.7\n1 0 obj << invalid'));
    await expect(
      service.confirm('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('CERTIFICATE_IMPORT_PDF_INVALID');
    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.certificate_bulk_import_files.update).not.toHaveBeenCalled();
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects missing or changed downloaded PDF bytes', async () => {
    await preparePdf(1);
    storage.getObject.mockResolvedValueOnce(null);
    await expect(
      service.confirm('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
    storage.getObject.mockResolvedValueOnce(Buffer.from('%PDF-1.7 changed'));
    await expect(
      service.confirm('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_CONTENT_MISMATCH');
    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.certificate_bulk_import_files.update).not.toHaveBeenCalled();
  });

  it('rejects magic bytes that do not match the declared type', async () => {
    prisma.certificate_bulk_import_files.findFirst.mockResolvedValue({
      file_id: 'file-1',
      file_type: 'application/pdf',
      upload_status: 'PENDING_UPLOAD',
      staging_key: 'staging-key',
      object_key: null,
      size_bytes: 1200n,
      confirmed_at: null,
      jurisdiction: 'CAMPO_LOCAL',
      batch: { user_id: 'owner-1', local_field_id: 7, status: 'DRAFT' },
    });

    await expect(
      service.confirm('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_CONTENT_MISMATCH');
    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.certificate_bulk_import_files.update).not.toHaveBeenCalled();
  });

  it('returns a recoverable storage error without sealing the file', async () => {
    prisma.certificate_bulk_import_files.findFirst.mockResolvedValue({
      file_id: 'file-1',
      file_type: 'image/jpeg',
      upload_status: 'PENDING_UPLOAD',
      staging_key: 'staging-key',
      object_key: null,
      size_bytes: 1200n,
      confirmed_at: null,
      jurisdiction: 'CAMPO_LOCAL',
      batch: { user_id: 'owner-1', local_field_id: 7, status: 'DRAFT' },
    });
    storage.getObjectInfo.mockRejectedValue(
      new AppInternalServerErrorException(ErrorCode.R2_VALIDATION_FAILED),
    );

    await expect(
      service.confirm('owner-1', 'batch-1', 'file-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.confirm('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE');
    expect(prisma.certificate_bulk_import_files.update).not.toHaveBeenCalled();
  });

  it('signs a download for the owner and hides unsealed or public references', async () => {
    prisma.certificate_bulk_import_files.findFirst.mockResolvedValue({
      file_id: 'file-1',
      upload_status: 'CONFIRMED',
      object_key: 'certificate-imports/batches/batch-1/sealed/file-1.jpg',
      jurisdiction: 'CAMPO_LOCAL',
      batch: { user_id: 'owner-1', local_field_id: 7, status: 'SUBMITTED' },
    });

    await expect(
      service.download('owner-1', 'batch-1', 'file-1'),
    ).resolves.toMatchObject({ download_url: 'https://r2.example/get' });

    prisma.certificate_bulk_import_files.findFirst.mockResolvedValue({
      file_id: 'file-1',
      upload_status: 'CONFIRMED',
      object_key: 'https://cdn.example/public.jpg',
      jurisdiction: 'CAMPO_LOCAL',
      batch: { user_id: 'owner-1', local_field_id: 7, status: 'SUBMITTED' },
    });

    await expect(
      service.download('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
  });

  it('lets a local-field reviewer download an ordinary file and blocks another field', async () => {
    prisma.certificate_bulk_import_files.findFirst.mockResolvedValue({
      file_id: 'file-1',
      upload_status: 'CONFIRMED',
      object_key: 'sealed-key',
      jurisdiction: 'CAMPO_LOCAL',
      batch: { user_id: 'owner-1', local_field_id: 7, status: 'SUBMITTED' },
    });
    prisma.users.findUnique.mockResolvedValue({
      local_field_id: 9,
      users_roles: [{ roles: { role_name: 'director-lf' } }],
    });

    await expect(
      service.download('reviewer-9', 'batch-1', 'file-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.users.findUnique.mockResolvedValue({
      local_field_id: 7,
      users_roles: [{ roles: { role_name: 'director-lf' } }],
    });
    await expect(
      service.download('reviewer-7', 'batch-1', 'file-1'),
    ).resolves.toMatchObject({ file_id: 'file-1' });
  });

  it('reserves institutional files for the owner and the super administrator', async () => {
    prisma.certificate_bulk_import_files.findFirst.mockResolvedValue({
      file_id: 'file-1',
      upload_status: 'CONFIRMED',
      object_key: 'sealed-key',
      jurisdiction: 'INSTITUTIONAL',
      batch: { user_id: 'owner-1', local_field_id: 7, status: 'SUBMITTED' },
    });
    prisma.users.findUnique.mockResolvedValue({
      local_field_id: null,
      users_roles: [{ roles: { role_name: 'admin' } }],
    });

    await expect(
      service.download('admin-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_FORBIDDEN');

    prisma.users.findUnique.mockResolvedValue({
      local_field_id: null,
      users_roles: [{ roles: { role_name: 'union-admin' } }],
    });
    await expect(
      service.download('union-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_FORBIDDEN');

    prisma.users.findUnique.mockResolvedValue({
      local_field_id: null,
      users_roles: [{ roles: { role_name: 'super-admin' } }],
    });
    await expect(
      service.download('super-1', 'batch-1', 'file-1'),
    ).resolves.toMatchObject({ download_url: 'https://r2.example/get' });
  });

  it('does not delete a proof already tied to a submitted item', async () => {
    prisma.certificate_bulk_import_files.findFirst.mockResolvedValue({
      file_id: 'file-1',
      staging_key: 'staging-key',
      object_key: 'sealed-key',
      upload_status: 'CONFIRMED',
      jurisdiction: 'CAMPO_LOCAL',
      batch: {
        user_id: 'owner-1',
        local_field_id: 7,
        status: 'NEEDS_CORRECTION',
      },
    });
    prisma.certificate_bulk_import_items.count.mockResolvedValue(1);

    await expect(
      service.remove('owner-1', 'batch-1', 'file-1'),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_SEALED');
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('purges abandoned staging uploads and leaves confirmed proofs', async () => {
    prisma.certificate_bulk_import_files.findMany.mockResolvedValue([
      { file_id: 'stale-1', staging_key: 'staging-key' },
    ]);

    await expect(
      service.purgeAbandoned(new Date('2026-09-21T00:00:00.000Z')),
    ).resolves.toEqual({ purged: 1 });

    expect(prisma.certificate_bulk_import_files.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          upload_status: 'PENDING_UPLOAD',
          batch: { status: 'DRAFT' },
        }),
      }),
    );
    expect(storage.deleteMany).toHaveBeenCalledWith(
      StorageBucketAlias.CERTIFICATE_IMPORTS,
      ['staging-key'],
    );
  });
});
