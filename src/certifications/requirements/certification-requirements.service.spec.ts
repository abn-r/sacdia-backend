import { Test, TestingModule } from '@nestjs/testing';
import { CertificationRequirementsService } from './certification-requirements.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { SaveRequirementDraftDto } from '../dto/save-requirement-draft.dto';
import type { SubmitRequirementDto } from '../dto/submit-requirement.dto';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-uuid-001';
const CERT_ID = 1;
const VERSION_ID = 7;
const ENROLLMENT_ID = 42;
const MODULE_ID = 10;
const SECTION_ID = 100;
const TEXT_COMPONENT_ID = 200;
const HONOR_COMPONENT_ID = 201;
const ATTESTATION_COMPONENT_ID = 202;
const HONOR_ID = 300;

const baseEnrollment = {
  enrollment_id: ENROLLMENT_ID,
  user_id: USER_ID,
  certification_id: CERT_ID,
  certification_version_id: VERSION_ID,
  status: 'ENROLLED',
  started_at: null,
  lock_version: 0,
};

const inProgressEnrollment = { ...baseEnrollment, status: 'IN_PROGRESS' };

const baseSection = {
  section_id: SECTION_ID,
  module_id: MODULE_ID,
  name: 'Sección 1',
  required: true,
  certification_requirement_components: [
    {
      component_id: TEXT_COMPONENT_ID,
      component_type: 'TEXT_RESPONSE',
      label: 'Reflexión',
      required: true,
    },
    {
      component_id: ATTESTATION_COMPONENT_ID,
      component_type: 'ATTESTATION',
      label: 'Confirmo',
      required: false,
    },
  ],
};

const sectionWithHonor = {
  ...baseSection,
  certification_requirement_components: [
    ...baseSection.certification_requirement_components,
    {
      component_id: HONOR_COMPONENT_ID,
      component_type: 'LINKED_HONOR',
      label: 'Especialidad requerida',
      required: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Tx mock
// ---------------------------------------------------------------------------

const createTxMock = () => ({
  users_certifications: {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  certification_sections: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  certification_section_progress: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  certification_component_responses: {
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
  users_honors: {
    findFirst: jest.fn(),
  },
  certification_review_events: {
    create: jest.fn(),
  },
});

type TxMock = ReturnType<typeof createTxMock>;

const mockPrisma = {
  $transaction: jest.fn(),
  users_certifications: {
    findFirst: jest.fn(),
  },
  certification_sections: {
    findFirst: jest.fn(),
  },
  certification_section_progress: {
    findFirst: jest.fn(),
  },
};

describe('CertificationRequirementsService', () => {
  let service: CertificationRequirementsService;
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
        CertificationRequirementsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(CertificationRequirementsService);
  });

  // ==========================================================================
  // getRequirement
  // ==========================================================================

  describe('getRequirement', () => {
    it('TC01 - not enrolled → CERT_ENROLLMENT_NOT_FOUND', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(null);

      await expect(
        service.getRequirement(USER_ID, CERT_ID, SECTION_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_ENROLLMENT_NOT_FOUND });
    });

    it('TC02 - section not in the enrolled version → CERT_SECTION_INVALID', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(
        baseEnrollment,
      );
      mockPrisma.certification_sections.findFirst.mockResolvedValue(null);

      await expect(
        service.getRequirement(USER_ID, CERT_ID, SECTION_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_SECTION_INVALID });
    });

    it('TC03 - returns DRAFT status view with no responses when never saved', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(
        baseEnrollment,
      );
      mockPrisma.certification_sections.findFirst.mockResolvedValue(
        baseSection,
      );
      mockPrisma.certification_section_progress.findFirst.mockResolvedValue(
        null,
      );

      const result = await service.getRequirement(USER_ID, CERT_ID, SECTION_ID);

      expect(result.status).toBe('DRAFT');
      expect(result.components).toHaveLength(2);
      expect(result.components[0].response).toBeNull();
    });

    it('TC04 - merges saved component responses into the view', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(
        baseEnrollment,
      );
      mockPrisma.certification_sections.findFirst.mockResolvedValue(
        baseSection,
      );
      mockPrisma.certification_section_progress.findFirst.mockResolvedValue({
        progress_id: 1,
        status: 'DRAFT',
        submitted_at: null,
        reviewed_at: null,
        last_review_comment: null,
        certification_component_responses: [
          {
            component_id: TEXT_COMPONENT_ID,
            text_value: 'Mi reflexión',
            attestation_confirmed: null,
            linked_user_honor_id: null,
            linked_activity_id: null,
          },
        ],
      });

      const result = await service.getRequirement(USER_ID, CERT_ID, SECTION_ID);

      const textComponent = result.components.find(
        (c) => c.component_id === TEXT_COMPONENT_ID,
      );
      expect(textComponent?.response?.text_value).toBe('Mi reflexión');
    });
  });

  // ==========================================================================
  // saveDraft
  // ==========================================================================

  describe('saveDraft', () => {
    const dto: SaveRequirementDraftDto = {
      responses: [{ component_id: TEXT_COMPONENT_ID, text_value: 'Hola' }],
    };

    const wireCreateNewProgress = () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue(null);
      txMock.certification_section_progress.create.mockResolvedValue({
        progress_id: 1,
        status: 'DRAFT',
        submitted_at: null,
        reviewed_at: null,
        last_review_comment: null,
      });
      txMock.certification_component_responses.upsert.mockResolvedValue({});
      txMock.certification_component_responses.findMany.mockResolvedValue([
        {
          component_id: TEXT_COMPONENT_ID,
          text_value: 'Hola',
          attestation_confirmed: null,
          linked_user_honor_id: null,
          linked_activity_id: null,
        },
      ]);
    };

    it('TC05 - not enrolled → CERT_ENROLLMENT_NOT_FOUND', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(null);

      await expect(
        service.saveDraft(USER_ID, CERT_ID, SECTION_ID, dto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_ENROLLMENT_NOT_FOUND });
    });

    it('TC06 - creates a new DRAFT progress row on first save and advances enrollment to IN_PROGRESS', async () => {
      wireCreateNewProgress();

      const result = await service.saveDraft(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        dto,
      );

      expect(result.status).toBe('DRAFT');
      expect(txMock.certification_section_progress.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: USER_ID,
            section_id: SECTION_ID,
            enrollment_id: ENROLLMENT_ID,
            status: 'DRAFT',
          }),
        }),
      );
      expect(txMock.users_certifications.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enrollment_id: ENROLLMENT_ID },
          data: expect.objectContaining({ status: 'IN_PROGRESS' }),
        }),
      );
    });

    it('TC07 - does not re-transition enrollment when already IN_PROGRESS', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(
        inProgressEnrollment,
      );
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue(null);
      txMock.certification_section_progress.create.mockResolvedValue({
        progress_id: 1,
        status: 'DRAFT',
        submitted_at: null,
        reviewed_at: null,
        last_review_comment: null,
      });
      txMock.certification_component_responses.upsert.mockResolvedValue({});
      txMock.certification_component_responses.findMany.mockResolvedValue([]);

      await service.saveDraft(USER_ID, CERT_ID, SECTION_ID, dto);

      expect(txMock.users_certifications.update).not.toHaveBeenCalled();
    });

    it('TC08 - upserts responses using the progress_id/component_id compound key', async () => {
      wireCreateNewProgress();

      await service.saveDraft(USER_ID, CERT_ID, SECTION_ID, dto);

      expect(
        txMock.certification_component_responses.upsert,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            progress_id_component_id: {
              progress_id: 1,
              component_id: TEXT_COMPONENT_ID,
            },
          },
        }),
      );
    });

    it('TC09 - unknown component_id for the section → CERT_SECTION_INVALID', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue(null);
      txMock.certification_section_progress.create.mockResolvedValue({
        progress_id: 1,
        status: 'DRAFT',
      });

      await expect(
        service.saveDraft(USER_ID, CERT_ID, SECTION_ID, {
          responses: [{ component_id: 9999, text_value: 'x' }],
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_SECTION_INVALID });
    });

    it('TC10 - SUBMITTED progress is locked for editing → CERT_REQUIREMENT_LOCKED', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue({
        progress_id: 1,
        status: 'SUBMITTED',
      });

      await expect(
        service.saveDraft(USER_ID, CERT_ID, SECTION_ID, dto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_LOCKED });
    });

    it('TC11 - APPROVED progress is locked for editing → CERT_REQUIREMENT_LOCKED', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue({
        progress_id: 1,
        status: 'APPROVED',
      });

      await expect(
        service.saveDraft(USER_ID, CERT_ID, SECTION_ID, dto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_LOCKED });
    });

    it('TC12 - CHANGES_REQUESTED progress remains editable', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue({
        progress_id: 1,
        status: 'CHANGES_REQUESTED',
      });
      txMock.certification_component_responses.upsert.mockResolvedValue({});
      txMock.certification_component_responses.findMany.mockResolvedValue([]);

      const result = await service.saveDraft(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        dto,
      );

      expect(result.status).toBe('CHANGES_REQUESTED');
      expect(
        txMock.certification_section_progress.create,
      ).not.toHaveBeenCalled();
    });

    it('TC13 - LINKED_HONOR response requires an APPROVED users_honors row for the same user', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(
        sectionWithHonor,
      );
      txMock.certification_section_progress.findFirst.mockResolvedValue(null);
      txMock.certification_section_progress.create.mockResolvedValue({
        progress_id: 1,
        status: 'DRAFT',
      });
      txMock.users_honors.findFirst.mockResolvedValue(null);

      await expect(
        service.saveDraft(USER_ID, CERT_ID, SECTION_ID, {
          responses: [
            { component_id: HONOR_COMPONENT_ID, linked_user_honor_id: HONOR_ID },
          ],
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_INCOMPLETE });

      expect(txMock.users_honors.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_honor_id: HONOR_ID,
            user_id: USER_ID,
            validation_status: 'APPROVED',
          }),
        }),
      );
    });

    it('TC14 - LINKED_HONOR response accepted when users_honors is APPROVED for the same user', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(
        sectionWithHonor,
      );
      txMock.certification_section_progress.findFirst.mockResolvedValue(null);
      txMock.certification_section_progress.create.mockResolvedValue({
        progress_id: 1,
        status: 'DRAFT',
      });
      txMock.users_honors.findFirst.mockResolvedValue({
        user_honor_id: HONOR_ID,
      });
      txMock.certification_component_responses.upsert.mockResolvedValue({});
      txMock.certification_component_responses.findMany.mockResolvedValue([
        {
          component_id: HONOR_COMPONENT_ID,
          text_value: null,
          attestation_confirmed: null,
          linked_user_honor_id: HONOR_ID,
          linked_activity_id: null,
        },
      ]);

      const result = await service.saveDraft(USER_ID, CERT_ID, SECTION_ID, {
        responses: [
          { component_id: HONOR_COMPONENT_ID, linked_user_honor_id: HONOR_ID },
        ],
      });

      const honorComponent = result.components.find(
        (c) => c.component_id === HONOR_COMPONENT_ID,
      );
      expect(honorComponent?.response?.linked_user_honor_id).toBe(HONOR_ID);
    });
  });

  // ==========================================================================
  // submitRequirement
  // ==========================================================================

  describe('submitRequirement', () => {
    const submitDto: SubmitRequirementDto = { lock_version: 0 };

    const draftProgressComplete = {
      progress_id: 1,
      status: 'DRAFT',
      submitted_at: null,
      reviewed_at: null,
      last_review_comment: null,
      certification_component_responses: [
        {
          component_id: TEXT_COMPONENT_ID,
          text_value: 'Respuesta completa',
          attestation_confirmed: null,
          linked_user_honor_id: null,
          linked_activity_id: null,
        },
      ],
    };

    const wireHappyPath = (
      opts: { progress?: object; enrollment?: object } = {},
    ) => {
      txMock.users_certifications.findFirst.mockResolvedValue(
        opts.enrollment ?? baseEnrollment,
      );
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        opts.progress ?? draftProgressComplete,
      );
      txMock.users_certifications.updateMany.mockResolvedValue({ count: 1 });
      txMock.certification_section_progress.update.mockResolvedValue({
        progress_id: 1,
        status: 'SUBMITTED',
        submitted_at: new Date(),
        reviewed_at: null,
        last_review_comment: null,
      });
      txMock.certification_review_events.create.mockResolvedValue({});
      txMock.certification_sections.findMany.mockResolvedValue([
        { section_id: SECTION_ID, required: true },
      ]);
      txMock.certification_section_progress.findMany.mockResolvedValue([
        { section_id: SECTION_ID, status: 'SUBMITTED' },
      ]);
    };

    it('TC15 - happy path: DRAFT → SUBMITTED, creates REQUIREMENT_SUBMITTED event', async () => {
      wireHappyPath();

      const result = await service.submitRequirement(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        submitDto,
      );

      expect(result.requirement.status).toBe('SUBMITTED');
      expect(txMock.certification_review_events.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: 'REQUIREMENT_SUBMITTED',
            from_status: 'DRAFT',
            to_status: 'SUBMITTED',
            performed_by_id: USER_ID,
          }),
        }),
      );
    });

    it('TC16 - resubmit from CHANGES_REQUESTED creates REQUIREMENT_RESUBMITTED event', async () => {
      wireHappyPath({
        progress: { ...draftProgressComplete, status: 'CHANGES_REQUESTED' },
      });

      const result = await service.submitRequirement(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        submitDto,
      );

      expect(result.requirement.status).toBe('SUBMITTED');
      expect(txMock.certification_review_events.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: 'REQUIREMENT_RESUBMITTED',
            from_status: 'CHANGES_REQUESTED',
          }),
        }),
      );
    });

    it('TC17 - double submit: second call on an already-SUBMITTED requirement is rejected and does not duplicate the review event', async () => {
      wireHappyPath();

      await service.submitRequirement(USER_ID, CERT_ID, SECTION_ID, submitDto);
      expect(txMock.certification_review_events.create).toHaveBeenCalledTimes(
        1,
      );

      // Second call: progress is now SUBMITTED (locked)
      txMock.certification_section_progress.findFirst.mockResolvedValue({
        ...draftProgressComplete,
        status: 'SUBMITTED',
      });

      await expect(
        service.submitRequirement(USER_ID, CERT_ID, SECTION_ID, submitDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_LOCKED });
      expect(txMock.certification_review_events.create).toHaveBeenCalledTimes(
        1,
      );
    });

    it('TC18 - APPROVED progress cannot be resubmitted → CERT_REQUIREMENT_LOCKED', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue({
        ...draftProgressComplete,
        status: 'APPROVED',
      });

      await expect(
        service.submitRequirement(USER_ID, CERT_ID, SECTION_ID, submitDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_LOCKED });
    });

    it('TC19 - missing required component response → CERT_REQUIREMENT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue({
        progress_id: 1,
        status: 'DRAFT',
        certification_component_responses: [],
      });

      await expect(
        service.submitRequirement(USER_ID, CERT_ID, SECTION_ID, submitDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_INCOMPLETE });
      expect(txMock.users_certifications.updateMany).not.toHaveBeenCalled();
    });

    it('TC20 - no draft saved yet → CERT_REQUIREMENT_INCOMPLETE', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(baseSection);
      txMock.certification_section_progress.findFirst.mockResolvedValue(null);

      await expect(
        service.submitRequirement(USER_ID, CERT_ID, SECTION_ID, submitDto),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_INCOMPLETE });
    });

    it('TC21 - stale lock_version → CERT_CONCURRENT_UPDATE, no status/event mutation', async () => {
      wireHappyPath();
      txMock.users_certifications.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.submitRequirement(USER_ID, CERT_ID, SECTION_ID, {
          lock_version: 99,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_CONCURRENT_UPDATE });

      expect(
        txMock.certification_section_progress.update,
      ).not.toHaveBeenCalled();
      expect(txMock.certification_review_events.create).not.toHaveBeenCalled();
    });

    it('TC22 - lock_version compare-and-swap uses the provided value and increments on success', async () => {
      wireHappyPath();

      await service.submitRequirement(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        submitDto,
      );

      expect(txMock.users_certifications.updateMany).toHaveBeenCalledWith({
        where: { enrollment_id: ENROLLMENT_ID, lock_version: 0 },
        data: { lock_version: { increment: 1 } },
      });
    });

    it('TC23 - progress_summary uses computeProgressSummary semantics (percentComplete)', async () => {
      wireHappyPath();

      const result = await service.submitRequirement(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        submitDto,
      );

      // 1 required section, still not APPROVED (just SUBMITTED) → 0% required-approved
      expect(result.progress_summary.requiredTotal).toBe(1);
      expect(result.progress_summary.requiredApproved).toBe(0);
      expect(result.progress_summary.percentComplete).toBe(0);
      expect(result.progress_summary.allRequiredApproved).toBe(false);
    });

    it('TC24 - transitions enrollment to READY_FOR_CLOSEOUT once all required sections are APPROVED', async () => {
      wireHappyPath();
      // Simulate that, after this submit, every required section in the
      // version is already APPROVED (e.g. reviewed out-of-band).
      txMock.certification_section_progress.findMany.mockResolvedValue([
        { section_id: SECTION_ID, status: 'APPROVED' },
      ]);

      await service.submitRequirement(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        submitDto,
      );

      expect(txMock.users_certifications.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enrollment_id: ENROLLMENT_ID },
          data: { status: 'READY_FOR_CLOSEOUT' },
        }),
      );
    });

    it('TC25 - translated/localized section name never affects submit outcome', async () => {
      wireHappyPath();
      txMock.certification_sections.findFirst.mockResolvedValue({
        ...baseSection,
        name: 'Sección Traducida (fr)',
      });

      const result = await service.submitRequirement(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        submitDto,
      );

      expect(result.requirement.status).toBe('SUBMITTED');
    });
  });
});
