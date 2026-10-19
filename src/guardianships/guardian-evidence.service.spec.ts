import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { StorageBucketAlias } from '../common/services/file-storage.service';
import {
  CONSENT_EVIDENCE_SIGNED_URL_TTL_SECONDS,
  GuardianEvidenceService,
} from './guardian-evidence.service';

const GUARDIAN = 'aaaaaaaa-0000-4000-8000-000000000001';
const SECOND_GUARDIAN = 'aaaaaaaa-0000-4000-8000-000000000002';
const DEPENDENT = 'dddddddd-0000-4000-8000-000000000001';
const DIRECTOR = 'eeeeeeee-0000-4000-8000-000000000001';
const CONSENT_ROW = 'bbbbbbbb-0000-4000-8000-000000000001';
const ASSIGNMENT = 'cccccccc-0000-4000-8000-000000000001';
const SECTION = 12;

const pdf = (): Express.Multer.File =>
  ({
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7'),
    size: 8,
    originalname: 'evil.exe',
  }) as never;

function codeOf(error: unknown): ErrorCode | undefined {
  return error instanceof AppException ? error.code : undefined;
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

function setup(options: { bucket?: string | undefined } = {}) {
  const bucket =
    'bucket' in options ? options.bucket : 'sacdia-guardianship-evidence';
  const calls: string[] = [];

  const tx: any = {
    $executeRaw: jest.fn().mockImplementation(() => {
      calls.push('lock');
      return Promise.resolve(1);
    }),
    guardianships: {
      findFirst: jest.fn().mockResolvedValue({ guardianship_id: CONSENT_ROW }),
      // verified consent rows of the dependent (W1): none by default
      count: jest.fn().mockResolvedValue(0),
    },
    guardianship_consent_evidences: {
      updateMany: jest.fn().mockImplementation(() => {
        calls.push('supersede');
        return Promise.resolve({ count: 1 });
      }),
      create: jest.fn().mockImplementation(() => {
        calls.push('create');
        return Promise.resolve({
          evidence_id: 'ev-new',
          uploaded_at: new Date('2026-10-19T12:00:00.000Z'),
        });
      }),
    },
  };

  const prisma: any = {
    guardianships: {
      // own guardian row, then the consent (primary) row
      findFirst: jest.fn(),
      // verified consent rows of the dependent (W1): none by default
      count: jest.fn().mockResolvedValue(0),
    },
    club_role_assignments: { findFirst: jest.fn() },
    dependent_profiles: {
      findUnique: jest.fn().mockResolvedValue({ user_id: DEPENDENT }),
    },
    guardianship_consent_evidences: { findFirst: jest.fn() },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'R2_BUCKET_GUARDIANSHIP_EVIDENCE' ? bucket : undefined,
    ),
  } as unknown as ConfigService;
  const storage: any = {
    upload: jest.fn().mockResolvedValue({
      key: `guardianships/consent/${CONSENT_ROW}/obj.pdf`,
      url: '/ignored',
    }),
    deleteMany: jest.fn().mockResolvedValue(undefined),
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed/x'),
  };
  // Evidence audit is fail closed (W3): only the throwing variant is used.
  const audit: any = {
    recordEvent: jest.fn().mockResolvedValue(undefined),
    recordEventOrThrow: jest.fn().mockResolvedValue(undefined),
  };
  const service = new GuardianEvidenceService(prisma, config, storage, audit);

  /** guardian row found, then the dependent's primary consent row. */
  const asGuardian = () => {
    prisma.guardianships.findFirst
      .mockResolvedValueOnce({ guardianship_id: 'own-row' })
      .mockResolvedValueOnce({
        guardianship_id: CONSENT_ROW,
        is_custodian: false,
        dependent_user_id: DEPENDENT,
      });
  };
  const asDirector = (
    assignment: Record<string, unknown> | null = {
      assignment_id: ASSIGNMENT,
      club_section_id: SECTION,
      user_id: DEPENDENT,
      status: 'pending',
      active: true,
    },
  ) => {
    prisma.club_role_assignments.findFirst.mockResolvedValue(assignment);
    prisma.guardianships.findFirst.mockResolvedValue({
      guardianship_id: CONSENT_ROW,
      is_custodian: false,
      dependent_user_id: DEPENDENT,
    });
  };

  return {
    service,
    prisma,
    tx,
    storage,
    audit,
    config,
    calls,
    asGuardian,
    asDirector,
  };
}

const currentEvidence = (overrides: Record<string, unknown> = {}) => ({
  evidence_id: 'ev-1',
  guardianship_id: CONSENT_ROW,
  file_key: `guardianships/consent/${CONSENT_ROW}/obj.pdf`,
  content_type: 'application/pdf',
  uploaded_at: new Date('2026-10-19T10:00:00.000Z'),
  uploaded_by: { name: 'María', paternal_last_name: 'Pérez' },
  ...overrides,
});

describe('GuardianEvidenceService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('fails closed while the private bucket is not configured', () => {
    it.each([
      [
        'guardian upload',
        (s: GuardianEvidenceService) =>
          s.uploadForGuardian(GUARDIAN, DEPENDENT, pdf()),
      ],
      [
        'guardian read',
        (s: GuardianEvidenceService) => s.getForGuardian(GUARDIAN, DEPENDENT),
      ],
      [
        'director upload',
        (s: GuardianEvidenceService) =>
          s.uploadForDirector(DIRECTOR, SECTION, ASSIGNMENT, pdf()),
      ],
      [
        'director read',
        (s: GuardianEvidenceService) =>
          s.getForDirector(DIRECTOR, SECTION, ASSIGNMENT),
      ],
      [
        'admin read',
        (s: GuardianEvidenceService) =>
          s.getForAdmin(DIRECTOR, DEPENDENT, CONSENT_ROW),
      ],
    ])(
      '%s: 503 GUARDIANSHIP_EVIDENCE_UNAVAILABLE, nothing touched',
      async (_label, run) => {
        for (const bucket of [undefined, '', '   ']) {
          const { service, prisma, storage } = setup({ bucket });

          const error = await rejection(run(service));

          expect(codeOf(error)).toBe(
            ErrorCode.GUARDIANSHIP_EVIDENCE_UNAVAILABLE,
          );
          expect((error as AppException).getStatus()).toBe(503);
          expect(storage.upload).not.toHaveBeenCalled();
          expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
          expect(prisma.guardianships.findFirst).not.toHaveBeenCalled();
        }
      },
    );
  });

  describe('guardian upload', () => {
    it('stores the form under {guardianshipId}/{uuid}.{ext} of the CONSENT row and returns the metadata', async () => {
      const { service, storage, tx, asGuardian } = setup();
      asGuardian();

      const result = await service.uploadForGuardian(
        GUARDIAN,
        DEPENDENT,
        pdf(),
      );

      const [alias, key, buffer, options] = storage.upload.mock.calls[0];
      expect(alias).toBe(StorageBucketAlias.GUARDIANSHIP_EVIDENCE);
      expect(key).toMatch(new RegExp(`^${CONSENT_ROW}/[0-9a-f-]{36}\\.pdf$`));
      expect(buffer).toEqual(Buffer.from('%PDF-1.7'));
      expect(options).toEqual({
        contentType: 'application/pdf',
        overwrite: false,
      });
      expect(tx.guardianship_consent_evidences.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          guardianship_id: CONSENT_ROW,
          file_key: `guardianships/consent/${CONSENT_ROW}/obj.pdf`,
          content_type: 'application/pdf',
          size_bytes: 8,
          uploaded_by_user_id: GUARDIAN,
        }),
        select: { evidence_id: true, uploaded_at: true },
      });
      expect(result).toEqual({
        evidence_id: 'ev-new',
        content_type: 'application/pdf',
        size_bytes: 8,
        uploaded_at: '2026-10-19T12:00:00.000Z',
      });
    });

    it('derives the extension from the validated MIME type, never from the original name', async () => {
      const { service, storage, asGuardian } = setup();
      asGuardian();

      await service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf());

      expect(storage.upload.mock.calls[0][1]).not.toContain('exe');
    });

    it('supersedes the previous current row (keeping its object) under the dependent lock', async () => {
      const { service, tx, storage, calls, asGuardian } = setup();
      asGuardian();

      await service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf());

      expect(calls).toEqual(['lock', 'supersede', 'create']);
      expect(tx.guardianship_consent_evidences.updateMany).toHaveBeenCalledWith(
        {
          where: {
            guardianship_id: CONSENT_ROW,
            superseded_at: null,
            purged_at: null,
          },
          data: { superseded_at: expect.any(Date) },
        },
      );
      expect(storage.deleteMany).not.toHaveBeenCalled();
    });

    it('the second guardian uploads onto the PRIMARY row, which is the one the director verifies', async () => {
      const { service, tx, asGuardian } = setup();
      asGuardian();

      await service.uploadForGuardian(SECOND_GUARDIAN, DEPENDENT, pdf());

      expect(
        tx.guardianship_consent_evidences.create.mock.calls[0][0].data,
      ).toMatchObject({
        guardianship_id: CONSENT_ROW,
        uploaded_by_user_id: SECOND_GUARDIAN,
      });
    });

    it('a foreign guardian gets 404 GUARDIANSHIP_NOT_FOUND and nothing is stored', async () => {
      const { service, prisma, storage } = setup();
      prisma.guardianships.findFirst.mockResolvedValue(null);

      const error = await rejection(
        service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf()),
      );

      expect(codeOf(error)).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
      expect((error as AppException).getStatus()).toBe(404);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('404 when the dependent has no consent row', async () => {
      const { service, prisma } = setup();
      prisma.guardianships.findFirst
        .mockResolvedValueOnce({ guardianship_id: 'own-row' })
        .mockResolvedValueOnce(null);

      const error = await rejection(
        service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf()),
      );

      expect(codeOf(error)).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    });

    it('requires a file', async () => {
      const { service, storage, asGuardian } = setup();
      asGuardian();

      const error = await rejection(
        service.uploadForGuardian(GUARDIAN, DEPENDENT, undefined),
      );

      expect(codeOf(error)).toBe(ErrorCode.FILE_REQUIRED);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('refuses a type the pipe would not allow even if the pipe was bypassed', async () => {
      const { service, storage, asGuardian } = setup();
      asGuardian();

      const error = await rejection(
        service.uploadForGuardian(GUARDIAN, DEPENDENT, {
          ...pdf(),
          mimetype: 'image/heic',
        }),
      );

      expect(codeOf(error)).toBe(ErrorCode.FILE_TYPE_INVALID);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('removes the orphan object when the database write fails', async () => {
      const { service, tx, storage, asGuardian } = setup();
      asGuardian();
      tx.guardianship_consent_evidences.create.mockRejectedValue(
        new Error('unique violation'),
      );

      await expect(
        service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf()),
      ).rejects.toThrow('unique violation');

      expect(storage.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.GUARDIANSHIP_EVIDENCE,
        [`guardianships/consent/${CONSENT_ROW}/obj.pdf`],
      );
    });

    it('a guardianship revoked between resolving and locking is a 404 and leaves no object', async () => {
      const { service, tx, storage, asGuardian } = setup();
      asGuardian();
      tx.guardianships.findFirst.mockResolvedValue(null);

      const error = await rejection(
        service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf()),
      );

      expect(codeOf(error)).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
      expect(storage.deleteMany).toHaveBeenCalled();
      expect(tx.guardianship_consent_evidences.create).not.toHaveBeenCalled();
    });

    it('audits the upload with the real actor and the dependent as target, in the upload transaction', async () => {
      const { service, audit, tx, asGuardian } = setup();
      asGuardian();

      await service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf());

      expect(audit.recordEventOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'guardianship_consent_evidence',
          entity_id: 'ev-new',
          action: 'uploaded',
          actor_user_id: GUARDIAN,
          target_user_id: DEPENDENT,
        }),
        tx,
      );
      expect(audit.recordEvent).not.toHaveBeenCalled();
    });
  });

  /**
   * verify 2c W1: once the consent is verified, the verified form must stay
   * the current one. A new upload (guardian or director) is a 409; replacing
   * the form needs a revocation (a new guardianship) first.
   */
  describe('upload after the consent is verified (W1)', () => {
    const verifiedWhere = {
      where: {
        dependent_user_id: DEPENDENT,
        consent_status: 'verified',
        is_test_data: false,
      },
    };

    it('guardian: 409 GUARDIANSHIP_CONSENT_ALREADY_VERIFIED, nothing stored', async () => {
      const { service, prisma, storage, tx, asGuardian } = setup();
      asGuardian();
      prisma.guardianships.count.mockResolvedValue(1);

      const error = await rejection(
        service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf()),
      );

      expect(codeOf(error)).toBe(
        ErrorCode.GUARDIANSHIP_CONSENT_ALREADY_VERIFIED,
      );
      expect((error as AppException).getStatus()).toBe(409);
      expect(prisma.guardianships.count).toHaveBeenCalledWith(verifiedWhere);
      expect(storage.upload).not.toHaveBeenCalled();
      expect(
        tx.guardianship_consent_evidences.updateMany,
      ).not.toHaveBeenCalled();
      expect(tx.guardianship_consent_evidences.create).not.toHaveBeenCalled();
    });

    it('director: 409 for a request still pending after the consent was verified (e.g. approve_error)', async () => {
      const { service, prisma, storage, tx, asDirector } = setup();
      asDirector();
      prisma.guardianships.count.mockResolvedValue(1);

      const error = await rejection(
        service.uploadForDirector(DIRECTOR, SECTION, ASSIGNMENT, pdf()),
      );

      expect(codeOf(error)).toBe(
        ErrorCode.GUARDIANSHIP_CONSENT_ALREADY_VERIFIED,
      );
      expect(storage.upload).not.toHaveBeenCalled();
      expect(tx.guardianship_consent_evidences.create).not.toHaveBeenCalled();
    });

    it('verified between the check and the lock: 409 under the lock, the verified form is not superseded and the object is removed', async () => {
      const { service, storage, tx, calls, asGuardian } = setup();
      asGuardian();
      tx.guardianships.count.mockImplementation(() => {
        calls.push('verified?');
        return Promise.resolve(1);
      });

      const error = await rejection(
        service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf()),
      );

      expect(codeOf(error)).toBe(
        ErrorCode.GUARDIANSHIP_CONSENT_ALREADY_VERIFIED,
      );
      expect(calls).toEqual(['lock', 'verified?']);
      expect(tx.guardianships.count).toHaveBeenCalledWith(verifiedWhere);
      expect(
        tx.guardianship_consent_evidences.updateMany,
      ).not.toHaveBeenCalled();
      expect(storage.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.GUARDIANSHIP_EVIDENCE,
        [`guardianships/consent/${CONSENT_ROW}/obj.pdf`],
      );
    });

    it('a pending consent still accepts a new form (supersede)', async () => {
      const { service, tx, asGuardian } = setup();
      asGuardian();

      await service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf());

      expect(tx.guardianship_consent_evidences.create).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * verify 2c W3: reading or storing a minor's consent form without its audit
   * row is not allowed. If the audit write fails, no signed URL leaves the
   * server and the upload is rolled back (503, the object is removed). S1: the
   * logs carry ids only, never the object key.
   */
  describe('audit is fail closed (W3) and logs carry no object key (S1)', () => {
    const KEY = `guardianships/consent/${CONSENT_ROW}/obj.pdf`;

    it.each([
      [
        'guardian read',
        (t: ReturnType<typeof setup>) => {
          t.asGuardian();
          return t.service.getForGuardian(GUARDIAN, DEPENDENT);
        },
      ],
      [
        'director read',
        (t: ReturnType<typeof setup>) => {
          t.asDirector();
          return t.service.getForDirector(DIRECTOR, SECTION, ASSIGNMENT);
        },
      ],
      [
        'admin read',
        (t: ReturnType<typeof setup>) => {
          t.prisma.guardianships.findFirst.mockResolvedValue({
            guardianship_id: CONSENT_ROW,
            dependent_user_id: DEPENDENT,
          });
          return t.service.getForAdmin(DIRECTOR, DEPENDENT, CONSENT_ROW);
        },
      ],
    ])(
      '%s: the audit write fails -> 503 GUARDIANSHIP_EVIDENCE_UNAVAILABLE and no URL is returned',
      async (_label, run) => {
        const t = setup();
        t.prisma.guardianship_consent_evidences.findFirst.mockResolvedValue(
          currentEvidence(),
        );
        t.audit.recordEventOrThrow.mockRejectedValue(new Error('audit down'));
        const logged: string[] = [];
        jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation((message: unknown) => {
            logged.push(String(message));
          });

        const error = await rejection(run(t));

        expect(codeOf(error)).toBe(ErrorCode.GUARDIANSHIP_EVIDENCE_UNAVAILABLE);
        expect((error as AppException).getStatus()).toBe(503);
        expect(JSON.stringify(error)).not.toContain('https://signed/x');
        expect(logged.join('\n')).toContain('ev-1');
        expect(logged.join('\n')).not.toContain(KEY);
      },
    );

    it('upload: the audit write fails -> 503, nothing committed and the object is removed', async () => {
      const t = setup();
      t.asGuardian();
      t.audit.recordEventOrThrow.mockRejectedValue(new Error('audit down'));

      const error = await rejection(
        t.service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf()),
      );

      expect(codeOf(error)).toBe(ErrorCode.GUARDIANSHIP_EVIDENCE_UNAVAILABLE);
      expect((error as AppException).getStatus()).toBe(503);
      // Written inside the transaction that created the row: it rolls back.
      expect(t.audit.recordEventOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'uploaded' }),
        t.tx,
      );
      expect(t.storage.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.GUARDIANSHIP_EVIDENCE,
        [KEY],
      );
    });

    it('S1: a failed orphan cleanup logs the guardianship id, never the object key', async () => {
      const t = setup();
      t.asGuardian();
      t.tx.guardianship_consent_evidences.create.mockRejectedValue(
        new Error('unique violation'),
      );
      t.storage.deleteMany.mockRejectedValue(new Error('r2 down'));
      const warned: string[] = [];
      jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation((message: unknown) => {
          warned.push(String(message));
        });

      await expect(
        t.service.uploadForGuardian(GUARDIAN, DEPENDENT, pdf()),
      ).rejects.toThrow('unique violation');

      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain(CONSENT_ROW);
      expect(warned[0]).not.toContain(KEY);
      expect(warned[0]).not.toContain('obj.pdf');
    });
  });

  describe('guardian read', () => {
    it('returns a 900 s signed URL (never a public one) and audits the read', async () => {
      const { service, prisma, storage, audit, asGuardian } = setup();
      asGuardian();
      prisma.guardianship_consent_evidences.findFirst.mockResolvedValue(
        currentEvidence(),
      );

      const result = await service.getForGuardian(GUARDIAN, DEPENDENT);

      expect(CONSENT_EVIDENCE_SIGNED_URL_TTL_SECONDS).toBe(900);
      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(
        StorageBucketAlias.GUARDIANSHIP_EVIDENCE,
        `guardianships/consent/${CONSENT_ROW}/obj.pdf`,
        { expiresInSeconds: 900 },
      );
      expect(result).toEqual({
        url: 'https://signed/x',
        expires_in: 900,
        content_type: 'application/pdf',
        uploaded_at: '2026-10-19T10:00:00.000Z',
      });
      expect(audit.recordEventOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'read',
          actor_user_id: GUARDIAN,
          target_user_id: DEPENDENT,
          changes: { guardianship_id: CONSENT_ROW, via: 'guardian' },
        }),
      );
    });

    it('queries only the CURRENT row (not superseded, not purged)', async () => {
      const { service, prisma, asGuardian } = setup();
      asGuardian();
      prisma.guardianship_consent_evidences.findFirst.mockResolvedValue(
        currentEvidence(),
      );

      await service.getForGuardian(GUARDIAN, DEPENDENT);

      expect(
        prisma.guardianship_consent_evidences.findFirst.mock.calls[0][0].where,
      ).toEqual({
        guardianship_id: CONSENT_ROW,
        superseded_at: null,
        purged_at: null,
      });
    });

    it('404 GUARDIANSHIP_EVIDENCE_NOT_FOUND when nothing was uploaded, and no read is audited', async () => {
      const { service, prisma, audit, storage, asGuardian } = setup();
      asGuardian();
      prisma.guardianship_consent_evidences.findFirst.mockResolvedValue(null);

      const error = await rejection(
        service.getForGuardian(GUARDIAN, DEPENDENT),
      );

      expect(codeOf(error)).toBe(ErrorCode.GUARDIANSHIP_EVIDENCE_NOT_FOUND);
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
      expect(audit.recordEventOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('director', () => {
    it('uploads for a pending request of the section; the uploader is the director', async () => {
      const { service, tx, audit, asDirector } = setup();
      asDirector();

      await service.uploadForDirector(DIRECTOR, SECTION, ASSIGNMENT, pdf());

      expect(
        tx.guardianship_consent_evidences.create.mock.calls[0][0].data,
      ).toMatchObject({
        guardianship_id: CONSENT_ROW,
        uploaded_by_user_id: DIRECTOR,
      });
      expect(audit.recordEventOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'uploaded',
          changes: expect.objectContaining({ via: 'director' }),
        }),
        tx,
      );
    });

    it('addresses the assignment through the section of the path, with no status filter', async () => {
      const { service, prisma, asDirector } = setup();
      asDirector();

      await service.uploadForDirector(DIRECTOR, SECTION, ASSIGNMENT, pdf());

      expect(prisma.club_role_assignments.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assignment_id: ASSIGNMENT, club_section_id: SECTION },
        }),
      );
    });

    it('a request of another section (or a missing one) is 404 MR_NOT_FOUND', async () => {
      const { service, storage, asDirector } = setup();
      asDirector(null);

      const error = await rejection(
        service.uploadForDirector(DIRECTOR, SECTION, ASSIGNMENT, pdf()),
      );

      expect(codeOf(error)).toBe(ErrorCode.MR_NOT_FOUND);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it.each(['active', 'rejected', 'expired', 'cancelled'])(
      'cannot upload for a request that is already %s',
      async (status) => {
        const { service, asDirector } = setup();
        asDirector({
          assignment_id: ASSIGNMENT,
          club_section_id: SECTION,
          user_id: DEPENDENT,
          status,
          active: true,
        });

        const error = await rejection(
          service.uploadForDirector(DIRECTOR, SECTION, ASSIGNMENT, pdf()),
        );

        expect(codeOf(error)).toBe(ErrorCode.MR_NOT_FOUND);
      },
    );

    it('an inactive assignment is 404 even when pending', async () => {
      const { service, asDirector } = setup();
      asDirector({
        assignment_id: ASSIGNMENT,
        club_section_id: SECTION,
        user_id: DEPENDENT,
        status: 'pending',
        active: false,
      });

      const error = await rejection(
        service.uploadForDirector(DIRECTOR, SECTION, ASSIGNMENT, pdf()),
      );

      expect(codeOf(error)).toBe(ErrorCode.MR_NOT_FOUND);
    });

    it('a request of a non-dependent has no consent form: 404 GUARDIANSHIP_NOT_FOUND', async () => {
      const { service, prisma, asDirector } = setup();
      asDirector();
      prisma.dependent_profiles.findUnique.mockResolvedValue(null);

      const error = await rejection(
        service.uploadForDirector(DIRECTOR, SECTION, ASSIGNMENT, pdf()),
      );

      expect(codeOf(error)).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    });

    it('reads the current form with the uploader name, for a pending or approved request', async () => {
      const { service, prisma, audit, asDirector } = setup();
      asDirector({
        assignment_id: ASSIGNMENT,
        club_section_id: SECTION,
        user_id: DEPENDENT,
        status: 'active',
        active: true,
      });
      prisma.guardianship_consent_evidences.findFirst.mockResolvedValue(
        currentEvidence(),
      );

      const result = await service.getForDirector(
        DIRECTOR,
        SECTION,
        ASSIGNMENT,
      );

      expect(result).toEqual({
        url: 'https://signed/x',
        expires_in: 900,
        content_type: 'application/pdf',
        uploaded_at: '2026-10-19T10:00:00.000Z',
        uploaded_by_display_name: 'María Pérez',
      });
      expect(audit.recordEventOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'read',
          actor_user_id: DIRECTOR,
          changes: { guardianship_id: CONSENT_ROW, via: 'director' },
        }),
      );
    });

    it('cannot read the form of a rejected request', async () => {
      const { service, asDirector } = setup();
      asDirector({
        assignment_id: ASSIGNMENT,
        club_section_id: SECTION,
        user_id: DEPENDENT,
        status: 'rejected',
        active: true,
      });

      const error = await rejection(
        service.getForDirector(DIRECTOR, SECTION, ASSIGNMENT),
      );

      expect(codeOf(error)).toBe(ErrorCode.MR_NOT_FOUND);
    });
  });

  describe('admin', () => {
    it('reads the form of a guardianship that belongs to the user as the dependent', async () => {
      const { service, prisma, audit } = setup();
      prisma.guardianships.findFirst.mockResolvedValue({
        guardianship_id: CONSENT_ROW,
        dependent_user_id: DEPENDENT,
      });
      prisma.guardianship_consent_evidences.findFirst.mockResolvedValue(
        currentEvidence(),
      );

      const result = await service.getForAdmin(
        'admin-1',
        DEPENDENT,
        CONSENT_ROW,
      );

      expect(prisma.guardianships.findFirst).toHaveBeenCalledWith({
        where: { guardianship_id: CONSENT_ROW, dependent_user_id: DEPENDENT },
        select: { guardianship_id: true, dependent_user_id: true },
      });
      expect(result).toEqual({
        url: 'https://signed/x',
        expires_in: 900,
        content_type: 'application/pdf',
        uploaded_at: '2026-10-19T10:00:00.000Z',
      });
      expect(audit.recordEventOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_user_id: 'admin-1',
          changes: { guardianship_id: CONSENT_ROW, via: 'admin' },
        }),
      );
    });

    it('a guardianship of another user is 404 (no cross-family leak)', async () => {
      const { service, prisma, storage } = setup();
      prisma.guardianships.findFirst.mockResolvedValue(null);

      const error = await rejection(
        service.getForAdmin('admin-1', DEPENDENT, CONSENT_ROW),
      );

      expect(codeOf(error)).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('404 GUARDIANSHIP_EVIDENCE_NOT_FOUND when the row has no current form', async () => {
      const { service, prisma } = setup();
      prisma.guardianships.findFirst.mockResolvedValue({
        guardianship_id: CONSENT_ROW,
        dependent_user_id: DEPENDENT,
      });
      prisma.guardianship_consent_evidences.findFirst.mockResolvedValue(null);

      const error = await rejection(
        service.getForAdmin('admin-1', DEPENDENT, CONSENT_ROW),
      );

      expect(codeOf(error)).toBe(ErrorCode.GUARDIANSHIP_EVIDENCE_NOT_FOUND);
    });
  });
});
