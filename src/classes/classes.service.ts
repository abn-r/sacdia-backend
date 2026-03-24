import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  private async resolveProgressEnrollment(params: {
    userId: string;
    classId: number;
    enrollmentId?: number;
  }): Promise<{
    enrollmentId: number;
    ecclesiasticalYearId: number;
  }> {
    if (params.enrollmentId !== undefined) {
      const enrollment = await this.prisma.enrollments.findUnique({
        where: {
          enrollment_id: params.enrollmentId,
        },
        select: {
          enrollment_id: true,
          user_id: true,
          class_id: true,
          ecclesiastical_year_id: true,
        },
      });

      if (
        !enrollment ||
        enrollment.user_id !== params.userId ||
        enrollment.class_id !== params.classId
      ) {
        throw new NotFoundException(
          'No se encontro la inscripcion anual solicitada para esta clase',
        );
      }

      return {
        enrollmentId: enrollment.enrollment_id,
        ecclesiasticalYearId: enrollment.ecclesiastical_year_id,
      };
    }

    const activeYear = await this.prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: new Date() },
        end_date: { gte: new Date() },
      },
      select: {
        year_id: true,
      },
    });

    if (!activeYear) {
      throw new NotFoundException(
        'No existe una inscripcion anual activa para esta clase',
      );
    }

    const enrollments = await this.prisma.enrollments.findMany({
      where: {
        user_id: params.userId,
        class_id: params.classId,
        ecclesiastical_year_id: activeYear.year_id,
        active: true,
      },
      select: {
        enrollment_id: true,
        ecclesiastical_year_id: true,
      },
    });

    if (enrollments.length === 0) {
      throw new NotFoundException(
        'No existe una inscripcion anual activa para esta clase',
      );
    }

    if (enrollments.length > 1) {
      throw new ConflictException({
        code: 'ENROLLMENT_RESOLUTION_AMBIGUOUS',
        message:
          'La solicitud es ambigua. Envia enrollmentId o enrollment_id para seleccionar la inscripcion anual correcta.',
      });
    }

    return {
      enrollmentId: enrollments[0].enrollment_id,
      ecclesiasticalYearId: enrollments[0].ecclesiastical_year_id,
    };
  }

  // ========================================
  // CLASSES
  // ========================================

  async findAll(
    clubTypeId?: number,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<any>> {
    const where = {
      active: true,
      ...(clubTypeId && { club_type_id: clubTypeId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.classes.findMany({
        where,
        include: {
          club_types: { select: { name: true } },
          _count: { select: { class_modules: true } },
        },
        orderBy: [{ club_type_id: 'asc' }, { minimum_age: 'asc' }],
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 50,
      }),
      this.prisma.classes.count({ where }),
    ]);

    return createPaginatedResult(
      data,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  async findOne(classId: number) {
    const classData = await this.prisma.classes.findUnique({
      where: { class_id: classId },
      include: {
        club_types: { select: { name: true } },
        class_modules: {
          where: { active: true },
          include: {
            class_sections: {
              where: { active: true },
              orderBy: { section_id: 'asc' },
            },
          },
          orderBy: { module_id: 'asc' },
        },
      },
    });

    if (!classData) {
      throw new NotFoundException(`Class with ID ${classId} not found`);
    }

    return classData;
  }

  async getModules(classId: number) {
    const classData = await this.findOne(classId);
    return classData.class_modules;
  }

  // ========================================
  // ENROLLMENTS
  // ========================================

  async enrollUser(
    userId: string,
    classId: number,
    ecclesiasticalYearId: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Resolve club type IDs by name
      const clubTypes = await tx.club_types.findMany({
        where: { name: { in: ['Aventureros', 'Conquistadores', 'Guías Mayores'] } },
      });
      if (clubTypes.length !== 3) {
        throw new InternalServerErrorException(
          'No se pudieron resolver los tipos de club requeridos',
        );
      }
      const aventurerosId = clubTypes.find((ct) => ct.name === 'Aventureros')!.club_type_id;
      const conquistadoresId = clubTypes.find((ct) => ct.name === 'Conquistadores')!.club_type_id;
      const gmId = clubTypes.find((ct) => ct.name === 'Guías Mayores')!.club_type_id;

      // 2. Get target class
      const targetClass = await tx.classes.findUnique({
        where: { class_id: classId },
      });
      if (!targetClass) {
        throw new NotFoundException('Clase no encontrada');
      }

      // 3. Check GM investiture pre-condition
      if (targetClass.requires_invested_gm) {
        const hasInvestiture = await tx.enrollments.findFirst({
          where: {
            user_id: userId,
            investiture_status: 'INVESTIDO',
            classes: { club_type_id: gmId },
          },
        });
        if (!hasInvestiture) {
          throw new ForbiddenException(
            'Necesitás haber sido investido en al menos una clase de Guías Mayores',
          );
        }
      }

      // 4. Enrollment limit by club type
      const { club_type_id } = targetClass;

      if ([aventurerosId, conquistadoresId].includes(club_type_id)) {
        const activeCount = await tx.enrollments.count({
          where: {
            user_id: userId,
            ecclesiastical_year_id: ecclesiasticalYearId,
            active: true,
            classes: { club_type_id: { in: [aventurerosId, conquistadoresId] } },
          },
        });
        if (activeCount >= 1) {
          throw new ConflictException(
            'Ya tenés una inscripción activa en Aventureros/Conquistadores',
          );
        }
      } else if (club_type_id === gmId) {
        const activeCount = await tx.enrollments.count({
          where: {
            user_id: userId,
            ecclesiastical_year_id: ecclesiasticalYearId,
            active: true,
            classes: { club_type_id: gmId },
          },
        });
        if (activeCount >= 2) {
          throw new ConflictException(
            'Ya tenés 2 inscripciones activas en Guías Mayores',
          );
        }
      }

      // 5. Duplicate check + create/reactivate
      const existing = await tx.enrollments.findUnique({
        where: {
          user_id_class_id_ecclesiastical_year_id: {
            user_id: userId,
            class_id: classId,
            ecclesiastical_year_id: ecclesiasticalYearId,
          },
        },
      });

      if (existing) {
        if (existing.active) {
          throw new ConflictException(
            'El usuario ya tiene una inscripción activa para esta clase en el año eclesiástico indicado',
          );
        }

        return tx.enrollments.update({
          where: { enrollment_id: existing.enrollment_id },
          data: { active: true },
          include: {
            classes: { select: { name: true } },
            ecclesiastical_year: { select: { start_date: true, end_date: true } },
          },
        });
      }

      return tx.enrollments.create({
        data: {
          user_id: userId,
          class_id: classId,
          ecclesiastical_year_id: ecclesiasticalYearId,
          enrollment_date: new Date(),
        },
        include: {
          classes: { select: { name: true } },
          ecclesiastical_year: { select: { start_date: true, end_date: true } },
        },
      });
    });
  }

  async getUserEnrollments(userId: string, ecclesiasticalYearId?: number) {
    return this.prisma.enrollments.findMany({
      where: {
        user_id: userId,
        ...(ecclesiasticalYearId && {
          ecclesiastical_year_id: ecclesiasticalYearId,
        }),
      },
      include: {
        classes: {
          select: {
            class_id: true,
            name: true,
            description: true,
            club_types: { select: { name: true } },
          },
        },
        ecclesiastical_year: { select: { start_date: true, end_date: true } },
      },
      orderBy: { enrollment_date: 'desc' },
    });
  }

  // ========================================
  // PROGRESS
  // ========================================

  async getUserProgress(
    userId: string,
    classId: number,
    enrollmentId?: number,
  ) {
    const resolvedEnrollment = await this.resolveProgressEnrollment({
      userId,
      classId,
      enrollmentId,
    });

    // Get all sections for this class
    const classData = await this.findOne(classId);

    // Get user's section progress
    const sectionProgress = await this.prisma.class_section_progress.findMany({
      where: {
        enrollment_id: resolvedEnrollment.enrollmentId,
        active: true,
      },
    });

    // Calculate completion
    let totalSections = 0;
    let completedSections = 0;

    const modulesProgress = classData.class_modules.map((module) => {
      const sectionsInModule = module.class_sections.length;
      totalSections += sectionsInModule;

      const completedInModule = sectionProgress.filter(
        (sp) => sp.module_id === module.module_id && sp.score >= 70,
      ).length;
      completedSections += completedInModule;

      return {
        module_id: module.module_id,
        module_name: module.name,
        total_sections: sectionsInModule,
        completed_sections: completedInModule,
        progress_percentage:
          sectionsInModule > 0
            ? Math.round((completedInModule / sectionsInModule) * 100)
            : 0,
        sections: module.class_sections.map((section) => {
          const progress = sectionProgress.find(
            (sp) => sp.section_id === section.section_id,
          );
          return {
            section_id: section.section_id,
            section_name: section.name,
            completed: progress ? progress.score >= 70 : false,
            score: progress?.score || 0,
            evidences: progress?.evidences || null,
          };
        }),
      };
    });

    return {
      enrollment_id: resolvedEnrollment.enrollmentId,
      ecclesiastical_year_id: resolvedEnrollment.ecclesiasticalYearId,
      class_id: classId,
      class_name: classData.name,
      total_sections: totalSections,
      completed_sections: completedSections,
      overall_progress:
        totalSections > 0
          ? Math.round((completedSections / totalSections) * 100)
          : 0,
      modules: modulesProgress,
    };
  }

  async updateSectionProgress(
    userId: string,
    classId: number,
    moduleId: number,
    sectionId: number,
    score: number,
    evidences?: Record<string, unknown>,
    enrollmentId?: number,
  ) {
    const resolvedEnrollment = await this.resolveProgressEnrollment({
      userId,
      classId,
      enrollmentId,
    });

    return this.prisma.$transaction(async (tx) => {
      const existingSection = await tx.class_section_progress.findFirst({
        where: {
          enrollment_id: resolvedEnrollment.enrollmentId,
          module_id: moduleId,
          section_id: sectionId,
        },
      });

      const serializedEvidences = evidences
        ? (evidences as Prisma.InputJsonValue)
        : Prisma.JsonNull;

      const sectionProgress = existingSection
        ? await tx.class_section_progress.update({
            where: {
              section_progress_id: existingSection.section_progress_id,
            },
            data: {
              score,
              evidences: serializedEvidences,
              active: true,
              modified_at: new Date(),
            },
          })
        : await tx.class_section_progress.create({
            data: {
              user_id: userId,
              class_id: classId,
              enrollment_id: resolvedEnrollment.enrollmentId,
              module_id: moduleId,
              section_id: sectionId,
              score,
              evidences: serializedEvidences,
              active: true,
            },
          });

      const moduleSections = await tx.class_section_progress.findMany({
        where: {
          enrollment_id: resolvedEnrollment.enrollmentId,
          module_id: moduleId,
          active: true,
        },
        select: {
          score: true,
        },
      });

      const moduleScore =
        moduleSections.length > 0
          ? Math.round(
              moduleSections.reduce((sum, item) => sum + item.score, 0) /
                moduleSections.length,
            )
          : 0;

      const existingModule = await tx.class_module_progress.findFirst({
        where: {
          enrollment_id: resolvedEnrollment.enrollmentId,
          module_id: moduleId,
        },
      });

      if (existingModule) {
        await tx.class_module_progress.update({
          where: {
            module_progress_id: existingModule.module_progress_id,
          },
          data: {
            score: moduleScore,
            active: true,
            modified_at: new Date(),
          },
        });
      } else {
        await tx.class_module_progress.create({
          data: {
            user_id: userId,
            class_id: classId,
            enrollment_id: resolvedEnrollment.enrollmentId,
            module_id: moduleId,
            score: moduleScore,
            active: true,
          },
        });
      }

      return {
        ...sectionProgress,
        enrollment_id: resolvedEnrollment.enrollmentId,
      };
    });
  }

  // ========================================
  // CLASS SECTION FILE EVIDENCE
  // ========================================

  async uploadSectionFile(
    userId: string,
    classId: number,
    sectionProgressId: number,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('File is required');
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Allowed: PDF, JPG, PNG, WEBP',
      );
    }

    // Validate that the section_progress_id belongs to userId and classId
    const sectionProgress = await this.prisma.class_section_progress.findFirst({
      where: {
        section_progress_id: sectionProgressId,
        user_id: userId,
        class_id: classId,
        active: true,
      },
    });

    if (!sectionProgress) {
      throw new NotFoundException(
        `Section progress ${sectionProgressId} not found for user ${userId} in class ${classId}`,
      );
    }

    const extension = this.resolveFileExtension(file);
    const objectKey = `${sectionProgressId}-${Date.now()}.${extension}`;

    const uploaded = await this.fileStorage.upload(
      StorageBucketAlias.CLASS_EVIDENCE,
      objectKey,
      file.buffer,
      { contentType: file.mimetype },
    );

    const created = await (this.prisma as any).evidence_files.create({
      data: {
        section_progress_id: sectionProgressId,
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

  async deleteSectionFile(
    userId: string,
    classId: number,
    sectionProgressId: number,
    fileId: number,
  ) {
    const fileRecord = await (this.prisma as any).evidence_files.findFirst({
      where: {
        evidence_file_id: fileId,
        section_progress_id: sectionProgressId,
        active: true,
      },
      include: {
        class_section_progress: {
          select: {
            user_id: true,
            class_id: true,
            active: true,
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
      !fileRecord.class_section_progress ||
      fileRecord.class_section_progress.user_id !== userId ||
      fileRecord.class_section_progress.class_id !== classId
    ) {
      throw new NotFoundException('Evidence file not found');
    }

    const r2Key = this.fileStorage.extractKeyFromPublicUrl(
      StorageBucketAlias.CLASS_EVIDENCE,
      fileRecord.file_url,
    );

    if (r2Key) {
      try {
        await this.fileStorage.deleteMany(StorageBucketAlias.CLASS_EVIDENCE, [
          r2Key,
        ]);
      } catch {
        // Best-effort delete from R2; soft-delete in DB is the source of truth.
      }
    }

    const updated = await (this.prisma as any).evidence_files.update({
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

  private mapEvidenceFile(file: {
    evidence_file_id: number;
    file_url: string;
    file_name: string;
    file_type: string;
    uploaded_at: Date;
    uploaded_by?: {
      name?: string | null;
      paternal_last_name?: string | null;
      maternal_last_name?: string | null;
    } | null;
  }) {
    return {
      id: String(file.evidence_file_id),
      file_id: file.evidence_file_id,
      url: file.file_url,
      file_url: file.file_url,
      file_name: file.file_name,
      file_type: file.file_type,
      uploaded_by_name: this.formatUserName(file.uploaded_by ?? null),
      uploaded_at: file.uploaded_at.toISOString(),
    };
  }

  private formatUserName(
    user?: {
      name?: string | null;
      paternal_last_name?: string | null;
      maternal_last_name?: string | null;
    } | null,
  ) {
    if (!user) return null;
    const parts = [user.name, user.paternal_last_name, user.maternal_last_name]
      .map((p) => p?.trim())
      .filter((p): p is string => Boolean(p));
    return parts.join(' ').trim() || null;
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
