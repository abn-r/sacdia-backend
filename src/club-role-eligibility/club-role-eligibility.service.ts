import { Injectable, Logger } from '@nestjs/common';
import { Prisma, investiture_status_enum } from '@prisma/client';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { clubTypeSectionKind, SectionKind } from '../clubs/section-display';
import { PrismaService } from '../prisma/prisma.service';

const GUIDE_MAJOR_ASSET_CODE = 'GM-01';
const MEMBER_ROLE_NAME = 'member';
const ACTIVE_GUIDE_MAJOR_STATUSES = [
  investiture_status_enum.IN_PROGRESS,
  investiture_status_enum.SUBMITTED_FOR_VALIDATION,
  investiture_status_enum.CLUB_APPROVED,
  investiture_status_enum.COORDINATOR_APPROVED,
  investiture_status_enum.FIELD_APPROVED,
] as const;

type EligibilityClient =
  | Pick<PrismaService, 'enrollments' | 'club_sections' | 'roles'>
  | Prisma.TransactionClient;

export type GmBasis = 'INVESTED' | 'APPROVED' | 'ACTIVE_ENROLLMENT';

export type GuideMajorEligibility = {
  eligible: boolean;
  basis: GmBasis | null;
  enrollmentId: number | null;
};

export type RoleViolation = {
  rule: 'RULE_1_MEMBER_ONLY' | 'RULE_3_GM_MEMBER_IN_AV_CQ';
  code: ErrorCode;
};

export type ClubRoleAssignmentEligibility = GuideMajorEligibility & {
  allowed: boolean;
  sectionKind: SectionKind;
  violation: RoleViolation | null;
};

export type AssignmentParams = {
  userId: string;
  roleName: string;
  clubSectionId: number;
  db?: EligibilityClient;
};

export type AssignmentForKindParams = {
  userId: string;
  roleName: string;
  sectionKind: SectionKind;
  db?: EligibilityClient;
};

const NOT_ELIGIBLE: GuideMajorEligibility = {
  eligible: false,
  basis: null,
  enrollmentId: null,
};

// Lower number wins when a user has several qualifying GM-01 enrollments.
const BASIS_PRIORITY: Record<GmBasis, number> = {
  INVESTED: 0,
  APPROVED: 1,
  ACTIVE_ENROLLMENT: 2,
};

/**
 * Single source of truth for Guia Mayor (GM-01) eligibility and the club role
 * rules built on it:
 *  1. Not GM-eligible: only `member` is allowed.
 *  2. GM-eligible `member` in a GM section: allowed.
 *  3. GM-eligible `member` in an AV/CQ section: rejected.
 * Callers must run it inside their mutation transaction (pass `db`).
 * GM wins over any cross-type AV/CQ enrollment: only GM-01 rows are queried.
 */
@Injectable()
export class ClubRoleEligibilityService {
  private readonly logger = new Logger(ClubRoleEligibilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async evaluateGuideMajor(
    userId: string,
    db: EligibilityClient = this.prisma,
  ): Promise<GuideMajorEligibility> {
    const result = await this.evaluateMany([userId], db);
    return result.get(userId) ?? NOT_ELIGIBLE;
  }

  async evaluateMany(
    userIds: string[],
    db: EligibilityClient = this.prisma,
  ): Promise<Map<string, GuideMajorEligibility>> {
    const result = new Map<string, GuideMajorEligibility>();
    const uniqueIds = [...new Set(userIds)];
    for (const id of uniqueIds) result.set(id, NOT_ELIGIBLE);
    if (uniqueIds.length === 0) return result;

    const enrollments = await db.enrollments.findMany({
      where: {
        user_id: { in: uniqueIds },
        classes: { asset_code: GUIDE_MAJOR_ASSET_CODE },
        OR: [
          {
            investiture_status: {
              in: [
                investiture_status_enum.INVESTIDO,
                investiture_status_enum.APPROVED,
              ],
            },
          },
          {
            active: true,
            investiture_status: { in: [...ACTIVE_GUIDE_MAJOR_STATUSES] },
            classes: { asset_code: GUIDE_MAJOR_ASSET_CODE, active: true },
          },
        ],
      },
      select: {
        enrollment_id: true,
        user_id: true,
        investiture_status: true,
      },
      orderBy: { enrollment_date: 'desc' },
    });

    for (const row of enrollments) {
      const basis: GmBasis =
        row.investiture_status === investiture_status_enum.INVESTIDO
          ? 'INVESTED'
          : row.investiture_status === investiture_status_enum.APPROVED
            ? 'APPROVED'
            : 'ACTIVE_ENROLLMENT';
      const current = result.get(row.user_id);
      if (
        !current?.basis ||
        BASIS_PRIORITY[basis] < BASIS_PRIORITY[current.basis]
      ) {
        result.set(row.user_id, {
          eligible: true,
          basis,
          enrollmentId: row.enrollment_id,
        });
      }
    }

    return result;
  }

  async evaluateAssignment({
    userId,
    roleName,
    clubSectionId,
    db = this.prisma,
  }: AssignmentParams): Promise<ClubRoleAssignmentEligibility> {
    const sectionKind = await this.resolveSectionKind(clubSectionId, db);
    return this.evaluateAssignmentForKind({
      userId,
      roleName,
      sectionKind,
      db,
    });
  }

  async evaluateAssignmentForKind({
    userId,
    roleName,
    sectionKind,
    db = this.prisma,
  }: AssignmentForKindParams): Promise<ClubRoleAssignmentEligibility> {
    const gm = await this.evaluateGuideMajor(userId, db);
    const violation = this.findViolation(userId, roleName, gm, sectionKind);

    return { ...gm, allowed: violation === null, sectionKind, violation };
  }

  private findViolation(
    userId: string,
    roleName: string,
    gm: GuideMajorEligibility,
    sectionKind: SectionKind,
  ): RoleViolation | null {
    const isMember = roleName === MEMBER_ROLE_NAME;
    if (!isMember && !gm.eligible) {
      return {
        rule: 'RULE_1_MEMBER_ONLY',
        code: ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED,
      };
    }
    if (isMember && gm.eligible) {
      if (sectionKind === 'UNKNOWN') {
        this.logger.warn(
          `Unresolvable section type for user ${userId}; skipping rule 3`,
        );
      } else if (sectionKind !== 'GM') {
        return {
          rule: 'RULE_3_GM_MEMBER_IN_AV_CQ',
          code: ErrorCode.CLUB_ROLE_MEMBER_REQUIRES_GUIDE_MAJOR_SECTION,
        };
      }
    }
    return null;
  }

  async assertAssignment(
    params: AssignmentParams,
  ): Promise<ClubRoleAssignmentEligibility> {
    const result = await this.evaluateAssignment(params);
    if (result.violation) {
      throw new AppForbiddenException(result.violation.code);
    }
    return result;
  }

  async listAssignableRoles({
    userId,
    clubSectionId,
    db = this.prisma,
  }: {
    userId: string;
    clubSectionId: number;
    db?: EligibilityClient;
  }): Promise<{
    guide_major_eligible: boolean;
    section_kind: SectionKind;
    roles: {
      role_id: string;
      role_name: string;
      allowed: boolean;
      violation_rule: RoleViolation['rule'] | null;
      violation_code: ErrorCode | null;
    }[];
  }> {
    const sectionKind = await this.resolveSectionKind(clubSectionId, db);
    const gm = await this.evaluateGuideMajor(userId, db);
    const clubRoles = await db.roles.findMany({
      where: { role_category: 'CLUB', active: true },
      select: { role_id: true, role_name: true },
      orderBy: { role_name: 'asc' },
    });

    const roles = clubRoles.map((role) => {
      const violation = this.findViolation(
        userId,
        role.role_name,
        gm,
        sectionKind,
      );
      return {
        ...role,
        allowed: violation === null,
        violation_rule: violation?.rule ?? null,
        violation_code: violation?.code ?? null,
      };
    });

    return {
      guide_major_eligible: gm.eligible,
      section_kind: sectionKind,
      roles,
    };
  }

  private async resolveSectionKind(
    clubSectionId: number,
    db: EligibilityClient,
  ): Promise<SectionKind> {
    const section = await db.club_sections.findUnique({
      where: { club_section_id: clubSectionId },
      select: { club_types: { select: { name: true } } },
    });
    if (!section) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }
    return clubTypeSectionKind(section.club_types?.name);
  }
}
