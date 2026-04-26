import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import { UpdateSectionRecordDto } from './dto/update-section-record.dto';
import { TranslationService } from '../common/services/translation.service';

@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly translationService: TranslationService,
  ) {}

  // ========================================
  // FOLDER TEMPLATES
  // ========================================

  /**
   * Listar todos los templates de carpetas activos
   */
  async findAll(
    clubTypeId?: number,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<any>> {
    const locale = this.translationService.getCurrentLocale();
    const where = {
      active: true,
      ...(clubTypeId && { club_type: clubTypeId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.folders.findMany({
        where,
        select: {
          folder_id: true,
          name: true,
          description: true,
          club_type: true,
          ecclesiastical_year_id: true,
          max_points: true,
          minimum_points: true,
          active: true,
          translations: {
            where: { locale },
            select: { locale: true, name: true, description: true },
          },
          _count: {
            select: {
              folders_modules: true,
            },
          },
        },
        orderBy: { folder_id: 'asc' },
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 50,
      }),
      this.prisma.folders.count({ where }),
    ]);

    const translated = this.translationService.translateMany(
      data,
      locale,
      ['name', 'description'],
      'translations',
    );

    const transformedData = translated.map((folder) => ({
      ...folder,
      modules_count: (folder as any)._count?.folders_modules,
      _count: undefined,
    }));

    return createPaginatedResult(
      transformedData,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  /**
   * Obtener detalles de un template de carpeta con módulos y secciones
   */
  async findOne(folderId: number) {
    const locale = this.translationService.getCurrentLocale();
    const folder = await this.prisma.folders.findUnique({
      where: { folder_id: folderId },
      include: {
        translations: {
          where: { locale },
          select: { locale: true, name: true, description: true },
        },
        folders_modules: {
          include: {
            translations: {
              where: { locale },
              select: { locale: true, name: true, description: true },
            },
            folders_sections: {
              include: {
                translations: {
                  where: { locale },
                  select: { locale: true, name: true, description: true },
                },
              },
              orderBy: { folder_section_id: 'asc' },
            },
          },
          orderBy: { folder_module_id: 'asc' },
        },
      },
    });

    if (!folder) {
      throw new AppNotFoundException(ErrorCode.FOLDER_NOT_FOUND);
    }

    // Translate folder
    const translatedFolder = this.translationService.translateMany(
      [folder],
      locale,
      ['name', 'description'],
      'translations',
    )[0];

    // Translate modules and their sections
    const translatedModules = this.translationService.translateMany(
      translatedFolder.folders_modules,
      locale,
      ['name', 'description'],
      'translations',
    ).map((module) => {
      const translatedSections = this.translationService.translateMany(
        (module as any).folders_sections ?? [],
        locale,
        ['name', 'description'],
        'translations',
      );
      return { ...module, folders_sections: translatedSections };
    });

    return {
      folder_id: translatedFolder.folder_id,
      name: translatedFolder.name,
      description: translatedFolder.description,
      club_type: translatedFolder.club_type,
      ecclesiastical_year_id: translatedFolder.ecclesiastical_year_id,
      max_points: translatedFolder.max_points,
      minimum_points: translatedFolder.minimum_points,
      active: translatedFolder.active,
      modules: translatedModules.map((module: any) => ({
        module_id: module.folder_module_id,
        name: module.name,
        description: module.description,
        max_points: module.max_points,
        minimum_points: module.minimum_points,
        sections: module.folders_sections.map((section: any) => ({
          section_id: section.folder_section_id,
          name: section.name,
          description: section.description,
          max_points: section.max_points,
          minimum_points: section.minimum_points,
        })),
      })),
    };
  }

  // ========================================
  // FOLDER ASSIGNMENTS
  // ========================================

  /**
   * Inscribir un usuario en una carpeta
   */
  async enrollUser(userId: string, folderId: number) {
    // 1. Verificar que la carpeta existe y está activa
    const folder = await this.prisma.folders.findUnique({
      where: { folder_id: folderId },
    });

    if (!folder || !folder.active) {
      throw new AppNotFoundException(ErrorCode.FOLDER_NOT_FOUND);
    }

    // 2. Verificar si ya está inscrito
    const existingAssignment = await this.prisma.folder_assignments.findFirst({
      where: {
        user_id: userId,
        folder_id: folderId,
        active: true,
      },
    });

    if (existingAssignment) {
      throw new AppConflictException(ErrorCode.FOLDER_ALREADY_ENROLLED);
    }

    // 3. Obtener sección de club del usuario según el tipo de club
    const clubSectionId = await this.getUserClubSectionId(
      userId,
      folder.club_type,
    );

    // Validar que el usuario pertenece a un club del tipo requerido
    if (!clubSectionId) {
      throw new AppBadRequestException(ErrorCode.FOLDER_USER_NO_CLUB_TYPE);
    }

    // 4. Crear assignment
    const assignment = await this.prisma.folder_assignments.create({
      data: {
        folder_id: folderId,
        user_id: userId,
        club_section_id: clubSectionId,
        assignment_date: new Date(),
        status: 'IN_PROGRESS',
        total_points: 0,
        progress_percentage: 0,
        active: true,
      },
    });

    return assignment;
  }

  /**
   * Obtener sección de club del usuario para un tipo de club específico
   */
  private async getUserClubSectionId(
    userId: string,
    clubType: number | null,
  ): Promise<number | null> {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      include: {
        club_role_assignments: {
          where: { active: true },
          include: {
            club_sections: {
              select: { club_section_id: true, club_type_id: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.FOLDER_USER_NOT_FOUND);
    }

    // Find a club_role_assignment that has a club_section matching the folder's club_type
    for (const assignment of user.club_role_assignments) {
      if (
        assignment.club_sections &&
        assignment.club_sections.club_type_id === clubType
      ) {
        return assignment.club_sections.club_section_id;
      }
    }

    return null;
  }

  /**
   * Listar carpetas asignadas a un usuario
   */
  async getUserFolders(userId: string) {
    const assignments = await this.prisma.folder_assignments.findMany({
      where: {
        user_id: userId,
        active: true,
      },
      include: {
        folders: {
          select: {
            name: true,
            description: true,
            max_points: true,
            minimum_points: true,
          },
        },
      },
      orderBy: { assignment_date: 'desc' },
    });

    return assignments.map((assignment) => ({
      assignment_id: assignment.folder_assignment_id,
      folder_id: assignment.folder_id,
      folder: {
        name: assignment.folders?.name,
        description: assignment.folders?.description,
        max_points: assignment.folders?.max_points,
        minimum_points: assignment.folders?.minimum_points,
      },
      status: assignment.status,
      total_points: assignment.total_points,
      progress_percentage: assignment.progress_percentage,
      assigned_date: assignment.assignment_date,
      completion_date: assignment.completion_date,
      active: assignment.active,
    }));
  }

  /**
   * Ver progreso detallado de una carpeta
   */
  async getFolderProgress(userId: string, folderId: number) {
    // Verificar que el usuario está inscrito
    const assignment = await this.prisma.folder_assignments.findFirst({
      where: {
        user_id: userId,
        folder_id: folderId,
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

    if (!assignment) {
      throw new AppNotFoundException(ErrorCode.FOLDER_ASSIGNMENT_NOT_FOUND);
    }

    // Obtener registros de módulos (por club section)
    const moduleRecords = await this.prisma.folders_modules_records.findMany({
      where: {
        folder_id: folderId,
        club_section_id: assignment.club_section_id,
      },
    });

    // Obtener registros de secciones (por club section)
    const sectionRecords = await this.prisma.folders_section_records.findMany({
      where: {
        folder_id: folderId,
        club_section_id: assignment.club_section_id,
      },
    });

    // Construir respuesta detallada
    const modules =
      assignment.folders?.folders_modules.map((module) => {
        const moduleRecord = moduleRecords.find(
          (mr) => mr.module_id === module.folder_module_id,
        );

        const sections = module.folders_sections.map((section) => {
          const sectionRecord = sectionRecords.find(
            (sr) => sr.section_id === section.folder_section_id,
          );

          return {
            section_id: section.folder_section_id,
            name: section.name,
            max_points: section.max_points,
            earned_points: sectionRecord?.points ?? 0,
            evidences: sectionRecord?.evidences ?? null,
          };
        });

        const earnedPoints = sections.reduce(
          (sum, s) => sum + (s.earned_points ?? 0),
          0,
        );
        const maxPoints = module.max_points ?? 0;
        const progressPercentage =
          maxPoints > 0 ? (earnedPoints / maxPoints) * 100 : 0;

        return {
          module_id: module.folder_module_id,
          name: module.name,
          max_points: module.max_points,
          earned_points: earnedPoints,
          progress_percentage: Math.round(progressPercentage * 10) / 10,
          sections,
        };
      }) ?? [];

    return {
      folder_id: assignment.folder_id,
      folder_name: assignment.folders?.name,
      status: assignment.status,
      progress_percentage: assignment.progress_percentage,
      total_points: assignment.total_points,
      max_points: assignment.folders?.max_points,
      minimum_points: assignment.folders?.minimum_points,
      assigned_date: assignment.assignment_date,
      completion_date: assignment.completion_date,
      modules,
    };
  }

  /**
   * Actualizar progreso de una sección
   */
  async updateSectionProgress(
    userId: string,
    folderId: number,
    moduleId: number,
    sectionId: number,
    dto: UpdateSectionRecordDto,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Verificar que el usuario está inscrito
      const assignment = await tx.folder_assignments.findFirst({
        where: {
          user_id: userId,
          folder_id: folderId,
          active: true,
        },
        include: {
          folders: true,
        },
      });

      if (!assignment) {
        throw new AppNotFoundException(ErrorCode.FOLDER_ASSIGNMENT_NOT_FOUND);
      }

      // 2. Validar que la sección pertenece al módulo y carpeta
      const section = await tx.folders_sections.findFirst({
        where: {
          folder_section_id: sectionId,
          module_id: moduleId,
          folders_modules: {
            folder_id: folderId,
          },
        },
      });

      if (!section) {
        throw new AppBadRequestException(ErrorCode.FOLDER_SECTION_INVALID);
      }

      // 3. Validar que los puntos no excedan el máximo de la sección
      const sectionMaxPoints = section.max_points ?? 0;
      if (dto.points > sectionMaxPoints) {
        throw new AppBadRequestException(ErrorCode.FOLDER_POINTS_EXCEED_MAX);
      }

      // 4. Buscar o crear registro de sección (por club section)
      const existingRecord = await tx.folders_section_records.findFirst({
        where: {
          folder_id: folderId,
          section_id: sectionId,
          club_section_id: assignment.club_section_id,
        },
      });

      let sectionRecord;
      if (existingRecord) {
        sectionRecord = await tx.folders_section_records.update({
          where: {
            folder_section_record_id: existingRecord.folder_section_record_id,
          },
          data: {
            points: dto.points,
            evidences: dto.evidences,
          },
        });
      } else {
        sectionRecord = await tx.folders_section_records.create({
          data: {
            folder_id: folderId,
            module_id: moduleId,
            section_id: sectionId,
            points: dto.points,
            evidences: dto.evidences,
            club_section_id: assignment.club_section_id,
          },
        });
      }

      // 5. Calcular puntos del módulo
      const allSectionsInModule = await tx.folders_sections.findMany({
        where: { module_id: moduleId },
      });

      const moduleSectionRecords = await tx.folders_section_records.findMany({
        where: {
          folder_id: folderId,
          module_id: moduleId,
          club_section_id: assignment.club_section_id,
        },
      });

      const modulePoints = moduleSectionRecords.reduce(
        (sum, record) => sum + (record.points ?? 0),
        0,
      );

      // 6. Actualizar registro del módulo
      const existingModuleRecord = await tx.folders_modules_records.findFirst({
        where: {
          folder_id: folderId,
          module_id: moduleId,
          club_section_id: assignment.club_section_id,
        },
      });

      if (existingModuleRecord) {
        await tx.folders_modules_records.update({
          where: {
            folder_module_record_id:
              existingModuleRecord.folder_module_record_id,
          },
          data: { points: modulePoints },
        });
      } else {
        await tx.folders_modules_records.create({
          data: {
            folder_id: folderId,
            module_id: moduleId,
            points: modulePoints,
            club_section_id: assignment.club_section_id,
          },
        });
      }

      // 7. Calcular puntos totales de la carpeta
      const allFolderSectionRecords = await tx.folders_section_records.findMany(
        {
          where: {
            folder_id: folderId,
            club_section_id: assignment.club_section_id,
          },
        },
      );

      const totalPoints = allFolderSectionRecords.reduce(
        (sum, record) => sum + (record.points ?? 0),
        0,
      );

      const maxPoints = assignment.folders?.max_points ?? 0;
      const minimumPoints = assignment.folders?.minimum_points ?? 0;

      const progressPercentage =
        maxPoints > 0 ? (totalPoints / maxPoints) * 100 : 0;

      // 8. Actualizar estado de la carpeta
      const folderCompleted = totalPoints >= minimumPoints;

      await tx.folder_assignments.update({
        where: { folder_assignment_id: assignment.folder_assignment_id },
        data: {
          total_points: totalPoints,
          progress_percentage: Math.round(progressPercentage * 10) / 10,
          status: folderCompleted ? 'COMPLETED' : 'IN_PROGRESS',
          completion_date: folderCompleted ? new Date() : null,
        },
      });

      return {
        section_record_id: sectionRecord.folder_section_record_id,
        folder_id: folderId,
        module_id: moduleId,
        section_id: sectionId,
        points: sectionRecord.points,
        evidences: sectionRecord.evidences,
        folder_progress: {
          total_points: totalPoints,
          progress_percentage: Math.round(progressPercentage * 10) / 10,
          status: folderCompleted ? 'COMPLETED' : 'IN_PROGRESS',
        },
      };
    });
  }

  /**
   * Abandonar una carpeta (soft delete)
   */
  async deleteAssignment(userId: string, folderId: number) {
    const assignment = await this.prisma.folder_assignments.findFirst({
      where: {
        user_id: userId,
        folder_id: folderId,
        active: true,
      },
    });

    if (!assignment) {
      throw new AppNotFoundException(ErrorCode.FOLDER_ASSIGNMENT_NOT_FOUND);
    }

    await this.prisma.folder_assignments.update({
      where: { folder_assignment_id: assignment.folder_assignment_id },
      data: { active: false },
    });

    return {
      message: 'Folder assignment deleted successfully',
    };
  }
}
