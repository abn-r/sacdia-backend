import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceFolderService } from './evidence-folder.service';

describe('EvidenceFolderService', () => {
  let service: EvidenceFolderService;

  const mockPrismaService: any = {
    folder_assignments: {
      findFirst: jest.fn(),
    },
    folders_sections: {
      findFirst: jest.fn(),
    },
    folders_section_records: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    evidence_files: {
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockFileStorageService = {
    upload: jest.fn(async (bucket: StorageBucketAlias, key: string) => ({
      key,
      url: `https://cdn.r2.example/${bucket.toLowerCase()}/${key}`,
    })),
    deleteMany: jest.fn().mockResolvedValue(undefined),
    extractKeyFromPublicUrl: jest.fn(
      (bucket: StorageBucketAlias, url: string) =>
        url.replace(`https://cdn.r2.example/${bucket.toLowerCase()}/`, ''),
    ),
    getSignedDownloadUrl: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceFolderService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<EvidenceFolderService>(EvidenceFolderService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFolder', () => {
    it('should map assignment, sections and evidence files into the mobile structure', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue({
        folder_assignment_id: 1,
        folder_id: 44,
        club_section_id: 9,
        active: true,
        folders: {
          folder_id: 44,
          name: 'Carpeta Anual de Evidencias 2026',
          description: 'Ruta formativa',
          active: true,
          max_points: 100,
          folders_modules: [
            {
              folder_module_id: 2,
              name: 'Módulo A',
              description: 'Intro',
              max_points: 40,
              folders_sections: [
                {
                  folder_section_id: 11,
                  name: 'Sección 1',
                  description: 'Primera',
                  max_points: 20,
                  module_id: 2,
                },
              ],
            },
          ],
        },
      });

      mockPrismaService.folders_section_records.findMany.mockResolvedValue([
        {
          folder_section_record_id: 501,
          folder_id: 44,
          module_id: 2,
          section_id: 11,
          points: 20,
          earned_points: 20,
          status: 'VALIDATED',
          submitted_by: {
            name: 'Juan',
            paternal_last_name: 'Pérez',
            maternal_last_name: 'López',
          },
          submitted_at: new Date('2026-03-10T10:00:00.000Z'),
          validated_by: {
            name: 'Ana',
            paternal_last_name: 'García',
            maternal_last_name: null,
          },
          validated_at: new Date('2026-03-11T10:00:00.000Z'),
          evidence_files: [
            {
              evidence_file_id: 99,
              file_url:
                'https://cdn.r2.example/evidence_files/evidence-501-1.pdf',
              file_name: 'comprobante.pdf',
              file_type: 'pdf',
              uploaded_at: new Date('2026-03-10T12:00:00.000Z'),
              uploaded_by: {
                name: 'María',
                paternal_last_name: 'Torres',
                maternal_last_name: null,
              },
            },
          ],
        },
      ]);

      const result = await service.getFolder('user-1', 9);

      expect(
        mockPrismaService.folder_assignments.findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id: 'user-1',
            club_section_id: 9,
            active: true,
          },
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          folder_id: 44,
          folder_name: 'Carpeta Anual de Evidencias 2026',
          name: 'Carpeta Anual de Evidencias 2026',
          description: 'Ruta formativa',
          is_open: true,
          total_points: 100,
          total_percentage: 0.2,
          sections: [
            expect.objectContaining({
              section_id: 11,
              name: 'Sección 1',
              point_value: 20,
              percentage: 0.2,
              status: 'VALIDATED',
              earned_points: 20,
              submitted_by_name: 'Juan Pérez López',
              validated_by_name: 'Ana García',
              files: [
                expect.objectContaining({
                  file_id: 99,
                  file_name: 'comprobante.pdf',
                  file_type: 'pdf',
                  uploaded_by_name: 'María Torres',
                }),
              ],
            }),
          ],
        }),
      );
    });

    it('should throw when the user has no active assignment for the club section', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue(null);

      await expect(service.getFolder('user-404', 9)).rejects.toMatchObject({
        code: ErrorCode.FOLDER_EVIDENCE_FOLDER_NOT_FOUND,
      });
    });

    it('should default status to PENDING and earned_points to 0 when section has no record', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue({
        folder_assignment_id: 2,
        folder_id: 44,
        club_section_id: 9,
        active: true,
        folders: {
          folder_id: 44,
          name: 'Carpeta Vacía',
          description: null,
          active: true,
          max_points: 50,
          folders_modules: [
            {
              folder_module_id: 3,
              name: 'Módulo B',
              description: null,
              max_points: 50,
              folders_sections: [
                {
                  folder_section_id: 20,
                  name: 'Sección sin registro',
                  description: null,
                  max_points: 50,
                  module_id: 3,
                },
              ],
            },
          ],
        },
      });

      // No records exist for this folder/section
      mockPrismaService.folders_section_records.findMany.mockResolvedValue([]);

      const result = await service.getFolder('user-1', 9);

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]).toEqual(
        expect.objectContaining({
          section_id: 20,
          status: 'PENDING',
          earned_points: 0,
          files: [],
        }),
      );
      expect(result.total_percentage).toBe(0);
    });
  });

  describe('submitSection', () => {
    const baseAssignment = {
      folder_id: 44,
      club_section_id: 9,
      folders: {
        folder_id: 44,
        active: true,
        folders_modules: [
          {
            folder_module_id: 2,
            folders_sections: [
              {
                folder_section_id: 11,
                module_id: 2,
              },
            ],
          },
        ],
      },
    };

    it('should mark the section as sent and record the actor', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue(
        baseAssignment,
      );

      mockPrismaService.folders_section_records.findFirst.mockResolvedValue({
        folder_section_record_id: 501,
        status: 'PENDING',
        evidence_files: [{ active: true }],
      });

      mockPrismaService.folders_section_records.update.mockResolvedValue({
        folder_section_record_id: 501,
        status: 'PENDING',
      });

      await service.submitSection('user-1', 9, 11);

      expect(
        mockPrismaService.folder_assignments.findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id: 'user-1',
            club_section_id: 9,
            active: true,
          },
        }),
      );
      expect(
        mockPrismaService.folders_section_records.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { folder_section_record_id: 501 },
          data: expect.objectContaining({
            status: 'PENDING',
            submitted_by_id: 'user-1',
            submitted_at: expect.any(Date),
          }),
        }),
      );
    });

    it('should throw NotFoundException when section record does not exist', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue(
        baseAssignment,
      );
      mockPrismaService.folders_section_records.findFirst.mockResolvedValue(
        null,
      );

      await expect(
        service.submitSection('user-1', 9, 11),
      ).rejects.toMatchObject({
        code: ErrorCode.FOLDER_EVIDENCE_SECTION_NOT_FOUND,
      });
    });

    it('should throw ConflictException when section is already REJECTED', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue(
        baseAssignment,
      );
      mockPrismaService.folders_section_records.findFirst.mockResolvedValue({
        folder_section_record_id: 501,
        status: 'REJECTED',
        evidence_files: [{ active: true }],
      });

      await expect(
        service.submitSection('user-1', 9, 11),
      ).rejects.toMatchObject({
        code: ErrorCode.FOLDER_EVIDENCE_SECTION_NOT_PENDING,
      });
    });

    it('should throw ConflictException when section is already VALIDATED', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue(
        baseAssignment,
      );
      mockPrismaService.folders_section_records.findFirst.mockResolvedValue({
        folder_section_record_id: 501,
        status: 'VALIDATED',
        evidence_files: [{ active: true }],
      });

      await expect(
        service.submitSection('user-1', 9, 11),
      ).rejects.toMatchObject({
        code: ErrorCode.FOLDER_EVIDENCE_SECTION_NOT_PENDING,
      });
    });

    it('should throw BadRequestException when there are no active evidence files', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue(
        baseAssignment,
      );
      mockPrismaService.folders_section_records.findFirst.mockResolvedValue({
        folder_section_record_id: 501,
        status: 'PENDING',
        evidence_files: [],
      });

      await expect(
        service.submitSection('user-1', 9, 11),
      ).rejects.toMatchObject({
        code: ErrorCode.FOLDER_EVIDENCE_NO_FILES_FOR_SUBMIT,
      });
    });

    it('should throw NotFoundException when sectionId does not exist in the folder template', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue(
        baseAssignment,
      );

      await expect(
        service.submitSection('user-1', 9, 999),
      ).rejects.toMatchObject({
        code: ErrorCode.FOLDER_EVIDENCE_SECTION_NOT_FOUND,
      });
    });
  });

  describe('uploadFile', () => {
    it('should throw BadRequestException when no file buffer is provided', async () => {
      await expect(
        service.uploadFile('user-1', 9, 11, { buffer: undefined } as any),
      ).rejects.toMatchObject({
        code: ErrorCode.FOLDER_EVIDENCE_FILE_REQUIRED,
      });
    });

    it('should create a new section record when none exists and upload the file', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1710748800000);

      const baseAssignment = {
        folder_id: 44,
        club_section_id: 9,
        folders: {
          folder_id: 44,
          active: true,
          folders_modules: [
            {
              folder_module_id: 2,
              folders_sections: [
                {
                  folder_section_id: 11,
                  module_id: 2,
                },
              ],
            },
          ],
        },
      };

      mockPrismaService.folder_assignments.findFirst.mockResolvedValue(
        baseAssignment,
      );
      // getActiveSectionRecord returns null → triggers create path
      mockPrismaService.folders_section_records.findFirst.mockResolvedValue(
        null,
      );
      mockPrismaService.folders_section_records.create.mockResolvedValue({
        folder_section_record_id: 502,
        status: 'PENDING',
        evidence_files: [],
      });
      mockPrismaService.evidence_files.create.mockResolvedValue({
        evidence_file_id: 100,
        file_url:
          'https://cdn.r2.example/evidence_files/evidence-502-1710748800000.jpg',
        file_name: 'Evidencia 01.jpg',
        file_type: 'image',
        uploaded_by_id: 'user-1',
        uploaded_at: new Date('2026-03-18T00:00:00.000Z'),
        active: true,
        uploaded_by: null,
      });
      mockPrismaService.evidence_files.count.mockResolvedValue(0);

      const result = await service.uploadFile('user-1', 9, 11, {
        buffer: Buffer.from('img'),
        mimetype: 'image/jpeg',
        originalname: 'foto.jpg',
      } as Express.Multer.File);

      expect(
        mockPrismaService.folders_section_records.create,
      ).toHaveBeenCalled();
      expect(mockFileStorageService.upload).toHaveBeenCalledWith(
        StorageBucketAlias.EVIDENCE_FILES,
        'evidence-502-1710748800000.jpg',
        expect.any(Buffer),
        { contentType: 'image/jpeg' },
      );
      expect(mockPrismaService.evidence_files.count).toHaveBeenCalledWith({
        where: { section_record_id: 502 },
      });
      expect(result).toEqual(
        expect.objectContaining({ file_id: 100, file_type: 'image' }),
      );
    });

    it('should throw ConflictException when section record is not pending', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue({
        folder_id: 44,
        club_section_id: 9,
        folders: {
          folder_id: 44,
          active: true,
          folders_modules: [
            {
              folder_module_id: 2,
              folders_sections: [{ folder_section_id: 11, module_id: 2 }],
            },
          ],
        },
      });
      mockPrismaService.folders_section_records.findFirst.mockResolvedValue({
        folder_section_record_id: 501,
        status: 'VALIDATED',
        evidence_files: [],
      });

      await expect(
        service.uploadFile('user-1', 9, 11, {
          buffer: Buffer.from('fake'),
          mimetype: 'application/pdf',
          originalname: 'doc.pdf',
        } as Express.Multer.File),
      ).rejects.toMatchObject({
        code: ErrorCode.FOLDER_EVIDENCE_SECTION_NOT_PENDING,
      });
    });

    it('should upload the file to R2 and create the evidence file record', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1710748800000);

      mockPrismaService.folder_assignments.findFirst.mockResolvedValue({
        folder_id: 44,
        club_section_id: 9,
        folders: {
          folder_id: 44,
          active: true,
          folders_modules: [
            {
              folder_module_id: 2,
              folders_sections: [
                {
                  folder_section_id: 11,
                  module_id: 2,
                },
              ],
            },
          ],
        },
      });

      mockPrismaService.folders_section_records.findFirst.mockResolvedValue({
        folder_section_record_id: 501,
        status: 'PENDING',
      });

      mockPrismaService.evidence_files.create.mockResolvedValue({
        evidence_file_id: 99,
        file_url:
          'https://cdn.r2.example/evidence_files/evidence-501-1710748800000.pdf',
        file_name: 'Evidencia 01.pdf',
        file_type: 'pdf',
        uploaded_by_id: 'user-1',
        uploaded_at: new Date('2026-03-18T00:00:00.000Z'),
        active: true,
      });
      mockPrismaService.evidence_files.count.mockResolvedValue(0);

      const result = await service.uploadFile('user-1', 9, 11, {
        buffer: Buffer.from('fake'),
        mimetype: 'application/pdf',
        originalname: 'comprobante.pdf',
      } as Express.Multer.File);

      expect(
        mockPrismaService.folder_assignments.findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id: 'user-1',
            club_section_id: 9,
            active: true,
          },
        }),
      );
      expect(mockFileStorageService.upload).toHaveBeenCalledWith(
        StorageBucketAlias.EVIDENCE_FILES,
        'evidence-501-1710748800000.pdf',
        expect.any(Buffer),
        { contentType: 'application/pdf' },
      );
      expect(mockPrismaService.evidence_files.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            section_record_id: 501,
            file_url:
              'https://cdn.r2.example/evidence_files/evidence-501-1710748800000.pdf',
            file_name: 'Evidencia 01.pdf',
            file_type: 'pdf',
            uploaded_by_id: 'user-1',
            active: true,
          }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          file_id: 99,
          file_name: 'Evidencia 01.pdf',
          file_type: 'pdf',
        }),
      );
    });
  });

  describe('deleteFile', () => {
    it('should throw NotFoundException when the file does not exist', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue({
        folder_id: 44,
        club_section_id: 9,
        folders: {
          folder_id: 44,
          active: true,
          folders_modules: [
            {
              folder_module_id: 2,
              folders_sections: [{ folder_section_id: 11, module_id: 2 }],
            },
          ],
        },
      });
      mockPrismaService.evidence_files.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteFile('user-1', 9, 11, 999),
      ).rejects.toMatchObject({
        code: ErrorCode.FOLDER_EVIDENCE_FILE_NOT_FOUND,
      });
    });

    it('should throw NotFoundException when the file belongs to a different section', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue({
        folder_id: 44,
        club_section_id: 9,
        folders: {
          folder_id: 44,
          active: true,
          folders_modules: [
            {
              folder_module_id: 2,
              folders_sections: [{ folder_section_id: 11, module_id: 2 }],
            },
          ],
        },
      });
      mockPrismaService.evidence_files.findFirst.mockResolvedValue({
        evidence_file_id: 99,
        section_record_id: 501,
        file_url: 'https://cdn.r2.example/evidence_files/evidence-501-xyz.pdf',
        active: true,
        section_record: {
          folder_section_record_id: 501,
          folder_id: 44,
          section_id: 99, // wrong section
          club_section_id: 9,
          status: 'PENDING',
        },
      });

      await expect(
        service.deleteFile('user-1', 9, 11, 99),
      ).rejects.toMatchObject({
        code: ErrorCode.FOLDER_EVIDENCE_FILE_NOT_FOUND,
      });
    });

    it('should throw ConflictException when the section is not pending', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue({
        folder_id: 44,
        club_section_id: 9,
        folders: {
          folder_id: 44,
          active: true,
          folders_modules: [
            {
              folder_module_id: 2,
              folders_sections: [{ folder_section_id: 11, module_id: 2 }],
            },
          ],
        },
      });
      mockPrismaService.evidence_files.findFirst.mockResolvedValue({
        evidence_file_id: 99,
        section_record_id: 501,
        file_url: 'https://cdn.r2.example/evidence_files/evidence-501-xyz.pdf',
        active: true,
        section_record: {
          folder_section_record_id: 501,
          folder_id: 44,
          section_id: 11,
          club_section_id: 9,
          status: 'VALIDATED',
        },
      });

      await expect(
        service.deleteFile('user-1', 9, 11, 99),
      ).rejects.toMatchObject({
        code: ErrorCode.FOLDER_EVIDENCE_SECTION_NOT_PENDING,
      });
    });

    it('should soft delete the file and remove it from R2 when possible', async () => {
      mockPrismaService.folder_assignments.findFirst.mockResolvedValue({
        folder_id: 44,
        club_section_id: 9,
        folders: {
          folder_id: 44,
          active: true,
          folders_modules: [
            {
              folder_module_id: 2,
              folders_sections: [
                {
                  folder_section_id: 11,
                  module_id: 2,
                },
              ],
            },
          ],
        },
      });

      mockPrismaService.evidence_files.findFirst.mockResolvedValue({
        evidence_file_id: 99,
        section_record_id: 501,
        file_url:
          'https://cdn.r2.example/evidence_files/evidence-501-1710748800000.pdf',
        active: true,
        section_record: {
          folder_section_record_id: 501,
          folder_id: 44,
          section_id: 11,
          club_section_id: 9,
          status: 'PENDING',
        },
      });

      mockPrismaService.evidence_files.update.mockResolvedValue({
        evidence_file_id: 99,
        active: false,
        file_url:
          'https://cdn.r2.example/evidence_files/evidence-501-1710748800000.pdf',
        file_name: 'comprobante.pdf',
        file_type: 'pdf',
        uploaded_at: new Date('2026-03-18T00:00:00.000Z'),
        uploaded_by: {
          name: 'María',
          paternal_last_name: 'Torres',
          maternal_last_name: null,
        },
      });

      await service.deleteFile('user-1', 9, 11, 99);

      expect(
        mockPrismaService.folder_assignments.findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id: 'user-1',
            club_section_id: 9,
            active: true,
          },
        }),
      );
      expect(mockFileStorageService.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.EVIDENCE_FILES,
        ['evidence-501-1710748800000.pdf'],
      );
      expect(mockPrismaService.evidence_files.update).toHaveBeenCalledWith({
        where: { evidence_file_id: 99 },
        data: { active: false },
        include: {
          uploaded_by: {
            select: {
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
        },
      });
    });
  });
});
