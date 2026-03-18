import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
    extractKeyFromPublicUrl: jest.fn((bucket: StorageBucketAlias, url: string) =>
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
          name: 'Carpeta de Evidencias 2026',
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
          status: 'validado',
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
              file_url: 'https://cdn.r2.example/evidence_files/evidence-501-1.pdf',
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
          folder_name: 'Carpeta de Evidencias 2026',
          name: 'Carpeta de Evidencias 2026',
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
              status: 'validado',
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

      await expect(service.getFolder('user-404', 9)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('submitSection', () => {
    it('should mark the section as sent and record the actor', async () => {
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
        status: 'pendiente',
        evidence_files: [{ active: true }],
      });

      mockPrismaService.folders_section_records.update.mockResolvedValue({
        folder_section_record_id: 501,
        status: 'enviado',
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
            status: 'enviado',
            submitted_by_id: 'user-1',
            submitted_at: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe('uploadFile', () => {
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
        status: 'pendiente',
      });

      mockPrismaService.evidence_files.create.mockResolvedValue({
        evidence_file_id: 99,
        file_url:
          'https://cdn.r2.example/evidence_files/evidence-501-1710748800000.pdf',
        file_name: 'comprobante.pdf',
        file_type: 'pdf',
        uploaded_by_id: 'user-1',
        uploaded_at: new Date('2026-03-18T00:00:00.000Z'),
        active: true,
      });

      const result = await service.uploadFile(
        'user-1',
        9,
        11,
        {
          buffer: Buffer.from('fake'),
          mimetype: 'application/pdf',
          originalname: 'comprobante.pdf',
        } as Express.Multer.File,
      );

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
            file_name: 'comprobante.pdf',
            file_type: 'pdf',
            uploaded_by_id: 'user-1',
            active: true,
          }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          file_id: 99,
          file_name: 'comprobante.pdf',
          file_type: 'pdf',
        }),
      );
    });
  });

  describe('deleteFile', () => {
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
          status: 'pendiente',
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
