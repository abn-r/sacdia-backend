import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export type RoleRequirementDb = Pick<
  Prisma.TransactionClient,
  'role_requirements' | 'service_credentials' | 'users_certifications'
>;

export type RoleRequirementStatus = 'MET' | 'PENDING_REVIEW' | 'MISSING';

export type RoleRequirementEvaluation = {
  role: string;
  type: string;
  mode: 'INFO' | 'WARN' | 'BLOCK';
  effective_from: string | null;
  status: RoleRequirementStatus;
  /** BLOCK mode and already in force (`effective_from` null or <= today). */
  enforced: boolean;
};

export type EvaluateRoleRequirementsInput = {
  userIds: string[];
  roleNames: string[];
  clubTypeId: number | null;
  /** Business date; only the UTC calendar day is used. */
  today: Date;
};

const CERTIFIED_STATUSES = ['APPROVED', 'CERTIFIED'] as const;

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Whether the requirement is in force: BLOCK mode and `effective_from` reached.
 * Pure so callers and specs share the one rule.
 */
export function isRequirementEnforced(
  mode: string,
  effectiveFrom: Date | null,
  today: Date,
): boolean {
  if (mode !== 'BLOCK') return false;
  return effectiveFrom === null || utcDay(effectiveFrom) <= utcDay(today);
}

/**
 * Role requirements (today: the counselor «constancia»). Switching it on is a
 * data change on `role_requirements` (`mode`, `effective_from`), not code.
 * Stateless: it receives the Prisma client / transaction so it composes inside
 * the assignment transactions. Batched: 3 queries however many users.
 */
@Injectable()
export class RoleRequirementService {
  async evaluate(
    db: RoleRequirementDb,
    input: EvaluateRoleRequirementsInput,
  ): Promise<Map<string, RoleRequirementEvaluation[]>> {
    const result = new Map<string, RoleRequirementEvaluation[]>();
    const userIds = [...new Set(input.userIds)];
    const roleNames = [...new Set(input.roleNames)];
    for (const id of userIds) result.set(id, []);
    if (userIds.length === 0 || roleNames.length === 0) return result;

    const requirements = await db.role_requirements.findMany({
      where: {
        active: true,
        roles: { role_name: { in: roleNames }, role_category: 'CLUB' },
        OR:
          input.clubTypeId === null
            ? [{ club_type_id: null }]
            : [{ club_type_id: null }, { club_type_id: input.clubTypeId }],
      },
      select: {
        requirement_type: true,
        mode: true,
        effective_from: true,
        equivalent_certification_id: true,
        roles: { select: { role_name: true } },
      },
      orderBy: [{ requirement_id: 'asc' }],
    });
    if (requirements.length === 0) return result;

    const types = [...new Set(requirements.map((r) => r.requirement_type))];
    const certificationIds = [
      ...new Set(
        requirements
          .map((r) => r.equivalent_certification_id)
          .filter((id): id is number => id !== null),
      ),
    ];
    const [credentials, certifications] = await Promise.all([
      db.service_credentials.findMany({
        where: {
          user_id: { in: userIds },
          credential_type: { in: types },
          active: true,
          status: { in: ['APPROVED', 'PENDING_REVIEW'] },
        },
        select: {
          user_id: true,
          credential_type: true,
          status: true,
          expires_at: true,
        },
      }),
      certificationIds.length === 0
        ? Promise.resolve([])
        : db.users_certifications.findMany({
            where: {
              user_id: { in: userIds },
              certification_id: { in: certificationIds },
              active: true,
              status: { in: [...CERTIFIED_STATUSES] },
            },
            select: {
              user_id: true,
              certification_id: true,
              expires_at: true,
            },
          }),
    ]);

    const todayMs = utcDay(input.today);
    const notExpired = (expiresAt: Date | null) =>
      expiresAt === null || utcDay(expiresAt) >= todayMs;

    // user|type -> 'APPROVED' (not expired) wins over 'PENDING_REVIEW'.
    const credentialState = new Map<string, 'APPROVED' | 'PENDING_REVIEW'>();
    for (const row of credentials) {
      const key = `${row.user_id}|${row.credential_type}`;
      if (row.status === 'APPROVED') {
        if (notExpired(row.expires_at)) credentialState.set(key, 'APPROVED');
      } else if (credentialState.get(key) !== 'APPROVED') {
        credentialState.set(key, 'PENDING_REVIEW');
      }
    }
    const certified = new Set<string>();
    for (const row of certifications) {
      if (notExpired(row.expires_at)) {
        certified.add(`${row.user_id}|${row.certification_id}`);
      }
    }

    for (const userId of userIds) {
      const list = result.get(userId) as RoleRequirementEvaluation[];
      for (const requirement of requirements) {
        const state = credentialState.get(
          `${userId}|${requirement.requirement_type}`,
        );
        const viaCertification =
          requirement.equivalent_certification_id !== null &&
          certified.has(`${userId}|${requirement.equivalent_certification_id}`);
        const status: RoleRequirementStatus =
          state === 'APPROVED' || viaCertification
            ? 'MET'
            : state === 'PENDING_REVIEW'
              ? 'PENDING_REVIEW'
              : 'MISSING';
        list.push({
          role: requirement.roles.role_name,
          type: requirement.requirement_type,
          mode: requirement.mode,
          effective_from: requirement.effective_from
            ? requirement.effective_from.toISOString().slice(0, 10)
            : null,
          status,
          enforced: isRequirementEnforced(
            requirement.mode,
            requirement.effective_from,
            input.today,
          ),
        });
      }
    }
    return result;
  }

  /**
   * 409 CLUB_ROLE_REQUIREMENT_MISSING when the role has an enforced requirement
   * the person does not meet. INFO / WARN never block.
   */
  async assertMet(
    db: RoleRequirementDb & Pick<Prisma.TransactionClient, 'club_sections'>,
    input: {
      userId: string;
      roleName: string;
      clubSectionId: number;
      today?: Date;
    },
  ): Promise<void> {
    const section = await db.club_sections.findUnique({
      where: { club_section_id: input.clubSectionId },
      select: { club_type_id: true },
    });
    const unmet = await this.findUnmetEnforced(db, {
      userId: input.userId,
      roleName: input.roleName,
      clubTypeId: section?.club_type_id ?? null,
      today: input.today,
    });
    if (unmet.length > 0) {
      throw new AppConflictException(ErrorCode.CLUB_ROLE_REQUIREMENT_MISSING);
    }
  }

  /** Enforced requirements of the role the person does not meet. */
  async findUnmetEnforced(
    db: RoleRequirementDb,
    input: {
      userId: string;
      roleName: string;
      clubTypeId: number | null;
      today?: Date;
    },
  ): Promise<RoleRequirementEvaluation[]> {
    const evaluated = await this.evaluate(db, {
      userIds: [input.userId],
      roleNames: [input.roleName],
      clubTypeId: input.clubTypeId,
      today: input.today ?? new Date(),
    });
    return (evaluated.get(input.userId) ?? []).filter(
      (row) => row.enforced && row.status !== 'MET',
    );
  }
}
