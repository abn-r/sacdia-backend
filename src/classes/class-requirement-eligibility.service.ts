import { Injectable } from '@nestjs/common';
import { evidence_validation_enum } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ClassRequirementTrack = 'BASIC' | 'ADVANCED' | 'EXTRA';

type EnrollmentForEligibility = {
  enrollment_id: number;
  user_id: string;
  class_id: number;
  ecclesiastical_year_id: number;
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

@Injectable()
export class ClassRequirementEligibilityService {
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

    return this.calculateForEnrollmentRecord(
      enrollment as EnrollmentForEligibility,
    );
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

    const completedSectionIds = new Set(
      progressRows
        .filter(
          (progress) =>
            progress.status !== evidence_validation_enum.REJECTED &&
            (progress.status === evidence_validation_enum.VALIDATED ||
              progress.score >= 70),
        )
        .map((progress) => progress.section_id),
    );

    const hasConfiguredExtraRequirements = sections.some(
      (section) =>
        section.requirement_track === 'EXTRA' &&
        section.required_for_investiture === true,
    );

    const applicableSections = sections.filter((section) => {
      const track = section.requirement_track as ClassRequirementTrack;

      if (track === 'BASIC') return true;
      if (track === 'ADVANCED') return enrollment.classes.advanced_enabled;
      if (track === 'EXTRA') return this.isExtraSectionApplicable(section, context);

      return false;
    });

    const requiredInvestitureSections = applicableSections.filter(
      (section) =>
        section.requirement_track !== 'ADVANCED' &&
        section.required_for_investiture === true,
    );

    const progressByTrack = new Map<ClassRequirementTrack, RequirementTrackProgress>();
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

    const advancedProgress = progressByTrack.get('ADVANCED') ??
      this.emptyProgress();
    const advancedEnabled = enrollment.classes.advanced_enabled;
    const advancedEligible =
      advancedEnabled &&
      advancedProgress.total > 0 &&
      advancedProgress.completed === advancedProgress.total;

    return {
      enrollment_id: enrollment.enrollment_id,
      class_id: enrollment.class_id,
      ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
      applicable_section_ids: applicableSections.map((section) => section.section_id),
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
        return this.buildRequirementContext(explicitAssignment);
      }
    }

    const assignments = await this.findContextAssignments(enrollment);
    if (assignments.length === 0) return emptyContext();

    return this.buildRequirementContext(assignments);
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
        club_sections: {
          active: true,
          club_type_id: enrollment.classes.club_type_id,
        },
      },
      orderBy: { start_date: 'desc' },
      select: {
        club_sections: {
          select: {
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
