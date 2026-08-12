import { Test, TestingModule } from '@nestjs/testing';
import {
  CertificationReviewService,
  type CertificationReviewActor,
} from './certification-review.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ApproveCertificationRequirementDto } from '../dto/review-certification-requirement.dto';
import type { RequestCertificationRequirementChangesDto } from '../dto/review-certification-requirement.dto';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARTICIPANT_ID = 'participant-uuid-001';
const REVIEWER_ID = 'reviewer-uuid-001';
const LOCAL_FIELD_ID = 10;
const OTHER_LOCAL_FIELD_ID = 99;
const ENROLLMENT_ID = 42;
const VERSION_ID = 7;
const PROGRESS_ID = 1000;
const SECTION_ID = 100;
const MODULE_ID = 5;
const CERT_ID = 1;

const localReviewer: CertificationReviewActor = {
  userId: REVIEWER_ID,
  localFieldId: LOCAL_FIELD_ID,
  globalAccess: false,
};

const globalReviewer: CertificationReviewActor = {
  userId: REVIEWER_ID,
  globalAccess: true,
};

const noScopeReviewer: CertificationReviewActor = {
  userId: REVIEWER_ID,
  globalAccess: false,
};

const baseProgress = {
  progress_id: PROGRESS_ID,
  enrollment_id: ENROLLMENT_ID,
  user_id: PARTICIPANT_ID,
  section_id: SECTION_ID,
  status: 'SUBMITTED',
  submitted_at: new Date('2026-01-01'),
  certifications: { certification_id: CERT_ID, name: 'Capacitación básica' },
  certification_sections: {
    section_id: SECTION_ID,
    name: 'Sección 1',
    module_id: MODULE_ID,
    certification_modules: { module_id: MODULE_ID, name: 'Módulo 1' },
  },
  users: {
    user_id: PARTICIPANT_ID,
    name: 'Juan',
    paternal_last_name: 'Pérez',
  },
};

const baseEnrollment = {
  enrollment_id: ENROLLMENT_ID,
  certification_version_id: VERSION_ID,
  status: 'IN_PROGRESS',
  lock_version: 0,
};

const createTxMock = () => ({
  certification_section_progress: {
    findFirst: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  users: {
    findUnique: jest.fn(),
  },
  users_certifications: {
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  },
  certification_review_events: {
    create: jest.fn(),
  },
  certification_sections: {
    findMany: jest.fn(),
  },
});

type TxMock = ReturnType<typeof createTxMock>;

const mockPrisma = {
  $transaction: jest.fn(),
  certification_section_progress: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  users: {
    findUnique: jest.fn(),
  },
  certification_component_responses: {
    findMany: jest.fn(),
  },
  certification_review_events: {
    findMany: jest.fn(),
  },
  users_certifications: {
    findUnique: jest.fn(),
  },
  certification_sections: {
    findUnique: jest.fn(),
  },
  certification_evidences: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

const mockFileStorage = {
  getSignedDownloadUrl: jest.fn(),
};

describe('CertificationReviewService', () => {
  let service: CertificationReviewService;
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
        CertificationReviewService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorage },
      ],
    }).compile();

    service = module.get(CertificationReviewService);
  });

  // ==========================================================================
  // getTray
  // ==========================================================================

  describe('getTray', () => {
    it('TC01 - local reviewer without localFieldId gets an empty tray (no scope, no error)', async () => {
      const result = await service.getTray(noScopeReviewer);
      expect(result).toEqual([]);
      expect(mockPrisma.certification_section_progress.findMany).not.toHaveBeenCalled();
    });

    it('TC02 - filters by the reviewer institutional scope (local_field_id)', async () => {
      mockPrisma.certification_section_progress.findMany.mockResolvedValue([
        baseProgress,
      ]);

      await service.getTray(localReviewer);

      expect(
        mockPrisma.certification_section_progress.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['SUBMITTED'] },
            users: { local_field_id: LOCAL_FIELD_ID },
          }),
        }),
      );
    });

    it('TC03 - global reviewer sees all requirements with no local_field filter', async () => {
      mockPrisma.certification_section_progress.findMany.mockResolvedValue([]);

      await service.getTray(globalReviewer);

      const callArg = mockPrisma.certification_section_progress.findMany.mock
        .calls[0][0];
      expect(callArg.where.users).toBeUndefined();
    });

    it('TC04 - defaults to SUBMITTED status when none is provided', async () => {
      mockPrisma.certification_section_progress.findMany.mockResolvedValue([]);

      await service.getTray(globalReviewer, {});

      expect(
        mockPrisma.certification_section_progress.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['SUBMITTED'] } }),
        }),
      );
    });

    it('TC05 - maps rows into tray items with participant and section data', async () => {
      mockPrisma.certification_section_progress.findMany.mockResolvedValue([
        baseProgress,
      ]);

      const result = await service.getTray(globalReviewer);

      expect(result).toEqual([
        expect.objectContaining({
          progress_id: PROGRESS_ID,
          enrollment_id: ENROLLMENT_ID,
          certification_name: 'Capacitación básica',
          section_name: 'Sección 1',
          module_name: 'Módulo 1',
          participant: expect.objectContaining({ user_id: PARTICIPANT_ID }),
        }),
      ]);
    });
  });

  // ==========================================================================
  // getDetail
  // ==========================================================================

  describe('getDetail', () => {
    const wireHappyPath = () => {
      mockPrisma.certification_section_progress.findFirst.mockResolvedValue(
        baseProgress,
      );
      mockPrisma.users.findUnique.mockResolvedValue({
        local_field_id: LOCAL_FIELD_ID,
      });
      mockPrisma.certification_component_responses.findMany.mockResolvedValue(
        [],
      );
      mockPrisma.certification_review_events.findMany.mockResolvedValue([]);
      mockPrisma.users_certifications.findUnique.mockResolvedValue({
        lock_version: 3,
      });
      mockPrisma.certification_sections.findUnique.mockResolvedValue({
        certification_requirement_components: [],
      });
    };

    it('TC06 - progress not found → RECORD_NOT_FOUND', async () => {
      mockPrisma.certification_section_progress.findFirst.mockResolvedValue(
        null,
      );

      await expect(
        service.getDetail(globalReviewer, PROGRESS_ID),
      ).rejects.toMatchObject({ code: ErrorCode.RECORD_NOT_FOUND });
    });

    it('TC07 - reviewer from a different local field → CERT_REVIEW_SCOPE_FORBIDDEN', async () => {
      mockPrisma.certification_section_progress.findFirst.mockResolvedValue(
        baseProgress,
      );
      mockPrisma.users.findUnique.mockResolvedValue({
        local_field_id: OTHER_LOCAL_FIELD_ID,
      });

      await expect(
        service.getDetail(localReviewer, PROGRESS_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });
    });

    it('TC08 - reviewer with no institutional scope at all → CERT_REVIEW_SCOPE_FORBIDDEN', async () => {
      mockPrisma.certification_section_progress.findFirst.mockResolvedValue(
        baseProgress,
      );
      mockPrisma.users.findUnique.mockResolvedValue({
        local_field_id: LOCAL_FIELD_ID,
      });

      await expect(
        service.getDetail(noScopeReviewer, PROGRESS_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });
    });

    it('TC09 - happy path returns components, evidences and history', async () => {
      wireHappyPath();
      mockPrisma.certification_component_responses.findMany.mockResolvedValue(
        [
          {
            component_id: 1,
            text_value: 'x',
            attestation_confirmed: null,
            linked_user_honor_id: null,
            linked_activity_id: null,
            certification_evidences: [
              {
                evidence_id: 5,
                original_filename: 'a.pdf',
                mime_type: 'application/pdf',
                size_bytes: BigInt(100),
                upload_status: 'CONFIRMED',
              },
            ],
          },
        ],
      );
      mockPrisma.certification_sections.findUnique.mockResolvedValue({
        certification_requirement_components: [
          {
            component_id: 1,
            component_type: 'FILE_EVIDENCE',
            label: 'Adjunta comprobante',
            required: true,
          },
        ],
      });
      mockPrisma.certification_review_events.findMany.mockResolvedValue([
        {
          review_event_id: 1,
          event_type: 'REQUIREMENT_SUBMITTED',
          comment: null,
          performed_by_id: PARTICIPANT_ID,
          from_status: 'DRAFT',
          to_status: 'SUBMITTED',
          created_at: new Date('2026-01-01'),
        },
      ]);

      const result = await service.getDetail(globalReviewer, PROGRESS_ID);

      expect(result.components).toHaveLength(1);
      expect(result.components[0].evidences).toHaveLength(1);
      expect(result.history).toHaveLength(1);
      expect(result.lock_version).toBe(3);
    });
  });

  // ==========================================================================
  // approve
  // ==========================================================================

  describe('approve', () => {
    const approveDto: ApproveCertificationRequirementDto = { lock_version: 0 };

    const wireHappyPath = () => {
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        baseProgress,
      );
      txMock.users.findUnique.mockResolvedValue({
        local_field_id: LOCAL_FIELD_ID,
      });
      txMock.users_certifications.updateMany.mockResolvedValue({ count: 1 });
      txMock.certification_section_progress.update.mockResolvedValue({});
      txMock.certification_review_events.create.mockResolvedValue({});
      txMock.users_certifications.findUniqueOrThrow.mockResolvedValue(
        baseEnrollment,
      );
      txMock.certification_sections.findMany.mockResolvedValue([
        { section_id: SECTION_ID, required: true },
      ]);
      txMock.certification_section_progress.findMany.mockResolvedValue([
        { section_id: SECTION_ID, status: 'APPROVED' },
      ]);
    };

    it('TC10 - reviewer out of scope → CERT_REVIEW_SCOPE_FORBIDDEN, no mutation', async () => {
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        baseProgress,
      );
      txMock.users.findUnique.mockResolvedValue({
        local_field_id: OTHER_LOCAL_FIELD_ID,
      });

      await expect(
        service.approve(localReviewer, PROGRESS_ID, approveDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });

      expect(txMock.certification_section_progress.update).not.toHaveBeenCalled();
    });

    it('TC11 - reviewer is the participant → CERT_REVIEW_SCOPE_FORBIDDEN', async () => {
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        baseProgress,
      );
      txMock.users.findUnique.mockResolvedValue({
        local_field_id: LOCAL_FIELD_ID,
      });

      const selfReviewer: CertificationReviewActor = {
        userId: PARTICIPANT_ID,
        localFieldId: LOCAL_FIELD_ID,
        globalAccess: false,
      };

      await expect(
        service.approve(selfReviewer, PROGRESS_ID, approveDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });
    });

    it('TC12 - approving from DRAFT (not SUBMITTED) → CERT_INVALID_TRANSITION', async () => {
      txMock.certification_section_progress.findFirst.mockResolvedValue({
        ...baseProgress,
        status: 'DRAFT',
      });
      txMock.users.findUnique.mockResolvedValue({
        local_field_id: LOCAL_FIELD_ID,
      });

      await expect(
        service.approve(localReviewer, PROGRESS_ID, approveDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_INVALID_TRANSITION });
    });

    it('TC13 - stale lock_version → CERT_CONCURRENT_UPDATE, no status/event mutation', async () => {
      wireHappyPath();
      txMock.users_certifications.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.approve(localReviewer, PROGRESS_ID, { lock_version: 99 }),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_CONCURRENT_UPDATE });

      expect(txMock.certification_section_progress.update).not.toHaveBeenCalled();
      expect(txMock.certification_review_events.create).not.toHaveBeenCalled();
    });

    it('TC14 - happy path transitions SUBMITTED → APPROVED and appends an append-only event', async () => {
      wireHappyPath();

      const result = await service.approve(
        localReviewer,
        PROGRESS_ID,
        approveDto,
      );

      expect(txMock.certification_section_progress.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { progress_id: PROGRESS_ID },
          data: expect.objectContaining({
            status: 'APPROVED',
            reviewed_by_id: REVIEWER_ID,
          }),
        }),
      );
      expect(txMock.certification_review_events.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: 'REQUIREMENT_APPROVED',
            performed_by_id: REVIEWER_ID,
            from_status: 'SUBMITTED',
            to_status: 'APPROVED',
          }),
        }),
      );
      expect(result.status).toBe('APPROVED');
    });

    it('TC15 - transitions enrollment to READY_FOR_CLOSEOUT once all required sections are APPROVED', async () => {
      wireHappyPath();

      await service.approve(localReviewer, PROGRESS_ID, approveDto);

      expect(txMock.users_certifications.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enrollment_id: ENROLLMENT_ID },
          data: { status: 'READY_FOR_CLOSEOUT' },
        }),
      );
    });

    it('TC16 - global reviewer can approve regardless of participant local field', async () => {
      wireHappyPath();

      const result = await service.approve(
        globalReviewer,
        PROGRESS_ID,
        approveDto,
      );

      expect(result.status).toBe('APPROVED');
    });
  });

  // ==========================================================================
  // requestChanges
  // ==========================================================================

  describe('requestChanges', () => {
    const requestChangesDto: RequestCertificationRequirementChangesDto = {
      lock_version: 0,
      comment: 'Falta el comprobante de la actividad',
    };

    const wireHappyPath = () => {
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        baseProgress,
      );
      txMock.users.findUnique.mockResolvedValue({
        local_field_id: LOCAL_FIELD_ID,
      });
      txMock.certification_section_progress.update.mockResolvedValue({});
      txMock.certification_review_events.create.mockResolvedValue({});
    };

    it('TC17 - reviewer out of scope → CERT_REVIEW_SCOPE_FORBIDDEN', async () => {
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        baseProgress,
      );
      txMock.users.findUnique.mockResolvedValue({
        local_field_id: OTHER_LOCAL_FIELD_ID,
      });

      await expect(
        service.requestChanges(
          localReviewer,
          PROGRESS_ID,
          requestChangesDto,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });
    });

    it('TC18 - reviewer is the participant → CERT_REVIEW_SCOPE_FORBIDDEN', async () => {
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        baseProgress,
      );
      txMock.users.findUnique.mockResolvedValue({
        local_field_id: LOCAL_FIELD_ID,
      });

      const selfReviewer: CertificationReviewActor = {
        userId: PARTICIPANT_ID,
        localFieldId: LOCAL_FIELD_ID,
        globalAccess: false,
      };

      await expect(
        service.requestChanges(selfReviewer, PROGRESS_ID, requestChangesDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });
    });

    it('TC19 - not from SUBMITTED → CERT_INVALID_TRANSITION', async () => {
      txMock.certification_section_progress.findFirst.mockResolvedValue({
        ...baseProgress,
        status: 'APPROVED',
      });
      txMock.users.findUnique.mockResolvedValue({
        local_field_id: LOCAL_FIELD_ID,
      });

      await expect(
        service.requestChanges(localReviewer, PROGRESS_ID, requestChangesDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_INVALID_TRANSITION });
    });

    it('TC20 - happy path transitions SUBMITTED → CHANGES_REQUESTED with the mandatory comment persisted', async () => {
      wireHappyPath();

      const result = await service.requestChanges(
        localReviewer,
        PROGRESS_ID,
        requestChangesDto,
      );

      expect(txMock.certification_section_progress.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CHANGES_REQUESTED',
            last_review_comment: requestChangesDto.comment,
          }),
        }),
      );
      expect(txMock.certification_review_events.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: 'REQUIREMENT_CHANGES_REQUESTED',
            comment: requestChangesDto.comment,
          }),
        }),
      );
      expect(result.status).toBe('CHANGES_REQUESTED');
    });
  });

  // ==========================================================================
  // getEvidenceDownloadUrl
  // ==========================================================================

  describe('getEvidenceDownloadUrl', () => {
    const EVIDENCE_ID = 55;
    const OBJECT_KEY = 'enrollment-42/requirement-100/component-1/uuid.pdf';

    const confirmedEvidence = {
      evidence_id: EVIDENCE_ID,
      object_key: OBJECT_KEY,
      original_filename: 'acta.pdf',
      mime_type: 'application/pdf',
      upload_status: 'CONFIRMED',
      active: true,
      certification_component_responses: {
        progress_id: PROGRESS_ID,
      },
    };

    beforeEach(() => {
      mockPrisma.certification_section_progress.findFirst.mockResolvedValue(
        baseProgress,
      );
      mockPrisma.users.findUnique.mockResolvedValue({
        local_field_id: LOCAL_FIELD_ID,
      });
    });

    it('TC30 - reviewer out of scope → CERT_REVIEW_SCOPE_FORBIDDEN', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        local_field_id: OTHER_LOCAL_FIELD_ID,
      });

      await expect(
        service.getEvidenceDownloadUrl(localReviewer, PROGRESS_ID, EVIDENCE_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REVIEW_SCOPE_FORBIDDEN });
      expect(mockFileStorage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('TC31 - evidence belonging to another progress → not found', async () => {
      mockPrisma.certification_evidences.findFirst.mockResolvedValue(null);

      await expect(
        service.getEvidenceDownloadUrl(localReviewer, PROGRESS_ID, EVIDENCE_ID),
      ).rejects.toMatchObject({ code: ErrorCode.RECORD_NOT_FOUND });
      expect(mockFileStorage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('TC32 - evidence not CONFIRMED → bad request', async () => {
      mockPrisma.certification_evidences.findFirst.mockResolvedValue({
        ...confirmedEvidence,
        upload_status: 'PENDING_UPLOAD',
      });

      await expect(
        service.getEvidenceDownloadUrl(localReviewer, PROGRESS_ID, EVIDENCE_ID),
      ).rejects.toMatchObject({
        code: ErrorCode.CERT_REQUIREMENT_INCOMPLETE,
      });
      expect(mockFileStorage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('TC33 - happy path returns signed URL without persisting it', async () => {
      mockPrisma.certification_evidences.findFirst.mockResolvedValue(
        confirmedEvidence,
      );
      mockFileStorage.getSignedDownloadUrl.mockResolvedValue(
        'https://signed.example/acta.pdf',
      );

      const result = await service.getEvidenceDownloadUrl(
        localReviewer,
        PROGRESS_ID,
        EVIDENCE_ID,
      );

      expect(result).toEqual({
        url: 'https://signed.example/acta.pdf',
        expires_in: 15 * 60,
        original_filename: 'acta.pdf',
        mime_type: 'application/pdf',
      });
      expect(mockFileStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
        'CERTIFICATION_EVIDENCE',
        OBJECT_KEY,
        { expiresInSeconds: 15 * 60 },
      );
      expect(mockPrisma.certification_evidences.update).not.toHaveBeenCalled();
    });
  });
});
