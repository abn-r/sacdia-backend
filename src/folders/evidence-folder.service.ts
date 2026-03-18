import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  FileStorageService,
  StorageBucketAlias,
} from '../common/services/file-storage.service';

type UserNameRecord = {
  name?: string | null;
  paternal_last_name?: string | null;
  maternal_last_name?: string | null;
};

type EvidenceFileRecord = {
  evidence_file_id: number;
  file_url: string;
  file_name: string;
  file_type: string;
  uploaded_at: Date;
  uploaded_by?: UserNameRecord | null;
};

type SectionRecord = {
  folder_section_record_id: number;
  folder_id: number;
  module_id: number;
  section_id: number;
  points?: number | null;
  earned_points?: number | null;
  status?: string | null;
  submitted_by?: UserNameRecord | null;
  submitted_at?: Date | null;
  validated_by?: UserNameRecord | null;
  validated_at?: Date | null;
  evidence_files?: EvidenceFileRecord[];
};

type SectionTemplate = {
  folder_section_id: number;
  name: string;
  description?: string | null;
  max_points?: number | null;
  module_id: number;
};

type ModuleTemplate = {
  folder_module_id: number;
  name: string;
  description?: string | null;
  max_points?: number | null;
  folders_sections: SectionTemplate[];
};

type FolderTemplate = {
  folder_id: number;
  name: string;
  description?: string | null;
  active?: boolean;
  max_points?: number | null;
  folders_modules: ModuleTemplate[];
};

@Injectable()
export class EvidenceFolderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  async getFolder(userId: string, clubSectionId: number) {
    const assignment = await this.getAssignment(userId, clubSectionId);
    const folder = assignment.folders as FolderTemplate;
    const folderMaxPoints = this.getFolderMaxPoints(folder);
    const sectionRecords = await this.getSectionRecords(
      folder.folder_id,
      clubSectionId,
    );
    const recordsBySectionId = new Map(
      sectionRecords.map((record: SectionRecord) => [
        record.section_id,
        record,
      ]),
    );

    const sections = folder.folders_modules.flatMap((module) =>
      module.folders_sections.map((section) =>
        this.mapSection(section, recordsBySectionId.get(section.folder_section_id), folderMaxPoints),
      ),
    );

    const earnedPoints = sections.reduce(
      (sum, section) => sum + (section.earned_points ?? 0),
      0,
    );

    return {
      id: String(folder.folder_id),
      folder_id: folder.folder_id,
      folder_name: folder.name,
      name: folder.name,
      description: folder.description ?? null,
      is_open: folder.active ?? true,
      total_points: folderMaxPoints,
      total_percentage:
        folderMaxPoints > 0
          ? Number((earnedPoints / folderMaxPoints).toFixed(2))
          : 0,
      sections,
    };
  }

  async submitSection(
    userId: string,
    clubSectionId: number,
    sectionId: number,
  ) {
    const assignment = await this.getAssignment(userId, clubSectionId);
    const folder = assignment.folders as FolderTemplate;
    this.findSectionTemplate(folder, sectionId);

    const sectionRecord = await this.getActiveSectionRecord(
      folder.folder_id,
      clubSectionId,
      sectionId,
    );

    if (!sectionRecord) {
      throw new NotFoundException('Evidence section record not found');
    }

    if ((sectionRecord.status ?? 'pendiente') !== 'pendiente') {
      throw new ConflictException('Section is not pending');
    }

    const activeFiles = (sectionRecord.evidence_files ?? []).filter(
      (file) => file,
    );

    if (activeFiles.length === 0) {
      throw new BadRequestException(
        'Section must have at least one evidence file before submit',
      );
    }

    return this.db.folders_section_records.update({
      where: { folder_section_record_id: sectionRecord.folder_section_record_id },
      data: {
        status: 'enviado',
        submitted_by_id: userId,
        submitted_at: new Date(),
      },
    });
  }

  async uploadFile(
    userId: string,
    clubSectionId: number,
    sectionId: number,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('File is required');
    }

    const assignment = await this.getAssignment(userId, clubSectionId);
    const folder = assignment.folders as FolderTemplate;
    const sectionTemplate = this.findSectionTemplate(folder, sectionId);
    const sectionRecord = await this.getOrCreateSectionRecord({
      folderId: folder.folder_id,
      clubSectionId,
      sectionTemplate,
      userId,
    });

    if ((sectionRecord.status ?? 'pendiente') !== 'pendiente') {
      throw new ConflictException('Section is not pending');
    }

    const extension = this.resolveFileExtension(file);
    const objectKey = `evidence-${sectionRecord.folder_section_record_id}-${Date.now()}.${extension}`;
    const uploaded = await this.fileStorage.upload(
      StorageBucketAlias.EVIDENCE_FILES,
      objectKey,
      file.buffer,
      { contentType: file.mimetype },
    );

    const created = await this.db.evidence_files.create({
      data: {
        section_record_id: sectionRecord.folder_section_record_id,
        file_url: uploaded.url,
        file_name: file.originalname || objectKey,
        file_type: this.resolveEvidenceFileType(file),
        uploaded_by_id: userId,
        active: true,
      },
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

    return this.mapEvidenceFile(created);
  }

  async deleteFile(
    userId: string,
    clubSectionId: number,
    sectionId: number,
    fileId: number,
  ) {
    const assignment = await this.getAssignment(userId, clubSectionId);
    const folder = assignment.folders as FolderTemplate;
    this.findSectionTemplate(folder, sectionId);

    const fileRecord = await this.db.evidence_files.findFirst({
      where: { evidence_file_id: fileId, active: true },
      include: {
        section_record: {
          include: {
            submitted_by: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
            validated_by: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
            evidence_files: {
              where: { active: true },
              include: {
                uploaded_by: {
                  select: {
                    name: true,
                    paternal_last_name: true,
                    maternal_last_name: true,
                  },
                },
              },
            },
          },
        },
        uploaded_by: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
    });

    if (
      !fileRecord ||
      !fileRecord.section_record ||
      fileRecord.section_record.folder_id !== folder.folder_id ||
      fileRecord.section_record.club_section_id !== clubSectionId ||
      fileRecord.section_record.section_id !== sectionId
    ) {
      throw new NotFoundException('Evidence file not found');
    }

    if ((fileRecord.section_record.status ?? 'pendiente') !== 'pendiente') {
      throw new ConflictException('Section is not pending');
    }

    const r2Key = this.fileStorage.extractKeyFromPublicUrl(
      StorageBucketAlias.EVIDENCE_FILES,
      fileRecord.file_url,
    );

    if (r2Key) {
      try {
        await this.fileStorage.deleteMany(StorageBucketAlias.EVIDENCE_FILES, [
          r2Key,
        ]);
      } catch {
        // Best-effort delete from R2; the DB soft delete is the source of truth.
      }
    }

    const updated = await this.db.evidence_files.update({
      where: { evidence_file_id: fileId },
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

    return this.mapEvidenceFile(updated);
  }

  private async getAssignment(userId: string, clubSectionId: number) {
    const assignment = await this.db.folder_assignments.findFirst({
      where: {
        user_id: userId,
        club_section_id: clubSectionId,
        active: true,
      },
      include: {
        folders: {
          include: {
            folders_modules: {
              include: {
                folders_sections: {
                  orderBy: { folder_section_id: 'asc' },
                },
              },
              orderBy: { folder_module_id: 'asc' },
            },
          },
        },
      },
    });

    if (!assignment?.folders) {
      throw new NotFoundException('Evidence folder not found');
    }

    return assignment;
  }

  private async getSectionRecords(folderId: number, clubSectionId: number) {
    return this.db.folders_section_records.findMany({
      where: {
        folder_id: folderId,
        club_section_id: clubSectionId,
        active: true,
      },
      include: {
        evidence_files: {
          where: { active: true },
          orderBy: { uploaded_at: 'asc' },
          include: {
            uploaded_by: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
        submitted_by: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
        validated_by: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: [{ module_id: 'asc' }, { section_id: 'asc' }],
    });
  }

  private async getActiveSectionRecord(
    folderId: number,
    clubSectionId: number,
    sectionId: number,
  ) {
    return this.db.folders_section_records.findFirst({
      where: {
        folder_id: folderId,
        club_section_id: clubSectionId,
        section_id: sectionId,
        active: true,
      },
      include: {
        evidence_files: {
          where: { active: true },
          orderBy: { uploaded_at: 'asc' },
          include: {
            uploaded_by: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
      },
    });
  }

  private async getOrCreateSectionRecord({
    folderId,
    clubSectionId,
    sectionTemplate,
    userId,
  }: {
    folderId: number;
    clubSectionId: number;
    sectionTemplate: SectionTemplate;
    userId: string;
  }) {
    const existing = await this.getActiveSectionRecord(
      folderId,
      clubSectionId,
      sectionTemplate.folder_section_id,
    );

    if (existing) {
      return existing;
    }

    return this.db.folders_section_records.create({
      data: {
        folder_id: folderId,
        module_id: sectionTemplate.module_id,
        section_id: sectionTemplate.folder_section_id,
        club_section_id: clubSectionId,
        points: 0,
        earned_points: 0,
        status: 'pendiente',
        active: true,
      },
      include: {
        evidence_files: {
          where: { active: true },
          include: {
            uploaded_by: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
      },
    });
  }

  private findSectionTemplate(folder: FolderTemplate, sectionId: number) {
    for (const module of folder.folders_modules) {
      const section = module.folders_sections.find(
        (item) => item.folder_section_id === sectionId,
      );
      if (section) {
        return section;
      }
    }

    throw new NotFoundException(`Evidence section ${sectionId} not found`);
  }

  private mapSection(
    section: SectionTemplate,
    record?: SectionRecord,
    folderMaxPoints = 0,
  ) {
    const files = (record?.evidence_files ?? []).map((file) =>
      this.mapEvidenceFile(file),
    );
    const pointValue = section.max_points ?? 0;
    const earnedPoints = record?.earned_points ?? record?.points ?? 0;
    const percentage =
      folderMaxPoints > 0
        ? Number((pointValue / folderMaxPoints).toFixed(2))
        : 0;

    return {
      id: String(section.folder_section_id),
      section_id: section.folder_section_id,
      section_name: section.name,
      name: section.name,
      description: section.description ?? null,
      point_value: pointValue,
      max_points: pointValue,
      percentage,
      weight_percentage: percentage,
      max_files: 10,
      status: record?.status ?? 'pendiente',
      files,
      evidence_files: files,
      submitted_by_name: this.formatUserName(record?.submitted_by ?? null),
      submitted_at: record?.submitted_at
        ? record.submitted_at.toISOString()
        : null,
      validated_by_name: this.formatUserName(record?.validated_by ?? null),
      validated_at: record?.validated_at
        ? record.validated_at.toISOString()
        : null,
      earned_points: earnedPoints,
    };
  }

  private mapEvidenceFile(file: EvidenceFileRecord) {
    return {
      id: String(file.evidence_file_id),
      file_id: file.evidence_file_id,
      url: file.file_url,
      file_url: file.file_url,
      file_name: file.file_name,
      fileName: file.file_name,
      file_type: file.file_type,
      type: file.file_type,
      uploaded_by_name: this.formatUserName(file.uploaded_by ?? null),
      uploadedByName: this.formatUserName(file.uploaded_by ?? null),
      uploaded_at: file.uploaded_at.toISOString(),
      uploadedAt: file.uploaded_at.toISOString(),
    };
  }

  private formatUserName(user?: UserNameRecord | null) {
    if (!user) return null;

    const parts = [user.name, user.paternal_last_name, user.maternal_last_name]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));

    const fullName = parts.join(' ').trim();
    return fullName || null;
  }

  private getFolderMaxPoints(folder: FolderTemplate) {
    if (typeof folder.max_points === 'number') {
      return folder.max_points;
    }

    return folder.folders_modules.reduce((sum, module) => {
      return (
        sum +
        module.folders_sections.reduce(
          (sectionSum, section) => sectionSum + (section.max_points ?? 0),
          0,
        )
      );
    }, 0);
  }

  private resolveEvidenceFileType(file: Express.Multer.File) {
    return file.mimetype === 'application/pdf' ||
      file.originalname?.toLowerCase().endsWith('.pdf')
      ? 'pdf'
      : 'image';
  }

  private resolveFileExtension(file: Express.Multer.File) {
    const original = file.originalname ?? '';
    const ext = original.includes('.')
      ? original.split('.').pop()?.toLowerCase()
      : null;

    if (ext) return ext;

    if (file.mimetype === 'application/pdf') return 'pdf';
    if (file.mimetype === 'image/png') return 'png';
    if (file.mimetype === 'image/webp') return 'webp';
    if (file.mimetype === 'image/jpeg') return 'jpg';

    return 'bin';
  }
}
