import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_CLASS_THRESHOLD_PERCENT,
  sectionMeetsThreshold,
} from './field-class-threshold';

export type ClassRequirementTrack = 'BASIC' | 'ADVANCED' | 'EXTRA';

type EnrollmentForEligibility = {
  enrollment_id: number;
  user_id: string;
  class_id: number;
  ecclesiastical_year_id: number;
  cross_type_enrollment?: boolean | null;
  classes: {
    class_id: number;
    club_type_id: number;
    advanced_enabled: boolean;
  };
  ecclesiastical_year: {
    year_id: number;
    start_date: Date;
  };
};

type RequirementContext = {
  resolved: boolean;
  divisionIds: Set<number>;
  unionIds: Set<number>;
  localFieldIds: Set<number>;
};

export type RequirementTrackProgress = {
  total: number;
  completed: number;
  percentage: number;
};

export type ClassRequirementEligibilityResult = {
  enrollment_id: number;
  class_id: number;
  ecclesiastical_year_id: number;
  applicable_section_ids: number[];
  required_investiture_section_ids: number[];
  completed_required_section_ids: number[];
  context_resolved: boolean;
  has_configured_extra_requirements: boolean;
  basic_progress: RequirementTrackProgress;
  advanced_progress: RequirementTrackProgress;
  extra_progress: RequirementTrackProgress;
  investiture_progress: RequirementTrackProgress;
  overall_progress: number;
  passing_score: number;
  investiture_eligibility: {
    eligible: boolean;
    enabled: boolean;
    reason: string | null;
    total: number;
    completed: number;
    missing_required_sections: number;
    context_resolved: boolean;
  };
  advanced_eligibility: {
    eligible: boolean;
    enabled: boolean;
    reason: string | null;
    total: number;
    completed: number;
  };
};

const REQUIREMENT_TRACKS: ClassRequirementTrack[] = [
  'BASIC',
  'ADVANCED',
  'EXTRA',
];

type ClassSectionRows = Awaited<
  ReturnType<ClassRequirementEligibilityService['findClassSections']>
>;

@Injectable()
export class ClassRequirementEligibilityService {
  private readonly logger = new Logger(ClassRequirementEligibilityService.name);
  constructor(private readonly prisma: PrismaService) {}

  async calculateForEnrollment(
    enrollmentId: number,
  ): Promise<ClassRequirementEligibilityResult | null> {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      select: {
        enrollment_id: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        cross_type_enrollment: true,
        classes: {
          select: {
            class_id: true,
            club_type_id: true,
            advanced_enabled: true,
          },
        },
        ecclesiastical_year: {
          select: {
            year_id: true,
            start_date: true,
          },
        },
      },
    });

    if (!enrollment) return null;

    return this.calculateForEnrollmentRecord(enrollment);
  }

  async calculateForEnrollmentRecord(
    enrollment: EnrollmentForEligibility,
  ): Promise<ClassRequirementEligibilityResult> {
    const [sections, progressRows, context] = await Promise.all([
      this.findClassSections(enrollment),
      this.prisma.class_section_progress.findMany({
        where: {
          enrollment_id: enrollment.enrollment_id,
          active: true,
        },
        select: {
          section_id: true,
          status: true,
          score: true,
        },
      }),
      this.resolveRequirementContext(enrollment),
    ]);

    const passingScore = await this.resolvePassingScore(
      context.localFieldIds,
      enrollment.ecclesiastical_year_id,
    );
    return this.composeResult(
      enrollment,
      sections,
      progressRows,
      context,
      passingScore,
    );
  }

  async calculateForEnrollments(
    enrollmentIds: number[],
  ): Promise<Map<number, ClassRequirementEligibilityResult>> {
    const results = new Map<number, ClassRequirementEligibilityResult>();
    const ids = [...new Set(enrollmentIds)];
    if (ids.length === 0) return results;

    const enrollments = (await this.prisma.enrollments.findMany({
      where: { enrollment_id: { in: ids } },
      select: {
        enrollment_id: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        cross_type_enrollment: true,
        classes: {
          select: {
            class_id: true,
            club_type_id: true,
            advanced_enabled: true,
          },
        },
        ecclesiastical_year: {
          select: {
            year_id: true,
            start_date: true,
          },
        },
      },
    })) as EnrollmentForEligibility[];

    const sectionsByKey = new Map<string, ClassSectionRows>();
    for (const enrollment of enrollments) {
      const key = this.sectionGroupKey(enrollment);
      if (!sectionsByKey.has(key)) {
        sectionsByKey.set(key, await this.findClassSections(enrollment));
      }
    }

    const progressRows = await this.prisma.class_section_progress.findMany({
      where: {
        enrollment_id: { in: enrollments.map((row) => row.enrollment_id) },
        active: true,
      },
      select: {
        enrollment_id: true,
        section_id: true,
        status: true,
        score: true,
      },
    });
    const progressByEnrollment = new Map<
      number,
      Array<{ section_id: number; status: string; score: number | null }>
    >();
    for (const row of progressRows) {
      if (row.enrollment_id == null) continue;
      const enrollmentId = row.enrollment_id;
      const list = progressByEnrollment.get(enrollmentId) ?? [];
      list.push({
        section_id: row.section_id,
        status: row.status,
        score: row.score == null ? null : Number(row.score),
      });
      progressByEnrollment.set(enrollmentId, list);
    }

    const userIds = [...new Set(enrollments.map((row) => row.user_id))];
    const yearIds = [
      ...new Set(enrollments.map((row) => row.ecclesiastical_year_id)),
    ];
    const [profiles, assignments] = await Promise.all([
      this.prisma.users_pr.findMany({
        where: { user_id: { in: userIds } },
        select: { user_id: true, active_club_assignment_id: true },
      }),
      userIds.length === 0
        ? Promise.resolve([])
        : this.prisma.club_role_assignments.findMany({
            where: {
              user_id: { in: userIds },
              ecclesiastical_year_id: { in: yearIds },
              active: true,
              status: 'active',
              club_sections: { active: true },
            },
            orderBy: { start_date: 'desc' },
            select: {
              assignment_id: true,
              user_id: true,
              ecclesiastical_year_id: true,
              club_sections: {
                select: {
                  club_type_id: true,
                  clubs: {
                    select: {
                      local_field_id: true,
                      local_fields: {
                        select: {
                          local_field_id: true,
                          union_id: true,
                          unions: {
                            select: {
                              union_id: true,
                              division_id: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
    ]);
    const explicitByUser = new Map(
      profiles.map((profile) => [
        profile.user_id,
        profile.active_club_assignment_id,
      ]),
    );

    const contexts = new Map<number, RequirementContext>();
    const scorePairs: Array<{
      localFieldId: number;
      ecclesiasticalYearId: number;
    }> = [];
    const seenPairs = new Set<string>();
    for (const enrollment of enrollments) {
      const context = this.buildRequirementContext(
        this.rowsForEnrollment(
          enrollment,
          assignments,
          explicitByUser.get(enrollment.user_id) ?? null,
        ),
      );
      contexts.set(enrollment.enrollment_id, context);
      const localFieldId = [...context.localFieldIds][0];
      if (localFieldId == null) continue;
      const pairKey = `${localFieldId}|${enrollment.ecclesiastical_year_id}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      scorePairs.push({
        localFieldId,
        ecclesiasticalYearId: enrollment.ecclesiastical_year_id,
      });
    }
    const scores = await this.resolvePassingScores(scorePairs);

    for (const enrollment of enrollments) {
      const context = contexts.get(enrollment.enrollment_id) ?? {
        resolved: false,
        divisionIds: new Set<number>(),
        unionIds: new Set<number>(),
        localFieldIds: new Set<number>(),
      };
      const localFieldId = [...context.localFieldIds][0];
      const passingScore =
        localFieldId == null
          ? DEFAULT_CLASS_THRESHOLD_PERCENT
          : (scores.get(
              `${localFieldId}|${enrollment.ecclesiastical_year_id}`,
            ) ?? DEFAULT_CLASS_THRESHOLD_PERCENT);
      results.set(
        enrollment.enrollment_id,
        this.composeResult(
          enrollment,
          sectionsByKey.get(this.sectionGroupKey(enrollment)) ?? [],
          progressByEnrollment.get(enrollment.enrollment_id) ?? [],
          context,
          passingScore,
        ),
      );
    }
    return results;
  }

  private sectionGroupKey(enrollment: EnrollmentForEligibility): string {
    return `${enrollment.class_id}|${enrollment.ecclesiastical_year.start_date.toISOString()}`;
  }

  private composeResult(
    enrollment: EnrollmentForEligibility,
    sections: ClassSectionRows,
    progressRows: Array<{
      section_id: number;
      status: string;
      score: number | null;
    }>,
    context: RequirementContext,
    passingScore: number,
  ): ClassRequirementEligibilityResult {
    const completedSectionIds = new Set(
      progressRows
        .filter((progress) =>
          sectionMeetsThreshold({
            status: progress.status,
            score: progress.score,
            threshold: passingScore,
          }),
        )
        .map((progress) => progress.section_id),
    );

    const hasConfiguredExtraRequirements = sections.some(
      (section) =>
        section.requirement_track === 'EXTRA' &&
        section.required_for_investiture === true,
    );

    const applicableSections = sections.filter((section) => {
      const track = section.requirement_track;

      if (track === 'BASIC') return true;
      if (track === 'ADVANCED') return enrollment.classes.advanced_enabled;
      if (track === 'EXTRA') {
        return this.isExtraSectionApplicable(section, context);
      }

      return false;
    });

    const requiredInvestitureSections = applicableSections.filter(
      (section) =>
        section.requirement_track !== 'ADVANCED' &&
        section.required_for_investiture === true,
    );

    const progressByTrack = new Map<
      ClassRequirementTrack,
      RequirementTrackProgress
    >();
    for (const track of REQUIREMENT_TRACKS) {
      const trackSections = applicableSections.filter(
        (section) => section.requirement_track === track,
      );
      progressByTrack.set(
        track,
        this.buildProgress(trackSections, completedSectionIds),
      );
    }

    const investitureProgress = this.buildProgress(
      requiredInvestitureSections,
      completedSectionIds,
    );
    const contextBlocksExtraResolution =
      !context.resolved && hasConfiguredExtraRequirements;
    const missingRequiredSections = Math.max(
      investitureProgress.total - investitureProgress.completed,
      0,
    );
    const investitureEligible =
      investitureProgress.total > 0 &&
      missingRequiredSections === 0 &&
      !contextBlocksExtraResolution;

    const advancedProgress =
      progressByTrack.get('ADVANCED') ?? this.emptyProgress();
    const advancedEnabled = enrollment.classes.advanced_enabled;
    const advancedEligible =
      advancedEnabled &&
      advancedProgress.total > 0 &&
      advancedProgress.completed === advancedProgress.total;

    return {
      enrollment_id: enrollment.enrollment_id,
      class_id: enrollment.class_id,
      ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
      applicable_section_ids: applicableSections.map(
        (section) => section.section_id,
      ),
      required_investiture_section_ids: requiredInvestitureSections.map(
        (section) => section.section_id,
      ),
      completed_required_section_ids: requiredInvestitureSections
        .filter((section) => completedSectionIds.has(section.section_id))
        .map((section) => section.section_id),
      context_resolved: context.resolved,
      has_configured_extra_requirements: hasConfiguredExtraRequirements,
      basic_progress: progressByTrack.get('BASIC') ?? this.emptyProgress(),
      advanced_progress: advancedProgress,
      extra_progress: progressByTrack.get('EXTRA') ?? this.emptyProgress(),
      investiture_progress: investitureProgress,
      overall_progress: investitureProgress.percentage,
      passing_score: passingScore,
      investiture_eligibility: {
        eligible: investitureEligible,
        enabled: true,
        reason: investitureEligible
          ? null
          : contextBlocksExtraResolution
            ? 'INSTITUTIONAL_CONTEXT_REQUIRED'
            : missingRequiredSections > 0
              ? 'REQUIRED_SECTIONS_INCOMPLETE'
              : 'NO_REQUIRED_SECTIONS',
        total: investitureProgress.total,
        completed: investitureProgress.completed,
        missing_required_sections: contextBlocksExtraResolution
          ? Math.max(missingRequiredSections, 1)
          : missingRequiredSections,
        context_resolved: context.resolved,
      },
      advanced_eligibility: {
        eligible: advancedEligible,
        enabled: advancedEnabled,
        reason: !advancedEnabled
          ? 'ADVANCED_DISABLED'
          : advancedEligible
            ? null
            : advancedProgress.total === 0
              ? 'NO_ADVANCED_REQUIREMENTS'
              : 'ADVANCED_REQUIREMENTS_INCOMPLETE',
        total: advancedProgress.total,
        completed: advancedProgress.completed,
      },
    };
  }

  private async resolvePassingScore(
    localFieldIds: Set<number>,
    ecclesiasticalYearId: number,
  ): Promise<number> {
    const localFieldId = [...localFieldIds][0];
    if (localFieldId == null) {
      return DEFAULT_CLASS_THRESHOLD_PERCENT;
    }
    const thresholds = (
      this.prisma as PrismaService & {
        local_field_class_thresholds?: {
          findUnique: (args: {
            where: {
              local_field_id_ecclesiastical_year_id: {
                local_field_id: number;
                ecclesiastical_year_id: number;
              };
            };
            select: { minimum_percent: true };
          }) => Promise<{ minimum_percent: number } | null>;
        };
      }
    ).local_field_class_thresholds;
    if (!thresholds) {
      return DEFAULT_CLASS_THRESHOLD_PERCENT;
    }
    try {
      const row = await thresholds.findUnique({
        where: {
          local_field_id_ecclesiastical_year_id: {
            local_field_id: localFieldId,
            ecclesiastical_year_id: ecclesiasticalYearId,
          },
        },
        select: { minimum_percent: true },
      });
      return row?.minimum_percent ?? DEFAULT_CLASS_THRESHOLD_PERCENT;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        this.logger.warn(
          'local_field_class_thresholds no existe; se usa el 80 por defecto',
        );
        return DEFAULT_CLASS_THRESHOLD_PERCENT;
      }
      throw error;
    }
  }

  private async findClassSections(enrollment: EnrollmentForEligibility) {
    const targetYearStartDate = enrollment.ecclesiastical_year.start_date;

    return this.prisma.class_sections.findMany({
      where: {
        active: true,
        class_modules: {
          class_id: enrollment.class_id,
          active: true,
        },
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
      },
      select: {
        section_id: true,
        requirement_track: true,
        required_for_investiture: true,
        owner_division_id: true,
        owner_union_id: true,
        owner_local_field_id: true,
      },
    });
  }

  private async resolveRequirementContext(
    enrollment: EnrollmentForEligibility,
  ): Promise<RequirementContext> {
    const emptyContext = (): RequirementContext => ({
      resolved: false,
      divisionIds: new Set<number>(),
      unionIds: new Set<number>(),
      localFieldIds: new Set<number>(),
    });

    const userPr = await this.prisma.users_pr.findUnique({
      where: { user_id: enrollment.user_id },
      select: { active_club_assignment_id: true },
    });

    const explicitAssignmentId = userPr?.active_club_assignment_id;
    if (explicitAssignmentId) {
      const explicitAssignment = await this.findContextAssignments(enrollment, {
        assignment_id: explicitAssignmentId,
      });
      if (explicitAssignment.length > 0) {
        return this.buildRequirementContext(
          this.preferCrossTypeHome(enrollment, explicitAssignment),
        );
      }
    }

    const assignments = await this.findContextAssignments(enrollment);
    if (assignments.length === 0) return emptyContext();

    return this.buildRequirementContext(
      this.preferCrossTypeHome(enrollment, assignments),
    );
  }

  private async findContextAssignments(
    enrollment: EnrollmentForEligibility,
    extraWhere: Record<string, unknown> = {},
  ) {
    return this.prisma.club_role_assignments.findMany({
      where: {
        ...extraWhere,
        user_id: enrollment.user_id,
        ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
        active: true,
        status: 'active',
        club_sections: enrollment.cross_type_enrollment
          ? { active: true }
          : {
              active: true,
              club_type_id: enrollment.classes.club_type_id,
            },
      },
      orderBy: { start_date: 'desc' },
      select: {
        club_sections: {
          select: {
            club_type_id: true,
            clubs: {
              select: {
                local_field_id: true,
                local_fields: {
                  select: {
                    local_field_id: true,
                    union_id: true,
                    unions: {
                      select: {
                        union_id: true,
                        division_id: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  private preferCrossTypeHome<
    T extends {
      club_sections?: { club_type_id?: number | null } | null;
    },
  >(enrollment: EnrollmentForEligibility, assignments: T[]): T[] {
    if (!enrollment.cross_type_enrollment) return assignments;
    const home = assignments.filter(
      (row) =>
        typeof row.club_sections?.club_type_id === 'number' &&
        row.club_sections.club_type_id !== enrollment.classes.club_type_id,
    );
    return home.length > 0 ? home : assignments;
  }

  private rowsForEnrollment<
    T extends {
      assignment_id?: string | null;
      user_id?: string | null;
      ecclesiastical_year_id?: number | null;
      club_sections?: { club_type_id?: number | null } | null;
    },
  >(
    enrollment: EnrollmentForEligibility,
    rows: T[],
    explicitAssignmentId: string | null,
  ): T[] {
    const mine = rows.filter(
      (row) =>
        row.user_id === enrollment.user_id &&
        row.ecclesiastical_year_id === enrollment.ecclesiastical_year_id,
    );
    const typed = enrollment.cross_type_enrollment
      ? mine
      : mine.filter(
          (row) =>
            row.club_sections?.club_type_id === enrollment.classes.club_type_id,
        );
    const chosen =
      explicitAssignmentId == null
        ? typed
        : typed.some((row) => row.assignment_id === explicitAssignmentId)
          ? typed.filter((row) => row.assignment_id === explicitAssignmentId)
          : typed;
    return this.preferCrossTypeHome(enrollment, chosen);
  }

  private async resolvePassingScores(
    pairs: Array<{ localFieldId: number; ecclesiasticalYearId: number }>,
  ): Promise<Map<string, number>> {
    const scores = new Map<string, number>();
    const keyOf = (localFieldId: number, ecclesiasticalYearId: number) =>
      `${localFieldId}|${ecclesiasticalYearId}`;
    if (pairs.length === 0) return scores;

    const thresholds = (
      this.prisma as PrismaService & {
        local_field_class_thresholds?: {
          findMany?: (args: {
            where: {
              OR: Array<{
                local_field_id: number;
                ecclesiastical_year_id: number;
              }>;
            };
            select: {
              local_field_id: true;
              ecclesiastical_year_id: true;
              minimum_percent: true;
            };
          }) => Promise<
            Array<{
              local_field_id: number;
              ecclesiastical_year_id: number;
              minimum_percent: number;
            }>
          >;
        };
      }
    ).local_field_class_thresholds;

    if (!thresholds?.findMany) {
      for (const pair of pairs) {
        scores.set(
          keyOf(pair.localFieldId, pair.ecclesiasticalYearId),
          await this.resolvePassingScore(
            new Set([pair.localFieldId]),
            pair.ecclesiasticalYearId,
          ),
        );
      }
      return scores;
    }

    try {
      const rows = await thresholds.findMany({
        where: {
          OR: pairs.map((pair) => ({
            local_field_id: pair.localFieldId,
            ecclesiastical_year_id: pair.ecclesiasticalYearId,
          })),
        },
        select: {
          local_field_id: true,
          ecclesiastical_year_id: true,
          minimum_percent: true,
        },
      });
      for (const pair of pairs) {
        const row = rows.find(
          (item) =>
            item.local_field_id === pair.localFieldId &&
            item.ecclesiastical_year_id === pair.ecclesiasticalYearId,
        );
        scores.set(
          keyOf(pair.localFieldId, pair.ecclesiasticalYearId),
          row?.minimum_percent ?? DEFAULT_CLASS_THRESHOLD_PERCENT,
        );
      }
      return scores;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        this.logger.warn(
          'local_field_class_thresholds no existe; se usa el 80 por defecto',
        );
        for (const pair of pairs) {
          scores.set(
            keyOf(pair.localFieldId, pair.ecclesiasticalYearId),
            DEFAULT_CLASS_THRESHOLD_PERCENT,
          );
        }
        return scores;
      }
      throw error;
    }
  }

  private buildRequirementContext(
    assignments: Awaited<ReturnType<typeof this.findContextAssignments>>,
  ): RequirementContext {
    const context: RequirementContext = {
      resolved: false,
      divisionIds: new Set<number>(),
      unionIds: new Set<number>(),
      localFieldIds: new Set<number>(),
    };

    for (const assignment of assignments) {
      const club = assignment.club_sections?.clubs;
      const localField = club?.local_fields;
      const union = localField?.unions;

      if (club?.local_field_id) context.localFieldIds.add(club.local_field_id);
      if (localField?.local_field_id) {
        context.localFieldIds.add(localField.local_field_id);
      }
      if (localField?.union_id) context.unionIds.add(localField.union_id);
      if (union?.union_id) context.unionIds.add(union.union_id);
      if (union?.division_id) context.divisionIds.add(union.division_id);
    }

    context.resolved =
      context.localFieldIds.size > 0 ||
      context.unionIds.size > 0 ||
      context.divisionIds.size > 0;

    return context;
  }

  private isExtraSectionApplicable(
    section: {
      owner_division_id: number | null;
      owner_union_id: number | null;
      owner_local_field_id: number | null;
    },
    context: RequirementContext,
  ): boolean {
    return (
      (section.owner_division_id !== null &&
        context.divisionIds.has(section.owner_division_id)) ||
      (section.owner_union_id !== null &&
        context.unionIds.has(section.owner_union_id)) ||
      (section.owner_local_field_id !== null &&
        context.localFieldIds.has(section.owner_local_field_id))
    );
  }

  private buildProgress(
    sections: Array<{ section_id: number }>,
    completedSectionIds: Set<number>,
  ): RequirementTrackProgress {
    const total = sections.length;
    const completed = sections.filter((section) =>
      completedSectionIds.has(section.section_id),
    ).length;

    return {
      total,
      completed,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  private emptyProgress(): RequirementTrackProgress {
    return { total: 0, completed: 0, percentage: 0 };
  }
}
