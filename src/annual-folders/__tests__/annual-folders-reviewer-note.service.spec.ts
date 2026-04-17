import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnnualFoldersService } from '../annual-folders.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
} from '../../common/services/file-storage.service';

/**
 * Unit tests for AnnualFoldersService.setReviewerNote
 *
 * Covers:
 *  1. A reviewer can set a note — saves note + reviewer_noted_by + reviewer_noted_at
 *  2. A reviewer can clear a note by sending null — all three fields set to null
 *  3. A reviewer can clear a note by sending empty string — same as null
 *  4. Evidence not found → NotFoundException
 *
 * NOTE: RBAC enforcement (assistant-lf / director-lf only) lives in the
 * controller layer (PermissionsGuard with annual_folders:evaluate + global scope).
 * It is tested via integration / e2e tests, not here.
 */
describe('AnnualFoldersService — setReviewerNote', () => {
  let service: AnnualFoldersService;

  const REVIEWER_USER_ID = 'reviewer-uuid-0000-0000-000000000001';
  const EVIDENCE_ID = 'evidence-uuid-0000-0000-000000000002';

  const mockEvidenceBase = {
    evidence_id: EVIDENCE_ID,
    annual_folder_id: 'folder-uuid-0000-0000-000000000003',
    section_id: 'section-uuid-0000-0000-000000000004',
    file_url: 'https://storage.example.com/acta-enero.pdf',
    file_name: 'acta-enero.pdf',
    uploaded_by: 'user-uuid-0000-0000-000000000005',
    notes: 'Acta de enero',
    reviewer_note: null,
    reviewer_noted_by: null,
    reviewer_noted_at: null,
    created_at: new Date('2026-01-15T10:00:00Z'),
    modified_at: new Date('2026-01-15T10:00:00Z'),
  };

  const mockPrismaService = {
    annual_folder_evidences: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockFileStorageService = {
    upload: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualFoldersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<AnnualFoldersService>(AnnualFoldersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------
  // 1. Set a non-empty reviewer note
  // ---------------------------------------------------------------
  describe('when setting a non-empty reviewer note', () => {
    it('saves note, reviewer_noted_by, and reviewer_noted_at', async () => {
      const noteText = 'Le falta la firma del secretario en la página 2.';

      mockPrismaService.annual_folder_evidences.findUnique.mockResolvedValue(
        mockEvidenceBase,
      );

      const updatedEvidence = {
        ...mockEvidenceBase,
        reviewer_note: noteText,
        reviewer_noted_by: REVIEWER_USER_ID,
        reviewer_noted_at: new Date(),
        section: { section_id: mockEvidenceBase.section_id, name: 'Actas' },
        uploader: { name: 'María', paternal_last_name: 'García', maternal_last_name: null },
        reviewer: { name: 'Juan', paternal_last_name: 'Pérez', maternal_last_name: null },
      };
      mockPrismaService.annual_folder_evidences.update.mockResolvedValue(
        updatedEvidence,
      );

      const result = await service.setReviewerNote(
        EVIDENCE_ID,
        { reviewer_note: noteText },
        REVIEWER_USER_ID,
      );

      expect(
        mockPrismaService.annual_folder_evidences.findUnique,
      ).toHaveBeenCalledWith({ where: { evidence_id: EVIDENCE_ID } });

      const updateCall =
        mockPrismaService.annual_folder_evidences.update.mock.calls[0][0];

      expect(updateCall.data.reviewer_note).toBe(noteText);
      expect(updateCall.data.reviewer_noted_by).toBe(REVIEWER_USER_ID);
      expect(updateCall.data.reviewer_noted_at).toBeInstanceOf(Date);

      expect(result).toEqual(updatedEvidence);
    });

    it('trims whitespace from the note before saving', async () => {
      mockPrismaService.annual_folder_evidences.findUnique.mockResolvedValue(
        mockEvidenceBase,
      );
      mockPrismaService.annual_folder_evidences.update.mockResolvedValue(
        mockEvidenceBase,
      );

      await service.setReviewerNote(
        EVIDENCE_ID,
        { reviewer_note: '  nota con espacios  ' },
        REVIEWER_USER_ID,
      );

      const updateCall =
        mockPrismaService.annual_folder_evidences.update.mock.calls[0][0];

      expect(updateCall.data.reviewer_note).toBe('nota con espacios');
    });
  });

  // ---------------------------------------------------------------
  // 2. Clear note by sending null
  // ---------------------------------------------------------------
  describe('when clearing the reviewer note with null', () => {
    it('sets all three reviewer fields to null', async () => {
      const evidenceWithNote = {
        ...mockEvidenceBase,
        reviewer_note: 'nota previa',
        reviewer_noted_by: REVIEWER_USER_ID,
        reviewer_noted_at: new Date(),
      };

      mockPrismaService.annual_folder_evidences.findUnique.mockResolvedValue(
        evidenceWithNote,
      );
      mockPrismaService.annual_folder_evidences.update.mockResolvedValue({
        ...evidenceWithNote,
        reviewer_note: null,
        reviewer_noted_by: null,
        reviewer_noted_at: null,
      });

      await service.setReviewerNote(
        EVIDENCE_ID,
        { reviewer_note: null },
        REVIEWER_USER_ID,
      );

      const updateCall =
        mockPrismaService.annual_folder_evidences.update.mock.calls[0][0];

      expect(updateCall.data.reviewer_note).toBeNull();
      expect(updateCall.data.reviewer_noted_by).toBeNull();
      expect(updateCall.data.reviewer_noted_at).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // 3. Clear note by sending empty string
  // ---------------------------------------------------------------
  describe('when clearing the reviewer note with empty string', () => {
    it('treats empty string as null — clears all three fields', async () => {
      mockPrismaService.annual_folder_evidences.findUnique.mockResolvedValue(
        mockEvidenceBase,
      );
      mockPrismaService.annual_folder_evidences.update.mockResolvedValue(
        mockEvidenceBase,
      );

      await service.setReviewerNote(
        EVIDENCE_ID,
        { reviewer_note: '' },
        REVIEWER_USER_ID,
      );

      const updateCall =
        mockPrismaService.annual_folder_evidences.update.mock.calls[0][0];

      expect(updateCall.data.reviewer_note).toBeNull();
      expect(updateCall.data.reviewer_noted_by).toBeNull();
      expect(updateCall.data.reviewer_noted_at).toBeNull();
    });

    it('treats whitespace-only string as null', async () => {
      mockPrismaService.annual_folder_evidences.findUnique.mockResolvedValue(
        mockEvidenceBase,
      );
      mockPrismaService.annual_folder_evidences.update.mockResolvedValue(
        mockEvidenceBase,
      );

      await service.setReviewerNote(
        EVIDENCE_ID,
        { reviewer_note: '   ' },
        REVIEWER_USER_ID,
      );

      const updateCall =
        mockPrismaService.annual_folder_evidences.update.mock.calls[0][0];

      expect(updateCall.data.reviewer_note).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // 4. Evidence not found
  // ---------------------------------------------------------------
  describe('when evidence does not exist', () => {
    it('throws NotFoundException', async () => {
      mockPrismaService.annual_folder_evidences.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.setReviewerNote(
          'non-existent-id',
          { reviewer_note: 'alguna nota' },
          REVIEWER_USER_ID,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(
        mockPrismaService.annual_folder_evidences.update,
      ).not.toHaveBeenCalled();
    });
  });
});
