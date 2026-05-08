import { Test, TestingModule } from '@nestjs/testing';
import { AnnualFoldersService } from '../annual-folders.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../../common/services/file-storage.service';

/**
 * Unit tests verifying that single-evidence return paths presign file_url
 * before returning to the caller.
 *
 * Covers:
 *  1. uploadEvidence   — create returns a presigned URL
 *  2. updateEvidence   — update returns a presigned URL
 *  3. setReviewerNote  — update returns a presigned URL
 *
 * Each test mocks getSignedDownloadUrl to return 'signed://presigned-url'
 * and asserts that the returned evidence carries that value.
 * A companion test for each path verifies the original key is kept when
 * presigning fails (non-fatal path).
 */

const FOLDER_ID = 'folder-uuid-presign-0000-000000000001';
const SECTION_ID = 'section-uuid-presign-0000-000000000002';
const USER_ID = 'user-uuid-presign-0000-000000000003';
const EVIDENCE_ID = 'evidence-uuid-presign-0000-000000000004';
const RAW_KEY = 'annual-evidence-raw-object-key.pdf';
const SIGNED_URL = 'signed://presigned-url';

// Minimal club-chain shape required by assertEvidenceClubAccess
const mockEvidenceClubChain = {
  annual_folder: {
    club_enrollment: {
      club_section: {
        clubs: { club_id: 10 },
      },
    },
  },
};

// Minimal club-chain shape required by assertEvidenceTerritoryAccess
const mockEvidenceTerritoryChain = {
  annual_folder: {
    club_enrollment: {
      club_section: {
        clubs: {
          club_id: 10,
          local_field_id: 30,
          local_fields: { union_id: 20 },
        },
      },
    },
  },
};

const mockCreatedEvidence = {
  evidence_id: EVIDENCE_ID,
  annual_folder_id: FOLDER_ID,
  section_id: SECTION_ID,
  file_url: RAW_KEY,
  file_name: 'acta.pdf',
  uploaded_by: USER_ID,
  notes: null,
  reviewer_note: null,
  reviewer_noted_by: null,
  reviewer_noted_at: null,
  created_at: new Date('2026-01-15T10:00:00Z'),
  modified_at: new Date('2026-01-15T10:00:00Z'),
  section: { section_id: SECTION_ID, name: 'Actas' },
  uploader: {
    name: 'Ana',
    paternal_last_name: 'López',
    maternal_last_name: null,
  },
};

const mockOpenFolder = {
  annual_folder_id: FOLDER_ID,
  folder_template_id: 'template-uuid-presign-0000-000000000005',
  status: 'open',
};

const mockSection = {
  section_id: SECTION_ID,
  folder_template_id: mockOpenFolder.folder_template_id,
  name: 'Actas',
};

const mockMulterFile: Express.Multer.File = {
  fieldname: 'file',
  originalname: 'acta.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  buffer: Buffer.from('pdf-content'),
  size: 11,
  stream: null as never,
  destination: '',
  filename: '',
  path: '',
};

const mockPrismaService = {
  annual_folders: {
    findUnique: jest.fn(),
  },
  folder_template_sections: {
    findFirst: jest.fn(),
  },
  annual_folder_evidences: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  // super-admin bypass for assertEvidenceClubAccess / assertEvidenceTerritoryAccess
  users_roles: {
    findFirst: jest.fn(),
  },
};

const mockFileStorageService = {
  upload: jest.fn(),
  getSignedDownloadUrl: jest.fn(),
};

describe('AnnualFoldersService — single-evidence presign', () => {
  let service: AnnualFoldersService;

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

    // Default: super-admin bypass for all access-check methods
    mockPrismaService.users_roles.findFirst.mockResolvedValue({
      user_role_id: 'sa-role-id',
    });
  });

  // ================================================================
  // uploadEvidence
  // ================================================================
  describe('uploadEvidence', () => {
    beforeEach(() => {
      mockPrismaService.annual_folders.findUnique.mockResolvedValue(
        mockOpenFolder,
      );
      mockPrismaService.folder_template_sections.findFirst.mockResolvedValue(
        mockSection,
      );
      mockFileStorageService.upload.mockResolvedValue({ url: RAW_KEY });
      mockPrismaService.annual_folder_evidences.create.mockResolvedValue({
        ...mockCreatedEvidence,
      });
    });

    it('returns a presigned file_url after successful create', async () => {
      mockFileStorageService.getSignedDownloadUrl.mockResolvedValue(SIGNED_URL);

      const result = await service.uploadEvidence(
        FOLDER_ID,
        SECTION_ID,
        { notes: undefined },
        USER_ID,
        mockMulterFile,
      );

      expect(mockFileStorageService.getSignedDownloadUrl).toHaveBeenCalledWith(
        StorageBucketAlias.EVIDENCE_FILES,
        RAW_KEY,
      );
      expect(result.file_url).toBe(SIGNED_URL);
    });

    it('keeps the raw key when presigning fails (non-fatal)', async () => {
      mockFileStorageService.getSignedDownloadUrl.mockRejectedValue(
        new Error('R2 error'),
      );

      const result = await service.uploadEvidence(
        FOLDER_ID,
        SECTION_ID,
        { notes: undefined },
        USER_ID,
        mockMulterFile,
      );

      expect(result.file_url).toBe(RAW_KEY);
    });
  });

  // ================================================================
  // updateEvidence
  // ================================================================
  describe('updateEvidence', () => {
    const mockUpdatedEvidence = {
      ...mockCreatedEvidence,
      notes: 'updated note',
    };

    beforeEach(() => {
      // assertEvidenceClubAccess: first findUnique call returns club chain
      // Then updateEvidence fetches the evidence itself (second findUnique)
      mockPrismaService.annual_folder_evidences.findUnique
        .mockResolvedValueOnce(mockEvidenceClubChain)
        .mockResolvedValueOnce({
          ...mockCreatedEvidence,
          annual_folder: { status: 'open' },
        });
      mockPrismaService.annual_folder_evidences.update.mockResolvedValue({
        ...mockUpdatedEvidence,
      });
    });

    it('returns a presigned file_url after successful update', async () => {
      mockFileStorageService.getSignedDownloadUrl.mockResolvedValue(SIGNED_URL);

      const result = await service.updateEvidence(
        EVIDENCE_ID,
        { notes: 'updated note' },
        USER_ID,
      );

      expect(mockFileStorageService.getSignedDownloadUrl).toHaveBeenCalledWith(
        StorageBucketAlias.EVIDENCE_FILES,
        RAW_KEY,
      );
      expect(result.file_url).toBe(SIGNED_URL);
    });

    it('keeps the raw key when presigning fails (non-fatal)', async () => {
      mockFileStorageService.getSignedDownloadUrl.mockRejectedValue(
        new Error('R2 error'),
      );

      const result = await service.updateEvidence(
        EVIDENCE_ID,
        { notes: 'updated note' },
        USER_ID,
      );

      expect(result.file_url).toBe(RAW_KEY);
    });
  });

  // ================================================================
  // setReviewerNote
  // ================================================================
  describe('setReviewerNote', () => {
    const REVIEWER_ID = 'reviewer-uuid-presign-000000000006';
    const noteText = 'Le falta la firma.';

    const mockNoteEvidence = {
      ...mockCreatedEvidence,
      reviewer_note: noteText,
      reviewer_noted_by: REVIEWER_ID,
      reviewer_noted_at: new Date(),
      reviewer: {
        name: 'Juan',
        paternal_last_name: 'Pérez',
        maternal_last_name: null,
      },
    };

    beforeEach(() => {
      // assertEvidenceTerritoryAccess: first findUnique → territory shape
      // Then setReviewerNote fetches the evidence itself (second findUnique)
      mockPrismaService.annual_folder_evidences.findUnique
        .mockResolvedValueOnce(mockEvidenceTerritoryChain)
        .mockResolvedValueOnce(mockCreatedEvidence);
      mockPrismaService.annual_folder_evidences.update.mockResolvedValue({
        ...mockNoteEvidence,
      });
    });

    it('returns a presigned file_url after setting reviewer note', async () => {
      mockFileStorageService.getSignedDownloadUrl.mockResolvedValue(SIGNED_URL);

      const result = await service.setReviewerNote(
        EVIDENCE_ID,
        { reviewer_note: noteText },
        REVIEWER_ID,
      );

      expect(mockFileStorageService.getSignedDownloadUrl).toHaveBeenCalledWith(
        StorageBucketAlias.EVIDENCE_FILES,
        RAW_KEY,
      );
      expect(result.file_url).toBe(SIGNED_URL);
    });

    it('keeps the raw key when presigning fails (non-fatal)', async () => {
      mockFileStorageService.getSignedDownloadUrl.mockRejectedValue(
        new Error('R2 error'),
      );

      const result = await service.setReviewerNote(
        EVIDENCE_ID,
        { reviewer_note: noteText },
        REVIEWER_ID,
      );

      expect(result.file_url).toBe(RAW_KEY);
    });
  });
});
