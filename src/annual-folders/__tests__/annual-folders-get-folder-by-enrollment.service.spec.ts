import { Test, TestingModule } from '@nestjs/testing';
import { AnnualFoldersService } from '../annual-folders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';
import { ErrorCode } from '../../common/errors/error-codes';

describe('AnnualFoldersService — getFolderByEnrollment', () => {
  let service: AnnualFoldersService;

  const mockPrismaService = {
    annual_folders: {
      findUnique: jest.fn(),
    },
    users_roles: {
      findFirst: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualFoldersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<AnnualFoldersService>(AnnualFoldersService);
  });

  it('throws ANNUAL_FOLDER_NOT_FOUND when the enrollment exists but has no folder row', async () => {
    mockPrismaService.annual_folders.findUnique.mockResolvedValue(null);

    await expect(
      service.getFolderByEnrollment(
        '621ea0d0-4779-4a06-98eb-25e13b1af398',
        'user-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_FOLDER_NOT_FOUND,
    });
  });

  it('rejects cross-club reads before presigning evidences', async () => {
    mockPrismaService.annual_folders.findUnique
      .mockResolvedValueOnce({ annual_folder_id: 'folder-1' })
      .mockResolvedValueOnce({
        club_enrollment: {
          club_section: {
            clubs: { club_id: 10 },
          },
        },
      });
    mockPrismaService.users_roles.findFirst.mockResolvedValue(null);
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);

    await expect(
      service.getFolderByEnrollment(
        '621ea0d0-4779-4a06-98eb-25e13b1af398',
        'user-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_FOLDER_FOLDER_ACCESS_DENIED,
    });

    expect(mockFileStorageService.getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('allows territorial local-field supervision when the caller has global evidence_folders:read', async () => {
    mockPrismaService.annual_folders.findUnique.mockResolvedValueOnce({
      club_enrollment: {
        club_section: {
          clubs: {
            club_id: 10,
            local_field_id: 30,
            local_fields: { union_id: 20 },
          },
        },
      },
    });
    mockPrismaService.users_roles.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user_role_id: 'global-read-grant' });
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);
    mockPrismaService.users.findUnique.mockResolvedValue({
      local_field_id: 30,
      union_id: null,
    });

    await expect(
      service.assertFolderReadAccessForUser('folder-1', 'lf-reviewer'),
    ).resolves.toBeUndefined();
  });
});
