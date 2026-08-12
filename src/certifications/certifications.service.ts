import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import { EnrollCertificationDto } from './dto/enroll-certification.dto';
import { UpdateCertificationProgressDto } from './dto/update-progress.dto';
import {
  AppBadRequestException,
  AppConflictException,
  AppException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { CertificationEligibilityService } from './eligibility/certification-eligibility.service';

@Injectable()
export class CertificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibilityService: CertificationEligibilityService,
  ) {}

  // ========================================
  // CERTIFICATIONS
  // ========================================

  /**
   * Listar todas las certificaciones activas con paginación
   */
  async findAll(pagination?: PaginationDto): Promise<PaginatedResult<any>> {
    const where = { active: true };

    const [certifications, total] = await Promise.all([
      this.prisma.certifications.findMany({
        where,
        include: {
          _count: {
            select: {
              certification_modules: true,
            },
          },
        },
        orderBy: { certification_id: 'asc' },
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 50,
      }),
      this.prisma.certifications.count({ where }),
    ]);

    // Transformar _count a modules_count
    const data = certifications.map((cert) => ({
      certification_id: cert.certification_id,
      name: cert.name,
      description: cert.description,
      active: cert.active,
      modules_count: cert._count.certification_modules,
    }));

    return createPaginatedResult(
      data,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  /**
   * Obtener detalles de una certificación con sus módulos y secciones
   */
  async findOne(certificationId: number) {
    const certification = await this.prisma.certifications.findUnique({
      where: { certification_id: certificationId },
      include: {
        certification_modules: {
          include: {
            certification_sections: {
              orderBy: { section_id: 'asc' },
            },
          },
          orderBy: { module_id: 'asc' },
        },
      },
    });

    if (!certification) {
      throw new AppNotFoundException(ErrorCode.CERT_NOT_FOUND);
    }

    // Transformar a formato del walkthrough
    return {
      certification_id: certification.certification_id,
      name: certification.name,
      description: certification.description,
      active: certification.active,
      modules: certification.certification_modules.map((module) => ({
        module_id: module.module_id,
        name: module.name,
        description: module.description,
        sections: module.certification_sections.map((section) => ({
          section_id: section.section_id,
          name: section.name,
          description: section.description,
        })),
      })),
    };
  }

  // ========================================
  // ENROLLMENTS
  // ========================================

  /**
   * Inscribir un usuario en una certificación.
   *
   * Elegibilidad configurable: se evalúan las reglas de la versión PUBLISHED
   * (certification_eligibility_rules) vía CertificationEligibilityService en
   * lugar del check de texto legado ("Guía Mayor" por nombre).
   */
  async enrollUser(userId: string, dto: EnrollCertificationDto) {
    // 1. Verificar que la certificación existe y está activa
    const certification = await this.prisma.certifications.findUnique({
      where: { certification_id: dto.certification_id },
    });

    if (!certification || !certification.active) {
      throw new AppNotFoundException(ErrorCode.CERT_NOT_FOUND);
    }

    // 2. Verificar si ya está inscrito
    const existingEnrollment = await this.prisma.users_certifications.findFirst(
      {
        where: {
          user_id: userId,
          certification_id: dto.certification_id,
          active: true,
        },
      },
    );

    if (existingEnrollment) {
      throw new AppConflictException(ErrorCode.CERT_ALREADY_ENROLLED);
    }

    // 3. Bind the currently published version (engine expansion)
    const publishedVersion =
      await this.prisma.certification_versions.findFirst({
        where: {
          certification_id: dto.certification_id,
          status: 'PUBLISHED',
          active: true,
        },
        orderBy: { version_number: 'desc' },
      });

    if (!publishedVersion) {
      throw new AppBadRequestException(ErrorCode.CERT_VERSION_NOT_PUBLISHED);
    }

    // 4. Evaluar elegibilidad configurable contra las reglas de esa versión
    const eligibility = await this.eligibilityService.evaluateForVersion(
      userId,
      publishedVersion.certification_version_id,
    );

    if (!eligibility.eligible) {
      throw new AppForbiddenException(ErrorCode.CERT_ELIGIBILITY_REQUIRED, {
        rules: eligibility.rules,
        reason_code: eligibility.reason_code,
      });
    }

    // 5. Crear enrollment (con defensa ante race condition en creación concurrente)
    let enrollment;
    try {
      enrollment = await this.prisma.users_certifications.create({
        data: {
          user_id: userId,
          certification_id: dto.certification_id,
          certification_version_id: publishedVersion.certification_version_id,
          enrollment_date: new Date(),
          status: 'ENROLLED',
          completion_status: false,
          active: true,
        },
        include: {
          certifications: {
            select: {
              name: true,
            },
          },
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new AppConflictException(ErrorCode.CERT_ALREADY_ENROLLED);
      }
      throw error;
    }

    return {
      enrollment_id: enrollment.enrollment_id,
      user_id: enrollment.user_id,
      certification_id: enrollment.certification_id,
      certification_version_id: enrollment.certification_version_id,
      enrollment_date: enrollment.enrollment_date,
      completion_status: enrollment.completion_status,
      completion_date: enrollment.completion_date,
      status: enrollment.status,
      active: enrollment.active,
      certification: {
        name: enrollment.certifications.name,
      },
    };
  }

  /**
   * Evaluar la elegibilidad configurable de un usuario para una certificación,
   * contra las reglas de la versión PUBLISHED vigente.
   */
  async getEligibility(userId: string, certificationId: number) {
    const certification = await this.prisma.certifications.findUnique({
      where: { certification_id: certificationId },
    });

    if (!certification || !certification.active) {
      throw new AppNotFoundException(ErrorCode.CERT_NOT_FOUND);
    }

    const result = await this.eligibilityService.evaluateForCertification(
      userId,
      certificationId,
    );

    if (!result) {
      throw new AppBadRequestException(ErrorCode.CERT_VERSION_NOT_PUBLISHED);
    }

    return result;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  /**
   * Listar certificaciones en las que está inscrito un usuario
   */
  async getUserCertifications(userId: string) {
    const enrollments = await this.prisma.users_certifications.findMany({
      where: {
        user_id: userId,
        active: true,
      },
      include: {
        certifications: {
          select: {
            name: true,
            certification_modules: {
              select: {
                module_id: true,
              },
            },
          },
        },
      },
      orderBy: { enrollment_date: 'desc' },
    });

    // Calcular progreso para cada enrollment
    return Promise.all(
      enrollments.map(async (enrollment) => {
        const modulesTotal =
          enrollment.certifications.certification_modules.length;

        // Contar módulos completados
        const completedModules =
          await this.prisma.certification_module_progress.count({
            where: {
              user_id: userId,
              module_id: {
                in: enrollment.certifications.certification_modules.map(
                  (m) => m.module_id,
                ),
              },
              completed: true,
            },
          });

        const progressPercentage =
          modulesTotal > 0 ? (completedModules / modulesTotal) * 100 : 0;

        return {
          enrollment_id: enrollment.enrollment_id,
          certification_id: enrollment.certification_id,
          certification: {
            name: enrollment.certifications.name,
          },
          enrollment_date: enrollment.enrollment_date,
          completion_status: enrollment.completion_status,
          progress_percentage: Math.round(progressPercentage * 10) / 10,
          modules_completed: completedModules,
          modules_total: modulesTotal,
          active: enrollment.active,
        };
      }),
    );
  }

  /**
   * Ver progreso detallado de una certificación específica
   */
  async getCertificationProgress(userId: string, certificationId: number) {
    // Verificar que el usuario está inscrito
    const enrollment = await this.prisma.users_certifications.findFirst({
      where: {
        user_id: userId,
        certification_id: certificationId,
        active: true,
      },
      include: {
        certifications: {
          select: {
            name: true,
            certification_modules: {
              include: {
                certification_sections: {
                  orderBy: { section_id: 'asc' },
                },
              },
              orderBy: { module_id: 'asc' },
            },
          },
        },
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.CERT_ENROLLMENT_NOT_FOUND);
    }

    // Obtener progreso de módulos
    const moduleProgress =
      await this.prisma.certification_module_progress.findMany({
        where: {
          user_id: userId,
          module_id: {
            in: enrollment.certifications.certification_modules.map(
              (m) => m.module_id,
            ),
          },
        },
      });

    // Obtener progreso de secciones
    const sectionIds = enrollment.certifications.certification_modules.flatMap(
      (m) => m.certification_sections.map((s) => s.section_id),
    );

    const sectionProgress =
      await this.prisma.certification_section_progress.findMany({
        where: {
          user_id: userId,
          section_id: { in: sectionIds },
        },
      });

    // Las inscripciones con versión (motor configurable) ya no marcan
    // secciones con el booleano legado `completed`; el estado real vive en
    // `certification_section_progress.status` (DRAFT/SUBMITTED/
    // CHANGES_REQUESTED/APPROVED), gestionado por el flujo de requisitos.
    const isVersionedEnrollment = Boolean(enrollment.certification_version_id);

    // Construir respuesta detallada
    const modules = enrollment.certifications.certification_modules.map(
      (module) => {
        const moduleProgressData = moduleProgress.find(
          (mp) => mp.module_id === module.module_id,
        );

        const sections = module.certification_sections.map((section) => {
          const sectionProgressData = sectionProgress.find(
            (sp) => sp.section_id === section.section_id,
          );

          return {
            section_id: section.section_id,
            name: section.name,
            completed: isVersionedEnrollment
              ? sectionProgressData?.status === 'APPROVED'
              : (sectionProgressData?.completed ?? false),
            completion_date: sectionProgressData?.completion_date ?? null,
          };
        });

        return {
          module_id: module.module_id,
          name: module.name,
          completed: moduleProgressData?.completed ?? false,
          completion_date: moduleProgressData?.completion_date ?? null,
          sections,
        };
      },
    );

    const modulesCompleted = modules.filter((m) => m.completed).length;
    const modulesTotal = modules.length;
    const progressPercentage =
      modulesTotal > 0 ? (modulesCompleted / modulesTotal) * 100 : 0;

    return {
      enrollment_id: enrollment.enrollment_id,
      certification_id: enrollment.certification_id,
      certification_name: enrollment.certifications.name,
      progress_percentage: Math.round(progressPercentage * 10) / 10,
      completion_status: enrollment.completion_status,
      enrollment_date: enrollment.enrollment_date,
      modules,
    };
  }

  /**
   * Actualizar progreso de una sección
   */
  async updateProgress(
    userId: string,
    certificationId: number,
    dto: UpdateCertificationProgressDto,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Verificar que el usuario está inscrito
      const enrollment = await tx.users_certifications.findFirst({
        where: {
          user_id: userId,
          certification_id: certificationId,
          active: true,
        },
      });

      if (!enrollment) {
        throw new AppNotFoundException(ErrorCode.CERT_ENROLLMENT_NOT_FOUND);
      }

      // 1b. Las inscripciones con versión (motor configurable) ya no usan este
      // endpoint legado; deben usar el flujo de requisitos por sección
      // (CertificationRequirementsService: draft/submit).
      if (enrollment.certification_version_id) {
        throw new AppException(
          ErrorCode.CERT_LEGACY_ENDPOINT_DEPRECATED,
          HttpStatus.GONE,
          { certification_version_id: enrollment.certification_version_id },
        );
      }

      // 2. Validar que la sección pertenece al módulo y certificación
      const section = await tx.certification_sections.findFirst({
        where: {
          section_id: dto.section_id,
          module_id: dto.module_id,
          certification_modules: {
            certification_id: certificationId,
          },
        },
      });

      if (!section) {
        throw new AppBadRequestException(ErrorCode.CERT_SECTION_INVALID);
      }

      // 3. Crear o actualizar registro de sección
      const sectionProgressExists =
        await tx.certification_section_progress.findFirst({
          where: {
            user_id: userId,
            section_id: dto.section_id,
          },
        });

      let sectionProgress;
      if (sectionProgressExists) {
        sectionProgress = await tx.certification_section_progress.update({
          where: { progress_id: sectionProgressExists.progress_id },
          data: {
            completed: dto.completed,
            completion_date: dto.completed ? new Date() : null,
          },
        });
      } else {
        sectionProgress = await tx.certification_section_progress.create({
          data: {
            user_id: userId,
            section_id: dto.section_id,
            module_id: dto.module_id,
            certification_id: certificationId,
            score: 0,
            completed: dto.completed,
            completion_date: dto.completed ? new Date() : null,
          },
        });
      }

      // 4. Verificar si el módulo está completo
      const allSectionsInModule = await tx.certification_sections.findMany({
        where: { module_id: dto.module_id },
      });

      const completedSectionsCount =
        await tx.certification_section_progress.count({
          where: {
            user_id: userId,
            section_id: { in: allSectionsInModule.map((s) => s.section_id) },
            completed: true,
          },
        });

      const moduleCompleted =
        completedSectionsCount === allSectionsInModule.length;

      // 5. Actualizar estado del módulo
      const moduleProgressExists =
        await tx.certification_module_progress.findFirst({
          where: {
            user_id: userId,
            module_id: dto.module_id,
          },
        });

      let moduleProgress;
      if (moduleProgressExists) {
        moduleProgress = await tx.certification_module_progress.update({
          where: { progress_id: moduleProgressExists.progress_id },
          data: {
            completed: moduleCompleted,
            completion_date: moduleCompleted ? new Date() : null,
          },
        });
      } else {
        moduleProgress = await tx.certification_module_progress.create({
          data: {
            user_id: userId,
            module_id: dto.module_id,
            certification_id: certificationId,
            score: 0,
            completed: moduleCompleted,
            completion_date: moduleCompleted ? new Date() : null,
          },
        });
      }

      // 6. Verificar si la certificación está completa
      const allModulesInCertification = await tx.certification_modules.findMany(
        {
          where: { certification_id: certificationId },
        },
      );

      const completedModulesCount =
        await tx.certification_module_progress.count({
          where: {
            user_id: userId,
            module_id: {
              in: allModulesInCertification.map((m) => m.module_id),
            },
            completed: true,
          },
        });

      const certificationCompleted =
        completedModulesCount === allModulesInCertification.length;

      // 7. Actualizar estado de la certificación si está completa
      if (certificationCompleted) {
        await tx.users_certifications.update({
          where: { enrollment_id: enrollment.enrollment_id },
          data: {
            completion_status: true,
            completion_date: new Date(),
          },
        });
      }

      // 8. Calcular porcentaje de progreso
      const progressPercentage =
        allModulesInCertification.length > 0
          ? (completedModulesCount / allModulesInCertification.length) * 100
          : 0;

      return {
        section_progress_id: sectionProgress.progress_id,
        module_id: dto.module_id,
        section_id: dto.section_id,
        completed: sectionProgress.completed,
        completion_date: sectionProgress.completion_date,
        module_progress: {
          module_id: moduleProgress.module_id,
          completed: moduleProgress.completed,
          completion_date: moduleProgress.completion_date,
        },
        certification_progress: {
          progress_percentage: Math.round(progressPercentage * 10) / 10,
          completion_status: certificationCompleted,
        },
      };
    });
  }

  /**
   * Abandonar una certificación (soft delete)
   */
  async deleteCertification(userId: string, certificationId: number) {
    const enrollment = await this.prisma.users_certifications.findFirst({
      where: {
        user_id: userId,
        certification_id: certificationId,
        active: true,
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.CERT_ENROLLMENT_NOT_FOUND);
    }

    await this.prisma.users_certifications.update({
      where: { enrollment_id: enrollment.enrollment_id },
      data: {
        active: false,
      },
    });

    return {
      message: 'Certification enrollment deleted successfully',
    };
  }
}
