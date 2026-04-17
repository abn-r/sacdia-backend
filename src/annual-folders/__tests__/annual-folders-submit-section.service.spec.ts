import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AnnualFoldersService } from '../annual-folders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';
import { annual_folder_section_status_enum } from '@prisma/client';

/**
 * Unit tests for AnnualFoldersService.submitSection
 *
 * Covers (C2-R-C2-1 / design §4.9):
 *  1. Happy path — PENDING → SUBMITTED: upsert + updateMany called correctly
 *  2. Idempotency — already-SUBMITTED section: upsert still called, updateMany called with PENDING guard (matches 0 rows; no error)
 *  3. Folder not found → NotFoundException
 *  4. Folder not open → BadRequestException
 *  5. Section not in template → NotFoundException
 *  6. No evidence uploaded → BadRequestException
 */

const FOLDER_ID = 'folder-uuid-0000-0000-000000000001';
const SECTION_ID = 'section-uuid-0000-0000-000000000002';
const USER_ID = 'user-uuid-0000-0000-000000000003';
const TEMPLATE_ID = 'template-uuid-0000-0000-000000000004';
const SUBMISSION_ID = 'submission-uuid-0000-0000-000000000005';

const mockOpenFolder = {
  annual_folder_id: FOLDER_ID,
  folder_template_id: TEMPLATE_ID,
  status: 'open',
};

const mockSection = {
  section_id: SECTION_ID,
  folder_template_id: TEMPLATE_ID,
  name: 'Actas',
};

const mockSubmission = {
  section_submission_id: SUBMISSION_ID,
  section_id: SECTION_ID,
  annual_folder_id: FOLDER_ID,
  submitted_by: USER_ID,
  submitted_at: new Date('2026-04-14T10:00:00Z'),
  modified_at: new Date('2026-04-14T10:00:00Z'),
};

// tx mirror — matches operations used inside the $transaction callback.
const mockTx = {
  annual_folder_section_submissions: {
    upsert: jest.fn(),
  },
  annual_folder_section_evaluations: {
    updateMany: jest.fn(),
  },
};

const mockPrismaService = {
  annual_folders: {
    findUnique: jest.fn(),
  },
  folder_template_sections: {
    findFirst: jest.fn(),
  },
  annual_folder_evidences: {
    count: jest.fn(),
  },
  // Simulate $transaction by immediately executing the callback with mockTx.
  $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) =>
    cb(mockTx),
  ),
};

const mockFileStorageService = { upload: jest.fn() };

describe('AnnualFoldersService — submitSection', () => {
  let service: AnnualFoldersService;

  beforeEach(async () => {
    // resetAllMocks clears call history AND mockResolvedValueOnce queues.
    jest.resetAllMocks();

    // Restore $transaction implementation after resetAllMocks wipes it.
    mockPrismaService.$transaction.mockImplementation(
      (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualFoldersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<AnnualFoldersService>(AnnualFoldersService);

    // Default happy-path wiring (overridden per negative-case test).
    mockPrismaService.annual_folders.findUnique.mockResolvedValue(mockOpenFolder);
    mockPrismaService.folder_template_sections.findFirst.mockResolvedValue(mockSection);
    mockPrismaService.annual_folder_evidences.count.mockResolvedValue(1);
    mockTx.annual_folder_section_submissions.upsert.mockResolvedValue(mockSubmission);
    mockTx.annual_folder_section_evaluations.updateMany.mockResolvedValue({ count: 1 });
  });

  // ---------------------------------------------------------------
  // 1. Happy path — PENDING → SUBMITTED
  // ---------------------------------------------------------------
  describe('happy path (PENDING → SUBMITTED)', () => {
    it('wraps upsert + updateMany in a transaction', async () => {
      const result = await service.submitSection(FOLDER_ID, SECTION_ID, USER_ID);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it('upserts the submission record inside the transaction', async () => {
      await service.submitSection(FOLDER_ID, SECTION_ID, USER_ID);

      expect(mockTx.annual_folder_section_submissions.upsert).toHaveBeenCalledTimes(1);
      const upsertCall = mockTx.annual_folder_section_submissions.upsert.mock.calls[0][0];
      expect(upsertCall.where.annual_folder_id_section_id).toEqual({
        annual_folder_id: FOLDER_ID,
        section_id: SECTION_ID,
      });
      expect(upsertCall.create.submitted_by).toBe(USER_ID);
    });

    it('transitions evaluation status PENDING → SUBMITTED with enum values', async () => {
      await service.submitSection(FOLDER_ID, SECTION_ID, USER_ID);

      expect(mockTx.annual_folder_section_evaluations.updateMany).toHaveBeenCalledTimes(1);
      const updateManyCall = mockTx.annual_folder_section_evaluations.updateMany.mock.calls[0][0];
      expect(updateManyCall.where).toEqual({
        annual_folder_id: FOLDER_ID,
        section_id: SECTION_ID,
        status: annual_folder_section_status_enum.PENDING,
      });
      expect(updateManyCall.data).toEqual({
        status: annual_folder_section_status_enum.SUBMITTED,
      });
    });

    it('returns the expected submission envelope', async () => {
      const result = await service.submitSection(FOLDER_ID, SECTION_ID, USER_ID);

      expect(result).toEqual({
        section_submission_id: SUBMISSION_ID,
        section_id: SECTION_ID,
        annual_folder_id: FOLDER_ID,
        submitted_at: mockSubmission.submitted_at,
        submitted_by: USER_ID,
      });
    });
  });

  // ---------------------------------------------------------------
  // 2. Idempotency — re-submission on already-SUBMITTED section
  // ---------------------------------------------------------------
  describe('idempotency — re-submitting an already-SUBMITTED section', () => {
    it('still calls updateMany with PENDING guard (matches 0 rows, no error)', async () => {
      // Simulate DB returning 0 rows affected (status was not PENDING).
      mockTx.annual_folder_section_evaluations.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.submitSection(FOLDER_ID, SECTION_ID, USER_ID),
      ).resolves.toBeDefined();

      // updateMany must still be called — guard is idempotent, not a throw.
      expect(mockTx.annual_folder_section_evaluations.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------
  // 3. Folder not found → NotFoundException
  // ---------------------------------------------------------------
  describe('when the folder does not exist', () => {
    it('throws NotFoundException before entering the transaction', async () => {
      mockPrismaService.annual_folders.findUnique.mockResolvedValue(null);

      await expect(
        service.submitSection(FOLDER_ID, SECTION_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // 4. Folder not open → BadRequestException
  // ---------------------------------------------------------------
  describe('when the folder is not open', () => {
    it('throws BadRequestException before entering the transaction', async () => {
      mockPrismaService.annual_folders.findUnique.mockResolvedValue({
        ...mockOpenFolder,
        status: 'submitted',
      });

      await expect(
        service.submitSection(FOLDER_ID, SECTION_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // 5. Section not in template → NotFoundException
  // ---------------------------------------------------------------
  describe('when the section does not belong to the folder template', () => {
    it('throws NotFoundException before entering the transaction', async () => {
      mockPrismaService.folder_template_sections.findFirst.mockResolvedValue(null);

      await expect(
        service.submitSection(FOLDER_ID, SECTION_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // 6. No evidence uploaded → BadRequestException
  // ---------------------------------------------------------------
  describe('when no evidence has been uploaded for the section', () => {
    it('throws BadRequestException before entering the transaction', async () => {
      mockPrismaService.annual_folder_evidences.count.mockResolvedValue(0);

      await expect(
        service.submitSection(FOLDER_ID, SECTION_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });
  });
});
