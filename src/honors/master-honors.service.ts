import { Injectable, NotFoundException } from '@nestjs/common';
import {
  master_honor_applicability_scope_enum,
  master_honor_requirement_group_type_enum,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  UserMasterHonorDetailDto,
  UserMasterHonorDto,
  UserMasterHonorDisplayStatusLabel,
  UserMasterHonorRoadmapDto,
  UserMasterHonorStatus,
} from './dto/master-honors.dto';

const CURRENT_MASTER_HONOR_STATUSES: UserMasterHonorStatus[] = [
  'AWARDED',
  'REVOKED',
  'RETIRED',
];

type UserMasterHonorRow = Prisma.users_master_honorsGetPayload<{
  select: {
    user_master_honor_id: true;
    master_honor_id: true;
    status: true;
    awarded_at: true;
    revoked_at: true;
    recovered_at: true;
    status_reason: true;
    evaluation_snapshot: true;
    master_honor: {
      select: {
        name: true;
        master_image: true;
      };
    };
  };
}>;

type MasterHonorRoadmapRow = Prisma.master_honorsGetPayload<{
  include: {
    master_honor_divisions: {
      where: { active: true };
      select: { division_id: true };
    };
    requirement_groups: {
      where: { active: true };
      include: {
        honor_category: {
          select: {
            honor_category_id: true;
            name: true;
          };
        };
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
        };
      };
    };
  };
}>;

type UserMasterHonorStatusRow = Prisma.users_master_honorsGetPayload<{
  select: {
    master_honor_id: true;
    status: true;
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
export class MasterHonorsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserMasterHonors(userId: string): Promise<UserMasterHonorDto[]> {
    const records = await this.prisma.users_master_honors.findMany({
      where: {
        user_id: userId,
        active: true,
        status: { in: CURRENT_MASTER_HONOR_STATUSES },
      },
      select: this.userMasterHonorSelect(),
      orderBy: [{ awarded_at: 'desc' }, { created_at: 'desc' }],
      take: 500,
    });

    return records.map((record) => this.toDto(record));
  }

  async getUserMasterHonorDetail(
    userId: string,
    masterHonorId: number,
  ): Promise<UserMasterHonorDetailDto> {
    const record = await this.prisma.users_master_honors.findFirst({
      where: {
        user_id: userId,
        master_honor_id: masterHonorId,
        active: true,
        status: { in: CURRENT_MASTER_HONOR_STATUSES },
      },
      select: this.userMasterHonorSelect(),
    });

    if (!record) {
      throw new NotFoundException('User master honor not found');
    }

    return {
      ...this.toDto(record),
      evaluation_snapshot: record.evaluation_snapshot,
    };
  }

  async getUserMasterHonorRoadmap(
    userId: string,
  ): Promise<UserMasterHonorRoadmapDto[]> {
    const [masterHonors, approvedRows, existingStatuses, activeDivisionId] =
      await Promise.all([
        this.prisma.master_honors.findMany({
          where: { active: true },
          include: {
            master_honor_divisions: {
              where: { active: true },
              select: { division_id: true },
            },
            requirement_groups: {
              where: { active: true },
              orderBy: { display_order: 'asc' },
              include: {
                honor_category: {
                  select: {
                    honor_category_id: true,
                    name: true,
                  },
                },
                options: {
                  where: { active: true },
                  orderBy: { display_order: 'asc' },
                  include: {
                    honors: {
                      where: { active: true },
                      select: { honor_id: true },
                    },
                  },
                },
              },
            },
          },
          orderBy: { name: 'asc' },
          take: 500,
        }) as Promise<MasterHonorRoadmapRow[]>,
        this.prisma.users_honors.findMany({
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
        }) as Promise<ApprovedHonorRow[]>,
        this.prisma.users_master_honors.findMany({
          where: {
            user_id: userId,
            active: true,
            status: { in: CURRENT_MASTER_HONOR_STATUSES },
          },
          select: {
            master_honor_id: true,
            status: true,
          },
        }) as Promise<UserMasterHonorStatusRow[]>,
        this.resolveActiveClubDivision(userId),
      ]);

    const approvedHonors = this.buildApprovedHonorSet(approvedRows);
    const statusByMasterHonorId = new Map(
      existingStatuses.map((row) => [
        row.master_honor_id,
        row.status as UserMasterHonorStatus,
      ]),
    );

    return masterHonors
      .filter((masterHonor) =>
        this.isMasterHonorApplicable(masterHonor, activeDivisionId),
      )
      .map((masterHonor) =>
        this.toRoadmapDto(masterHonor, approvedHonors, statusByMasterHonorId),
      )
      .sort((a, b) => {
        if (a.is_awarded !== b.is_awarded) {
          return a.is_awarded ? 1 : -1;
        }
        if (a.progress_percent !== b.progress_percent) {
          return b.progress_percent - a.progress_percent;
        }
        return a.name.localeCompare(b.name);
      });
  }

  private userMasterHonorSelect() {
    return {
      user_master_honor_id: true,
      master_honor_id: true,
      status: true,
      awarded_at: true,
      revoked_at: true,
      recovered_at: true,
      status_reason: true,
      evaluation_snapshot: true,
      master_honor: {
        select: {
          name: true,
          master_image: true,
        },
      },
    } satisfies Prisma.users_master_honorsSelect;
  }

  private toDto(record: UserMasterHonorRow): UserMasterHonorDto {
    const isCurrent = record.status === 'AWARDED';

    return {
      user_master_honor_id: record.user_master_honor_id,
      master_honor_id: record.master_honor_id,
      name: record.master_honor.name,
      master_image: record.master_honor.master_image,
      status: record.status as UserMasterHonorStatus,
      is_current: isCurrent,
      display_status_label: this.getDisplayStatusLabel(isCurrent),
      awarded_at: this.toIsoString(record.awarded_at),
      revoked_at: this.toIsoString(record.revoked_at),
      recovered_at: this.toIsoString(record.recovered_at),
      status_reason: record.status_reason,
    };
  }

  private getDisplayStatusLabel(
    isCurrent: boolean,
  ): UserMasterHonorDisplayStatusLabel {
    return isCurrent ? 'Vigente' : 'No vigente';
  }

  private toIsoString(value: Date | null): string | null {
    return value ? value.toISOString() : null;
  }

  private toRoadmapDto(
    masterHonor: MasterHonorRoadmapRow,
    approvedHonors: ApprovedHonorSet,
    statusByMasterHonorId: Map<number, UserMasterHonorStatus>,
  ): UserMasterHonorRoadmapDto {
    const groups = masterHonor.requirement_groups.map((group) => {
      if (
        group.group_type ===
        master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS
      ) {
        const matchedHonorIds = new Set<number>();
        const options = group.options.map((option) => {
          const honorIds = option.honors.map((honor) => honor.honor_id);
          const completedHonorIds = honorIds.filter((honorId) =>
            approvedHonors.ids.has(honorId),
          );
          completedHonorIds.forEach((honorId) => matchedHonorIds.add(honorId));

          return {
            option_id: option.option_id,
            label: option.label,
            completed: completedHonorIds.length > 0,
            honor_ids: honorIds,
            completed_honor_ids: completedHonorIds,
          };
        });
        const currentCount = options.filter(
          (option) => option.completed,
        ).length;

        return {
          group_id: group.group_id,
          group_type: 'EXPLICIT_OPTIONS' as const,
          title: group.title,
          description: group.description,
          minimum_required: group.minimum_required,
          current_count: currentCount,
          passed: currentCount >= group.minimum_required,
          honors_category_id: group.honors_category_id,
          category_name: group.honor_category?.name ?? null,
          matched_honor_ids: Array.from(matchedHonorIds),
          options,
        };
      }

      const matchedHonorIds =
        group.honors_category_id != null
          ? Array.from(
              approvedHonors.byCategory.get(group.honors_category_id) ??
                new Set<number>(),
            )
          : [];
      const currentCount = matchedHonorIds.length;

      return {
        group_id: group.group_id,
        group_type: 'CATEGORY_COUNT' as const,
        title: group.title,
        description: group.description,
        minimum_required: group.minimum_required,
        current_count: currentCount,
        passed: currentCount >= group.minimum_required,
        honors_category_id: group.honors_category_id,
        category_name: group.honor_category?.name ?? null,
        matched_honor_ids: matchedHonorIds,
        options: [],
      };
    });

    const status =
      statusByMasterHonorId.get(masterHonor.master_honor_id) ?? null;
    const isCurrent = status === 'AWARDED';
    const requiredTotal = groups.reduce(
      (total, group) => total + Math.max(1, group.minimum_required),
      0,
    );
    const completedTotal = groups.reduce(
      (total, group) =>
        total + Math.min(group.current_count, group.minimum_required),
      0,
    );

    return {
      master_honor_id: masterHonor.master_honor_id,
      name: masterHonor.name,
      master_image: masterHonor.master_image,
      status,
      is_current: isCurrent,
      is_awarded: status != null,
      display_status_label:
        status == null ? null : this.getDisplayStatusLabel(isCurrent),
      completed_groups: groups.filter((group) => group.passed).length,
      total_groups: groups.length,
      progress_percent:
        requiredTotal === 0
          ? 0
          : Math.min(100, Math.round((completedTotal / requiredTotal) * 100)),
      requirement_groups: groups,
    };
  }

  private buildApprovedHonorSet(rows: ApprovedHonorRow[]): ApprovedHonorSet {
    const ids = new Set<number>();
    const byCategory = new Map<number, Set<number>>();

    for (const row of rows) {
      const honor = row.honors;
      if (!honor || ids.has(honor.honor_id)) {
        continue;
      }

      ids.add(honor.honor_id);

      if (honor.honors_category_id == null) {
        continue;
      }

      const categoryHonors =
        byCategory.get(honor.honors_category_id) ?? new Set<number>();
      categoryHonors.add(honor.honor_id);
      byCategory.set(honor.honors_category_id, categoryHonors);
    }

    return { ids, byCategory };
  }

  private isMasterHonorApplicable(
    masterHonor: MasterHonorRoadmapRow,
    activeDivisionId: number | null,
  ): boolean {
    if (
      masterHonor.applicability_scope ===
      master_honor_applicability_scope_enum.ALL
    ) {
      return true;
    }

    if (activeDivisionId == null) {
      return false;
    }

    return masterHonor.master_honor_divisions.some(
      ({ division_id }) => division_id === activeDivisionId,
    );
  }

  private async resolveActiveClubDivision(
    userId: string,
  ): Promise<number | null> {
    const userPr = await this.prisma.users_pr.findUnique({
      where: { user_id: userId },
      select: { active_club_assignment_id: true },
    });

    const explicitAssignmentId = userPr?.active_club_assignment_id;

    const explicit = explicitAssignmentId
      ? await this.prisma.club_role_assignments.findFirst({
          where: {
            assignment_id: explicitAssignmentId,
            user_id: userId,
            active: true,
            status: 'active',
          },
          select: this.activeClubDivisionSelect(),
        })
      : null;

    const assignment =
      explicit ??
      (await this.prisma.club_role_assignments.findFirst({
        where: { user_id: userId, active: true, status: 'active' },
        orderBy: { start_date: 'desc' },
        select: this.activeClubDivisionSelect(),
      }));

    return (
      assignment?.club_sections?.clubs?.local_fields?.unions?.division_id ??
      null
    );
  }

  private activeClubDivisionSelect() {
    return {
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
    } satisfies Prisma.club_role_assignmentsSelect;
  }
}
