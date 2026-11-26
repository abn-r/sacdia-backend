import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import { EnrollCertificationDto } from './dto/enroll-certification.dto';
import { ListCertificationEnrollmentsDto } from './dto/list-certification-enrollments.dto';
import { Prisma } from '@prisma/client';
import {
  accentInsensitiveMatchSql,
  searchTokens,
} from '../common/search/accent-insensitive';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { CertificationEligibilityService } from './eligibility/certification-eligibility.service';
import {
  assertEnrollmentAbandonable,
  ENROLLMENT_NOT_ABANDONABLE_STATUSES,
  transitionEnrollment,
} from './domain/certification-state-machine';

export type CertificationSectionsSummary = {
  total: number;
  approved: number;
  submitted: number;
  changes_requested: number;
  not_started_or_draft: number;
};

/**
 * Cuenta solo las secciones requeridas por estado de revisión. Una sección sin
 * fila de progreso cuenta como not_started_or_draft.
 */
function summarizeRequiredSections(
  sections: { section_id: number; required: boolean }[],
  statusBySection: Map<number, string> | undefined,
): CertificationSectionsSummary {
  const summary: CertificationSectionsSummary = {
    total: 0,
    approved: 0,
    submitted: 0,
    changes_requested: 0,
    not_started_or_draft: 0,
  };
  for (const section of sections) {
    if (!section.required) continue;
    summary.total += 1;
    switch (statusBySection?.get(section.section_id)) {
      case 'APPROVED':
        summary.approved += 1;
        break;
      case 'SUBMITTED':
        summary.submitted += 1;
        break;
      case 'CHANGES_REQUESTED':
        summary.changes_requested += 1;
        break;
      default:
        summary.not_started_or_draft += 1;
    }
  }
  return summary;
}

type VersionModule = {
  module_id: number;
  certification_sections: { section_id: number; required: boolean | null }[];
};

/**
 * Progreso de una inscripción con versión: secciones requeridas aprobadas /
 * secciones requeridas de su versión. Un módulo está completo cuando todas sus
 * secciones requeridas están aprobadas.
 */
function versionProgress(
  modules: VersionModule[],
  statusBySection: Map<number, string> | undefined,
) {
  let required = 0;
  let approved = 0;
  let modulesCompleted = 0;
  for (const module of modules) {
    const requiredSections = module.certification_sections.filter(
      (s) => s.required ?? true,
    );
    const approvedSections = requiredSections.filter(
      (s) => statusBySection?.get(s.section_id) === 'APPROVED',
    ).length;
    required += requiredSections.length;
    approved += approvedSections;
    if (approvedSections === requiredSections.length) modulesCompleted += 1;
  }
  return {
    progress_percentage:
      required > 0 ? Math.round((approved / required) * 1000) / 10 : 0,
    modules_completed: modulesCompleted,
    modules_total: modules.length,
  };
}

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

    // 2. Verificar si ya está inscrito. Además de la inscripción activa, se
    // rechaza cualquier fila histórica (aunque esté inactiva) en estado
    // CERTIFIED / APPROVED / SUBMITTED_FOR_FINAL_REVIEW: son abandonos previos
    // al guard de deleteCertification y no deben permitir reinscribirse sobre
    // una certificación otorgada o en revisión final. Filas inactivas
    // WITHDRAWN / EXPIRED sí permiten reinscripción.
    const existingEnrollment = await this.prisma.users_certifications.findFirst(
      {
        where: {
          user_id: userId,
          certification_id: dto.certification_id,
          OR: [
            { active: true },
            { status: { in: [...ENROLLMENT_NOT_ABANDONABLE_STATUSES] } },
          ],
        },
      },
    );

    if (existingEnrollment) {
      throw new AppConflictException(ErrorCode.CERT_ALREADY_ENROLLED);
    }

    // 3. Bind the currently published version (engine expansion)
    const publishedVersion = await this.prisma.certification_versions.findFirst(
      {
        where: {
          certification_id: dto.certification_id,
          status: 'PUBLISHED',
          active: true,
        },
        orderBy: { version_number: 'desc' },
      },
    );

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
        certifications: { select: { name: true } },
      },
      orderBy: { enrollment_date: 'desc' },
    });
    if (enrollments.length === 0) return [];

    // Árbol de cada versión y estado de secciones de todas las inscripciones,
    // en dos consultas (sin N+1).
    const versionIds = [
      ...new Set(enrollments.map((e) => e.certification_version_id)),
    ];
    const [versionModules, progressRows] = await Promise.all([
      this.prisma.certification_modules.findMany({
        where: { certification_version_id: { in: versionIds }, active: true },
        select: {
          module_id: true,
          certification_version_id: true,
          certification_sections: {
            where: { active: true },
            select: { section_id: true, required: true },
          },
        },
      }),
      this.prisma.certification_section_progress.findMany({
        where: {
          enrollment_id: { in: enrollments.map((e) => e.enrollment_id) },
        },
        select: { enrollment_id: true, section_id: true, status: true },
      }),
    ]);

    const modulesByVersion = new Map<number, VersionModule[]>();
    for (const module of versionModules) {
      const list = modulesByVersion.get(module.certification_version_id) ?? [];
      list.push(module);
      modulesByVersion.set(module.certification_version_id, list);
    }
    const statusByEnrollment = new Map<number, Map<number, string>>();
    for (const row of progressRows ?? []) {
      if (row.enrollment_id === null) continue;
      const bySection =
        statusByEnrollment.get(row.enrollment_id) ?? new Map<number, string>();
      bySection.set(row.section_id, row.status);
      statusByEnrollment.set(row.enrollment_id, bySection);
    }

    return enrollments.map((enrollment) => {
      const modules =
        modulesByVersion.get(enrollment.certification_version_id) ?? [];
      const statusBySection = statusByEnrollment.get(enrollment.enrollment_id);
      return {
        enrollment_id: enrollment.enrollment_id,
        certification_id: enrollment.certification_id,
        certification: {
          name: enrollment.certifications.name,
        },
        enrollment_date: enrollment.enrollment_date,
        completion_status: enrollment.completion_status,
        status: enrollment.status,
        certified_at: enrollment.certified_at ?? null,
        summary: summarizeRequiredSections(
          modules.flatMap((m) =>
            m.certification_sections.map((s) => ({
              section_id: s.section_id,
              required: s.required ?? true,
            })),
          ),
          statusBySection,
        ),
        ...versionProgress(modules, statusBySection),
        active: enrollment.active,
      };
    });
  }

  /**
   * Listar inscritos de una certificación (vista administrativa, paginada).
   * Progreso = secciones requeridas aprobadas / secciones requeridas de la
   * versión a la que está ligada cada inscripción (motor configurable; el
   * booleano legado de módulos ya no se escribe). Calculado en lote para la
   * página (sin N+1).
   */
  async listCertificationEnrollments(
    certificationId: number,
    query: ListCertificationEnrollmentsDto,
  ) {
    const certification = await this.prisma.certifications.findUnique({
      where: { certification_id: certificationId },
      select: { certification_id: true },
    });
    if (!certification) {
      throw new AppNotFoundException(ErrorCode.CERT_NOT_FOUND);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const tokens = searchTokens(query.search);

    // Name search ignores case and accents («Perez» finds «Pérez»). Prisma
    // cannot fold accents, so the matching enrollments are found in SQL first.
    let matchingEnrollmentIds: number[] | null = null;
    if (tokens.length > 0) {
      const matches = await this.prisma.$queryRaw<{ enrollment_id: number }[]>(
        Prisma.sql`
          SELECT uc.enrollment_id
          FROM users_certifications uc
          JOIN users u ON u.user_id = uc.user_id
          WHERE uc.certification_id = ${certificationId}
            AND uc.active = TRUE
            AND ${accentInsensitiveMatchSql(
              ['u.name', 'u.paternal_last_name', 'u.maternal_last_name'],
              tokens,
            )}`,
      );
      matchingEnrollmentIds = matches.map((m) => Number(m.enrollment_id));
    }

    const where: Prisma.users_certificationsWhereInput = {
      certification_id: certificationId,
      active: true,
      ...(query.status ? { status: query.status } : {}),
      ...(matchingEnrollmentIds !== null
        ? { enrollment_id: { in: matchingEnrollmentIds } }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.users_certifications.count({ where }),
      this.prisma.users_certifications.findMany({
        where,
        select: {
          enrollment_id: true,
          user_id: true,
          certification_version_id: true,
          status: true,
          enrollment_date: true,
          users: {
            select: {
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
        },
        orderBy: [{ enrollment_date: 'desc' }, { enrollment_id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const enrollmentIds = rows.map((r) => r.enrollment_id);
    const versionIds = [
      ...new Set(rows.map((r) => r.certification_version_id)),
    ];

    const [versionModules, approvedRows, assignmentRows] =
      rows.length > 0
        ? await Promise.all([
            this.prisma.certification_modules.findMany({
              where: {
                certification_version_id: { in: versionIds },
                active: true,
              },
              select: {
                certification_version_id: true,
                certification_sections: {
                  where: { active: true, required: true },
                  select: { section_id: true },
                },
              },
            }),
            this.prisma.certification_section_progress.findMany({
              where: {
                enrollment_id: { in: enrollmentIds },
                status: 'APPROVED',
              },
              select: { enrollment_id: true, section_id: true },
            }),
            this.prisma.club_role_assignments.findMany({
              where: {
                user_id: { in: userIds },
                active: true,
                status: 'active',
                club_section_id: { not: null },
              },
              select: {
                user_id: true,
                club_sections: {
                  select: {
                    clubs: { select: { name: true } },
                    club_types: { select: { name: true } },
                  },
                },
              },
              orderBy: [{ start_date: 'desc' }, { assignment_id: 'desc' }],
            }),
          ])
        : [[], [], []];

    const requiredByVersion = new Map<number, Set<number>>();
    for (const module of versionModules) {
      const set =
        requiredByVersion.get(module.certification_version_id) ??
        new Set<number>();
      for (const section of module.certification_sections) {
        set.add(section.section_id);
      }
      requiredByVersion.set(module.certification_version_id, set);
    }
    const approvedByEnrollment = new Map<number, Set<number>>();
    for (const row of approvedRows) {
      if (row.enrollment_id === null) continue;
      const set =
        approvedByEnrollment.get(row.enrollment_id) ?? new Set<number>();
      set.add(row.section_id);
      approvedByEnrollment.set(row.enrollment_id, set);
    }

    // Primera asignación activa más reciente por usuario.
    const placeByUser = new Map<
      string,
      { club_name: string | null; section_name: string | null }
    >();
    for (const a of assignmentRows) {
      if (placeByUser.has(a.user_id)) continue;
      placeByUser.set(a.user_id, {
        club_name: a.club_sections?.clubs?.name ?? null,
        section_name: a.club_sections?.club_types?.name ?? null,
      });
    }

    const items = rows.map((r) => {
      const required =
        requiredByVersion.get(r.certification_version_id) ?? new Set<number>();
      const approved = approvedByEnrollment.get(r.enrollment_id);
      let approvedRequired = 0;
      for (const sectionId of required) {
        if (approved?.has(sectionId)) approvedRequired += 1;
      }
      const percent =
        required.size > 0
          ? Math.round((approvedRequired / required.size) * 100)
          : 0;
      const place = placeByUser.get(r.user_id);
      return {
        enrollment_id: r.enrollment_id,
        user_id: r.user_id,
        name: r.users.name,
        paternal_last_name: r.users.paternal_last_name ?? null,
        maternal_last_name: r.users.maternal_last_name ?? null,
        club_name: place?.club_name ?? null,
        section_name: place?.section_name ?? null,
        status: r.status,
        progress_percent: Math.min(100, Math.max(0, percent)),
        enrollment_date: r.enrollment_date.toISOString(),
      };
    });

    return { items, total, page, limit };
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
        certifications: { select: { name: true } },
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.CERT_ENROLLMENT_NOT_FOUND);
    }

    // Árbol de la versión a la que está ligada la inscripción (no el de todas
    // las versiones de la certificación) y el estado de sus secciones. El
    // estado real vive en certification_section_progress.status (DRAFT/
    // SUBMITTED/CHANGES_REQUESTED/APPROVED), gestionado por el flujo de
    // requisitos.
    const [versionModules, sectionProgress] = await Promise.all([
      this.prisma.certification_modules.findMany({
        where: {
          certification_version_id: enrollment.certification_version_id,
          active: true,
        },
        include: {
          certification_sections: {
            where: { active: true },
            orderBy: { section_id: 'asc' },
          },
        },
        orderBy: { module_id: 'asc' },
      }),
      this.prisma.certification_section_progress.findMany({
        where: { enrollment_id: enrollment.enrollment_id },
      }),
    ]);
    const progressBySection = new Map(
      sectionProgress.map((sp) => [sp.section_id, sp]),
    );
    const statusBySection = new Map(
      sectionProgress.map((sp) => [sp.section_id, sp.status as string]),
    );

    // Construir respuesta detallada
    const modules = versionModules.map((module) => {
      const sections = module.certification_sections.map((section) => {
        const sectionProgressData = progressBySection.get(section.section_id);

        return {
          section_id: section.section_id,
          name: section.name,
          completed: sectionProgressData?.status === 'APPROVED',
          completion_date: sectionProgressData?.completion_date ?? null,
          status: sectionProgressData?.status ?? 'NOT_STARTED',
          submitted_at: sectionProgressData?.submitted_at ?? null,
          reviewed_at: sectionProgressData?.reviewed_at ?? null,
          last_review_comment: sectionProgressData?.last_review_comment ?? null,
          required: section.required ?? true,
        };
      });

      // Completo = todas las secciones requeridas aprobadas; la fecha es la
      // de la última revisión que lo completó.
      const required = sections.filter((s) => s.required);
      const completed = required.every((s) => s.completed);
      const reviewedTimes = required
        .map((s) => s.reviewed_at?.getTime())
        .filter((t): t is number => typeof t === 'number');

      return {
        module_id: module.module_id,
        name: module.name,
        completed,
        completion_date:
          completed && reviewedTimes.length > 0
            ? new Date(Math.max(...reviewedTimes))
            : null,
        sections,
      };
    });

    const { progress_percentage } = versionProgress(
      versionModules,
      statusBySection,
    );

    return {
      enrollment_id: enrollment.enrollment_id,
      certification_id: enrollment.certification_id,
      certification_name: enrollment.certifications.name,
      progress_percentage,
      completion_status: enrollment.completion_status,
      status: enrollment.status,
      certified_at: enrollment.certified_at ?? null,
      summary: summarizeRequiredSections(
        versionModules.flatMap((m) =>
          m.certification_sections.map((s) => ({
            section_id: s.section_id,
            required: s.required ?? true,
          })),
        ),
        statusBySection,
      ),
      enrollment_date: enrollment.enrollment_date,
      modules,
    };
  }

  /**
   * Abandonar una certificación.
   *
   * - CERTIFIED / APPROVED / SUBMITTED_FOR_FINAL_REVIEW: 409
   *   (CERT_ENROLLMENT_NOT_ABANDONABLE). No se puede esconder una
   *   certificación otorgada ni una en revisión final.
   * - ENROLLED / IN_PROGRESS / READY_FOR_CLOSEOUT / CHANGES_REQUESTED:
   *   transición a WITHDRAWN vía máquina de estados + active=false + evento
   *   de auditoría WITHDRAWN.
   * - EXPIRED: la máquina no permite EXPIRED -> WITHDRAWN; se conserva EXPIRED
   *   y solo se desactiva (active=false) para permitir la reinscripción.
   * - WITHDRAWN activo: estado inconsistente (WITHDRAWN siempre debería ir con
   *   active=false). Se trata como idempotente: solo se desactiva, de modo que
   *   el usuario no quede bloqueado por CERT_ALREADY_ENROLLED.
   */
  async deleteCertification(userId: string, certificationId: number) {
    return this.prisma.$transaction(async (tx) => {
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

      const currentStatus = enrollment.status;
      assertEnrollmentAbandonable(currentStatus);

      const keepsStatus =
        currentStatus === 'EXPIRED' || currentStatus === 'WITHDRAWN';
      const nextStatus = keepsStatus
        ? currentStatus
        : transitionEnrollment(currentStatus, 'WITHDRAWN');

      // Condicionado al estado leído: si un revisor movió la inscripción entre
      // el read y el write (p. ej. a revisión final), no se abandona.
      const result = await tx.users_certifications.updateMany({
        where: {
          enrollment_id: enrollment.enrollment_id,
          active: true,
          status: currentStatus,
        },
        data: {
          status: nextStatus,
          active: false,
          lock_version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        throw new AppConflictException(ErrorCode.CERT_CONCURRENT_UPDATE);
      }

      if (!keepsStatus) {
        await tx.certification_review_events.create({
          data: {
            enrollment_id: enrollment.enrollment_id,
            event_type: 'WITHDRAWN',
            performed_by_id: userId,
            from_status: currentStatus,
            to_status: nextStatus,
          },
        });
      }

      return {
        message: 'Certification enrollment deleted successfully',
      };
    });
  }
}
