import { Test, TestingModule } from '@nestjs/testing';
import { EvaluationService } from '../evaluation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { InstitutionalHierarchyService } from '../../common/services/institutional-hierarchy.service';

describe('EvaluationService', () => {
  let service: EvaluationService;

  // ---------------------------------------------------------------
  // Transaction mock factory — creates a fresh tx object per test
  // ---------------------------------------------------------------
  const createTxMock = () => ({
    annual_folders: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    annual_folder_section_evaluations: {
      update: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    folder_template_sections: {
      findMany: jest.fn(),
    },
  });

  let txMock: ReturnType<typeof createTxMock>;
  const mockHierarchyService = {
    snapshotForClub: jest.fn(),
  };

  const mockPrismaService = {
    $transaction: jest.fn(),
    annual_folders: {
      findUnique: jest.fn(),
    },
    annual_folder_section_evaluations: {
      findMany: jest.fn(),
    },
    users_roles: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    txMock = createTxMock();
    mockHierarchyService.snapshotForClub.mockResolvedValue({
      hierarchy_context_id: 'ctx-eval-1',
    });

    mockPrismaService.$transaction.mockImplementation(
      (callback: (tx: ReturnType<typeof createTxMock>) => Promise<unknown>) =>
        callback(txMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: InstitutionalHierarchyService,
          useValue: mockHierarchyService,
        },
      ],
    }).compile();

    service = module.get<EvaluationService>(EvaluationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ================================================================
  // evaluateSection
  // ================================================================

  describe('evaluateSection', () => {
    const folderId = 'folder-uuid-1';
    const sectionId = 'section-uuid-1';
    const evaluatorId = 'user-uuid-eval';
    const dto = { earned_points: 80 };

    // Base folder with requires_union_confirmation=true (default path → PREAPPROVED_LF)
    const baseFolder = {
      annual_folder_id: folderId,
      status: 'submitted',
      hierarchy_context_id: null,
      requires_union_confirmation: true,
      club_enrollment: {
        club_section: {
          clubs: {
            club_id: 10,
          },
        },
      },
      folder_template: {
        folder_template_id: 'tmpl-1',
        sections: [
          { section_id: sectionId, name: 'Actividades', max_points: 100 },
          { section_id: 'section-uuid-2', name: 'Finanzas', max_points: 50 },
        ],
      },
    };

    // Pre-existing row in SUBMITTED state (set by club user submitSection)
    const existingEvalRow = {
      evaluation_id: 'eval-uuid-1',
      section_id: sectionId,
      annual_folder_id: folderId,
      status: 'SUBMITTED',
    };

    const mockEvaluation = {
      evaluation_id: 'eval-uuid-1',
      section_id: sectionId,
      annual_folder_id: folderId,
      earned_points: 80,
      max_points: 100,
      notes: null,
      status: 'PREAPPROVED_LF',
      lf_approved_at: new Date(),
      lf_approved_by: evaluatorId,
      section: { section_id: sectionId, name: 'Actividades' },
      lf_approver: {
        name: 'Juan',
        paternal_last_name: 'Perez',
        maternal_last_name: 'Lopez',
      },
    };

    const updatedFolder = {
      annual_folder_id: folderId,
      status: 'under_evaluation',
      total_earned_points: 80,
      total_max_points: 150,
      progress_percentage: 53.33,
      evaluated_at: null,
    };

    // Helper: wire up the standard happy-path mocks for evaluateSection
    const setupHappyPathMocks = (
      folderOverride?: Partial<typeof baseFolder>,
      existingEvalOverride?: Partial<typeof existingEvalRow>,
    ) => {
      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({ ...baseFolder, ...folderOverride })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' }); // recalcFolderTotals

      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue({
        ...existingEvalRow,
        ...existingEvalOverride,
      });

      txMock.annual_folder_section_evaluations.update.mockResolvedValue(
        mockEvaluation,
      );

      txMock.annual_folder_section_evaluations.findMany
        .mockResolvedValueOnce([]) // recalcFolderTotals (no terminal rows yet)
        .mockResolvedValueOnce([]); // decidedEvaluations post-recalc

      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);

      txMock.annual_folders.update.mockResolvedValue(updatedFolder);
    };

    it('should evaluate a section successfully (happy path)', async () => {
      setupHappyPathMocks();

      const result = await service.evaluateSection(
        folderId,
        sectionId,
        dto,
        evaluatorId,
      );

      expect(result.evaluation.earned_points).toBe(80);
      expect(result.folder_summary.status).toBe('under_evaluation');
    });

    it('should use update (not upsert) on the evaluation row', async () => {
      setupHappyPathMocks();

      await service.evaluateSection(folderId, sectionId, dto, evaluatorId);

      expect(
        txMock.annual_folder_section_evaluations.update,
      ).toHaveBeenCalledTimes(1);
    });

    it('should write lf_approved_by, lf_approved_at, and status on update', async () => {
      setupHappyPathMocks();

      await service.evaluateSection(folderId, sectionId, dto, evaluatorId);

      expect(
        txMock.annual_folder_section_evaluations.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lf_approved_by: evaluatorId,
            lf_approved_at: expect.any(Date),
            status: 'PREAPPROVED_LF',
          }),
        }),
      );
    });

    it('should reject if folder status is "open"', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        ...baseFolder,
        status: 'open',
      });

      await expect(
        service.evaluateSection(folderId, sectionId, dto, evaluatorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_STATUS_INVALID_FOR_EVALUATE,
      });
    });

    it('should reject if folder status is "closed"', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        ...baseFolder,
        status: 'closed',
      });

      await expect(
        service.evaluateSection(folderId, sectionId, dto, evaluatorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_STATUS_INVALID_FOR_EVALUATE,
      });
    });

    it('should reject if earned_points exceeds section max_points', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        ...baseFolder,
        status: 'submitted',
      });

      await expect(
        service.evaluateSection(
          folderId,
          sectionId,
          { earned_points: 150 },
          evaluatorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_EARNED_POINTS_EXCEED_MAX,
      });
    });

    it('should reject if section does not belong to folder template', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        ...baseFolder,
        status: 'submitted',
      });

      await expect(
        service.evaluateSection(
          folderId,
          'unknown-section-id',
          dto,
          evaluatorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_SECTION_NOT_IN_TEMPLATE,
      });
    });

    it('should throw AppNotFoundException if folder does not exist', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue(null);

      await expect(
        service.evaluateSection(
          'non-existent-folder',
          sectionId,
          dto,
          evaluatorId,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.ANNUAL_FOLDER_NOT_FOUND });
    });

    it('should throw AppBadRequestException if evaluation row is missing (T-B2-1 not run)', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue(baseFolder);
      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.evaluateSection(folderId, sectionId, dto, evaluatorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_EVAL_ROW_NOT_FOUND,
      });
    });

    it('should reject PENDING rows', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue(baseFolder);
      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue({
        ...existingEvalRow,
        status: 'PENDING',
      });

      await expect(
        service.evaluateSection(folderId, sectionId, dto, evaluatorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_SECTION_PENDING,
      });
    });

    it('should reject VALIDATED rows (terminal)', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue(baseFolder);
      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue({
        ...existingEvalRow,
        status: 'VALIDATED',
      });

      await expect(
        service.evaluateSection(folderId, sectionId, dto, evaluatorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_SECTION_TERMINAL,
      });
    });

    it('should reject REJECTED rows (terminal)', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue(baseFolder);
      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue({
        ...existingEvalRow,
        status: 'REJECTED',
      });

      await expect(
        service.evaluateSection(folderId, sectionId, dto, evaluatorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_SECTION_TERMINAL,
      });
    });

    it('should set status=PREAPPROVED_LF when requires_union_confirmation=true', async () => {
      setupHappyPathMocks({ requires_union_confirmation: true });

      await service.evaluateSection(folderId, sectionId, dto, evaluatorId);

      expect(
        txMock.annual_folder_section_evaluations.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PREAPPROVED_LF' }),
        }),
      );
    });

    it('shortcut path: requires_union_confirmation=false → status=VALIDATED and union columns mirrored', async () => {
      setupHappyPathMocks({ requires_union_confirmation: false });

      await service.evaluateSection(folderId, sectionId, dto, evaluatorId);

      expect(
        txMock.annual_folder_section_evaluations.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'VALIDATED',
            union_approved_by: evaluatorId,
            union_approved_at: expect.any(Date),
            union_decision: 'APPROVED',
          }),
        }),
      );
    });

    it('should transition folder status from "submitted" to "under_evaluation" on first evaluation', async () => {
      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({ ...baseFolder, status: 'submitted' })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });

      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue(
        existingEvalRow,
      );
      txMock.annual_folder_section_evaluations.update.mockResolvedValue(
        mockEvaluation,
      );

      txMock.annual_folder_section_evaluations.findMany
        .mockResolvedValueOnce([]) // recalcFolderTotals (no terminal rows yet)
        .mockResolvedValueOnce([]); // decidedEvaluations — 0 of 2 sections terminal

      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);

      txMock.annual_folders.update.mockResolvedValue({
        ...updatedFolder,
        status: 'under_evaluation',
      });

      const result = await service.evaluateSection(
        folderId,
        sectionId,
        dto,
        evaluatorId,
      );

      expect(txMock.annual_folders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'under_evaluation' }),
        }),
      );
      expect(result.folder_summary.status).toBe('under_evaluation');
    });

    it('does not store hierarchy snapshot while folder remains under_evaluation', async () => {
      setupHappyPathMocks({ status: 'submitted' });

      await service.evaluateSection(folderId, sectionId, dto, evaluatorId);

      expect(mockHierarchyService.snapshotForClub).not.toHaveBeenCalled();
      const updateCall = txMock.annual_folders.update.mock.calls.at(-1)?.[0];
      expect(updateCall?.data).not.toHaveProperty('hierarchy_context_id');
    });

    it('should transition folder status to "evaluated" when ALL sections are evaluated', async () => {
      const allDecidedEvaluations = [
        {
          evaluation_id: 'e1',
          section_id: sectionId,
          earned_points: 80,
          max_points: 100,
          status: 'VALIDATED',
        },
        {
          evaluation_id: 'e2',
          section_id: 'section-uuid-2',
          earned_points: 40,
          max_points: 50,
          status: 'VALIDATED',
        },
      ];

      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({ ...baseFolder, status: 'under_evaluation' })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });

      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue(
        existingEvalRow,
      );
      txMock.annual_folder_section_evaluations.update.mockResolvedValue(
        mockEvaluation,
      );

      txMock.annual_folder_section_evaluations.findMany
        .mockResolvedValueOnce([{ earned_points: 80 }, { earned_points: 40 }]) // recalcFolderTotals
        .mockResolvedValueOnce(allDecidedEvaluations); // decidedEvaluations — 2 of 2 terminal

      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);

      txMock.annual_folders.update.mockResolvedValue({
        ...updatedFolder,
        status: 'evaluated',
        total_earned_points: 120,
        total_max_points: 150,
        progress_percentage: 80,
        evaluated_at: new Date(),
      });

      const result = await service.evaluateSection(
        folderId,
        sectionId,
        dto,
        evaluatorId,
      );

      expect(txMock.annual_folders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'evaluated',
            evaluated_at: expect.any(Date),
          }),
        }),
      );
      expect(result.folder_summary.status).toBe('evaluated');
    });

    it('stores hierarchy snapshot when folder reaches evaluated state', async () => {
      const allDecidedEvaluations = [
        { evaluation_id: 'e1', section_id: sectionId, status: 'VALIDATED' },
        {
          evaluation_id: 'e2',
          section_id: 'section-uuid-2',
          status: 'VALIDATED',
        },
      ];

      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({ ...baseFolder, status: 'under_evaluation' })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });
      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue(
        existingEvalRow,
      );
      txMock.annual_folder_section_evaluations.update.mockResolvedValue(
        mockEvaluation,
      );
      txMock.annual_folder_section_evaluations.findMany
        .mockResolvedValueOnce([{ earned_points: 80 }, { earned_points: 40 }])
        .mockResolvedValueOnce(allDecidedEvaluations);
      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);
      txMock.annual_folders.update.mockResolvedValue({
        ...updatedFolder,
        status: 'evaluated',
        evaluated_at: new Date(),
      });

      await service.evaluateSection(folderId, sectionId, dto, evaluatorId);

      expect(mockHierarchyService.snapshotForClub).toHaveBeenCalledWith(
        10,
        expect.any(Date),
        evaluatorId,
      );
      expect(txMock.annual_folders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hierarchy_context_id: 'ctx-eval-1',
          }),
        }),
      );
    });

    it('should update folder totals correctly after evaluation', async () => {
      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({ ...baseFolder, status: 'under_evaluation' })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });

      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue(
        existingEvalRow,
      );
      txMock.annual_folder_section_evaluations.update.mockResolvedValue(
        mockEvaluation,
      );

      txMock.annual_folder_section_evaluations.findMany
        .mockResolvedValueOnce([{ earned_points: 80 }])
        .mockResolvedValueOnce([]);

      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);

      txMock.annual_folders.update.mockResolvedValue({
        ...updatedFolder,
        total_earned_points: 80,
        total_max_points: 150,
        progress_percentage: 53.33,
      });

      await service.evaluateSection(folderId, sectionId, dto, evaluatorId);

      // recalcFolderTotals must update the folder with computed totals
      expect(txMock.annual_folders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            total_earned_points: 80,
            total_max_points: 150,
          }),
        }),
      );
    });
  });

  // ================================================================
  // confirmUnion
  // ================================================================

  describe('confirmUnion', () => {
    const folderId = 'folder-uuid-1';
    const sectionId = 'section-uuid-1';
    const unionActorId = 'user-uuid-union';
    const lfActorId = 'user-uuid-lf';

    const baseFolder = {
      annual_folder_id: folderId,
      status: 'under_evaluation',
      requires_union_confirmation: true,
      folder_template: {
        folder_template_id: 'tmpl-1',
        sections: [
          { section_id: sectionId, name: 'Actividades', max_points: 100 },
          { section_id: 'section-uuid-2', name: 'Finanzas', max_points: 50 },
        ],
      },
    };

    const preApprovedEvalRow = {
      evaluation_id: 'eval-uuid-1',
      section_id: sectionId,
      annual_folder_id: folderId,
      status: 'PREAPPROVED_LF',
      lf_approved_by: lfActorId,
      lf_approved_at: new Date('2026-01-01T10:00:00Z'),
      notes: 'LF note',
    };

    const mockUpdatedEval = {
      evaluation_id: 'eval-uuid-1',
      section_id: sectionId,
      annual_folder_id: folderId,
      earned_points: 80,
      max_points: 100,
      notes: 'LF note',
      status: 'VALIDATED',
      lf_approved_by: lfActorId,
      lf_approved_at: new Date('2026-01-01T10:00:00Z'),
      union_approved_by: unionActorId,
      union_approved_at: new Date(),
      union_decision: 'APPROVED',
      section: { section_id: sectionId, name: 'Actividades' },
      lf_approver: {
        name: 'Juan',
        paternal_last_name: 'Perez',
        maternal_last_name: 'Lopez',
      },
    };

    const updatedFolder = {
      annual_folder_id: folderId,
      status: 'under_evaluation',
      total_earned_points: 80,
      total_max_points: 150,
      progress_percentage: 53.33,
      evaluated_at: null,
    };

    /** Build a users_roles mock payload for a given list of role names. */
    const makeRolesMock = (roleNames: string[]) =>
      roleNames.map((name) => ({
        user_role_id: `ur-${name}`,
        user_id: unionActorId,
        role_id: `role-${name}`,
        active: true,
        roles: { role_name: name },
      }));

    const setupHappyPathMocks = (
      folderOverride?: Partial<typeof baseFolder>,
      evalRowOverride?: Partial<typeof preApprovedEvalRow>,
      updatedEvalOverride?: Partial<typeof mockUpdatedEval>,
      /** Role names returned by users_roles.findMany — defaults to director-union */
      actorRoleNames: string[] = ['director-union'],
    ) => {
      // Role check (runs before the $transaction)
      mockPrismaService.users_roles.findMany.mockResolvedValueOnce(
        makeRolesMock(actorRoleNames),
      );

      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({ ...baseFolder, ...folderOverride })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' }); // recalcFolderTotals

      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue({
        ...preApprovedEvalRow,
        ...evalRowOverride,
      });

      txMock.annual_folder_section_evaluations.update.mockResolvedValue({
        ...mockUpdatedEval,
        ...updatedEvalOverride,
      });

      txMock.annual_folder_section_evaluations.findMany
        .mockResolvedValueOnce([{ earned_points: 80 }]) // recalcFolderTotals — terminal rows
        .mockResolvedValueOnce([]); // decidedEvaluations post-recalc

      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);

      txMock.annual_folders.update.mockResolvedValue(updatedFolder);
    };

    it('APPROVED → status VALIDATED, union_* set, lf_* preserved', async () => {
      setupHappyPathMocks();

      const result = await service.confirmUnion(
        folderId,
        sectionId,
        { decision: 'APPROVED' },
        unionActorId,
      );

      expect(
        txMock.annual_folder_section_evaluations.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            union_approved_by: unionActorId,
            union_approved_at: expect.any(Date),
            union_decision: 'APPROVED',
            status: 'VALIDATED',
          }),
        }),
      );

      // lf columns must NOT be written
      const updateCall =
        txMock.annual_folder_section_evaluations.update.mock.calls[0][0];
      expect(updateCall.data.lf_approved_by).toBeUndefined();
      expect(updateCall.data.lf_approved_at).toBeUndefined();

      expect(result.evaluation).toBeDefined();
      expect(result.folder_summary).toBeDefined();
    });

    it('REJECTED_OVERRIDE → status REJECTED, union_* set, lf_* preserved', async () => {
      setupHappyPathMocks(undefined, undefined, {
        status: 'REJECTED',
        union_decision: 'REJECTED_OVERRIDE',
      });

      await service.confirmUnion(
        folderId,
        sectionId,
        { decision: 'REJECTED_OVERRIDE' },
        unionActorId,
      );

      expect(
        txMock.annual_folder_section_evaluations.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            union_approved_by: unionActorId,
            union_decision: 'REJECTED_OVERRIDE',
            status: 'REJECTED',
          }),
        }),
      );

      const updateCall =
        txMock.annual_folder_section_evaluations.update.mock.calls[0][0];
      expect(updateCall.data.lf_approved_by).toBeUndefined();
      expect(updateCall.data.lf_approved_at).toBeUndefined();
    });

    it('should throw BadRequestException when folder.requires_union_confirmation === false', async () => {
      // Role check must pass so we reach the folder precondition
      mockPrismaService.users_roles.findMany.mockResolvedValueOnce(
        makeRolesMock(['director-union']),
      );

      txMock.annual_folders.findUnique.mockResolvedValue({
        ...baseFolder,
        requires_union_confirmation: false,
      });

      await expect(
        service.confirmUnion(
          folderId,
          sectionId,
          { decision: 'APPROVED' },
          unionActorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_UNION_CONFIRMATION_NOT_REQUIRED,
      });
    });

    it.each(['PENDING', 'SUBMITTED', 'VALIDATED', 'REJECTED'])(
      'should throw BadRequestException when evaluation.status === %s',
      async (status) => {
        // Role check must pass so we reach the eval-status precondition
        mockPrismaService.users_roles.findMany.mockResolvedValueOnce(
          makeRolesMock(['director-union']),
        );

        txMock.annual_folders.findUnique.mockResolvedValue(baseFolder);
        txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue({
          ...preApprovedEvalRow,
          status,
        });

        await expect(
          service.confirmUnion(
            folderId,
            sectionId,
            { decision: 'APPROVED' },
            unionActorId,
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.ANNUAL_FOLDER_SECTION_NOT_PREAPPROVED,
        });

        // Reset for next iteration
        txMock = createTxMock();
        mockPrismaService.$transaction.mockImplementation(
          (
            callback: (tx: ReturnType<typeof createTxMock>) => Promise<unknown>,
          ) => callback(txMock),
        );
      },
    );

    it('union override preserves original lf_approved_by (LF actor stays on row)', async () => {
      setupHappyPathMocks(undefined, undefined, {
        status: 'REJECTED',
        union_decision: 'REJECTED_OVERRIDE',
      });

      await service.confirmUnion(
        folderId,
        sectionId,
        { decision: 'REJECTED_OVERRIDE' },
        unionActorId,
      );

      // The update payload must NOT overwrite lf columns
      const updateCall =
        txMock.annual_folder_section_evaluations.update.mock.calls[0][0];
      expect(updateCall.data.lf_approved_by).toBeUndefined();
      expect(updateCall.data.lf_approved_at).toBeUndefined();
    });

    it('should preserve existing notes when dto.notes is not provided', async () => {
      setupHappyPathMocks();

      await service.confirmUnion(
        folderId,
        sectionId,
        { decision: 'APPROVED' }, // no notes field
        unionActorId,
      );

      const updateCall =
        txMock.annual_folder_section_evaluations.update.mock.calls[0][0];
      expect(updateCall.data.notes).toBe('LF note');
    });

    it('should overwrite notes when dto.notes is explicitly provided', async () => {
      setupHappyPathMocks();

      await service.confirmUnion(
        folderId,
        sectionId,
        { decision: 'APPROVED', notes: 'Union override note' },
        unionActorId,
      );

      const updateCall =
        txMock.annual_folder_section_evaluations.update.mock.calls[0][0];
      expect(updateCall.data.notes).toBe('Union override note');
    });

    it('should throw AppNotFoundException when folder does not exist', async () => {
      mockPrismaService.users_roles.findMany.mockResolvedValueOnce(
        makeRolesMock(['director-union']),
      );
      txMock.annual_folders.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmUnion(
          'non-existent',
          sectionId,
          { decision: 'APPROVED' },
          unionActorId,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.ANNUAL_FOLDER_NOT_FOUND });
    });

    it('should throw AppBadRequestException when evaluation row does not exist', async () => {
      mockPrismaService.users_roles.findMany.mockResolvedValueOnce(
        makeRolesMock(['director-union']),
      );
      txMock.annual_folders.findUnique.mockResolvedValue(baseFolder);
      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.confirmUnion(
          folderId,
          sectionId,
          { decision: 'APPROVED' },
          unionActorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_EVAL_ROW_NOT_FOUND,
      });
    });

    it('should transition folder to "evaluated" when all sections reach terminal state', async () => {
      mockPrismaService.users_roles.findMany.mockResolvedValueOnce(
        makeRolesMock(['director-union']),
      );

      txMock.annual_folders.findUnique
        .mockResolvedValueOnce(baseFolder)
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });

      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue(
        preApprovedEvalRow,
      );
      txMock.annual_folder_section_evaluations.update.mockResolvedValue(
        mockUpdatedEval,
      );

      // recalcFolderTotals + decidedEvaluations — both sections terminal
      txMock.annual_folder_section_evaluations.findMany
        .mockResolvedValueOnce([{ earned_points: 80 }, { earned_points: 40 }])
        .mockResolvedValueOnce([
          { evaluation_id: 'e1', status: 'VALIDATED' },
          { evaluation_id: 'e2', status: 'VALIDATED' },
        ]);

      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);

      txMock.annual_folders.update.mockResolvedValue({
        ...updatedFolder,
        status: 'evaluated',
        evaluated_at: new Date(),
      });

      const result = await service.confirmUnion(
        folderId,
        sectionId,
        { decision: 'APPROVED' },
        unionActorId,
      );

      expect(txMock.annual_folders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'evaluated',
            evaluated_at: expect.any(Date),
          }),
        }),
      );
      expect(result.folder_summary.status).toBe('evaluated');
    });

    it('should use $transaction', async () => {
      setupHappyPathMocks();

      await service.confirmUnion(
        folderId,
        sectionId,
        { decision: 'APPROVED' },
        unionActorId,
      );

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    // ----------------------------------------------------------------
    // Role enforcement (Option B — service-layer tier check)
    // ----------------------------------------------------------------

    describe('role enforcement — only union-tier actors may call confirmUnion', () => {
      it('throws AppForbiddenException when actor has only director-lf role', async () => {
        mockPrismaService.users_roles.findMany.mockResolvedValueOnce(
          makeRolesMock(['director-lf']),
        );

        await expect(
          service.confirmUnion(
            folderId,
            sectionId,
            { decision: 'APPROVED' },
            'lf-actor-id',
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.ANNUAL_FOLDER_UNION_ROLE_REQUIRED,
        });
      });

      it('throws AppForbiddenException when actor has only assistant-lf role', async () => {
        mockPrismaService.users_roles.findMany.mockResolvedValueOnce(
          makeRolesMock(['assistant-lf']),
        );

        await expect(
          service.confirmUnion(
            folderId,
            sectionId,
            { decision: 'APPROVED' },
            'lf-actor-id',
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.ANNUAL_FOLDER_UNION_ROLE_REQUIRED,
        });
      });

      it('throws AppForbiddenException when actor has no roles at all', async () => {
        mockPrismaService.users_roles.findMany.mockResolvedValueOnce([]);

        await expect(
          service.confirmUnion(
            folderId,
            sectionId,
            { decision: 'APPROVED' },
            'no-role-actor',
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.ANNUAL_FOLDER_UNION_ROLE_REQUIRED,
        });
      });

      it('succeeds when actor has assistant-union role', async () => {
        setupHappyPathMocks(undefined, undefined, undefined, [
          'assistant-union',
        ]);

        const result = await service.confirmUnion(
          folderId,
          sectionId,
          { decision: 'APPROVED' },
          unionActorId,
        );

        expect(result.evaluation).toBeDefined();
      });

      it('succeeds when actor holds BOTH director-lf AND director-union (union role grants access)', async () => {
        setupHappyPathMocks(undefined, undefined, undefined, [
          'director-lf',
          'director-union',
        ]);

        const result = await service.confirmUnion(
          folderId,
          sectionId,
          { decision: 'APPROVED' },
          unionActorId,
        );

        expect(result.evaluation).toBeDefined();
      });

      it('throws ANNUAL_FOLDER_UNION_ROLE_REQUIRED for unauthorized actors', async () => {
        mockPrismaService.users_roles.findMany.mockResolvedValueOnce(
          makeRolesMock(['director-lf']),
        );

        await expect(
          service.confirmUnion(
            folderId,
            sectionId,
            { decision: 'APPROVED' },
            'lf-actor-id',
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.ANNUAL_FOLDER_UNION_ROLE_REQUIRED,
        });
      });
    });
  });

  // ================================================================
  // reopenSection
  // ================================================================

  describe('reopenSection', () => {
    const folderId = 'folder-uuid-1';
    const sectionId = 'section-uuid-1';
    const evaluatorId = 'user-uuid-eval';

    const existingEvaluationValidated = {
      evaluation_id: 'eval-uuid-1',
      annual_folder_id: folderId,
      section_id: sectionId,
      status: 'VALIDATED' as any,
    };

    const updatedFolder = {
      annual_folder_id: folderId,
      status: 'under_evaluation',
      total_earned_points: 0,
      total_max_points: 150,
      progress_percentage: 0,
      evaluated_at: null,
    };

    function setupHappyPath(
      folderStatus: string,
      evalStatus: string = 'VALIDATED',
    ) {
      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({
          annual_folder_id: folderId,
          status: folderStatus,
        })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });

      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue({
        ...existingEvaluationValidated,
        status: evalStatus,
      });
      txMock.annual_folder_section_evaluations.update.mockResolvedValue({
        ...existingEvaluationValidated,
        status: 'SUBMITTED',
        lf_approved_by: null,
        lf_approved_at: null,
        union_approved_by: null,
        union_approved_at: null,
        union_decision: null,
        earned_points: 0,
        notes: null,
      });

      txMock.annual_folder_section_evaluations.findMany.mockResolvedValue([]);
      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);
      txMock.annual_folders.update.mockResolvedValue({
        ...updatedFolder,
        status:
          folderStatus === 'evaluated' ? 'under_evaluation' : folderStatus,
        ...(folderStatus === 'evaluated' && { evaluated_at: null }),
      });
    }

    it('should UPDATE evaluation row (not delete) and recalc totals successfully', async () => {
      setupHappyPath('under_evaluation', 'VALIDATED');

      const result = await service.reopenSection(
        folderId,
        sectionId,
        evaluatorId,
      );

      expect(
        txMock.annual_folder_section_evaluations.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            annual_folder_id_section_id: {
              annual_folder_id: folderId,
              section_id: sectionId,
            },
          },
          data: expect.objectContaining({
            status: 'SUBMITTED',
            lf_approved_by: null,
            lf_approved_at: null,
            union_approved_by: null,
            union_approved_at: null,
            union_decision: null,
            earned_points: 0,
            notes: null,
          }),
        }),
      );
      expect(
        txMock.annual_folder_section_evaluations.delete,
      ).not.toHaveBeenCalled();
      expect(result.message).toBe('Section evaluation reopened successfully');
    });

    it('should row still exist after reopen with status=SUBMITTED and LF/union fields cleared', async () => {
      setupHappyPath('under_evaluation', 'VALIDATED');

      await service.reopenSection(folderId, sectionId, evaluatorId);

      const updateCall =
        txMock.annual_folder_section_evaluations.update.mock.calls[0][0];
      expect(updateCall.data).toMatchObject({
        status: 'SUBMITTED',
        lf_approved_by: null,
        lf_approved_at: null,
        union_approved_by: null,
        union_approved_at: null,
        union_decision: null,
        earned_points: 0,
        notes: null,
      });
    });

    it('should reject if folder status is "open"', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        annual_folder_id: folderId,
        status: 'open',
      });

      await expect(
        service.reopenSection(folderId, sectionId, evaluatorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_STATUS_INVALID_FOR_REOPEN,
      });
    });

    it('should reject if folder status is "submitted"', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        annual_folder_id: folderId,
        status: 'submitted',
      });

      await expect(
        service.reopenSection(folderId, sectionId, evaluatorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_STATUS_INVALID_FOR_REOPEN,
      });
    });

    it('should return 404 if section has no evaluation', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        annual_folder_id: folderId,
        status: 'under_evaluation',
      });

      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.reopenSection(folderId, sectionId, evaluatorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_EVAL_ROW_NOT_FOUND,
      });
    });

    it('should return 404 if folder does not exist', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue(null);

      await expect(
        service.reopenSection('non-existent-folder', sectionId, evaluatorId),
      ).rejects.toMatchObject({ code: ErrorCode.ANNUAL_FOLDER_NOT_FOUND });
    });

    it('should transition folder from "evaluated" back to "under_evaluation"', async () => {
      setupHappyPath('evaluated', 'VALIDATED');

      const result = await service.reopenSection(
        folderId,
        sectionId,
        evaluatorId,
      );

      const lastUpdateCall =
        txMock.annual_folders.update.mock.calls[
          txMock.annual_folders.update.mock.calls.length - 1
        ][0];
      expect(lastUpdateCall.data).toMatchObject({
        status: 'under_evaluation',
        evaluated_at: null,
      });
      expect(result.folder_summary.status).toBe('under_evaluation');
    });

    it('should keep folder as "under_evaluation" when status was already "under_evaluation"', async () => {
      setupHappyPath('under_evaluation', 'VALIDATED');

      await service.reopenSection(folderId, sectionId, evaluatorId);

      const lastUpdateCall =
        txMock.annual_folders.update.mock.calls[
          txMock.annual_folders.update.mock.calls.length - 1
        ][0];
      expect(lastUpdateCall.data.status).toBe('under_evaluation');
      expect(lastUpdateCall.data.evaluated_at).toBeUndefined();
    });

    // ---- Status guard tests ----

    it('should reject reopen on PENDING status', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        annual_folder_id: folderId,
        status: 'under_evaluation',
      });
      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue({
        ...existingEvaluationValidated,
        status: 'PENDING',
      });

      await expect(
        service.reopenSection(folderId, sectionId, evaluatorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_SECTION_NOT_REOPENABLE,
      });
    });

    it('should reject reopen on SUBMITTED status', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        annual_folder_id: folderId,
        status: 'under_evaluation',
      });
      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue({
        ...existingEvaluationValidated,
        status: 'SUBMITTED',
      });

      await expect(
        service.reopenSection(folderId, sectionId, evaluatorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_SECTION_NOT_REOPENABLE,
      });
    });

    it('should allow reopen on PREAPPROVED_LF status', async () => {
      setupHappyPath('under_evaluation', 'PREAPPROVED_LF');

      await expect(
        service.reopenSection(folderId, sectionId, evaluatorId),
      ).resolves.not.toThrow();

      expect(
        txMock.annual_folder_section_evaluations.update,
      ).toHaveBeenCalled();
    });

    it('should allow reopen on VALIDATED status', async () => {
      setupHappyPath('under_evaluation', 'VALIDATED');

      await expect(
        service.reopenSection(folderId, sectionId, evaluatorId),
      ).resolves.not.toThrow();

      expect(
        txMock.annual_folder_section_evaluations.update,
      ).toHaveBeenCalled();
    });

    it('should allow reopen on REJECTED status', async () => {
      setupHappyPath('under_evaluation', 'REJECTED');

      await expect(
        service.reopenSection(folderId, sectionId, evaluatorId),
      ).resolves.not.toThrow();

      expect(
        txMock.annual_folder_section_evaluations.update,
      ).toHaveBeenCalled();
    });
  });

  // ================================================================
  // recalcFolderTotals
  // ================================================================

  describe('recalcFolderTotals', () => {
    const folderId = 'folder-uuid-1';

    it('should sum earned_points from all evaluations', async () => {
      txMock.annual_folder_section_evaluations.findMany.mockResolvedValue([
        { earned_points: 80 },
        { earned_points: 40 },
        { earned_points: 30 },
      ]);
      txMock.annual_folders.findUnique.mockResolvedValue({
        folder_template_id: 'tmpl-1',
      });
      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
        { max_points: 50 },
      ]);
      txMock.annual_folders.update.mockResolvedValue({});

      const result = await service.recalcFolderTotals(folderId, txMock as any);

      expect(result.total_earned_points).toBe(150);
    });

    it('should sum max_points from all template sections', async () => {
      txMock.annual_folder_section_evaluations.findMany.mockResolvedValue([
        { earned_points: 50 },
      ]);
      txMock.annual_folders.findUnique.mockResolvedValue({
        folder_template_id: 'tmpl-1',
      });
      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);
      txMock.annual_folders.update.mockResolvedValue({});

      const result = await service.recalcFolderTotals(folderId, txMock as any);

      expect(result.total_max_points).toBe(150);
    });

    it('should calculate progress_percentage correctly', async () => {
      txMock.annual_folder_section_evaluations.findMany.mockResolvedValue([
        { earned_points: 75 },
      ]);
      txMock.annual_folders.findUnique.mockResolvedValue({
        folder_template_id: 'tmpl-1',
      });
      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
      ]);
      txMock.annual_folders.update.mockResolvedValue({});

      const result = await service.recalcFolderTotals(folderId, txMock as any);

      expect(result.progress_percentage).toBe(75);
    });

    it('should handle 0 max_points without division by zero', async () => {
      txMock.annual_folder_section_evaluations.findMany.mockResolvedValue([
        { earned_points: 50 },
      ]);
      txMock.annual_folders.findUnique.mockResolvedValue({
        folder_template_id: 'tmpl-1',
      });
      txMock.folder_template_sections.findMany.mockResolvedValue([]); // no sections → max = 0
      txMock.annual_folders.update.mockResolvedValue({});

      const result = await service.recalcFolderTotals(folderId, txMock as any);

      expect(result.total_max_points).toBe(0);
      expect(result.progress_percentage).toBe(0);
    });

    it('should handle folder with no evaluations (all zeros)', async () => {
      txMock.annual_folder_section_evaluations.findMany.mockResolvedValue([]);
      txMock.annual_folders.findUnique.mockResolvedValue({
        folder_template_id: 'tmpl-1',
      });
      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);
      txMock.annual_folders.update.mockResolvedValue({});

      const result = await service.recalcFolderTotals(folderId, txMock as any);

      expect(result.total_earned_points).toBe(0);
      expect(result.total_max_points).toBe(150);
      expect(result.progress_percentage).toBe(0);
    });

    it('should persist computed totals to the database', async () => {
      txMock.annual_folder_section_evaluations.findMany.mockResolvedValue([
        { earned_points: 60 },
      ]);
      txMock.annual_folders.findUnique.mockResolvedValue({
        folder_template_id: 'tmpl-1',
      });
      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 200 },
      ]);
      txMock.annual_folders.update.mockResolvedValue({});

      await service.recalcFolderTotals(folderId, txMock as any);

      expect(txMock.annual_folders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { annual_folder_id: folderId },
          data: expect.objectContaining({
            total_earned_points: 60,
            total_max_points: 200,
            progress_percentage: 30,
          }),
        }),
      );
    });
  });

  // ================================================================
  // getFolderEvaluations
  // ================================================================

  describe('getFolderEvaluations', () => {
    const folderId = 'folder-uuid-1';

    it('should return formatted evaluations for a folder', async () => {
      mockPrismaService.annual_folders.findUnique.mockResolvedValue({
        annual_folder_id: folderId,
        status: 'under_evaluation',
      });

      mockPrismaService.annual_folder_section_evaluations.findMany.mockResolvedValue(
        [
          {
            evaluation_id: 'eval-1',
            section_id: 'section-1',
            earned_points: 80,
            max_points: 100,
            notes: 'Well done',
            lf_approved_at: new Date(),
            section: { section_id: 'section-1', name: 'Actividades', order: 1 },
            lf_approver: {
              name: 'Ana',
              paternal_last_name: 'Gomez',
              maternal_last_name: 'Torres',
            },
          },
        ],
      );

      const result = await service.getFolderEvaluations(folderId);

      expect(result).toHaveLength(1);
      expect(result[0].earned_points).toBe(80);
      expect(result[0].evaluator).toBe('Ana Gomez Torres');
      expect(result[0].section_name).toBe('Actividades');
    });

    it('should return 404 if folder does not exist', async () => {
      mockPrismaService.annual_folders.findUnique.mockResolvedValue(null);

      await expect(
        service.getFolderEvaluations('non-existent'),
      ).rejects.toMatchObject({ code: ErrorCode.ANNUAL_FOLDER_NOT_FOUND });
    });

    it('should return empty array when folder has no evaluations', async () => {
      mockPrismaService.annual_folders.findUnique.mockResolvedValue({
        annual_folder_id: folderId,
      });

      mockPrismaService.annual_folder_section_evaluations.findMany.mockResolvedValue(
        [],
      );

      const result = await service.getFolderEvaluations(folderId);

      expect(result).toHaveLength(0);
    });

    it('should handle evaluator with missing name parts gracefully', async () => {
      mockPrismaService.annual_folders.findUnique.mockResolvedValue({
        annual_folder_id: folderId,
      });

      mockPrismaService.annual_folder_section_evaluations.findMany.mockResolvedValue(
        [
          {
            evaluation_id: 'eval-1',
            section_id: 'section-1',
            earned_points: 50,
            max_points: 100,
            notes: null,
            lf_approved_at: new Date(),
            section: { section_id: 'section-1', name: 'Sección A', order: 1 },
            lf_approver: null,
          },
        ],
      );

      const result = await service.getFolderEvaluations(folderId);

      expect(result[0].evaluator).toBeNull();
    });
  });
});
