import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConflictException, AppNotFoundException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export type AnnualBaseHint = {
  sourceClubId?: number;
  sourceSectionId?: number;
};

export type ResolvedAnnualBase = {
  clubId: number;
  baseSectionId: number;
  clubTypeName: string;
};

export type EnsureNotEnrolledResult = {
  assignment_id: string | null;
  created: boolean;
};

export type LegacyConflictReport = {
  duplicateMemberGroups: Array<{
    user_id: string;
    club_section_id: number;
    ecclesiastical_year_id: number;
    count: number;
  }>;
  designatedRows: number;
};

export type NotEnrolledListItem = {
  user_id: string;
  name?: string;
};

type DbClient = Prisma.TransactionClient | PrismaService;

const GUIDE_MAJOR_ASSET_CODE = 'GM-01';
const AV_CQ_TYPE_NAMES = ['Aventureros', 'Conquistadores'] as const;
const VALID_MEMBERSHIP_STATUSES = ['active', 'inactive'] as const;

@Injectable()
export class AnnualMembershipPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveBase(
    tx: DbClient,
    userId: string,
    hint?: AnnualBaseHint,
  ): Promise<ResolvedAnnualBase> {
    if (hint?.sourceClubId != null || hint?.sourceSectionId != null) {
      return this.resolveReturnBase(tx, userId, hint);
    }

    const approvedTransfer = await tx.club_transfer_requests.findFirst({
      where: { user_id: userId, status: 'approved' },
      orderBy: { reviewed_at: 'desc' },
      select: {
        to_section_id: true,
        to_section: {
          select: {
            club_section_id: true,
            main_club_id: true,
            active: true,
            club_type_id: true,
            club_types: { select: { name: true } },
          },
        },
      },
    });

    if (
      approvedTransfer?.to_section?.active === true &&
      approvedTransfer.to_section.main_club_id != null
    ) {
      return {
        clubId: approvedTransfer.to_section.main_club_id,
        baseSectionId: approvedTransfer.to_section_id,
        clubTypeName: approvedTransfer.to_section.club_types?.name ?? '',
      };
    }

    const assignments = await tx.club_role_assignments.findMany({
      where: {
        user_id: userId,
        active: true,
        club_section_id: { not: null },
      },
      select: {
        assignment_id: true,
        club_section_id: true,
        status: true,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            active: true,
            club_types: { select: { name: true } },
          },
        },
      },
    });

    const candidates = new Map<number, ResolvedAnnualBase>();
    for (const assignment of assignments) {
      if (
        assignment.status == null ||
        !VALID_MEMBERSHIP_STATUSES.includes(
          assignment.status as (typeof VALID_MEMBERSHIP_STATUSES)[number],
        )
      ) {
        continue;
      }
      const section = assignment.club_sections;
      if (
        section == null ||
        section.active !== true ||
        section.main_club_id == null ||
        assignment.club_section_id == null
      ) {
        continue;
      }
      candidates.set(assignment.club_section_id, {
        clubId: section.main_club_id,
        baseSectionId: assignment.club_section_id,
        clubTypeName: section.club_types?.name ?? '',
      });
    }

    if (candidates.size !== 1) {
      throw new AppConflictException(ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED);
    }

    return candidates.values().next().value as ResolvedAnnualBase;
  }

  async ensureNotEnrolled(
    tx: DbClient,
    userId: string,
    baseSectionId: number,
    year: { year_id: number; start_date: Date },
  ): Promise<EnsureNotEnrolledResult> {
    const directorRole = await tx.roles.findFirst({
      where: { role_name: 'director', role_category: 'CLUB', active: true },
      select: { role_id: true },
    });

    if (directorRole) {
      const operationalDirector = await tx.club_role_assignments.findFirst({
        where: {
          user_id: userId,
          club_section_id: baseSectionId,
          ecclesiastical_year_id: year.year_id,
          role_id: directorRole.role_id,
          status: 'active',
        },
        select: { assignment_id: true },
      });

      if (operationalDirector) {
        return { assignment_id: operationalDirector.assignment_id, created: false };
      }
    }

    const memberRole = await tx.roles.findFirst({
      where: { role_name: 'member', role_category: 'CLUB', active: true },
      select: { role_id: true },
    });

    if (!memberRole) {
      throw new AppNotFoundException(ErrorCode.POST_REG_MEMBER_ROLE_NOT_FOUND);
    }

    const existing = await tx.club_role_assignments.findFirst({
      where: {
        user_id: userId,
        role_id: memberRole.role_id,
        club_section_id: baseSectionId,
        ecclesiastical_year_id: year.year_id,
        status: { not: 'ended' },
      },
      select: {
        assignment_id: true,
        status: true,
        ecclesiastical_year_id: true,
        club_section_id: true,
      },
    });

    if (existing) {
      return { assignment_id: existing.assignment_id, created: false };
    }

    const created = await tx.club_role_assignments.create({
      data: {
        user_id: userId,
        role_id: memberRole.role_id,
        club_section_id: baseSectionId,
        ecclesiastical_year_id: year.year_id,
        start_date: year.start_date,
        active: true,
        status: 'inactive',
      },
      select: { assignment_id: true },
    });

    return { assignment_id: created.assignment_id, created: true };
  }

  async listNotEnrolled(
    tx: DbClient,
    sectionId: number,
    yearId: number,
  ): Promise<NotEnrolledListItem[]> {
    const memberRole = await tx.roles.findFirst({
      where: { role_name: 'member', role_category: 'CLUB', active: true },
      select: { role_id: true },
    });

    if (!memberRole) {
      return [];
    }

    const rows = await tx.club_role_assignments.findMany({
      where: {
        club_section_id: sectionId,
        ecclesiastical_year_id: yearId,
        role_id: memberRole.role_id,
        status: 'inactive',
        active: true,
      },
      select: {
        user_id: true,
        users: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      user_id: row.user_id,
      name: [row.users?.name, row.users?.paternal_last_name, row.users?.maternal_last_name]
        .filter(Boolean)
        .join(' ')
        .trim(),
    }));
  }

  async reportLegacyConflicts(tx: DbClient): Promise<LegacyConflictReport> {
    const memberRole = await tx.roles.findFirst({
      where: { role_name: 'member', role_category: 'CLUB', active: true },
      select: { role_id: true },
    });

    const memberRows = memberRole
      ? await tx.club_role_assignments.findMany({
          where: {
            role_id: memberRole.role_id,
            active: true,
            status: { in: ['active', 'inactive'] },
            club_section_id: { not: null },
          },
          select: {
            user_id: true,
            club_section_id: true,
            ecclesiastical_year_id: true,
          },
        })
      : [];

    const grouped = new Map<string, number>();
    for (const row of memberRows) {
      if (row.club_section_id == null) continue;
      const key = `${row.user_id}:${row.club_section_id}:${row.ecclesiastical_year_id}`;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }

    const duplicateMemberGroups = [...grouped.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => {
        const [user_id, sectionId, yearId] = key.split(':');
        return {
          user_id,
          club_section_id: Number(sectionId),
          ecclesiastical_year_id: Number(yearId),
          count,
        };
      });

    const designatedRows = await tx.club_role_assignments.count({
      where: { status: 'designated' },
    });

    return { duplicateMemberGroups, designatedRows };
  }

  private async resolveReturnBase(
    tx: DbClient,
    userId: string,
    hint: AnnualBaseHint,
  ): Promise<ResolvedAnnualBase> {
    const sourceClubId = hint.sourceClubId;
    if (sourceClubId == null) {
      throw new AppConflictException(ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED);
    }

    if (hint.sourceSectionId != null) {
      const sourceSection = await tx.club_sections.findUnique({
        where: { club_section_id: hint.sourceSectionId },
        select: {
          club_section_id: true,
          main_club_id: true,
          club_type_id: true,
          active: true,
        },
      });

      if (
        sourceSection?.main_club_id !== sourceClubId ||
        sourceSection.club_type_id == null
      ) {
        throw new AppConflictException(ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED);
      }

      const clubTypes = await tx.club_types.findMany({
        where: { name: { in: [...AV_CQ_TYPE_NAMES, 'Guías Mayores'] } },
        select: { club_type_id: true, name: true },
      });
      const avCqTypeIds = new Set(
        clubTypes
          .filter((type) => (AV_CQ_TYPE_NAMES as readonly string[]).includes(type.name))
          .map((type) => type.club_type_id),
      );
      if (!avCqTypeIds.has(sourceSection.club_type_id)) {
        throw new AppConflictException(ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED);
      }
    }

    const gmType = await tx.club_types.findFirst({
      where: { name: 'Guías Mayores' },
      select: { club_type_id: true, name: true },
    });

    if (!gmType) {
      throw new AppConflictException(ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED);
    }

    const gmSection = await tx.club_sections.findFirst({
      where: { main_club_id: sourceClubId, club_type_id: gmType.club_type_id },
      select: {
        club_section_id: true,
        main_club_id: true,
        active: true,
      },
    });

    if (gmSection == null || gmSection.active !== true || gmSection.main_club_id == null) {
      throw new AppConflictException(ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED);
    }

    const eligible = await this.isGmReturnEligible(tx, userId, gmSection.club_section_id);
    if (!eligible) {
      throw new AppConflictException(ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED);
    }

    return {
      clubId: gmSection.main_club_id,
      baseSectionId: gmSection.club_section_id,
      clubTypeName: gmType.name,
    };
  }

  private async isGmReturnEligible(
    tx: DbClient,
    userId: string,
    gmSectionId: number,
  ): Promise<boolean> {
    const gmClasses = await tx.classes.findMany({
      where: { asset_code: GUIDE_MAJOR_ASSET_CODE },
      select: { class_id: true },
    });
    const gmClassIds = gmClasses.map((row) => row.class_id);

    if (gmClassIds.length > 0) {
      const investiture = await tx.enrollments.findFirst({
        where: {
          user_id: userId,
          class_id: { in: gmClassIds },
          investiture_status: 'INVESTIDO',
        },
        select: { enrollment_id: true },
      });
      if (investiture) {
        return true;
      }
    }

    const priorGm = await tx.club_role_assignments.findFirst({
      where: {
        user_id: userId,
        club_section_id: gmSectionId,
      },
      select: { assignment_id: true },
    });

    return priorGm != null;
  }
}
