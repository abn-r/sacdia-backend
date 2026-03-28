import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EvaluationService } from '../evaluation.service';
import { PrismaService } from '../../prisma/prisma.service';

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
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    folder_template_sections: {
      findMany: jest.fn(),
    },
  });

  let txMock: ReturnType<typeof createTxMock>;

  const mockPrismaService = {
    $transaction: jest.fn(),
    annual_folders: {
      findUnique: jest.fn(),
    },
    annual_folder_section_evaluations: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    txMock = createTxMock();

    mockPrismaService.$transaction.mockImplementation(
      (callback: (tx: ReturnType<typeof createTxMock>) => Promise<unknown>) =>
        callback(txMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationService,
        { provide: PrismaService, useValue: mockPrismaService },
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

    const baseFolder = {
      annual_folder_id: folderId,
      status: 'submitted',
      folder_template: {
        folder_template_id: 'tmpl-1',
        sections: [
          { section_id: sectionId, name: 'Actividades', max_points: 100 },
          { section_id: 'section-uuid-2', name: 'Finanzas', max_points: 50 },
        ],
      },
    };

    const mockEvaluation = {
      evaluation_id: 'eval-uuid-1',
      section_id: sectionId,
      annual_folder_id: folderId,
      earned_points: 80,
      max_points: 100,
      notes: null,
      evaluated_at: new Date(),
      section: { section_id: sectionId, name: 'Actividades' },
      evaluated_by: {
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

    it('should evaluate a section successfully (happy path)', async () => {
      txMock.annual_folders.findUnique
        .mockResolvedValueOnce(baseFolder) // first call in evaluateSection
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' }); // call inside recalcFolderTotals

      txMock.annual_folder_section_evaluations.upsert.mockResolvedValue(
        mockEvaluation,
      );

      // recalcFolderTotals internals
      txMock.annual_folder_section_evaluations.findMany
        .mockResolvedValueOnce([{ earned_points: 80 }]) // inside recalcFolderTotals
        .mockResolvedValueOnce([mockEvaluation]); // inside evaluateSection (post-recalc allEvaluations)

      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);

      txMock.annual_folders.update.mockResolvedValue(updatedFolder);

      const result = await service.evaluateSection(
        folderId,
        sectionId,
        dto,
        evaluatorId,
      );

      expect(result.evaluation.earned_points).toBe(80);
      expect(result.folder_summary.status).toBe('under_evaluation');
    });

    it('should reject if folder status is "open"', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        ...baseFolder,
        status: 'open',
      });

      await expect(
        service.evaluateSection(folderId, sectionId, dto, evaluatorId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if folder status is "closed"', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        ...baseFolder,
        status: 'closed',
      });

      await expect(
        service.evaluateSection(folderId, sectionId, dto, evaluatorId),
      ).rejects.toThrow(BadRequestException);
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
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.evaluateSection(
          folderId,
          sectionId,
          { earned_points: 150 },
          evaluatorId,
        ),
      ).rejects.toThrow('cannot exceed section max_points');
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
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if folder does not exist', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue(null);

      await expect(
        service.evaluateSection(
          'non-existent-folder',
          sectionId,
          dto,
          evaluatorId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should transition folder status from "submitted" to "under_evaluation" on first evaluation', async () => {
      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({ ...baseFolder, status: 'submitted' })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });

      txMock.annual_folder_section_evaluations.upsert.mockResolvedValue(
        mockEvaluation,
      );

      txMock.annual_folder_section_evaluations.findMany
        .mockResolvedValueOnce([{ earned_points: 80 }]) // recalcFolderTotals
        .mockResolvedValueOnce([mockEvaluation]); // allEvaluations (1 of 2 sections done)

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

    it('should transition folder status to "evaluated" when ALL sections are evaluated', async () => {
      const allEvaluations = [
        {
          evaluation_id: 'e1',
          section_id: sectionId,
          earned_points: 80,
          max_points: 100,
        },
        {
          evaluation_id: 'e2',
          section_id: 'section-uuid-2',
          earned_points: 40,
          max_points: 50,
        },
      ];

      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({ ...baseFolder, status: 'under_evaluation' })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });

      txMock.annual_folder_section_evaluations.upsert.mockResolvedValue(
        mockEvaluation,
      );

      txMock.annual_folder_section_evaluations.findMany
        .mockResolvedValueOnce([{ earned_points: 80 }, { earned_points: 40 }]) // recalcFolderTotals
        .mockResolvedValueOnce(allEvaluations); // allEvaluations — 2 of 2 sections done

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

    it('should update folder totals correctly after evaluation', async () => {
      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({ ...baseFolder, status: 'under_evaluation' })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });

      txMock.annual_folder_section_evaluations.upsert.mockResolvedValue(
        mockEvaluation,
      );

      txMock.annual_folder_section_evaluations.findMany
        .mockResolvedValueOnce([{ earned_points: 80 }])
        .mockResolvedValueOnce([mockEvaluation]);

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
  // reopenSection
  // ================================================================

  describe('reopenSection', () => {
    const folderId = 'folder-uuid-1';
    const sectionId = 'section-uuid-1';
    const evaluatorId = 'user-uuid-eval';

    const existingEvaluation = {
      evaluation_id: 'eval-uuid-1',
      annual_folder_id: folderId,
      section_id: sectionId,
    };

    const updatedFolder = {
      annual_folder_id: folderId,
      status: 'under_evaluation',
      total_earned_points: 0,
      total_max_points: 150,
      progress_percentage: 0,
      evaluated_at: null,
    };

    it('should delete evaluation and recalc totals successfully', async () => {
      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({
          annual_folder_id: folderId,
          status: 'under_evaluation',
        })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });

      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue(
        existingEvaluation,
      );
      txMock.annual_folder_section_evaluations.delete.mockResolvedValue(
        existingEvaluation,
      );

      txMock.annual_folder_section_evaluations.findMany.mockResolvedValue([]);

      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);

      txMock.annual_folders.update.mockResolvedValue(updatedFolder);

      const result = await service.reopenSection(
        folderId,
        sectionId,
        evaluatorId,
      );

      expect(
        txMock.annual_folder_section_evaluations.delete,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            annual_folder_id_section_id: {
              annual_folder_id: folderId,
              section_id: sectionId,
            },
          },
        }),
      );
      expect(result.message).toBe('Section evaluation removed successfully');
    });

    it('should reject if folder status is "open"', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        annual_folder_id: folderId,
        status: 'open',
      });

      await expect(
        service.reopenSection(folderId, sectionId, evaluatorId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if folder status is "submitted"', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue({
        annual_folder_id: folderId,
        status: 'submitted',
      });

      await expect(
        service.reopenSection(folderId, sectionId, evaluatorId),
      ).rejects.toThrow(BadRequestException);
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
      ).rejects.toThrow(NotFoundException);
    });

    it('should return 404 if folder does not exist', async () => {
      txMock.annual_folders.findUnique.mockResolvedValue(null);

      await expect(
        service.reopenSection('non-existent-folder', sectionId, evaluatorId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should transition folder from "evaluated" back to "under_evaluation"', async () => {
      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({
          annual_folder_id: folderId,
          status: 'evaluated',
        })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });

      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue(
        existingEvaluation,
      );
      txMock.annual_folder_section_evaluations.delete.mockResolvedValue(
        existingEvaluation,
      );

      txMock.annual_folder_section_evaluations.findMany.mockResolvedValue([]);

      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
        { max_points: 50 },
      ]);

      txMock.annual_folders.update.mockResolvedValue({
        ...updatedFolder,
        status: 'under_evaluation',
        evaluated_at: null,
      });

      const result = await service.reopenSection(
        folderId,
        sectionId,
        evaluatorId,
      );

      // The last update (status transition) should set status back
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
      txMock.annual_folders.findUnique
        .mockResolvedValueOnce({
          annual_folder_id: folderId,
          status: 'under_evaluation',
        })
        .mockResolvedValueOnce({ folder_template_id: 'tmpl-1' });

      txMock.annual_folder_section_evaluations.findUnique.mockResolvedValue(
        existingEvaluation,
      );
      txMock.annual_folder_section_evaluations.delete.mockResolvedValue(
        existingEvaluation,
      );
      txMock.annual_folder_section_evaluations.findMany.mockResolvedValue([]);
      txMock.folder_template_sections.findMany.mockResolvedValue([
        { max_points: 100 },
      ]);
      txMock.annual_folders.update.mockResolvedValue(updatedFolder);

      await service.reopenSection(folderId, sectionId, evaluatorId);

      // The final update should NOT include evaluated_at: null (only set when transitioning from evaluated)
      const lastUpdateCall =
        txMock.annual_folders.update.mock.calls[
          txMock.annual_folders.update.mock.calls.length - 1
        ][0];
      expect(lastUpdateCall.data.status).toBe('under_evaluation');
      expect(lastUpdateCall.data.evaluated_at).toBeUndefined();
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
            evaluated_at: new Date(),
            section: { section_id: 'section-1', name: 'Actividades', order: 1 },
            evaluated_by: {
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
      ).rejects.toThrow(NotFoundException);
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
            evaluated_at: new Date(),
            section: { section_id: 'section-1', name: 'Sección A', order: 1 },
            evaluated_by: null,
          },
        ],
      );

      const result = await service.getFolderEvaluations(folderId);

      expect(result[0].evaluator).toBeNull();
    });
  });
});
