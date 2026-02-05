import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import { UpdateSectionRecordDto } from './dto/update-section-record.dto';

@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

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

    const transformedData = data.map((folder) => ({
      ...folder,
      modules_count: folder._count.folders_modules,
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
    const folder = await this.prisma.folders.findUnique({
      where: { folder_id: folderId },
      include: {
        folders_modules: {
          include: {
            folders_sections: {
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!folder) {
      throw new NotFoundException(`Folder with ID ${folderId} not found`);
    }

    return {
      folder_id: folder.folder_id,
      name: folder.name,
      description: folder.description,
      club_type: folder.club_type,
      ecclesiastical_year_id: folder.ecclesiastical_year_id,
      max_points: folder.max_points,
      minimum_points: folder.minimum_points,
      active: folder.active,
      modules: folder.folders_modules.map((module) => ({
        module_id: module.module_id,
        name: module.name,
        description: module.description,
        order: module.order,
        max_points: module.max_points,
        sections: module.folders_sections.map((section) => ({
          section_id: section.section_id,
          name: section.name,
          description: section.description,
          order: section.order,
          points: section.points,
          required: section.required,
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
      throw new NotFoundException('Folder not found');
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
      throw new ConflictException(
        'User already has an active assignment for this folder',
      );
    }

    // 3. Obtener instancia de club del usuario según el tipo de club
    const clubInstances = await this.getUserClubInstances(userId);

    let clubAdvId = null;
    let clubPathfId = null;
    let clubMgId = null;

    if (folder.club_type === 1) {
      clubAdvId = clubInstances.adventurers;
    } else if (folder.club_type === 2) {
      clubPathfId = clubInstances.pathfinders;
    } else if (folder.club_type === 3) {
      clubMgId = clubInstances.masterGuilds;
    }

    // Validar que el usuario pertenece a un club del tipo requerido
    if (!clubAdvId && !clubPathfId && !clubMgId) {
      throw new BadRequestException(
        `User does not belong to a club of the required type`,
      );
    }

    // 4. Crear assignment
    const assignment = await this.prisma.folder_assignments.create({
      data: {
        folder_id: folderId,
        user_id: userId,
        club_adv_id: clubAdvId,
        club_pathf_id: clubPathfId,
        club_mg_id: clubMgId,
        assigned_date: new Date(),
        status: 'IN_PROGRESS',
        total_points: 0,
        progress_percentage: 0,
        active: true,
      },
    });

    return assignment;
  }

  /**
   * Obtener instancias de club del usuario
   */
  private async getUserClubInstances(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        club_adv_id: true,
        club_pathf_id: true,
        club_mg_id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      adventurers: user.club_adv_id,
      pathfinders: user.club_pathf_id,
      masterGuilds: user.club_mg_id,
    };
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
      orderBy: { assigned_date: 'desc' },
    });

    return assignments.map((assignment) => ({
      assignment_id: assignment.assignment_id,
      folder_id: assignment.folder_id,
      folder: {
        name: assignment.folders.name,
        description: assignment.folders.description,
        max_points: assignment.folders.max_points,
        minimum_points: assignment.folders.minimum_points,
      },
      status: assignment.status,
      total_points: assignment.total_points,
      progress_percentage: assignment.progress_percentage,
      assigned_date: assignment.assigned_date,
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
                  orderBy: { order: 'asc' },
                },
              },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Folder assignment not found');
    }

    // Obtener registros de módulos
    const moduleRecords = await this.prisma.folders_modules_records.findMany({
      where: {
        user_id: userId,
        module_id: {
          in: assignment.folders.folders_modules.map((m) => m.module_id),
        },
      },
    });

    // Obtener registros de secciones
    const sectionIds = assignment.folders.folders_modules.flatMap((m) =>
      m.folders_sections.map((s) => s.section_id),
    );

    const sectionRecords = await this.prisma.folders_section_records.findMany({
      where: {
        user_id: userId,
        section_id: { in: sectionIds },
      },
    });

    // Construir respuesta detallada
    const modules = assignment.folders.folders_modules.map((module) => {
      const moduleRecord = moduleRecords.find(
        (mr) => mr.module_id === module.module_id,
      );

      const sections = module.folders_sections.map((section) => {
        const sectionRecord = sectionRecords.find(
          (sr) => sr.section_id === section.section_id,
        );

        return {
          section_id: section.section_id,
          name: section.name,
          points: section.points,
          earned_points: sectionRecord?.points ?? 0,
          completed: sectionRecord?.completed ?? false,
          completion_date: sectionRecord?.completion_date ?? null,
          evidences: sectionRecord?.evidences ?? null,
        };
      });

      const earnedPoints = sections.reduce(
        (sum, s) => sum + (s.earned_points ?? 0),
        0,
      );
      const progressPercentage =
        module.max_points > 0 ? (earnedPoints / module.max_points) * 100 : 0;

      return {
        module_id: module.module_id,
        name: module.name,
        max_points: module.max_points,
        earned_points: earnedPoints,
        progress_percentage: Math.round(progressPercentage * 10) / 10,
        completed: moduleRecord?.completed ?? false,
        sections,
      };
    });

    return {
      folder_id: assignment.folder_id,
      folder_name: assignment.folders.name,
      status: assignment.status,
      progress_percentage: assignment.progress_percentage,
      total_points: assignment.total_points,
      max_points: assignment.folders.max_points,
      minimum_points: assignment.folders.minimum_points,
      assigned_date: assignment.assigned_date,
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
        throw new NotFoundException('Folder assignment not found');
      }

      // 2. Validar que la sección pertenece al módulo y carpeta
      const section = await tx.folders_sections.findFirst({
        where: {
          section_id: sectionId,
          module_id: moduleId,
          folders_modules: {
            folder_id: folderId,
          },
        },
      });

      if (!section) {
        throw new BadRequestException(
          'Invalid module or section for this folder',
        );
      }

      // 3. Validar que los puntos no excedan el máximo de la sección
      if (dto.points > section.points) {
        throw new BadRequestException('Points exceed section maximum');
      }

      // 4. Crear o actualizar registro de sección
      const sectionRecord = await tx.folders_section_records.upsert({
        where: {
          user_id_section_id: {
            user_id: userId,
            section_id: sectionId,
          },
        },
        create: {
          user_id: userId,
          section_id: sectionId,
          points: dto.points,
          completed: dto.points === section.points,
          completion_date:
            dto.points === section.points ? new Date() : null,
          evidences: dto.evidences,
        },
        update: {
          points: dto.points,
          completed: dto.points === section.points,
          completion_date:
            dto.points === section.points ? new Date() : null,
          evidences: dto.evidences,
        },
      });

      // 5. Verificar si el módulo está completo
      const allSectionsInModule = await tx.folders_sections.findMany({
        where: { module_id: moduleId },
      });

      const completedSectionsCount = await tx.folders_section_records.count({
        where: {
          user_id: userId,
          section_id: { in: allSectionsInModule.map((s) => s.section_id) },
          completed: true,
        },
      });

      const moduleCompleted =
        completedSectionsCount === allSectionsInModule.length;

      // 6. Calcular puntos del módulo
      const moduleSectionRecords = await tx.folders_section_records.findMany({
        where: {
          user_id: userId,
          section_id: { in: allSectionsInModule.map((s) => s.section_id) },
        },
      });

      const modulePoints = moduleSectionRecords.reduce(
        (sum, record) => sum + (record.points ?? 0),
        0,
      );

      // 7. Actualizar registro del módulo
      await tx.folders_modules_records.upsert({
        where: {
          user_id_module_id: {
            user_id: userId,
            module_id: moduleId,
          },
        },
        create: {
          user_id: userId,
          module_id: moduleId,
          points: modulePoints,
          completed: moduleCompleted,
          completion_date: moduleCompleted ? new Date() : null,
        },
        update: {
          points: modulePoints,
          completed: moduleCompleted,
          completion_date: moduleCompleted ? new Date() : null,
        },
      });

      // 8. Calcular puntos totales de la carpeta
      const allModulesInFolder = await tx.folders_modules.findMany({
        where: { folder_id: folderId },
      });

      const allFolderSections = await tx.folders_sections.findMany({
        where: {
          module_id: { in: allModulesInFolder.map((m) => m.module_id) },
        },
      });

      const allFolderSectionRecords = await tx.folders_section_records.findMany(
        {
          where: {
            user_id: userId,
            section_id: { in: allFolderSections.map((s) => s.section_id) },
          },
        },
      );

      const totalPoints = allFolderSectionRecords.reduce(
        (sum, record) => sum + (record.points ?? 0),
        0,
      );

      const progressPercentage =
        assignment.folders.max_points > 0
          ? (totalPoints / assignment.folders.max_points) * 100
          : 0;

      // 9. Actualizar estado de la carpeta
      const folderCompleted = totalPoints >= assignment.folders.minimum_points;

      await tx.folder_assignments.update({
        where: { assignment_id: assignment.assignment_id },
        data: {
          total_points: totalPoints,
          progress_percentage: Math.round(progressPercentage * 10) / 10,
          status: folderCompleted ? 'COMPLETED' : 'IN_PROGRESS',
          completion_date: folderCompleted ? new Date() : null,
        },
      });

      return {
        section_record_id: sectionRecord.section_record_id,
        folder_id: folderId,
        module_id: moduleId,
        section_id: sectionId,
        user_id: userId,
        points: sectionRecord.points,
        completed: sectionRecord.completed,
        completion_date: sectionRecord.completion_date,
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
      throw new NotFoundException('Folder assignment not found');
    }

    await this.prisma.folder_assignments.update({
      where: { assignment_id: assignment.assignment_id },
      data: { active: false },
    });

    return {
      message: 'Folder assignment deleted successfully',
    };
  }
}
