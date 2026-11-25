import { Test, TestingModule } from '@nestjs/testing';
import { AnnualFoldersService } from '../annual-folders.service';
import { AuthorizationContextService } from '../../common/services/authorization-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';
import { GlobalRole } from '../../common/authorization/roles';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  buildResolvedProfile,
  buildScopedAuthorizationContext,
} from './folder-scope.testing';

/**
 * Folder reads and reviewer notes resolve the actor's territory through the
 * institutional hierarchy (local field -> union -> division), so a Division
 * actor reaches every folder of its division and nothing else.
 */
describe('AnnualFoldersService — division scope through the hierarchy', () => {
  let service: AnnualFoldersService;

  const FOLDER_IN_DIVISION = {
    club_enrollment: {
      club_section_id: 163,
      club_section: {
        clubs: {
          club_id: 10,
          local_field_id: 30,
          local_fields: { union_id: 20, unions: { division_id: 7 } },
        },
      },
    },
  };

  const FOLDER_OTHER_DIVISION = {
    club_enrollment: {
      club_section_id: 164,
      club_section: {
        clubs: {
          club_id: 11,
          local_field_id: 31,
          local_fields: { union_id: 21, unions: { division_id: 8 } },
        },
      },
    },
  };

  const mockPrismaService = {
    annual_folders: { findUnique: jest.fn() },
    annual_folder_evidences: { findUnique: jest.fn(), update: jest.fn() },
    users_roles: { findFirst: jest.fn() },
    club_role_assignments: { findFirst: jest.fn() },
    users: { findUnique: jest.fn() },
  };

  const build = async (roleName: string | null, ids = {}) => {
    const authorizationContext = buildScopedAuthorizationContext(
      buildResolvedProfile(roleName, ids),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualFoldersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: {} },
        {
          provide: AuthorizationContextService,
          useValue: authorizationContext,
        },
      ],
    }).compile();
    service = module.get(AnnualFoldersService);
  };

  beforeEach(() => {
    jest.resetAllMocks();
    // No super-admin bypass; the global-permission lookup also finds a grant
    // (controller-level permission is what lets global roles reach here).
    mockPrismaService.users_roles.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ user_role_id: 'global-read-grant' });
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);
  });

  describe('folder read (getFolder / by-enrollment / :folderId/evaluations)', () => {
    it('allows a Division actor on a folder of its division even when its own union differs', async () => {
      await build(GlobalRole.DIRECTOR_DIA, { division: 7, union: 99 });
      mockPrismaService.annual_folders.findUnique.mockResolvedValue(
        FOLDER_IN_DIVISION,
      );

      await expect(
        service.assertFolderReadAccessForUser('folder-1', 'dia-1'),
      ).resolves.toBeUndefined();
      expect(mockPrismaService.users.findUnique).not.toHaveBeenCalled();
    });

    it('allows a Division actor anchored only by local_field_id (division in scope)', async () => {
      await build(GlobalRole.ASSISTANT_DIA, { division: 7, localField: 999 });
      mockPrismaService.annual_folders.findUnique.mockResolvedValue(
        FOLDER_IN_DIVISION,
      );

      await expect(
        service.assertFolderReadAccessForUser('folder-1', 'dia-1'),
      ).resolves.toBeUndefined();
    });

    it('rejects a Division actor on a folder of another division', async () => {
      await build(GlobalRole.DIRECTOR_DIA, { division: 7, union: 21 });
      mockPrismaService.annual_folders.findUnique.mockResolvedValue(
        FOLDER_OTHER_DIVISION,
      );

      await expect(
        service.assertFolderReadAccessForUser('folder-2', 'dia-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_FOLDER_ACCESS_DENIED,
      });
    });

    it('rejects a Division role without a division anchor', async () => {
      await build(GlobalRole.DIRECTOR_DIA, { localField: 30 });
      mockPrismaService.annual_folders.findUnique.mockResolvedValue(
        FOLDER_IN_DIVISION,
      );

      await expect(
        service.assertFolderReadAccessForUser('folder-1', 'dia-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_FOLDER_ACCESS_DENIED,
      });
    });

    it('keeps Union behavior: own union allowed, other union rejected', async () => {
      await build(GlobalRole.DIRECTOR_UNION, { union: 20, division: 7 });
      mockPrismaService.annual_folders.findUnique.mockResolvedValue(
        FOLDER_IN_DIVISION,
      );
      await expect(
        service.assertFolderReadAccessForUser('folder-1', 'u-1'),
      ).resolves.toBeUndefined();

      mockPrismaService.users_roles.findFirst
        .mockReset()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ user_role_id: 'global-read-grant' });
      mockPrismaService.annual_folders.findUnique.mockResolvedValue({
        club_enrollment: {
          ...FOLDER_IN_DIVISION.club_enrollment,
          club_section: {
            clubs: {
              ...FOLDER_IN_DIVISION.club_enrollment.club_section.clubs,
              local_fields: { union_id: 21, unions: { division_id: 7 } },
            },
          },
        },
      });
      await expect(
        service.assertFolderReadAccessForUser('folder-1', 'u-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_FOLDER_ACCESS_DENIED,
      });
    });

    it('keeps Local Field behavior: own field allowed, other field rejected', async () => {
      await build(GlobalRole.DIRECTOR_LF, { localField: 30, union: 20 });
      mockPrismaService.annual_folders.findUnique.mockResolvedValue(
        FOLDER_IN_DIVISION,
      );
      await expect(
        service.assertFolderReadAccessForUser('folder-1', 'lf-1'),
      ).resolves.toBeUndefined();

      mockPrismaService.users_roles.findFirst
        .mockReset()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ user_role_id: 'global-read-grant' });
      mockPrismaService.annual_folders.findUnique.mockResolvedValue(
        FOLDER_OTHER_DIVISION,
      );
      await expect(
        service.assertFolderReadAccessForUser('folder-2', 'lf-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_FOLDER_ACCESS_DENIED,
      });
    });
  });

  describe('reviewer note', () => {
    const evidenceShape = (folder: typeof FOLDER_IN_DIVISION) => ({
      annual_folder: folder,
    });
    const evidenceRow = {
      evidence_id: 'ev-1',
      annual_folder_id: 'folder-1',
      reviewer_note: null,
    };

    beforeEach(() => {
      mockPrismaService.users_roles.findFirst
        .mockReset()
        .mockResolvedValue(null);
    });

    it('saves a note for a Division actor on an in-division folder', async () => {
      await build(GlobalRole.DIRECTOR_DIA, { division: 7, union: 99 });
      mockPrismaService.annual_folder_evidences.findUnique
        .mockResolvedValueOnce(evidenceShape(FOLDER_IN_DIVISION))
        .mockResolvedValueOnce(evidenceRow);
      mockPrismaService.annual_folder_evidences.update.mockResolvedValue({
        ...evidenceRow,
        reviewer_note: 'ok',
      });

      await service.setReviewerNote('ev-1', { reviewer_note: 'ok' }, 'dia-1');

      expect(
        mockPrismaService.annual_folder_evidences.update,
      ).toHaveBeenCalledTimes(1);
    });

    it('rejects a Division actor on an out-of-division folder without writing', async () => {
      await build(GlobalRole.DIRECTOR_DIA, { division: 7 });
      mockPrismaService.annual_folder_evidences.findUnique.mockResolvedValueOnce(
        evidenceShape(FOLDER_OTHER_DIVISION),
      );

      await expect(
        service.setReviewerNote('ev-2', { reviewer_note: 'x' }, 'dia-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_FOLDER_EVIDENCE_TERRITORY_DENIED,
      });
      expect(
        mockPrismaService.annual_folder_evidences.update,
      ).not.toHaveBeenCalled();
    });
  });
});
