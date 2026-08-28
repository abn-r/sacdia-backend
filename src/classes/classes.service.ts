import { Inject, Injectable, Logger } from '@nestjs/common';
import 'multer';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, evidence_validation_enum } from '@prisma/client';
import { TranslationService } from '../common/services/translation.service';
import { AchievementsService } from '../achievements/achievements.service';
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
import {
  buildEvidenceDisplayNameForFile,
  resolveEvidenceFileExtension,
} from '../common/utils/evidence-file-names';
import { ClassProgressAccessService } from './class-progress-access.service';
import {
  ClassRequirementEligibilityService,
  type ClassRequirementEligibilityResult,
} from './class-requirement-eligibility.service';
import pLimit from 'p-limit';

// Concurrency cap for the evidence URL presign fan-out in getUserProgress.
// Worst case: 10 sections × 20 evidence files = 200 concurrent HMAC presigns
// against the private CLASS_EVIDENCE bucket. Cap matches the pattern established
// in camporees.service.ts (PROFILE_URL_LIMITER = pLimit(20)).
export const EVIDENCE_URL_LIMITER = pLimit(20);

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Injectable()
export class ClassesService {
  private readonly logger = new Logger(ClassesService.name);
  private siblingTypeIdsCache: Promise<number[]> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly achievementsService: AchievementsService,
    private readonly translationService: TranslationService,
    private readonly classProgressAccess: ClassProgressAccessService,
    private readonly requirementEligibility: ClassRequirementEligibilityService,
  ) {}

  private static readonly PROGRESS_MUTATION_BLOCKED_STATUSES = new Set([
    'SUBMITTED',
    'CLUB_APPROVED',
    'COORDINATOR_APPROVED',
    'FIELD_APPROVED',
    'INVESTIDO',
    'EXPIRED',
  ]);

  private assertProgressMutable(enrollment: {
    investitureStatus: string;
    lockedForValidation: boolean;
  }) {
    if (
      enrollment.lockedForValidation ||
      ClassesService.PROGRESS_MUTATION_BLOCKED_STATUSES.has(
        enrollment.investitureStatus,
      )
    ) {
      throw new AppConflictException(ErrorCode.CLASS_PROGRESS_LOCKED);
    }
  }

  private getSiblingClubTypeIds(): Promise<number[]> {
    if (!this.siblingTypeIdsCache) {
      this.siblingTypeIdsCache = this.prisma.club_types
        .findMany({
          where: {
            OR: [
              { name: { contains: 'venturer', mode: 'insensitive' } },
              { name: { contains: 'conquistador', mode: 'insensitive' } },
            ],
          },
          select: { club_type_id: true },
        })
        .then((rows) => rows.map((ct) => ct.club_type_id));
    }
    return this.siblingTypeIdsCache;
  }

  private async resolveProgressEnrollment(params: {
    userId: string;
    classId: number;
    enrollmentId?: number;
  }): Promise<{
    enrollmentId: number;
    ecclesiasticalYearId: number;
    investitureStatus: string;
    lockedForValidation: boolean;
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
          investiture_status: true,
          locked_for_validation: true,
        },
      });

      if (
        !enrollment ||
        enrollment.user_id !== params.userId ||
        enrollment.class_id !== params.classId
      ) {
        throw new AppNotFoundException(ErrorCode.CLASS_ENROLLMENT_NOT_FOUND);
      }

      return {
        enrollmentId: enrollment.enrollment_id,
        ecclesiasticalYearId: enrollment.ecclesiastical_year_id,
        investitureStatus: enrollment.investiture_status,
        lockedForValidation: enrollment.locked_for_validation,
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
      throw new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND);
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
        investiture_status: true,
        locked_for_validation: true,
      },
    });

    if (enrollments.length === 0) {
      throw new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND);
    }

    if (enrollments.length > 1) {
      throw new AppConflictException(ErrorCode.CLASS_ENROLLMENT_AMBIGUOUS);
    }

    return {
      enrollmentId: enrollments[0].enrollment_id,
      ecclesiasticalYearId: enrollments[0].ecclesiastical_year_id,
      investitureStatus: enrollments[0].investiture_status,
      lockedForValidation: enrollments[0].locked_for_validation,
    };
  }

  private async findCurrentEcclesiasticalYear(): Promise<{
    year_id: number;
    start_date: Date;
  }> {
    const now = new Date();
    const yearByCurrentDate = await this.prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: now },
        end_date: { gte: now },
      },
      select: {
        year_id: true,
        start_date: true,
      },
      orderBy: { start_date: 'desc' },
    });

    const activeYear =
      yearByCurrentDate ??
      (await this.prisma.ecclesiastical_years.findFirst({
        where: { active: true },
        select: {
          year_id: true,
          start_date: true,
        },
        orderBy: { start_date: 'desc' },
      }));

    if (!activeYear) {
      throw new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND);
    }

    return activeYear;
  }

  private buildAvailabilityWhere(
    targetYearStartDate: Date,
  ): Prisma.classesWhereInput {
    return {
      AND: [
        {
          OR: [
            { available_from_year_id: null },
            {
              available_from_year: {
                start_date: { lte: targetYearStartDate },
              },
            },
          ],
        },
        {
          OR: [
            { available_until_year_id: null },
            {
              available_until_year: {
                start_date: { gte: targetYearStartDate },
              },
            },
          ],
        },
      ],
    };
  }

  private isClassAvailableForYear(params: {
    targetYearStartDate: Date;
    available_from_year?: { start_date: Date } | null;
    available_until_year?: { start_date: Date } | null;
  }): boolean {
    const { targetYearStartDate, available_from_year, available_until_year } =
      params;

    const startsAfterFrom =
      !available_from_year ||
      available_from_year.start_date <= targetYearStartDate;
    const startsBeforeUntil =
      !available_until_year ||
      available_until_year.start_date >= targetYearStartDate;

    return startsAfterFrom && startsBeforeUntil;
  }

  // ========================================
  // CLASSES
  // ========================================

  async findAll(
    clubTypeId?: number,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<any>> {
    const locale = this.translationService.getCurrentLocale();
    const activeYear = await this.findCurrentEcclesiasticalYear();
    const where: Prisma.classesWhereInput = {
      active: true,
      ...(clubTypeId && { club_type_id: clubTypeId }),
      ...this.buildAvailabilityWhere(activeYear.start_date),
    };

    const [data, total] = await Promise.all([
      this.prisma.classes.findMany({
        where,
        include: {
          club_types: { select: { name: true } },
          _count: { select: { class_modules: true } },
          translations: {
            where: { locale },
            select: { locale: true, name: true, description: true },
          },
        },
        orderBy: [{ club_type_id: 'asc' }, { display_order: 'asc' }],
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 50,
      }),
      this.prisma.classes.count({ where }),
    ]);

    const translated = this.translationService.translateMany(
      data,
      locale,
      ['name', 'description'],
      'translations',
    );

    return createPaginatedResult(
      translated,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  async findOne(classId: number) {
    const locale = this.translationService.getCurrentLocale();
    const classData = await this.prisma.classes.findUnique({
      where: { class_id: classId },
      include: {
        club_types: { select: { name: true } },
        translations: {
          where: { locale },
          select: { locale: true, name: true, description: true },
        },
        prerequisites: {
          where: { active: true },
          include: {
            prerequisite: {
              select: { class_id: true, name: true },
            },
          },
          orderBy: { class_prerequisite_id: 'asc' },
        },
        class_modules: {
          where: { active: true },
          include: {
            translations: {
              where: { locale },
              select: { locale: true, name: true, description: true },
            },
            class_sections: {
              where: { active: true },
              include: {
                translations: {
                  where: { locale },
                  select: { locale: true, name: true, description: true },
                },
              },
              orderBy: [{ display_order: 'asc' }, { section_id: 'asc' }],
            },
            class_honors: {
              where: { active: true, honor: { active: true } },
              include: {
                honor: {
                  select: {
                    honor_id: true,
                    name: true,
                    honor_image: true,
                    material_url: true,
                    honors_category_id: true,
                    skill_level: true,
                  },
                },
              },
              orderBy: [{ relation_type: 'asc' }, { honor: { name: 'asc' } }],
            },
          },
          orderBy: { module_id: 'asc' },
        },
      },
    });

    if (!classData) {
      throw new AppNotFoundException(ErrorCode.CLASS_NOT_FOUND);
    }

    // Translate the top-level class
    const translatedClass = this.translationService.translateMany(
      [classData],
      locale,
      ['name', 'description'],
      'translations',
    )[0];

    // Translate nested modules and sections
    if (translatedClass.class_modules) {
      // translateMany strips the `translations` key — cast to keep the
      // surrounding structure assignable to the Prisma-inferred type.
      (translatedClass as any).class_modules =
        this.translationService.translateMany(
          translatedClass.class_modules,
          locale,
          ['name', 'description'],
          'translations',
        );
      for (const mod of (translatedClass as any).class_modules) {
        if (mod.class_sections) {
          mod.class_sections = this.translationService.translateMany(
            mod.class_sections as Record<string, unknown>[],
            locale,
            ['name', 'description'],
            'translations',
          );
        }
        const rawHonors = Array.isArray(mod.class_honors)
          ? mod.class_honors
          : [];
        mod.honors = rawHonors.map(
          (relation: {
            class_honor_id: number;
            relation_type: string;
            module_id: number | null;
            honor: unknown;
          }) => ({
            class_honor_id: relation.class_honor_id,
            relation_type: relation.relation_type,
            module_id: relation.module_id ?? null,
            module_name: mod.name ?? null,
            honor: relation.honor,
          }),
        );
        delete mod.class_honors;
      }
    }

    const prerequisites = (
      (translatedClass as any).prerequisites as
        | Array<{ prerequisite: { class_id: number; name: string } }>
        | undefined
    )?.map((row) => ({
      class_id: row.prerequisite.class_id,
      name: row.prerequisite.name,
    })) ?? [];

    const { prerequisites: _rawPrerequisites, ...rest } =
      translatedClass as typeof translatedClass & {
        prerequisites?: unknown;
      };

    return {
      ...rest,
      prerequisites,
    };
  }

  async getModules(classId: number) {
    const classData = await this.findOne(classId);
    return classData.class_modules;
  }

  async getClassHonors(classId: number, userId?: string) {
    const classExists = await this.prisma.classes.findFirst({
      where: { class_id: classId, active: true },
      select: { class_id: true },
    });
    if (!classExists) {
      throw new AppNotFoundException(ErrorCode.CLASS_NOT_FOUND);
    }

    const relations = await this.prisma.class_honors.findMany({
      where: { class_id: classId, active: true, honor: { active: true } },
      include: {
        honor: {
          select: {
            honor_id: true,
            name: true,
            honor_image: true,
            material_url: true,
            honors_category_id: true,
            skill_level: true,
          },
        },
        module: {
          select: { module_id: true, name: true },
        },
      },
      orderBy: [{ relation_type: 'asc' }, { honor: { name: 'asc' } }],
    });

    let userHonorsByHonorId = new Map<number, string>();
    if (userId && relations.length > 0) {
      const userHonors = await this.prisma.users_honors.findMany({
        where: {
          user_id: userId,
          honor_id: { in: relations.map((r) => r.honor_id) },
        },
        select: { honor_id: true, validation_status: true },
      });
      userHonorsByHonorId = new Map(
        userHonors.map((uh) => [uh.honor_id, uh.validation_status]),
      );
    }

    return relations.map((relation) => ({
      class_honor_id: relation.class_honor_id,
      relation_type: relation.relation_type,
      module_id: relation.module_id ?? null,
      module_name: relation.module?.name ?? null,
      honor: relation.honor,
      user_status: userHonorsByHonorId.get(relation.honor_id) ?? null,
    }));
  }

  // ========================================
  // ENROLLMENTS
  // ========================================

  async enrollUser(
    userId: string,
    classId: number,
    ecclesiasticalYearId: number,
  ) {
    const enrollment = await this.prisma.$transaction(async (tx) => {
      // 1. Get target class with its club type name so we can classify the pool
      //    without relying on hardcoded exact-match strings that break under
      //    encoding/collation differences in the DB.
      const targetClass = await tx.classes.findUnique({
        where: { class_id: classId },
        include: {
          club_types: { select: { name: true } },
          available_from_year: { select: { start_date: true } },
          available_until_year: { select: { start_date: true } },
        },
      });
      if (!targetClass) {
        throw new AppNotFoundException(ErrorCode.CLASS_NOT_FOUND);
      }
      if (targetClass.active === false) {
        throw new AppNotFoundException(ErrorCode.CLASS_NOT_FOUND);
      }

      const targetYear = await tx.ecclesiastical_years.findUnique({
        where: { year_id: ecclesiasticalYearId },
        select: { start_date: true, end_date: true },
      });
      if (!targetYear) {
        throw new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND);
      }

      if (
        !this.isClassAvailableForYear({
          targetYearStartDate: targetYear.start_date,
          available_from_year: targetClass.available_from_year,
          available_until_year: targetClass.available_until_year,
        })
      ) {
        throw new AppBadRequestException(
          ErrorCode.CLASS_NOT_AVAILABLE_FOR_YEAR,
        );
      }

      const clubTypeName = targetClass.club_types?.name?.toLowerCase() ?? '';

      // Classify the pool using case-insensitive partial matching.
      // "guía" / "guia" covers both accented and unaccented variants.
      const isGm =
        clubTypeName.includes('guia') || clubTypeName.includes('guía');
      const isAventuConquis =
        clubTypeName.includes('aventurer') ||
        clubTypeName.includes('conquistador');

      // 2. Check GM investiture pre-condition
      if (targetClass.requires_invested_gm) {
        const hasInvestiture = await tx.enrollments.findFirst({
          where: {
            user_id: userId,
            investiture_status: 'INVESTIDO',
            classes: {
              club_types: {
                name: { contains: 'uía', mode: 'insensitive' },
              },
            },
          },
        });
        if (!hasInvestiture) {
          throw new AppForbiddenException(
            ErrorCode.CLASS_GM_INVESTITURE_REQUIRED,
          );
        }
      }

      // 2b. Explicit class prerequisites: every active prerequisite must be
      // INVESTIDO for this user, regardless of year.
      const prerequisites = await tx.class_prerequisites.findMany({
        where: { class_id: classId, active: true },
        include: {
          prerequisite: { select: { class_id: true, name: true } },
        },
      });

      if (prerequisites.length > 0) {
        const investedClassIds = new Set(
          (
            await tx.enrollments.findMany({
              where: {
                user_id: userId,
                investiture_status: 'INVESTIDO',
                class_id: {
                  in: prerequisites.map((p) => p.prerequisite_class_id),
                },
              },
              select: { class_id: true },
            })
          ).map((enrollment) => enrollment.class_id),
        );

        const missing = prerequisites.filter(
          (p) => !investedClassIds.has(p.prerequisite_class_id),
        );

        if (missing.length > 0) {
          throw new AppForbiddenException(
            ErrorCode.CLASS_PREREQUISITE_NOT_MET,
          );
        }
      }

      // 3. Display-order progression restriction
      // Users can only enroll up to one class above their highest INVESTIDO class
      // within the same club type. If no INVESTIDO exists, they can only enroll
      // in their base class (the one selected during post-registration).
      // Exception: if the ecclesiastical year has ended, allow the next class.
      await this.validateDisplayOrderProgression(tx, {
        userId,
        targetClass,
        ecclesiasticalYearId,
      });

      // 4. Enrollment limit by club type
      const { club_type_id } = targetClass;

      if (isAventuConquis) {
        const siblingIds = await this.getSiblingClubTypeIds();

        const activeCount = await tx.enrollments.count({
          where: {
            user_id: userId,
            ecclesiastical_year_id: ecclesiasticalYearId,
            active: true,
            classes: {
              club_type_id: { in: siblingIds },
            },
          },
        });
        if (activeCount >= 1) {
          throw new AppConflictException(
            ErrorCode.CLASS_MAX_AVENTU_CONQUIS_ACTIVE,
          );
        }
      } else if (isGm) {
        const activeCount = await tx.enrollments.count({
          where: {
            user_id: userId,
            ecclesiastical_year_id: ecclesiasticalYearId,
            active: true,
            classes: { club_type_id },
          },
        });
        // DB enforces a single active enrollment per user/year via the partial
        // unique index uniq_enrollments_active_user_year; keep the service rule
        // aligned so violations surface as CLASS_MAX_GM_ACTIVE instead of a raw
        // unique-constraint error.
        if (activeCount >= 1) {
          throw new AppConflictException(ErrorCode.CLASS_MAX_GM_ACTIVE);
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
          throw new AppConflictException(ErrorCode.CLASS_ALREADY_ENROLLED);
        }

        return tx.enrollments.update({
          where: { enrollment_id: existing.enrollment_id },
          data: { active: true },
          include: {
            classes: { select: { name: true, club_type_id: true } },
            ecclesiastical_year: {
              select: { start_date: true, end_date: true },
            },
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
          classes: { select: { name: true, club_type_id: true } },
          ecclesiastical_year: { select: { start_date: true, end_date: true } },
        },
      });
    });

    try {
      await this.achievementsService.emitEvent({
        userId,
        eventType: 'class.started',
        payload: {
          class_id: classId,
          class_name: enrollment.classes?.name ?? null,
          club_type_id: enrollment.classes?.club_type_id ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit achievement event: ${(error as Error).message}`,
      );
    }

    return enrollment;
  }

  async getUserEnrollments(userId: string, ecclesiasticalYearId?: number) {
    const enrollments = await this.prisma.enrollments.findMany({
      where: {
        user_id: userId,
        ...(ecclesiasticalYearId && {
          ecclesiastical_year_id: ecclesiasticalYearId,
        }),
      },
      select: {
        enrollment_id: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        enrollment_date: true,
        investiture_status: true,
        submitted_for_validation: true,
        submitted_at: true,
        validated_by: true,
        validated_at: true,
        locked_for_validation: true,
        cross_type_enrollment: true,
        created_at: true,
        modified_at: true,
        classes: {
          select: {
            class_id: true,
            name: true,
            description: true,
            asset_code: true,
            advanced_enabled: true,
            club_types: { select: { name: true } },
          },
        },
        ecclesiastical_year: { select: { start_date: true, end_date: true } },
      },
      orderBy: { enrollment_date: 'desc' },
    });

    if (enrollments.length === 0) {
      return [];
    }

    const eligibilityEntries = await Promise.all(
      enrollments.map(
        async (
          enrollment,
        ): Promise<[number, ClassRequirementEligibilityResult | null]> => [
          enrollment.enrollment_id,
          await this.requirementEligibility.calculateForEnrollment(
            enrollment.enrollment_id,
          ),
        ],
      ),
    );

    const eligibilityByEnrollment = new Map<
      number,
      ClassRequirementEligibilityResult
    >(
      eligibilityEntries.filter(
        (
          entry,
        ): entry is [number, ClassRequirementEligibilityResult] =>
          entry[1] !== null,
      ),
    );

    return enrollments.map((enrollment) => {
      const eligibility = eligibilityByEnrollment.get(enrollment.enrollment_id);

      return {
        ...enrollment,
        overall_progress: eligibility?.overall_progress ?? 0,
        basic_progress: eligibility?.basic_progress,
        advanced_progress: eligibility?.advanced_progress,
        extra_progress: eligibility?.extra_progress,
        investiture_eligibility: eligibility?.investiture_eligibility,
        advanced_eligibility: eligibility?.advanced_eligibility,
      };
    });
  }

  // ========================================
  // PROGRESS
  // ========================================

  async getUserProgress(
    targetUserId: string,
    classId: number,
    enrollmentId?: number,
    actorUserId = targetUserId,
  ) {
    const resolvedEnrollment = await this.resolveProgressEnrollment({
      userId: targetUserId,
      classId,
      enrollmentId,
    });
    await this.classProgressAccess.assertCanAccessProgress({
      actorUserId,
      targetUserId,
      classId,
      ecclesiasticalYearId: resolvedEnrollment.ecclesiasticalYearId,
    });

    // Get all sections for this class
    const classData = await this.findOne(classId);

    // Get user's section progress including evidence files
    const sectionProgress = await this.prisma.class_section_progress.findMany({
      where: {
        enrollment_id: resolvedEnrollment.enrollmentId,
        active: true,
      },
      include: {
        submitted_by: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
        validated_by_user: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
        evidence_files: {
          where: { active: true },
          select: {
            evidence_file_id: true,
            file_url: true,
            file_name: true,
            file_type: true,
            uploaded_at: true,
            uploaded_by: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
          orderBy: { uploaded_at: 'asc' },
        },
      },
    });

    // Pre-sign all evidence file URLs with a concurrency cap.
    // Without the cap, a worst-case request (10 sections × 20 files) would fire
    // 200 simultaneous HMAC presigns against the private CLASS_EVIDENCE bucket,
    // blocking the event loop for 1-4 seconds. Cap is 20, matching the pattern
    // used by PROFILE_URL_LIMITER in camporees.service.ts.
    const allEvidenceFiles = sectionProgress.flatMap((sp) => sp.evidence_files);
    const signedUrlMap = new Map<number, string>();
    await Promise.all(
      allEvidenceFiles.map((ef) =>
        EVIDENCE_URL_LIMITER(async () => {
          try {
            const signedUrl = await this.fileStorage.getSignedDownloadUrl(
              StorageBucketAlias.CLASS_EVIDENCE,
              ef.file_url,
            );
            signedUrlMap.set(ef.evidence_file_id, signedUrl);
          } catch (err) {
            this.logger.warn(
              `Failed to presign evidence URL for file ${ef.evidence_file_id} (class ${classId}, user ${targetUserId}): ${(err as Error).message}`,
            );
            signedUrlMap.set(ef.evidence_file_id, ef.file_url);
          }
        }),
      ),
    );

    const eligibility =
      await this.requirementEligibility.calculateForEnrollment(
        resolvedEnrollment.enrollmentId,
      );
    const applicableSectionIds = new Set(
      eligibility?.applicable_section_ids ??
        classData.class_modules.flatMap((module) =>
          module.class_sections.map((section) => section.section_id),
        ),
    );

    const isCompletedProgress = (
      progress: (typeof sectionProgress)[number] | undefined,
    ) =>
      Boolean(
        progress &&
          progress.status !== evidence_validation_enum.REJECTED &&
          (progress.status === evidence_validation_enum.VALIDATED ||
            progress.score >= 70),
      );

    const modulesProgress = classData.class_modules
      .map((module) => {
        const applicableSections = module.class_sections.filter((section) =>
          applicableSectionIds.has(section.section_id),
        );
        const sectionsInModule = applicableSections.length;

        const completedInModule = applicableSections.filter((section) => {
          const progress = sectionProgress.find(
            (sp) => sp.section_id === section.section_id,
          );
          return isCompletedProgress(progress);
        }).length;

        return {
          module_id: module.module_id,
          id: module.module_id,
          class_id: classId,
          module_name: module.name,
          name: module.name,
          description: module.description ?? null,
          total_sections: sectionsInModule,
          completed_sections: completedInModule,
          progress_percentage:
            sectionsInModule > 0
              ? Math.round((completedInModule / sectionsInModule) * 100)
              : 0,
          sections: applicableSections.map((section) => {
            const progress = sectionProgress.find(
              (sp) => sp.section_id === section.section_id,
            );
            const evidenceFiles = (progress?.evidence_files ?? []).map((ef) => ({
              id: String(ef.evidence_file_id),
              file_id: ef.evidence_file_id,
              file_name: ef.file_name,
              file_type: ef.file_type,
              file_url: signedUrlMap.get(ef.evidence_file_id) ?? ef.file_url,
              uploaded_at: ef.uploaded_at.toISOString(),
              uploaded_by_name: this.formatUserName(ef.uploaded_by ?? null),
            }));
            return {
              section_id: section.section_id,
              id: section.section_id,
              section_name: section.name,
              name: section.name,
              description: section.description ?? null,
              module_id: module.module_id,
              requirement_track: section.requirement_track,
              required_for_investiture: section.required_for_investiture,
              display_order: section.display_order,
              completed: isCompletedProgress(progress),
              score: progress?.score || 0,
              evidences: progress?.evidences || null,
              evidence_files: evidenceFiles,
              status: progress?.status ?? evidence_validation_enum.PENDING,
              submitted_by_name: this.formatUserName(
                progress?.submitted_by ?? null,
              ),
              submitted_at: progress?.submitted_at?.toISOString() || null,
              validated_by_name: this.formatUserName(
                progress?.validated_by_user ?? null,
              ),
              validated_at: progress?.validated_at?.toISOString() || null,
              rejection_reason: progress?.rejection_reason || null,
            };
          }),
        };
      })
      .filter((module) => module.total_sections > 0);

    const totalSections =
      eligibility?.investiture_progress.total ??
      modulesProgress.reduce((sum, module) => sum + module.total_sections, 0);
    const completedSections =
      eligibility?.investiture_progress.completed ??
      modulesProgress.reduce(
        (sum, module) => sum + module.completed_sections,
        0,
      );
    const fallbackOverallProgress =
      totalSections > 0
        ? Math.round((completedSections / totalSections) * 100)
        : 0;

    return {
      enrollment_id: resolvedEnrollment.enrollmentId,
      ecclesiastical_year_id: resolvedEnrollment.ecclesiasticalYearId,
      investiture_status: resolvedEnrollment.investitureStatus,
      class_id: classId,
      id: classId,
      class_name: classData.name,
      name: classData.name,
      description: classData.description ?? null,
      club_type_id: classData.club_type_id,
      advanced_enabled: classData.advanced_enabled,
      available_from_year_id: classData.available_from_year_id,
      available_until_year_id: classData.available_until_year_id,
      min_duration_years: classData.min_duration_years,
      max_duration_years: classData.max_duration_years,
      total_sections: totalSections,
      completed_sections: completedSections,
      overall_progress: eligibility?.overall_progress ?? fallbackOverallProgress,
      percentage: eligibility?.overall_progress ?? fallbackOverallProgress,
      basic_progress: eligibility?.basic_progress,
      advanced_progress: eligibility?.advanced_progress,
      extra_progress: eligibility?.extra_progress,
      investiture_eligibility: eligibility?.investiture_eligibility,
      advanced_eligibility: eligibility?.advanced_eligibility,
      modules: modulesProgress,
    };
  }

  async updateSectionProgress(
    targetUserId: string,
    classId: number,
    moduleId: number,
    sectionId: number,
    score: number,
    evidences?: Record<string, unknown>,
    enrollmentId?: number,
    actorUserId = targetUserId,
  ) {
    const resolvedEnrollment = await this.resolveProgressEnrollment({
      userId: targetUserId,
      classId,
      enrollmentId,
    });
    await this.classProgressAccess.assertCanAccessProgress({
      actorUserId,
      targetUserId,
      classId,
      ecclesiasticalYearId: resolvedEnrollment.ecclesiasticalYearId,
    });
    this.assertProgressMutable(resolvedEnrollment);

    const validSection = await this.prisma.class_sections.findFirst({
      where: {
        section_id: sectionId,
        module_id: moduleId,
        active: true,
        class_modules: {
          module_id: moduleId,
          class_id: classId,
          active: true,
        },
      },
      select: { section_id: true },
    });
    if (!validSection) {
      throw new AppNotFoundException(ErrorCode.CLASS_SECTION_NOT_FOUND);
    }

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
              user_id: targetUserId,
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
            user_id: targetUserId,
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
    targetUserId: string,
    actorUserId: string,
    classId: number,
    sectionId: number,
    file: Express.Multer.File,
    enrollmentId?: number,
  ) {
    if (!file?.buffer) {
      throw new AppBadRequestException(ErrorCode.CLASS_FILE_REQUIRED);
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new AppBadRequestException(ErrorCode.CLASS_FILE_INVALID_TYPE);
    }

    // Validate the section belongs to this class and get its module_id
    const section = await this.prisma.class_sections.findFirst({
      where: {
        section_id: sectionId,
        class_modules: { class_id: classId },
        active: true,
      },
      select: { section_id: true, module_id: true },
    });

    if (!section) {
      throw new AppNotFoundException(ErrorCode.CLASS_SECTION_NOT_FOUND);
    }

    const resolved = await this.resolveProgressEnrollment({
      userId: targetUserId,
      classId,
      enrollmentId,
    });
    await this.classProgressAccess.assertCanAccessProgress({
      actorUserId,
      targetUserId,
      classId,
      ecclesiasticalYearId: resolved.ecclesiasticalYearId,
    });
    this.assertProgressMutable(resolved);

    // Find or create section progress using the annual enrollment owner.
    let sectionProgress = await this.prisma.class_section_progress.findFirst({
      where: {
        enrollment_id: resolved.enrollmentId,
        section_id: sectionId,
        active: true,
      },
    });

    if (!sectionProgress) {
      sectionProgress = await this.prisma.class_section_progress.create({
        data: {
          user_id: targetUserId,
          class_id: classId,
          enrollment_id: resolved.enrollmentId,
          module_id: section.module_id,
          section_id: sectionId,
          score: 0,
          active: true,
        },
      });
    }

    const progressId = sectionProgress.section_progress_id;
    const extension = resolveEvidenceFileExtension(file);
    const objectKey = `${progressId}-${Date.now()}.${extension}`;
    const existingEvidenceCount = await (
      this.prisma as any
    ).evidence_files.count({
      where: { section_progress_id: progressId },
    });
    const displayName = buildEvidenceDisplayNameForFile(
      existingEvidenceCount + 1,
      file,
    );

    const uploaded = await this.fileStorage.upload(
      StorageBucketAlias.CLASS_EVIDENCE,
      objectKey,
      file.buffer,
      { contentType: file.mimetype },
    );

    const created = await (this.prisma as any).evidence_files.create({
      data: {
        section_progress_id: progressId,
        file_url: uploaded.url,
        file_name: displayName,
        file_type: this.resolveEvidenceFileType(file),
        uploaded_by_id: actorUserId,
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

    const signedUrl = await this.fileStorage.getSignedDownloadUrl(
      StorageBucketAlias.CLASS_EVIDENCE,
      uploaded.url,
    );

    return this.mapEvidenceFile(created, signedUrl);
  }

  async submitSection(
    targetUserId: string,
    actorUserId: string,
    classId: number,
    sectionId: number,
    enrollmentId?: number,
  ) {
    const resolved = await this.resolveProgressEnrollment({
      userId: targetUserId,
      classId,
      enrollmentId,
    });
    await this.classProgressAccess.assertCanAccessProgress({
      actorUserId,
      targetUserId,
      classId,
      ecclesiasticalYearId: resolved.ecclesiasticalYearId,
    });

    // Find the section progress by annual enrollment owner.
    const sectionProgress = await this.prisma.class_section_progress.findFirst({
      where: {
        enrollment_id: resolved.enrollmentId,
        section_id: sectionId,
        active: true,
      },
      include: {
        evidence_files: {
          where: { active: true },
        },
      },
    });

    if (!sectionProgress) {
      throw new AppNotFoundException(
        ErrorCode.CLASS_SECTION_PROGRESS_NOT_FOUND,
      );
    }

    // Must be in PENDING or REJECTED status to submit
    if (
      sectionProgress.status !== evidence_validation_enum.PENDING &&
      sectionProgress.status !== evidence_validation_enum.REJECTED
    ) {
      throw new AppBadRequestException(
        ErrorCode.CLASS_SECTION_ALREADY_SUBMITTED,
        { status: String(sectionProgress.status) },
      );
    }

    // Must have at least one evidence file
    if (
      !sectionProgress.evidence_files ||
      sectionProgress.evidence_files.length === 0
    ) {
      throw new AppBadRequestException(ErrorCode.CLASS_SECTION_NO_EVIDENCE);
    }

    const updated = await this.prisma.class_section_progress.update({
      where: {
        section_progress_id: sectionProgress.section_progress_id,
      },
      data: {
        status: evidence_validation_enum.SUBMITTED,
        submitted_by_id: actorUserId,
        submitted_at: new Date(),
        modified_at: new Date(),
      },
    });

    return {
      section_progress_id: updated.section_progress_id,
      section_id: updated.section_id,
      status: updated.status,
      submitted_at: updated.submitted_at?.toISOString() ?? null,
    };
  }

  async deleteSectionFile(
    targetUserId: string,
    actorUserId: string,
    classId: number,
    sectionId: number,
    fileId: number,
    enrollmentId?: number,
  ) {
    const resolved = await this.resolveProgressEnrollment({
      userId: targetUserId,
      classId,
      enrollmentId,
    });
    await this.classProgressAccess.assertCanAccessProgress({
      actorUserId,
      targetUserId,
      classId,
      ecclesiasticalYearId: resolved.ecclesiasticalYearId,
    });
    this.assertProgressMutable(resolved);

    // Resolve the section progress from the annual enrollment owner.
    const sectionProgress = await this.prisma.class_section_progress.findFirst({
      where: {
        enrollment_id: resolved.enrollmentId,
        section_id: sectionId,
        active: true,
      },
      select: { section_progress_id: true },
    });

    if (!sectionProgress) {
      throw new AppNotFoundException(ErrorCode.CLASS_EVIDENCE_FILE_NOT_FOUND);
    }

    const fileRecord = await (this.prisma as any).evidence_files.findFirst({
      where: {
        evidence_file_id: fileId,
        section_progress_id: sectionProgress.section_progress_id,
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

    if (!fileRecord) {
      throw new AppNotFoundException(ErrorCode.CLASS_EVIDENCE_FILE_NOT_FOUND);
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

  private mapEvidenceFile(
    file: {
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
    },
    signedUrl?: string,
  ) {
    const resolvedUrl = signedUrl ?? file.file_url;
    return {
      id: String(file.evidence_file_id),
      file_id: file.evidence_file_id,
      url: resolvedUrl,
      file_url: resolvedUrl,
      file_name: file.file_name,
      file_type: file.file_type,
      uploaded_by_name: this.formatUserName(file.uploaded_by ?? null),
      uploaded_at: file.uploaded_at.toISOString(),
    };
  }

  /**
   * Validates that the user can enroll in the target class based on
   * display_order progression rules:
   *
   * 1. Find the user's highest INVESTIDO class within the same club type.
   *    If found, maxAllowedOrder = highestInvested.display_order + 1.
   *
   * 2. If no INVESTIDO class exists, find the user's base class (earliest
   *    enrollment for the same club type — set during post-registration).
   *    maxAllowedOrder = baseClass.display_order (they can only re-enroll
   *    in the same class they originally picked).
   *
   * 3. Exception: if the ecclesiastical year has ended (end_date < today),
   *    maxAllowedOrder is incremented by 1 (they can advance to the next).
   *
   * 4. If target display_order > maxAllowedOrder → throw BadRequestException.
   */
  private async validateDisplayOrderProgression(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      targetClass: {
        class_id: number;
        club_type_id: number;
        display_order: number;
      };
      ecclesiasticalYearId: number;
    },
  ): Promise<void> {
    const { userId, targetClass, ecclesiasticalYearId } = params;

    const [highestInvested, year] = await Promise.all([
      tx.enrollments.findFirst({
        where: {
          user_id: userId,
          investiture_status: 'INVESTIDO',
          active: true,
          classes: { club_type_id: targetClass.club_type_id },
        },
        include: { classes: { select: { display_order: true } } },
        orderBy: { classes: { display_order: 'desc' } },
      }),
      tx.ecclesiastical_years.findUnique({
        where: { year_id: ecclesiasticalYearId },
        select: { end_date: true },
      }),
    ]);

    let maxAllowedOrder: number;

    if (highestInvested) {
      maxAllowedOrder = highestInvested.classes.display_order + 1;
    } else {
      const baseEnrollment = await tx.enrollments.findFirst({
        where: {
          user_id: userId,
          classes: { club_type_id: targetClass.club_type_id },
        },
        include: { classes: { select: { display_order: true } } },
        orderBy: { enrollment_date: 'asc' },
      });

      if (!baseEnrollment) {
        return;
      }

      maxAllowedOrder = baseEnrollment.classes.display_order;
    }

    if (year && year.end_date < new Date()) {
      maxAllowedOrder += 1;
    }

    if (targetClass.display_order > maxAllowedOrder) {
      throw new AppBadRequestException(ErrorCode.CLASS_LEVEL_TOO_HIGH);
    }
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
