import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  master_honor_applicability_scope_enum,
  master_honor_requirement_group_type_enum,
  user_master_honor_source_enum,
  user_master_honor_status_enum,
  user_master_honor_status_reason_enum,
} from '@prisma/client';

export type MasterHonorTransition =
  | 'NONE'
  | 'AWARDED'
  | 'RECOVERED'
  | 'REVOKED'
  | 'RETIRED';

export interface MasterHonorEvaluationOptionSnapshot {
  option_id: number;
  label: string;
  matched_honor_ids: number[];
}

export interface MasterHonorEvaluationSnapshot {
  master_honor_id: number;
  master_honor_name: string;
  evaluated_at: string;
  awarded_division_id: number | null;
  groups: Array<{
    group_id: number;
    group_type: 'EXPLICIT_OPTIONS' | 'CATEGORY_COUNT';
    minimum_required: number;
    current_count: number;
    passed: boolean;
    matched_honor_ids: number[];
    matched_options?: MasterHonorEvaluationOptionSnapshot[];
  }>;
}

export interface MasterHonorEvaluationResult {
  master_honor_id: number;
  master_honor_name: string;
  status: user_master_honor_status_enum | null;
  previous_status: user_master_honor_status_enum | null;
  transition: MasterHonorTransition;
  status_reason: user_master_honor_status_reason_enum | null;
  user_master_honor_id: number | null;
  snapshot: MasterHonorEvaluationSnapshot;
}

type EvaluatableMasterHonor = Prisma.master_honorsGetPayload<{
  include: {
    master_honor_divisions: {
      where: { active: true };
      select: { division_id: true };
    };
    requirement_groups: {
      where: { active: true };
      include: {
        options: {
          where: { active: true };
          include: {
            honors: {
              where: { active: true };
              select: {
                honor_id: true;
              };
            };
          };
          orderBy: { display_order: 'asc' };
        };
      };
      orderBy: { display_order: 'asc' };
    };
  };
}>;

type EvaluatedUserMasterHonor = Prisma.users_master_honorsGetPayload<{
  select: {
    user_master_honor_id: true;
    master_honor_id: true;
    status: true;
    awarded_division_id: true;
    awarded_at: true;
    revoked_at: true;
    recovered_at: true;
    status_reason: true;
  };
}>;

type ApprovedHonorRow = {
  honors: {
    honor_id: number;
    honors_category_id: number | null;
  };
};

type ApprovedHonorSet = {
  ids: Set<number>;
  byCategory: Map<number, Set<number>>;
};

@Injectable()
export class MasterHonorsEvaluatorService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluateUser(
    userId: string,
    opts?: { masterHonorId?: number; jobId?: string },
  ): Promise<MasterHonorEvaluationResult[]> {
    if (opts?.masterHonorId) {
      const result = await this.evaluateUserForMasterHonor(userId, opts.masterHonorId, {
        jobId: opts.jobId,
      });
      return result ? [result] : [];
    }

    return this.evaluateUserInternal(userId, {
      includeUnawarded: false,
      jobId: opts?.jobId,
    });
  }

  async evaluateUserForMasterHonor(
    userId: string,
    masterHonorId: number,
    opts?: { jobId?: string },
  ): Promise<MasterHonorEvaluationResult> {
    const results = await this.evaluateUserInternal(userId, {
      masterHonorId,
      includeUnawarded: true,
      jobId: opts?.jobId,
    });

    if (results.length === 0) {
      throw new Error(`Master honor ${masterHonorId} not found`);
    }

    return results[0];
  }

  private async evaluateUserInternal(
    userId: string,
    opts: {
      masterHonorId?: number;
      includeUnawarded: boolean;
      jobId?: string;
    },
  ): Promise<MasterHonorEvaluationResult[]> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.users_master_honors.findMany({
        where: {
          user_id: userId,
          active: true,
        },
        select: {
          user_master_honor_id: true,
          master_honor_id: true,
          status: true,
          awarded_division_id: true,
          awarded_at: true,
          revoked_at: true,
          recovered_at: true,
          status_reason: true,
        },
      });

      const existingByMasterHonorId = new Map(
        existing.map((row) => [row.master_honor_id, row]),
      );

      const [masterHonors, approvedRows, activeDivision] = await Promise.all([
        this.fetchMasterHonors(tx, {
          masterHonorId: opts.masterHonorId,
          existingRecordIds: existing.map((row) => row.master_honor_id),
        }),
        tx.users_honors.findMany({
          where: {
            user_id: userId,
            active: true,
            validation_status: 'APPROVED',
          },
          select: {
            honors: {
              select: {
                honor_id: true,
                honors_category_id: true,
              },
            },
          },
        }),
        this.resolveActiveClubDivision(tx, userId),
      ]);

      const approvedHonors = this.buildApprovedHonorSet(approvedRows as ApprovedHonorRow[]);

      const now = new Date();
      const results: MasterHonorEvaluationResult[] = [];

      for (const masterHonor of masterHonors) {
        const existingRecord = existingByMasterHonorId.get(
          masterHonor.master_honor_id,
        ) ?? null;

        const applicableDivisionId =
          existingRecord?.awarded_division_id ?? activeDivision;

        const evaluation = this.evaluateMasterHonor(
          masterHonor,
          approvedHonors,
          applicableDivisionId,
          now,
        );

        if (
          !existingRecord &&
          !opts.includeUnawarded &&
          evaluation.status == null
        ) {
          continue;
        }

        const persisted = await this.persistEvaluation(
          tx,
          userId,
          masterHonor,
          existingRecord,
          evaluation,
          now,
          opts.jobId,
        );

        results.push(persisted);
      }

      return results;
    });
  }

  private evaluateMasterHonor(
    masterHonor: EvaluatableMasterHonor,
    approvedHonors: ApprovedHonorSet,
    applicableDivisionId: number | null,
    now: Date,
  ): MasterHonorEvaluationResult {
    const groups: MasterHonorEvaluationSnapshot['groups'] = [];
    let allGroupsPass = true;

    for (const group of masterHonor.requirement_groups) {
      if (group.group_type === master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS) {
        const matchedOptions: MasterHonorEvaluationOptionSnapshot[] = [];
        const matchedHonorIds = new Set<number>();

        for (const option of group.options) {
          const optionMatched = [
            ...new Set(
              option.honors
                .map((honor) => honor.honor_id)
                .filter((honorId) => approvedHonors.ids.has(honorId)),
            ),
          ];

          if (optionMatched.length > 0) {
            for (const honorId of optionMatched) {
              matchedHonorIds.add(honorId);
            }

            matchedOptions.push({
              option_id: option.option_id,
              label: option.label,
              matched_honor_ids: optionMatched,
            });
          }
        }

        const currentCount = matchedOptions.length;
        const passed = currentCount >= group.minimum_required;

        if (!passed) {
          allGroupsPass = false;
        }

        groups.push({
          group_id: group.group_id,
          group_type: 'EXPLICIT_OPTIONS',
          minimum_required: group.minimum_required,
          current_count: currentCount,
          passed,
          matched_honor_ids: Array.from(matchedHonorIds),
          matched_options: matchedOptions,
        });

        continue;
      }

      const matchedIds =
        group.honors_category_id != null
          ? approvedHonors.byCategory.get(group.honors_category_id) ?? new Set<number>()
          : new Set<number>();
      const currentCount = matchedIds.size;
      const passed = currentCount >= group.minimum_required;

      if (!passed) {
        allGroupsPass = false;
      }

      groups.push({
        group_id: group.group_id,
        group_type: 'CATEGORY_COUNT',
        minimum_required: group.minimum_required,
        current_count: currentCount,
        passed,
        matched_honor_ids: Array.from(matchedIds),
      });
    }

    const eligibleByCriteria =
      masterHonor.requirement_groups.length > 0 && allGroupsPass;
    const applicable = this.isApplicable(
      masterHonor,
      masterHonor.active,
      applicableDivisionId,
    );

    const qualifies = masterHonor.active && applicable && eligibleByCriteria;

    const snapshot: MasterHonorEvaluationSnapshot = {
      master_honor_id: masterHonor.master_honor_id,
      master_honor_name: masterHonor.name,
      evaluated_at: now.toISOString(),
      awarded_division_id: applicableDivisionId,
      groups,
    };

    if (!masterHonor.active) {
      return {
        master_honor_id: masterHonor.master_honor_id,
        master_honor_name: masterHonor.name,
        status: null,
        previous_status: null,
        transition: 'NONE',
        status_reason: null,
        user_master_honor_id: null,
        snapshot,
      };
    }

    if (!qualifies) {
      return {
        master_honor_id: masterHonor.master_honor_id,
        master_honor_name: masterHonor.name,
        status: null,
        previous_status: null,
        transition: 'NONE',
        status_reason: null,
        user_master_honor_id: null,
        snapshot,
      };
    }

    return {
      master_honor_id: masterHonor.master_honor_id,
      master_honor_name: masterHonor.name,
      status: user_master_honor_status_enum.AWARDED,
      previous_status: null,
      transition: 'AWARDED',
      status_reason: null,
      user_master_honor_id: null,
      snapshot,
    };
  }

  private isApplicable(
    masterHonor: EvaluatableMasterHonor,
    isHonorActive: boolean,
    applicableDivisionId: number | null,
  ) {
    if (!isHonorActive) {
      return false;
    }

    if (masterHonor.applicability_scope === master_honor_applicability_scope_enum.ALL) {
      return true;
    }

    if (applicableDivisionId == null) {
      return false;
    }

    return masterHonor.master_honor_divisions.some(
      ({ division_id }) => division_id === applicableDivisionId,
    );
  }

  private async persistEvaluation(
    tx: Prisma.TransactionClient,
    userId: string,
    masterHonor: EvaluatableMasterHonor,
    existingRecord: EvaluatedUserMasterHonor | null,
    evaluation: MasterHonorEvaluationResult,
    now: Date,
    jobId?: string,
  ): Promise<MasterHonorEvaluationResult> {
    if (!existingRecord) {
      if (!evaluation.status) {
        return {
          ...evaluation,
          user_master_honor_id: null,
        };
      }

      const created = await tx.users_master_honors.create({
        data: {
          user_id: userId,
          master_honor_id: masterHonor.master_honor_id,
          status: evaluation.status,
          awarded_division_id: evaluation.snapshot.awarded_division_id,
          source: user_master_honor_source_enum.AUTO,
          awarded_at: now,
          evaluated_at: now,
          status_reason: null,
          evaluation_snapshot: evaluation.snapshot as unknown as Prisma.JsonObject,
          active: true,
          modified_at: now,
        },
      });

      await tx.master_honor_evaluation_history.create({
        data: {
          user_master_honor_id: created.user_master_honor_id,
          user_id: userId,
          master_honor_id: masterHonor.master_honor_id,
          from_status: null,
          to_status: evaluation.status,
          reason: null,
          evaluation_snapshot: evaluation.snapshot as unknown as Prisma.JsonObject,
          created_by_job_id: jobId,
        },
      });

      return {
        ...evaluation,
        previous_status: null,
        transition: 'AWARDED',
        user_master_honor_id: created.user_master_honor_id,
      };
    }

    const { nextStatus, reason, transition } = this.getNextStatus(
      existingRecord,
      masterHonor,
      evaluation,
    );

    const updated = await tx.users_master_honors.update({
      where: { user_master_honor_id: existingRecord.user_master_honor_id },
      data: {
        status: nextStatus,
        status_reason: reason,
        evaluated_at: now,
        evaluation_snapshot: evaluation.snapshot as unknown as Prisma.JsonObject,
        modified_at: now,
        ...(existingRecord.status !== nextStatus &&
        nextStatus === user_master_honor_status_enum.AWARDED
          ? { awarded_at: existingRecord.awarded_at ?? now }
          : {}),
        ...(existingRecord.status !== nextStatus &&
        nextStatus === user_master_honor_status_enum.REVOKED
          ? { revoked_at: now }
          : {}),
        ...(existingRecord.status !== nextStatus &&
        existingRecord.status ===
          user_master_honor_status_enum.REVOKED &&
        nextStatus === user_master_honor_status_enum.AWARDED
          ? { recovered_at: now }
          : {}),
      },
    });

    if (existingRecord.status !== nextStatus) {
      await tx.master_honor_evaluation_history.create({
        data: {
          user_master_honor_id: existingRecord.user_master_honor_id,
          user_id: userId,
          master_honor_id: masterHonor.master_honor_id,
          from_status: existingRecord.status,
          to_status: nextStatus,
          reason,
          evaluation_snapshot: evaluation.snapshot as unknown as Prisma.JsonObject,
          created_by_job_id: jobId,
        },
      });
    }

    return {
      ...evaluation,
      status: nextStatus,
      previous_status: existingRecord.status,
      transition,
      status_reason: reason,
      user_master_honor_id: updated.user_master_honor_id,
    };
  }

  private getNextStatus(
    existingRecord: EvaluatedUserMasterHonor,
    masterHonor: EvaluatableMasterHonor,
    evaluation: MasterHonorEvaluationResult,
  ) {
    const currentlyRetired =
      existingRecord.status === user_master_honor_status_enum.RETIRED;

    if (!masterHonor.active) {
      if (currentlyRetired) {
        return {
          nextStatus: user_master_honor_status_enum.RETIRED,
          reason: existingRecord.status_reason,
          transition: 'NONE' as const,
        };
      }

      return {
        nextStatus: user_master_honor_status_enum.RETIRED,
        reason: user_master_honor_status_reason_enum.MASTER_HONOR_INACTIVE,
        transition: 'RETIRED' as const,
      };
    }

    if (currentlyRetired) {
      return {
        nextStatus: existingRecord.status,
        reason: existingRecord.status_reason,
        transition: 'NONE' as const,
      };
    }

    if (!evaluation.status && existingRecord.status === user_master_honor_status_enum.AWARDED) {
      return {
        nextStatus: user_master_honor_status_enum.REVOKED,
        reason: user_master_honor_status_reason_enum.USER_NO_LONGER_QUALIFIES,
        transition: 'REVOKED' as const,
      };
    }

    if (evaluation.status && existingRecord.status === user_master_honor_status_enum.REVOKED) {
      return {
        nextStatus: user_master_honor_status_enum.AWARDED,
        reason: user_master_honor_status_reason_enum.RECOVERED,
        transition: 'RECOVERED' as const,
      };
    }

    return {
      nextStatus: existingRecord.status,
      reason: existingRecord.status_reason,
      transition: 'NONE' as const,
    };
  }

  private buildApprovedHonorSet(rows: ApprovedHonorRow[]): ApprovedHonorSet {
    const ids = new Set<number>();
    const byCategory = new Map<number, Set<number>>();

    for (const row of rows) {
      const honor = row.honors;

      if (!honor) {
        continue;
      }

      if (ids.has(honor.honor_id)) {
        continue;
      }

      ids.add(honor.honor_id);

      if (honor.honors_category_id == null) {
        continue;
      }

      const categorySet = byCategory.get(honor.honors_category_id) ?? new Set<number>();
      categorySet.add(honor.honor_id);
      byCategory.set(honor.honors_category_id, categorySet);
    }

    return { ids, byCategory };
  }

  private fetchMasterHonors(
    tx: Prisma.TransactionClient,
    opts: {
      masterHonorId?: number;
      existingRecordIds: number[];
    },
  ) {
    const where: Prisma.master_honorsWhereInput = opts.masterHonorId
      ? { master_honor_id: opts.masterHonorId }
      : {
          OR: [
            { active: true },
            {
              master_honor_id: {
                in:
                  opts.existingRecordIds.length > 0
                    ? opts.existingRecordIds
                    : [0],
              },
            },
          ],
        };

    return tx.master_honors.findMany({
      where,
      include: {
        master_honor_divisions: {
          where: { active: true },
          select: { division_id: true },
        },
        requirement_groups: {
          where: { active: true },
          include: {
            options: {
              where: { active: true },
              include: {
                honors: {
                  where: { active: true },
                  select: {
                    honor_id: true,
                  },
                },
              },
              orderBy: { display_order: 'asc' },
            },
          },
          orderBy: { display_order: 'asc' },
        },
      },
      orderBy: { master_honor_id: 'asc' },
    }) as Promise<EvaluatableMasterHonor[]>;
  }

  private async resolveActiveClubDivision(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<number | null> {
    const userPr = await tx.users_pr.findUnique({
      where: { user_id: userId },
      select: { active_club_assignment_id: true },
    });

    const explicitAssignmentId = userPr?.active_club_assignment_id;

    const explicit = explicitAssignmentId
      ? await tx.club_role_assignments.findFirst({
          where: {
            assignment_id: explicitAssignmentId,
            user_id: userId,
            active: true,
            status: 'active',
          },
          select: {
            club_sections: {
              select: {
                clubs: {
                  select: {
                    local_fields: {
                      select: {
                        unions: {
                          select: {
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
        })
      : null;

    const assignment = explicit ??
      (await tx.club_role_assignments.findFirst({
        where: { user_id: userId, active: true, status: 'active' },
        orderBy: { start_date: 'desc' },
        select: {
          club_sections: {
            select: {
              clubs: {
                select: {
                  local_fields: {
                    select: {
                      unions: {
                        select: {
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
      }));

    return assignment?.club_sections?.clubs?.local_fields?.unions?.division_id ?? null;
  }
}
