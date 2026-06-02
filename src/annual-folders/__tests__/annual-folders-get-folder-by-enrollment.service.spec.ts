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
  };

  const mockFileStorageService = {
    getSignedUrl: jest.fn(),
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
      service.getFolderByEnrollment('621ea0d0-4779-4a06-98eb-25e13b1af398'),
    ).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_FOLDER_NOT_FOUND,
    });
  });
});
