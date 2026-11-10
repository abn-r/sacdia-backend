import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ZonedBusinessTimeService } from '../common/clock/zoned-business-time.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { StorageBucketAlias } from '../common/services/file-storage.service';
import { CreateServiceCredentialDto } from './dto/create-service-credential.dto';
import {
  MyServiceCredentialsService,
  SERVICE_CREDENTIAL_BUCKET,
} from './my-service-credentials.service';
import {
  makeCredential,
  newFakeDb,
  newFakePrisma,
  type FakeDb,
} from './service-credentials.testing';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-10T18:00:00.000Z');
const PDF = Buffer.from('%PDF-1.7');

function setup() {
  const db: FakeDb = newFakeDb();
  const prisma = newFakePrisma(db);
  const storage = {
    getSignedUploadUrl: jest.fn(
      async (
        _bucket: StorageBucketAlias,
        key: string,
        options: { expiresInSeconds?: number },
      ) => ({
        url: `https://r2.example/put/${key}`,
        key: `certifications/evidence/${key}`,
        expiresInSeconds: options.expiresInSeconds ?? 0,
      }),
    ),
    getObjectInfo: jest.fn(async () => ({
      size: 2048,
      contentType: 'application/pdf',
    })),
    getObjectPrefix: jest.fn(async () => PDF),
    copyObject: jest.fn(
      async (_bucket: StorageBucketAlias, _src: string, dest: string) => ({
        key: `certifications/evidence/${dest}`,
      }),
    ),
    deleteMany: jest.fn(async () => undefined),
  };
  const service = new MyServiceCredentialsService(
    prisma as never,
    storage as never,
    { now: () => NOW },
    new ZonedBusinessTimeService(),
  );
  return { db, prisma, storage, service };
}

const dto = (
  overrides: Partial<CreateServiceCredentialDto> = {},
): CreateServiceCredentialDto => ({
  type: 'COUNSELOR_TRAINING',
  completed_at: '2026-05-20',
  file_name: 'constancia.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  ...overrides,
});

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppException ? error.code : String(error);
  }
  return undefined;
}

describe('MyServiceCredentialsService', () => {
  it('uses the private certification-evidence bucket', () => {
    expect(SERVICE_CREDENTIAL_BUCKET).toBe(
      StorageBucketAlias.CERTIFICATION_EVIDENCE,
    );
  });

  describe('create', () => {
    it('creates a PENDING_UPLOAD row and a presigned PUT under the owner prefix', async () => {
      const { db, service, storage } = setup();

      const result = await service.create(USER, dto());

      expect(result.credential).toMatchObject({
        type: 'COUNSELOR_TRAINING',
        completed_at: '2026-05-20',
        status: 'PENDING_REVIEW',
        upload_status: 'PENDING_UPLOAD',
        file_name: 'constancia.pdf',
      });
      expect(result.upload).toEqual({
        url: expect.stringContaining(`service-credentials/${USER}/`),
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        expires_in: 900,
      });
      expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
        StorageBucketAlias.CERTIFICATION_EVIDENCE,
        expect.stringMatching(
          new RegExp(
            `^service-credentials/${USER}/${result.credential.credential_id}/upload\\.pdf$`,
          ),
        ),
        expect.objectContaining({
          contentType: 'application/pdf',
          contentLength: 2048,
        }),
      );
      expect(db.credentials).toHaveLength(1);
      expect(db.credentials[0].object_key).toContain(
        'certifications/evidence/',
      );
    });

    it.each([
      ['gif', { mime_type: 'image/gif' }],
      ['webp', { mime_type: 'image/webp' }],
      ['too big', { size_bytes: 10 * 1024 * 1024 + 1 }],
      ['empty', { size_bytes: 0 }],
    ])('rejects an invalid file (%s)', async (_name, overrides) => {
      const { service, db } = setup();
      expect(await code(service.create(USER, dto(overrides)))).toBe(
        ErrorCode.SERVICE_CREDENTIAL_FILE_INVALID,
      );
      expect(db.credentials).toHaveLength(0);
    });

    it('accepts the 10 MB limit exactly and image types', async () => {
      const { service } = setup();
      await expect(
        service.create(
          USER,
          dto({ mime_type: 'image/png', size_bytes: 10 * 1024 * 1024 }),
        ),
      ).resolves.toBeDefined();
    });

    it.each([['2026-11-11'], ['2026-02-30'], ['2027-01-01']])(
      'rejects completed_at %s (future or not a real day)',
      async (completed_at) => {
        const { service } = setup();
        expect(await code(service.create(USER, dto({ completed_at })))).toBe(
          ErrorCode.SERVICE_CREDENTIAL_DATE_INVALID,
        );
      },
    );

    it('accepts today as completed_at', async () => {
      const { service } = setup();
      await expect(
        service.create(USER, dto({ completed_at: '2026-11-10' })),
      ).resolves.toBeDefined();
    });

    it('answers 409 when a confirmed credential is already under review', async () => {
      const { db, service } = setup();
      db.credentials.push(makeCredential({ user_id: USER }));
      expect(await code(service.create(USER, dto()))).toBe(
        ErrorCode.SERVICE_CREDENTIAL_PENDING_EXISTS,
      );
      expect(db.credentials).toHaveLength(1);
    });

    it('retires an abandoned (unconfirmed) attempt instead of blocking', async () => {
      const { db, service } = setup();
      const stale = makeCredential({
        user_id: USER,
        upload_status: 'PENDING_UPLOAD',
      });
      db.credentials.push(stale);
      await service.create(USER, dto());
      expect(stale.active).toBe(false);
      expect(db.credentials.filter((c) => c.active)).toHaveLength(1);
    });

    it('allows a new credential after a rejection or an approval', async () => {
      const { db, service } = setup();
      db.credentials.push(
        makeCredential({ user_id: USER, status: 'REJECTED' }),
      );
      await expect(service.create(USER, dto())).resolves.toBeDefined();
    });

    it("does not look at another user's pending credential", async () => {
      const { db, service } = setup();
      db.credentials.push(makeCredential({ user_id: OTHER }));
      await expect(service.create(USER, dto())).resolves.toBeDefined();
    });
  });

  describe('list', () => {
    it('returns only own active rows, newest first', async () => {
      const { db, service } = setup();
      const older = makeCredential({
        user_id: USER,
        status: 'REJECTED',
        created_at: new Date('2026-01-01T00:00:00Z'),
      });
      const newer = makeCredential({
        user_id: USER,
        created_at: new Date('2026-09-01T00:00:00Z'),
      });
      db.credentials.push(
        older,
        newer,
        makeCredential({ user_id: OTHER }),
        makeCredential({ user_id: USER, active: false }),
      );

      const result = await service.list(USER);

      expect(result.items.map((item) => item.credential_id)).toEqual([
        newer.credential_id,
        older.credential_id,
      ]);
      expect(Object.keys(result.items[0]).sort()).toEqual(
        [
          'completed_at',
          'created_at',
          'credential_id',
          'decision_reason',
          'expires_at',
          'file_name',
          'reviewed_at',
          'status',
          'type',
          'upload_status',
        ].sort(),
      );
    });
  });

  describe('confirm', () => {
    it('heads the object, seals a copy and marks CONFIRMED', async () => {
      const { db, service, storage } = setup();
      const row = makeCredential({
        user_id: USER,
        upload_status: 'PENDING_UPLOAD',
        object_key:
          'certifications/evidence/service-credentials/u/c/upload.pdf',
      });
      db.credentials.push(row);

      const result = await service.confirm(USER, row.credential_id);

      expect(result.upload_status).toBe('CONFIRMED');
      expect(storage.getObjectInfo).toHaveBeenCalled();
      expect(row.object_key).toMatch(
        new RegExp(
          `^certifications/evidence/service-credentials/${USER}/${row.credential_id}/[0-9a-f-]{36}\\.pdf$`,
        ),
      );
      expect(storage.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.CERTIFICATION_EVIDENCE,
        ['certifications/evidence/service-credentials/u/c/upload.pdf'],
      );
    });

    it('is idempotent once confirmed', async () => {
      const { db, service, storage } = setup();
      const row = makeCredential({ user_id: USER });
      db.credentials.push(row);
      const result = await service.confirm(USER, row.credential_id);
      expect(result.upload_status).toBe('CONFIRMED');
      expect(storage.copyObject).not.toHaveBeenCalled();
    });

    it('answers UPLOAD_MISSING when the object is not there', async () => {
      const { db, service, storage } = setup();
      const row = makeCredential({
        user_id: USER,
        upload_status: 'PENDING_UPLOAD',
      });
      db.credentials.push(row);
      storage.getObjectInfo.mockResolvedValueOnce(null);
      expect(await code(service.confirm(USER, row.credential_id))).toBe(
        ErrorCode.SERVICE_CREDENTIAL_UPLOAD_MISSING,
      );
      expect(row.upload_status).toBe('PENDING_UPLOAD');
    });

    it('rejects an object whose content does not match the declared type', async () => {
      const { db, service, storage } = setup();
      const row = makeCredential({
        user_id: USER,
        upload_status: 'PENDING_UPLOAD',
      });
      db.credentials.push(row);
      storage.getObjectPrefix.mockResolvedValueOnce(
        Buffer.from('MZ-not-a-pdf'),
      );
      expect(await code(service.confirm(USER, row.credential_id))).toBe(
        ErrorCode.SERVICE_CREDENTIAL_FILE_INVALID,
      );
      expect(row.upload_status).toBe('PENDING_UPLOAD');
    });

    it('rejects an object far from the declared size', async () => {
      const { db, service, storage } = setup();
      const row = makeCredential({
        user_id: USER,
        upload_status: 'PENDING_UPLOAD',
      });
      db.credentials.push(row);
      storage.getObjectInfo.mockResolvedValueOnce({
        size: 9_000_000,
        contentType: 'application/pdf',
      });
      expect(await code(service.confirm(USER, row.credential_id))).toBe(
        ErrorCode.SERVICE_CREDENTIAL_FILE_INVALID,
      );
    });

    it("cannot confirm another user's credential", async () => {
      const { db, service } = setup();
      const row = makeCredential({
        user_id: OTHER,
        upload_status: 'PENDING_UPLOAD',
      });
      db.credentials.push(row);
      expect(await code(service.confirm(USER, row.credential_id))).toBe(
        ErrorCode.SERVICE_CREDENTIAL_NOT_FOUND,
      );
    });
  });

  describe('withdraw', () => {
    it('deactivates a pending or rejected credential', async () => {
      const { db, service } = setup();
      const pending = makeCredential({ user_id: USER });
      const rejected = makeCredential({ user_id: USER, status: 'REJECTED' });
      db.credentials.push(pending, rejected);
      await service.withdraw(USER, pending.credential_id);
      await service.withdraw(USER, rejected.credential_id);
      expect(pending.active).toBe(false);
      expect(rejected.active).toBe(false);
    });

    it('answers 409 for an approved credential', async () => {
      const { db, service } = setup();
      const approved = makeCredential({ user_id: USER, status: 'APPROVED' });
      db.credentials.push(approved);
      expect(await code(service.withdraw(USER, approved.credential_id))).toBe(
        ErrorCode.SERVICE_CREDENTIAL_APPROVED_LOCKED,
      );
      expect(approved.active).toBe(true);
    });

    it("cannot withdraw another user's credential", async () => {
      const { db, service } = setup();
      const row = makeCredential({ user_id: OTHER });
      db.credentials.push(row);
      expect(await code(service.withdraw(USER, row.credential_id))).toBe(
        ErrorCode.SERVICE_CREDENTIAL_NOT_FOUND,
      );
      expect(row.active).toBe(true);
    });
  });
});

describe('CreateServiceCredentialDto', () => {
  const valid = {
    type: 'COUNSELOR_TRAINING',
    completed_at: '2026-05-20',
    file_name: 'a.pdf',
    mime_type: 'application/pdf',
    size_bytes: 10,
  };
  const errorsOf = async (body: object) =>
    (await validate(plainToInstance(CreateServiceCredentialDto, body))).map(
      (e) => e.property,
    );

  it('accepts a complete body', async () => {
    expect(await errorsOf(valid)).toEqual([]);
  });

  it.each([
    ['unknown type', { type: 'OTHER' }, 'type'],
    ['bad date format', { completed_at: '20/05/2026' }, 'completed_at'],
    ['missing file name', { file_name: undefined }, 'file_name'],
    ['zero size', { size_bytes: 0 }, 'size_bytes'],
  ])('rejects %s', async (_name, overrides, property) => {
    expect(await errorsOf({ ...valid, ...overrides })).toContain(property);
  });
});
