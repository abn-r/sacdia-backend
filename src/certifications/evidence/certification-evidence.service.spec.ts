import { Test, TestingModule } from '@nestjs/testing';
import { CertificationEvidenceService } from './certification-evidence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { PresignCertificationEvidenceDto } from '../dto/presign-certification-evidence.dto';
import type { ConfirmCertificationEvidenceDto } from '../dto/confirm-certification-evidence.dto';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-uuid-001';
const CERT_ID = 1;
const VERSION_ID = 7;
const ENROLLMENT_ID = 42;
const MODULE_ID = 10;
const SECTION_ID = 100;
const FILE_COMPONENT_ID = 200;
const TEXT_COMPONENT_ID = 201;
const PROGRESS_ID = 55;
const RESPONSE_ID = 900;
const EVIDENCE_ID = 5000;

const baseEnrollment = {
  enrollment_id: ENROLLMENT_ID,
  user_id: USER_ID,
  certification_id: CERT_ID,
  certification_version_id: VERSION_ID,
};

const baseSection = {
  section_id: SECTION_ID,
  module_id: MODULE_ID,
  certification_requirement_components: [
    {
      component_id: FILE_COMPONENT_ID,
      component_type: 'FILE_EVIDENCE',
    },
    {
      component_id: TEXT_COMPONENT_ID,
      component_type: 'TEXT_RESPONSE',
    },
  ],
};

const draftProgress = {
  progress_id: PROGRESS_ID,
  status: 'DRAFT',
};

const presignDto: PresignCertificationEvidenceDto = {
  component_id: FILE_COMPONENT_ID,
  file_name: 'comprobante.pdf',
  mime_type: 'application/pdf',
  file_size: 102400,
};

const confirmDto: ConfirmCertificationEvidenceDto = {
  evidence_id: EVIDENCE_ID,
};

const createTxMock = () => ({
  users_certifications: {
    findFirst: jest.fn(),
  },
  certification_sections: {
    findFirst: jest.fn(),
  },
  certification_section_progress: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  certification_component_responses: {
    upsert: jest.fn(),
  },
  certification_evidences: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
});

type TxMock = ReturnType<typeof createTxMock>;

const mockPrisma = {
  $transaction: jest.fn(),
};

const mockFileStorage = {
  getSignedUploadUrl: jest.fn(),
  getObjectInfo: jest.fn(),
};

describe('CertificationEvidenceService', () => {
  let service: CertificationEvidenceService;
  let txMock: TxMock;

  beforeEach(async () => {
    jest.clearAllMocks();
    txMock = createTxMock();

    mockPrisma.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: TxMock) => Promise<unknown>)(txMock);
      }
      return Promise.all(arg as Array<Promise<unknown>>);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificationEvidenceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorage },
      ],
    }).compile();

    service = module.get(CertificationEvidenceService);
  });

  // ==========================================================================
  // presign
  // ==========================================================================

  describe('presign', () => {
    const wireHappyPath = (opts: { progress?: object | null } = {}) => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        opts.progress === undefined ? draftProgress : opts.progress,
      );
      txMock.certification_section_progress.create.mockResolvedValue(
        draftProgress,
      );
      txMock.certification_component_responses.upsert.mockResolvedValue({
        response_id: RESPONSE_ID,
      });
      mockFileStorage.getSignedUploadUrl.mockResolvedValue({
        url: 'https://r2.example.com/signed-put',
        key: `enrollment-${ENROLLMENT_ID}/requirement-${SECTION_ID}/component-${FILE_COMPONENT_ID}/uuid.pdf`,
        expiresInSeconds: 900,
      });
      txMock.certification_evidences.create.mockResolvedValue({
        evidence_id: EVIDENCE_ID,
      });
    };

    it('TC01 - enrollment not found / not owned → CERT_ENROLLMENT_NOT_FOUND', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(null);

      await expect(
        service.presign(USER_ID, ENROLLMENT_ID, SECTION_ID, presignDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_ENROLLMENT_NOT_FOUND });

      expect(txMock.users_certifications.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            enrollment_id: ENROLLMENT_ID,
            user_id: USER_ID,
            active: true,
          },
        }),
      );
    });

    it('TC02 - section not in enrolled version → CERT_SECTION_INVALID', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(null);

      await expect(
        service.presign(USER_ID, ENROLLMENT_ID, SECTION_ID, presignDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_SECTION_INVALID });
    });

    it('TC03 - unknown component_id in section → CERT_SECTION_INVALID', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue(null);

      await expect(
        service.presign(USER_ID, ENROLLMENT_ID, SECTION_ID, {
          ...presignDto,
          component_id: 9999,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_SECTION_INVALID });
    });

    it('TC04 - component_id pointing to non-FILE_EVIDENCE component → CERT_SECTION_INVALID', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue(null);

      await expect(
        service.presign(USER_ID, ENROLLMENT_ID, SECTION_ID, {
          ...presignDto,
          component_id: TEXT_COMPONENT_ID,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_SECTION_INVALID });
    });

    it('TC05 - disallowed MIME type → CERT_EVIDENCE_INVALID_TYPE (rejected before touching the DB)', async () => {
      await expect(
        service.presign(USER_ID, ENROLLMENT_ID, SECTION_ID, {
          ...presignDto,
          mime_type: 'application/zip',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_EVIDENCE_INVALID_TYPE });

      expect(txMock.users_certifications.findFirst).not.toHaveBeenCalled();
    });

    it('TC06 - declared file_size over the limit → CERT_EVIDENCE_TOO_LARGE', async () => {
      await expect(
        service.presign(USER_ID, ENROLLMENT_ID, SECTION_ID, {
          ...presignDto,
          file_size: 50 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_EVIDENCE_TOO_LARGE });
    });

    it('TC07 - SUBMITTED progress is locked for new evidence → CERT_REQUIREMENT_LOCKED', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue({
        progress_id: PROGRESS_ID,
        status: 'SUBMITTED',
      });

      await expect(
        service.presign(USER_ID, ENROLLMENT_ID, SECTION_ID, presignDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_LOCKED });
    });

    it('TC08 - creates a DRAFT progress row on first evidence when none exists', async () => {
      wireHappyPath({ progress: null });

      await service.presign(USER_ID, ENROLLMENT_ID, SECTION_ID, presignDto);

      expect(
        txMock.certification_section_progress.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: USER_ID,
            section_id: SECTION_ID,
            enrollment_id: ENROLLMENT_ID,
            status: 'DRAFT',
          }),
        }),
      );
    });

    it('TC09 - generates a server-side object_key under the enrollment/section/component namespace', async () => {
      wireHappyPath();

      await service.presign(USER_ID, ENROLLMENT_ID, SECTION_ID, presignDto);

      expect(mockFileStorage.getSignedUploadUrl).toHaveBeenCalledWith(
        'CERTIFICATION_EVIDENCE',
        expect.stringMatching(
          new RegExp(
            `^enrollment-${ENROLLMENT_ID}/requirement-${SECTION_ID}/component-${FILE_COMPONENT_ID}/.+\\.pdf$`,
          ),
        ),
        expect.objectContaining({ contentType: 'application/pdf' }),
      );
    });

    it('TC10 - never trusts a client-supplied object_key/URL (DTO has no such fields)', async () => {
      wireHappyPath();

      const maliciousDto = {
        ...presignDto,
        object_key: 'attacker/controlled/path.pdf',
        upload_url: 'https://evil.example.com/x',
      } as PresignCertificationEvidenceDto & Record<string, unknown>;

      await service.presign(USER_ID, ENROLLMENT_ID, SECTION_ID, maliciousDto);

      const [, generatedKey] = mockFileStorage.getSignedUploadUrl.mock.calls[0];
      expect(generatedKey).not.toContain('attacker');
    });

    it('TC11 - creates the evidence row with PENDING_UPLOAD status', async () => {
      wireHappyPath();

      await service.presign(USER_ID, ENROLLMENT_ID, SECTION_ID, presignDto);

      expect(txMock.certification_evidences.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            response_id: RESPONSE_ID,
            upload_status: 'PENDING_UPLOAD',
            uploaded_by_id: USER_ID,
            mime_type: 'application/pdf',
          }),
        }),
      );
    });

    it('TC12 - returns the presign payload with upload_url and evidence_id', async () => {
      wireHappyPath();

      const result = await service.presign(
        USER_ID,
        ENROLLMENT_ID,
        SECTION_ID,
        presignDto,
      );

      expect(result).toEqual(
        expect.objectContaining({
          evidence_id: EVIDENCE_ID,
          upload_url: 'https://r2.example.com/signed-put',
          expires_in: 900,
        }),
      );
    });
  });

  // ==========================================================================
  // confirm
  // ==========================================================================

  describe('confirm', () => {
    const pendingEvidence = {
      evidence_id: EVIDENCE_ID,
      object_key: 'enrollment-42/requirement-100/component-200/uuid.pdf',
      original_filename: 'comprobante.pdf',
      mime_type: 'application/pdf',
      size_bytes: BigInt(102400),
      upload_status: 'PENDING_UPLOAD',
      checksum_sha256: null,
      confirmed_at: null,
    };

    const wireHappyPath = () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        draftProgress,
      );
      txMock.certification_evidences.findFirst.mockResolvedValue(
        pendingEvidence,
      );
      mockFileStorage.getObjectInfo.mockResolvedValue({
        size: 102400,
        contentType: 'application/pdf',
      });
      txMock.certification_evidences.update.mockResolvedValue({
        ...pendingEvidence,
        upload_status: 'CONFIRMED',
        confirmed_at: new Date(),
      });
    };

    it('TC13 - evidence not found for this progress → RECORD_NOT_FOUND', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        draftProgress,
      );
      txMock.certification_evidences.findFirst.mockResolvedValue(null);

      await expect(
        service.confirm(USER_ID, ENROLLMENT_ID, SECTION_ID, confirmDto),
      ).rejects.toMatchObject({ code: ErrorCode.RECORD_NOT_FOUND });
    });

    it('TC14 - object not actually uploaded to R2 (HEAD 404) → CERT_REQUIREMENT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        draftProgress,
      );
      txMock.certification_evidences.findFirst.mockResolvedValue(
        pendingEvidence,
      );
      mockFileStorage.getObjectInfo.mockResolvedValue(null);

      await expect(
        service.confirm(USER_ID, ENROLLMENT_ID, SECTION_ID, confirmDto),
      ).rejects.toMatchObject({
        code: ErrorCode.CERT_REQUIREMENT_INCOMPLETE,
      });
    });

    it('TC15 - stored object MIME differs from allow-list → CERT_EVIDENCE_INVALID_TYPE', async () => {
      wireHappyPath();
      mockFileStorage.getObjectInfo.mockResolvedValue({
        size: 102400,
        contentType: 'application/zip',
      });

      await expect(
        service.confirm(USER_ID, ENROLLMENT_ID, SECTION_ID, confirmDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_EVIDENCE_INVALID_TYPE });
    });

    it('TC16 - stored object size diverges from the declared size beyond tolerance → CERT_EVIDENCE_TOO_LARGE', async () => {
      wireHappyPath();
      mockFileStorage.getObjectInfo.mockResolvedValue({
        size: 999999999,
        contentType: 'application/pdf',
      });

      await expect(
        service.confirm(USER_ID, ENROLLMENT_ID, SECTION_ID, confirmDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_EVIDENCE_TOO_LARGE });
    });

    it('TC17 - happy path transitions PENDING_UPLOAD → CONFIRMED', async () => {
      wireHappyPath();

      const result = await service.confirm(
        USER_ID,
        ENROLLMENT_ID,
        SECTION_ID,
        confirmDto,
      );

      expect(txMock.certification_evidences.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { evidence_id: EVIDENCE_ID },
          data: expect.objectContaining({ upload_status: 'CONFIRMED' }),
        }),
      );
      expect(result.upload_status).toBe('CONFIRMED');
    });

    it('TC18 - requirement already SUBMITTED → CERT_REQUIREMENT_LOCKED (cannot confirm evidence post-submit)', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue({
        progress_id: PROGRESS_ID,
        status: 'SUBMITTED',
      });

      await expect(
        service.confirm(USER_ID, ENROLLMENT_ID, SECTION_ID, confirmDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_LOCKED });
    });
  });

  // ==========================================================================
  // delete
  // ==========================================================================

  describe('delete', () => {
    const confirmedEvidenceWithProgress = (status: string) => ({
      evidence_id: EVIDENCE_ID,
      certification_component_responses: {
        certification_section_progress: { progress_id: PROGRESS_ID, status },
      },
    });

    it('TC19 - not enrolled → CERT_ENROLLMENT_NOT_FOUND', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(null);

      await expect(
        service.delete(USER_ID, ENROLLMENT_ID, EVIDENCE_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_ENROLLMENT_NOT_FOUND });
    });

    it('TC20 - evidence not found/not owned → RECORD_NOT_FOUND', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_evidences.findFirst.mockResolvedValue(null);

      await expect(
        service.delete(USER_ID, ENROLLMENT_ID, EVIDENCE_ID),
      ).rejects.toMatchObject({ code: ErrorCode.RECORD_NOT_FOUND });
    });

    it('TC21 - blocked once the requirement has been SUBMITTED → CERT_REQUIREMENT_LOCKED', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_evidences.findFirst.mockResolvedValue(
        confirmedEvidenceWithProgress('SUBMITTED'),
      );

      await expect(
        service.delete(USER_ID, ENROLLMENT_ID, EVIDENCE_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_LOCKED });

      expect(txMock.certification_evidences.update).not.toHaveBeenCalled();
    });

    it('TC22 - blocked once the requirement has been APPROVED → CERT_REQUIREMENT_LOCKED', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_evidences.findFirst.mockResolvedValue(
        confirmedEvidenceWithProgress('APPROVED'),
      );

      await expect(
        service.delete(USER_ID, ENROLLMENT_ID, EVIDENCE_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_LOCKED });
    });

    it('TC23 - happy path soft-deletes evidence while requirement is still DRAFT', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_evidences.findFirst.mockResolvedValue(
        confirmedEvidenceWithProgress('DRAFT'),
      );
      txMock.certification_evidences.update.mockResolvedValue({});

      const result = await service.delete(USER_ID, ENROLLMENT_ID, EVIDENCE_ID);

      expect(txMock.certification_evidences.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { evidence_id: EVIDENCE_ID },
          data: expect.objectContaining({ active: false }),
        }),
      );
      expect(result.message).toEqual(expect.any(String));
    });

    it('TC24 - allowed while requirement is CHANGES_REQUESTED', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_evidences.findFirst.mockResolvedValue(
        confirmedEvidenceWithProgress('CHANGES_REQUESTED'),
      );
      txMock.certification_evidences.update.mockResolvedValue({});

      await service.delete(USER_ID, ENROLLMENT_ID, EVIDENCE_ID);

      expect(txMock.certification_evidences.update).toHaveBeenCalled();
    });
  });
});
