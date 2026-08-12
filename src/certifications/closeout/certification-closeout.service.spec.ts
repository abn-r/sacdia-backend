import { Test, TestingModule } from '@nestjs/testing';
import {
  CertificationCloseoutService,
  type CertificationCloseoutReviewActor,
} from './certification-closeout.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { PresignCertificationCloseoutEvidenceDto } from '../dto/review-certification-closeout.dto';
import type { ConfirmCertificationCloseoutEvidenceDto } from '../dto/review-certification-closeout.dto';
import type { RequestCertificationCloseoutChangesDto } from '../dto/review-certification-closeout.dto';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-uuid-001';
const REVIEWER_ID = 'reviewer-uuid-001';
const CERT_ID = 1;
const VERSION_ID = 7;
const ENROLLMENT_ID = 42;
const SECTION_ID = 100;
const CLOSEOUT_EVIDENCE_ID = 900;
const LOCAL_FIELD_ID = 10;
const OTHER_LOCAL_FIELD_ID = 99;

const readyEnrollment = {
  enrollment_id: ENROLLMENT_ID,
  user_id: USER_ID,
  certification_id: CERT_ID,
  certification_version_id: VERSION_ID,
  status: 'READY_FOR_CLOSEOUT',
};

const changesRequestedEnrollment = {
  ...readyEnrollment,
  status: 'CHANGES_REQUESTED',
};

const presignDto: PresignCertificationCloseoutEvidenceDto = {
  file_name: 'acta-junta.pdf',
  mime_type: 'application/pdf',
  file_size: 102400,
};

const confirmDto: ConfirmCertificationCloseoutEvidenceDto = {
  closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
};

const localReviewer: CertificationCloseoutReviewActor = {
  userId: REVIEWER_ID,
  localFieldId: LOCAL_FIELD_ID,
  globalAccess: false,
};

const globalReviewer: CertificationCloseoutReviewActor = {
  userId: REVIEWER_ID,
  globalAccess: true,
};

const createTxMock = () => ({
  users_certifications: {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  certification_closeout_evidences: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  certification_sections: {
    findMany: jest.fn(),
  },
  certification_section_progress: {
    findMany: jest.fn(),
  },
  certification_review_events: {
    create: jest.fn(),
  },
});

type TxMock = ReturnType<typeof createTxMock>;

const mockPrisma = {
  $transaction: jest.fn(),
  users_certifications: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  certification_closeout_evidences: {
    findFirst: jest.fn(),
  },
};

const mockFileStorage = {
  getSignedUploadUrl: jest.fn(),
  getObjectInfo: jest.fn(),
  getSignedDownloadUrl: jest.fn(),
};

const wireAllRequiredApproved = (tx: TxMock) => {
  tx.certification_sections.findMany.mockResolvedValue([
    { section_id: SECTION_ID, required: true },
  ]);
  tx.certification_section_progress.findMany.mockResolvedValue([
    { section_id: SECTION_ID, status: 'APPROVED' },
  ]);
};

describe('CertificationCloseoutService', () => {
  let service: CertificationCloseoutService;
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
        CertificationCloseoutService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorage },
      ],
    }).compile();

    service = module.get(CertificationCloseoutService);
  });

  // ==========================================================================
  // presignCloseoutEvidence
  // ==========================================================================

  describe('presignCloseoutEvidence', () => {
    const wireHappyPath = () => {
      txMock.users_certifications.findFirst.mockResolvedValue(readyEnrollment);
      txMock.certification_closeout_evidences.updateMany.mockResolvedValue({
        count: 0,
      });
      mockFileStorage.getSignedUploadUrl.mockResolvedValue({
        url: 'https://r2.example.com/signed-put',
        key: `enrollment-${ENROLLMENT_ID}/closeout/uuid.pdf`,
        expiresInSeconds: 900,
      });
      txMock.certification_closeout_evidences.create.mockResolvedValue({
        closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
      });
    };

    it('TC01 - enrollment not found / not owned → CERT_ENROLLMENT_NOT_FOUND', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(null);

      await expect(
        service.presignCloseoutEvidence(USER_ID, ENROLLMENT_ID, presignDto),
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

    it('TC02 - disallowed MIME type → CERT_EVIDENCE_INVALID_TYPE', async () => {
      await expect(
        service.presignCloseoutEvidence(USER_ID, ENROLLMENT_ID, {
          ...presignDto,
          mime_type: 'application/zip',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_EVIDENCE_INVALID_TYPE });
    });

    it('TC03 - declared size over the limit → CERT_EVIDENCE_TOO_LARGE', async () => {
      await expect(
        service.presignCloseoutEvidence(USER_ID, ENROLLMENT_ID, {
          ...presignDto,
          file_size: 50 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_EVIDENCE_TOO_LARGE });
    });

    it('TC04 - enrollment not yet ready for closeout (still IN_PROGRESS) → CERT_CLOSEOUT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue({
        ...readyEnrollment,
        status: 'IN_PROGRESS',
      });

      await expect(
        service.presignCloseoutEvidence(USER_ID, ENROLLMENT_ID, presignDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_CLOSEOUT_INCOMPLETE });
    });

    it('TC05 - valid PDF from READY_FOR_CLOSEOUT generates a server-side object_key under the enrollment/closeout namespace', async () => {
      wireHappyPath();

      const result = await service.presignCloseoutEvidence(
        USER_ID,
        ENROLLMENT_ID,
        presignDto,
      );

      expect(mockFileStorage.getSignedUploadUrl).toHaveBeenCalledWith(
        'CERTIFICATION_EVIDENCE',
        expect.stringMatching(
          new RegExp(`^enrollment-${ENROLLMENT_ID}/closeout/.+\\.pdf$`),
        ),
        expect.objectContaining({ contentType: 'application/pdf' }),
      );
      expect(result.closeout_evidence_id).toBe(CLOSEOUT_EVIDENCE_ID);
    });

    it('TC06 - valid image/jpeg is accepted', async () => {
      wireHappyPath();

      await service.presignCloseoutEvidence(USER_ID, ENROLLMENT_ID, {
        ...presignDto,
        file_name: 'foto.jpg',
        mime_type: 'image/jpeg',
      });

      expect(txMock.certification_closeout_evidences.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mime_type: 'image/jpeg' }),
        }),
      );
    });

    it('TC07 - replace before send: deactivates any existing non-approved closeout evidence', async () => {
      wireHappyPath();

      await service.presignCloseoutEvidence(USER_ID, ENROLLMENT_ID, presignDto);

      expect(
        txMock.certification_closeout_evidences.updateMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            enrollment_id: ENROLLMENT_ID,
            active: true,
            review_status: { not: 'APPROVED' },
          }),
          data: expect.objectContaining({ active: false }),
        }),
      );
    });

    it('TC08 - re-entering after a final-review return (CHANGES_REQUESTED) replays IN_PROGRESS → READY_FOR_CLOSEOUT', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(
        changesRequestedEnrollment,
      );
      wireAllRequiredApproved(txMock);
      txMock.certification_closeout_evidences.updateMany.mockResolvedValue({
        count: 1,
      });
      mockFileStorage.getSignedUploadUrl.mockResolvedValue({
        url: 'https://r2.example.com/signed-put',
        key: `enrollment-${ENROLLMENT_ID}/closeout/uuid.pdf`,
        expiresInSeconds: 900,
      });
      txMock.certification_closeout_evidences.create.mockResolvedValue({
        closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
      });

      await service.presignCloseoutEvidence(USER_ID, ENROLLMENT_ID, presignDto);

      expect(txMock.users_certifications.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'IN_PROGRESS' } }),
      );
      expect(txMock.users_certifications.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'READY_FOR_CLOSEOUT' } }),
      );
    });

    it('TC09 - blocked from a terminal state (CERTIFIED) → CERT_CLOSEOUT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue({
        ...readyEnrollment,
        status: 'CERTIFIED',
      });

      await expect(
        service.presignCloseoutEvidence(USER_ID, ENROLLMENT_ID, presignDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_CLOSEOUT_INCOMPLETE });
    });
  });

  // ==========================================================================
  // confirmCloseoutEvidence
  // ==========================================================================

  describe('confirmCloseoutEvidence', () => {
    const pendingEvidence = {
      closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
      enrollment_id: ENROLLMENT_ID,
      object_key: `enrollment-${ENROLLMENT_ID}/closeout/uuid.pdf`,
      mime_type: 'application/pdf',
      size_bytes: BigInt(102400),
      upload_status: 'PENDING_UPLOAD',
      review_status: 'PENDING',
    };

    it('TC10 - not enrolled → CERT_ENROLLMENT_NOT_FOUND', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(null);

      await expect(
        service.confirmCloseoutEvidence(USER_ID, ENROLLMENT_ID, confirmDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_ENROLLMENT_NOT_FOUND });
    });

    it('TC11 - evidence not found for this enrollment → RECORD_NOT_FOUND', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(readyEnrollment);
      txMock.certification_closeout_evidences.findFirst.mockResolvedValue(
        null,
      );

      await expect(
        service.confirmCloseoutEvidence(USER_ID, ENROLLMENT_ID, confirmDto),
      ).rejects.toMatchObject({ code: ErrorCode.RECORD_NOT_FOUND });
    });

    it('TC12 - object not uploaded to R2 (HEAD 404) → CERT_REQUIREMENT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(readyEnrollment);
      txMock.certification_closeout_evidences.findFirst.mockResolvedValue(
        pendingEvidence,
      );
      mockFileStorage.getObjectInfo.mockResolvedValue(null);

      await expect(
        service.confirmCloseoutEvidence(USER_ID, ENROLLMENT_ID, confirmDto),
      ).rejects.toMatchObject({
        code: ErrorCode.CERT_REQUIREMENT_INCOMPLETE,
      });
    });

    it('TC13 - happy path transitions PENDING_UPLOAD → CONFIRMED', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(readyEnrollment);
      txMock.certification_closeout_evidences.findFirst.mockResolvedValue(
        pendingEvidence,
      );
      mockFileStorage.getObjectInfo.mockResolvedValue({
        size: 102400,
        contentType: 'application/pdf',
      });
      txMock.certification_closeout_evidences.update.mockResolvedValue({
        closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
        upload_status: 'CONFIRMED',
        review_status: 'PENDING',
      });

      const result = await service.confirmCloseoutEvidence(
        USER_ID,
        ENROLLMENT_ID,
        confirmDto,
      );

      expect(result.upload_status).toBe('CONFIRMED');
    });
  });

  // ==========================================================================
  // submitFinal
  // ==========================================================================

  describe('submitFinal', () => {
    const confirmedEvidence = {
      closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
      upload_status: 'CONFIRMED',
    };

    const wireHappyPath = () => {
      txMock.users_certifications.findFirst.mockResolvedValue(readyEnrollment);
      wireAllRequiredApproved(txMock);
      txMock.certification_closeout_evidences.findFirst.mockResolvedValue(
        confirmedEvidence,
      );
      txMock.users_certifications.update.mockResolvedValue({});
      txMock.certification_closeout_evidences.update.mockResolvedValue({});
      txMock.certification_review_events.create.mockResolvedValue({});
    };

    it('TC14 - enrollment not READY_FOR_CLOSEOUT → CERT_CLOSEOUT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue({
        ...readyEnrollment,
        status: 'IN_PROGRESS',
      });

      await expect(
        service.submitFinal(USER_ID, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_CLOSEOUT_INCOMPLETE });
    });

    it('TC15 - a required requirement is not APPROVED → CERT_CLOSEOUT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(readyEnrollment);
      txMock.certification_sections.findMany.mockResolvedValue([
        { section_id: SECTION_ID, required: true },
      ]);
      txMock.certification_section_progress.findMany.mockResolvedValue([
        { section_id: SECTION_ID, status: 'SUBMITTED' },
      ]);

      await expect(
        service.submitFinal(USER_ID, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_CLOSEOUT_INCOMPLETE });
    });

    it('TC16 - no closeout evidence uploaded → CERT_CLOSEOUT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(readyEnrollment);
      wireAllRequiredApproved(txMock);
      txMock.certification_closeout_evidences.findFirst.mockResolvedValue(
        null,
      );

      await expect(
        service.submitFinal(USER_ID, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_CLOSEOUT_INCOMPLETE });
    });

    it('TC17 - closeout evidence still PENDING_UPLOAD (not confirmed) → CERT_CLOSEOUT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(readyEnrollment);
      wireAllRequiredApproved(txMock);
      txMock.certification_closeout_evidences.findFirst.mockResolvedValue({
        ...confirmedEvidence,
        upload_status: 'PENDING_UPLOAD',
      });

      await expect(
        service.submitFinal(USER_ID, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_CLOSEOUT_INCOMPLETE });
    });

    it('TC18 - happy path transitions READY_FOR_CLOSEOUT → SUBMITTED_FOR_FINAL_REVIEW', async () => {
      wireHappyPath();

      const result = await service.submitFinal(USER_ID, ENROLLMENT_ID);

      expect(txMock.users_certifications.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SUBMITTED_FOR_FINAL_REVIEW',
          }),
        }),
      );
      expect(txMock.certification_closeout_evidences.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ review_status: 'SUBMITTED' }),
        }),
      );
      expect(txMock.certification_review_events.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event_type: 'CLOSEOUT_SUBMITTED' }),
        }),
      );
      expect(result.status).toBe('SUBMITTED_FOR_FINAL_REVIEW');
    });
  });

  // ==========================================================================
  // getFinalTray
  // ==========================================================================

  describe('getFinalTray', () => {
    it('TC19 - reviewer without institutional scope gets an empty tray', async () => {
      const result = await service.getFinalTray({
        userId: REVIEWER_ID,
        globalAccess: false,
      });
      expect(result).toEqual([]);
      expect(mockPrisma.users_certifications.findMany).not.toHaveBeenCalled();
    });

    it('TC20 - filters by local_field_id for a local reviewer', async () => {
      mockPrisma.users_certifications.findMany.mockResolvedValue([]);

      await service.getFinalTray(localReviewer);

      expect(mockPrisma.users_certifications.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['SUBMITTED_FOR_FINAL_REVIEW', 'APPROVED'] },
            users: { local_field_id: LOCAL_FIELD_ID },
          }),
        }),
      );
    });

    it('TC21 - global reviewer sees all enrollments with no local_field filter', async () => {
      mockPrisma.users_certifications.findMany.mockResolvedValue([]);

      await service.getFinalTray(globalReviewer);

      const callArg = mockPrisma.users_certifications.findMany.mock.calls[0][0];
      expect(callArg.where.users).toBeUndefined();
    });

    it('TC21b - tray includes SUBMITTED_FOR_FINAL_REVIEW and APPROVED with closeout metadata', async () => {
      mockPrisma.users_certifications.findMany.mockResolvedValue([
        {
          enrollment_id: ENROLLMENT_ID,
          status: 'SUBMITTED_FOR_FINAL_REVIEW',
          submitted_at: new Date('2026-01-02'),
          users: {
            user_id: USER_ID,
            name: 'Ana',
            paternal_last_name: 'López',
          },
          certifications: { certification_id: CERT_ID, name: 'Capacitación' },
          certification_closeout_evidences: [
            {
              closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
              review_status: 'SUBMITTED',
              upload_status: 'CONFIRMED',
              original_filename: 'junta.pdf',
              mime_type: 'application/pdf',
            },
          ],
        },
      ]);

      const result = await service.getFinalTray(localReviewer);

      expect(mockPrisma.users_certifications.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['SUBMITTED_FOR_FINAL_REVIEW', 'APPROVED'] },
          }),
        }),
      );
      expect(result[0]).toEqual(
        expect.objectContaining({
          enrollment_id: ENROLLMENT_ID,
          closeout_evidence: {
            closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
            review_status: 'SUBMITTED',
            upload_status: 'CONFIRMED',
            original_filename: 'junta.pdf',
            mime_type: 'application/pdf',
          },
        }),
      );
    });
  });

  // ==========================================================================
  // getCloseoutEvidenceDownloadUrl
  // ==========================================================================

  describe('getCloseoutEvidenceDownloadUrl', () => {
    const OBJECT_KEY = `enrollment-${ENROLLMENT_ID}/closeout/uuid.pdf`;
    const confirmedCloseout = {
      closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
      object_key: OBJECT_KEY,
      original_filename: 'junta.pdf',
      mime_type: 'application/pdf',
      upload_status: 'CONFIRMED',
      active: true,
    };

    const enrollmentInScope = {
      ...readyEnrollment,
      status: 'SUBMITTED_FOR_FINAL_REVIEW',
      users: { local_field_id: LOCAL_FIELD_ID },
    };

    it('TC34 - reviewer out of scope → CERT_REVIEW_SCOPE_FORBIDDEN', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue({
        ...enrollmentInScope,
        users: { local_field_id: OTHER_LOCAL_FIELD_ID },
      });

      await expect(
        service.getCloseoutEvidenceDownloadUrl(localReviewer, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });
      expect(mockFileStorage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('TC35 - no confirmed closeout evidence → not found', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(
        enrollmentInScope,
      );
      mockPrisma.certification_closeout_evidences.findFirst.mockResolvedValue(
        null,
      );

      await expect(
        service.getCloseoutEvidenceDownloadUrl(localReviewer, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.RECORD_NOT_FOUND });
    });

    it('TC36 - happy path returns signed URL for confirmed closeout evidence', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(
        enrollmentInScope,
      );
      mockPrisma.certification_closeout_evidences.findFirst.mockResolvedValue(
        confirmedCloseout,
      );
      mockFileStorage.getSignedDownloadUrl.mockResolvedValue(
        'https://signed.example/junta.pdf',
      );

      const result = await service.getCloseoutEvidenceDownloadUrl(
        localReviewer,
        ENROLLMENT_ID,
      );

      expect(result).toEqual({
        url: 'https://signed.example/junta.pdf',
        expires_in: 15 * 60,
        original_filename: 'junta.pdf',
        mime_type: 'application/pdf',
      });
      expect(mockFileStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
        'CERTIFICATION_EVIDENCE',
        OBJECT_KEY,
        { expiresInSeconds: 15 * 60 },
      );
    });
  });

  // ==========================================================================
  // approveCloseoutEvidence
  // ==========================================================================

  describe('approveCloseoutEvidence', () => {
    const submittedEnrollmentWithUser = {
      ...readyEnrollment,
      status: 'SUBMITTED_FOR_FINAL_REVIEW',
      users: { local_field_id: LOCAL_FIELD_ID },
    };

    it('TC22 - reviewer out of scope → CERT_REVIEW_SCOPE_FORBIDDEN', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue({
        ...submittedEnrollmentWithUser,
        users: { local_field_id: OTHER_LOCAL_FIELD_ID },
      });

      await expect(
        service.approveCloseoutEvidence(localReviewer, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });
    });

    it('TC23 - reviewer is the participant → CERT_REVIEW_SCOPE_FORBIDDEN', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(
        submittedEnrollmentWithUser,
      );

      const selfReviewer: CertificationCloseoutReviewActor = {
        userId: USER_ID,
        localFieldId: LOCAL_FIELD_ID,
        globalAccess: false,
      };

      await expect(
        service.approveCloseoutEvidence(selfReviewer, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });
    });

    it('TC24 - enrollment not SUBMITTED_FOR_FINAL_REVIEW → CERT_INVALID_TRANSITION', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue({
        ...submittedEnrollmentWithUser,
        status: 'READY_FOR_CLOSEOUT',
      });

      await expect(
        service.approveCloseoutEvidence(localReviewer, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_INVALID_TRANSITION });
    });

    it('TC25 - happy path approves the evidence and transitions enrollment to APPROVED', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(
        submittedEnrollmentWithUser,
      );
      txMock.certification_closeout_evidences.findFirst.mockResolvedValue({
        closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
        review_status: 'SUBMITTED',
      });
      txMock.certification_closeout_evidences.update.mockResolvedValue({});
      txMock.users_certifications.update.mockResolvedValue({});
      txMock.certification_review_events.create.mockResolvedValue({});

      const result = await service.approveCloseoutEvidence(
        localReviewer,
        ENROLLMENT_ID,
      );

      expect(txMock.certification_closeout_evidences.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ review_status: 'APPROVED' }),
        }),
      );
      expect(txMock.users_certifications.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
      expect(result.status).toBe('APPROVED');
    });
  });

  // ==========================================================================
  // requestChanges (final)
  // ==========================================================================

  describe('requestChanges', () => {
    const submittedEnrollmentWithUser = {
      ...readyEnrollment,
      status: 'SUBMITTED_FOR_FINAL_REVIEW',
      users: { local_field_id: LOCAL_FIELD_ID },
    };
    const dto: RequestCertificationCloseoutChangesDto = {
      comment: 'El acta no incluye la firma del director',
    };

    it('TC26 - happy path transitions to CHANGES_REQUESTED with mandatory comment persisted', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(
        submittedEnrollmentWithUser,
      );
      txMock.certification_closeout_evidences.findFirst.mockResolvedValue({
        closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
      });
      txMock.certification_closeout_evidences.update.mockResolvedValue({});
      txMock.users_certifications.update.mockResolvedValue({});
      txMock.certification_review_events.create.mockResolvedValue({});

      const result = await service.requestChanges(
        localReviewer,
        ENROLLMENT_ID,
        dto,
      );

      expect(txMock.certification_closeout_evidences.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            review_status: 'CHANGES_REQUESTED',
            review_comment: dto.comment,
          }),
        }),
      );
      expect(txMock.users_certifications.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'CHANGES_REQUESTED' },
        }),
      );
      expect(result.status).toBe('CHANGES_REQUESTED');
    });

    it('TC27 - reviewer out of scope → CERT_REVIEW_SCOPE_FORBIDDEN', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue({
        ...submittedEnrollmentWithUser,
        users: { local_field_id: OTHER_LOCAL_FIELD_ID },
      });

      await expect(
        service.requestChanges(localReviewer, ENROLLMENT_ID, dto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });
    });
  });

  // ==========================================================================
  // certify
  // ==========================================================================

  describe('certify', () => {
    const approvedEnrollmentWithUser = {
      ...readyEnrollment,
      status: 'APPROVED',
      users: { local_field_id: LOCAL_FIELD_ID },
    };

    it('TC28 - enrollment not APPROVED → CERT_CLOSEOUT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue({
        ...approvedEnrollmentWithUser,
        status: 'SUBMITTED_FOR_FINAL_REVIEW',
      });

      await expect(
        service.certify(localReviewer, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_CLOSEOUT_INCOMPLETE });
    });

    it('TC29 - a required requirement is no longer APPROVED at certify time → CERT_CLOSEOUT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(
        approvedEnrollmentWithUser,
      );
      txMock.certification_sections.findMany.mockResolvedValue([
        { section_id: SECTION_ID, required: true },
      ]);
      txMock.certification_section_progress.findMany.mockResolvedValue([
        { section_id: SECTION_ID, status: 'CHANGES_REQUESTED' },
      ]);

      await expect(
        service.certify(localReviewer, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_CLOSEOUT_INCOMPLETE });
    });

    it('TC30 - closeout evidence not APPROVED → CERT_CLOSEOUT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(
        approvedEnrollmentWithUser,
      );
      wireAllRequiredApproved(txMock);
      txMock.certification_closeout_evidences.findFirst.mockResolvedValue({
        closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
        review_status: 'SUBMITTED',
      });

      await expect(
        service.certify(localReviewer, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_CLOSEOUT_INCOMPLETE });
    });

    it('TC31 - happy path certifies and transitions APPROVED → CERTIFIED', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(
        approvedEnrollmentWithUser,
      );
      wireAllRequiredApproved(txMock);
      txMock.certification_closeout_evidences.findFirst.mockResolvedValue({
        closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
        review_status: 'APPROVED',
      });
      txMock.users_certifications.update.mockResolvedValue({});
      txMock.certification_review_events.create.mockResolvedValue({});

      const result = await service.certify(localReviewer, ENROLLMENT_ID);

      expect(txMock.users_certifications.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CERTIFIED' }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ status: 'CERTIFIED', already_certified: false }),
      );
    });

    it('TC32 - idempotent: calling certify again on an already-CERTIFIED enrollment is a no-op success', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue({
        ...approvedEnrollmentWithUser,
        status: 'CERTIFIED',
      });

      const result = await service.certify(localReviewer, ENROLLMENT_ID);

      expect(result).toEqual(
        expect.objectContaining({ status: 'CERTIFIED', already_certified: true }),
      );
      expect(txMock.users_certifications.update).not.toHaveBeenCalled();
      expect(txMock.certification_review_events.create).not.toHaveBeenCalled();
    });

    it('TC33 - reviewer out of scope cannot certify → CERT_REVIEW_SCOPE_FORBIDDEN', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue({
        ...approvedEnrollmentWithUser,
        users: { local_field_id: OTHER_LOCAL_FIELD_ID },
      });

      await expect(
        service.certify(localReviewer, ENROLLMENT_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });
    });

    it('TC34 - global reviewer can certify regardless of participant local field', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(
        approvedEnrollmentWithUser,
      );
      wireAllRequiredApproved(txMock);
      txMock.certification_closeout_evidences.findFirst.mockResolvedValue({
        closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
        review_status: 'APPROVED',
      });
      txMock.users_certifications.update.mockResolvedValue({});
      txMock.certification_review_events.create.mockResolvedValue({});

      const result = await service.certify(globalReviewer, ENROLLMENT_ID);

      expect(result.status).toBe('CERTIFIED');
    });
  });
});
