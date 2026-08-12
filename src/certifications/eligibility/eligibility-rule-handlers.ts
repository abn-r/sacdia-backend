/**
 * Per-rule-type eligibility evaluators for the configurable certifications
 * engine. Each handler receives the pre-loaded user context, the persisted
 * rule row (with its typed FK/configuration), and a Prisma client (either
 * `PrismaService` or an in-flight `Prisma.TransactionClient`), and returns
 * an explainable, machine-readable verdict.
 *
 * IMPORTANT: INVESTED_CLASS must always match by `class_id` (FK), never by
 * `classes.name`, so localized/translated class names never break eligibility.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CertificationEligibilityRuleType } from '../domain/certification-definition.types';

export type EligibilityDbClient = PrismaService | Prisma.TransactionClient;

export type EligibilityRuleRecord = {
  eligibility_rule_id: number;
  rule_type: CertificationEligibilityRuleType;
  configuration: unknown;
  class_id: number | null;
  club_type_id: number | null;
  role_id: string | null;
  sort_order: number;
};

export type EligibilityUserContext = {
  user_id: string;
  birthday: Date | null;
  baptism: boolean;
};

export type EligibilityRuleEvaluation = {
  eligibility_rule_id: number;
  type: CertificationEligibilityRuleType;
  satisfied: boolean;
  reason_code: string | null;
};

export type EligibilityRuleHandler = (
  db: EligibilityDbClient,
  user: EligibilityUserContext,
  rule: EligibilityRuleRecord,
) => Promise<EligibilityRuleEvaluation>;

function verdict(
  rule: EligibilityRuleRecord,
  satisfied: boolean,
  reasonCode: string | null,
): EligibilityRuleEvaluation {
  return {
    eligibility_rule_id: rule.eligibility_rule_id,
    type: rule.rule_type,
    satisfied,
    reason_code: satisfied ? null : reasonCode,
  };
}

/**
 * Whole-years age as of `asOf` (defaults to now). Matches calendar-age
 * semantics (birthday not yet reached this year → one year younger).
 */
export function calculateAge(birthday: Date, asOf: Date = new Date()): number {
  let age = asOf.getFullYear() - birthday.getFullYear();
  const monthDiff = asOf.getMonth() - birthday.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && asOf.getDate() < birthday.getDate())
  ) {
    age -= 1;
  }
  return age;
}

async function evaluateMinAge(
  _db: EligibilityDbClient,
  user: EligibilityUserContext,
  rule: EligibilityRuleRecord,
): Promise<EligibilityRuleEvaluation> {
  if (!user.birthday) {
    return verdict(rule, false, 'BIRTHDAY_MISSING');
  }

  const config = (rule.configuration ?? {}) as { min_age?: number };
  const minAge = config.min_age;
  if (typeof minAge !== 'number') {
    return verdict(rule, false, 'RULE_MISCONFIGURED');
  }

  const age = calculateAge(user.birthday);
  return verdict(rule, age >= minAge, 'AGE_TOO_LOW');
}

async function evaluateBaptized(
  _db: EligibilityDbClient,
  user: EligibilityUserContext,
  rule: EligibilityRuleRecord,
): Promise<EligibilityRuleEvaluation> {
  return verdict(rule, user.baptism === true, 'NOT_BAPTIZED');
}

/**
 * Matches strictly by `enrollments.class_id` (the FK), never by
 * `classes.name`, so translated/localized class names never affect
 * eligibility evaluation.
 */
async function evaluateInvestedClass(
  db: EligibilityDbClient,
  user: EligibilityUserContext,
  rule: EligibilityRuleRecord,
): Promise<EligibilityRuleEvaluation> {
  if (!rule.class_id) {
    return verdict(rule, false, 'RULE_MISCONFIGURED');
  }

  const enrollment = await db.enrollments.findFirst({
    where: {
      user_id: user.user_id,
      class_id: rule.class_id,
      investiture_status: 'INVESTIDO',
    },
    select: { enrollment_id: true },
  });

  return verdict(rule, !!enrollment, 'CLASS_NOT_INVESTED');
}

async function evaluateActiveClubType(
  db: EligibilityDbClient,
  user: EligibilityUserContext,
  rule: EligibilityRuleRecord,
): Promise<EligibilityRuleEvaluation> {
  if (!rule.club_type_id) {
    return verdict(rule, false, 'RULE_MISCONFIGURED');
  }

  const assignment = await db.club_role_assignments.findFirst({
    where: {
      user_id: user.user_id,
      active: true,
      status: 'active',
      club_sections: {
        active: true,
        club_type_id: rule.club_type_id,
      },
    },
    select: { assignment_id: true },
  });

  return verdict(rule, !!assignment, 'CLUB_TYPE_NOT_ACTIVE');
}

async function evaluateActiveRole(
  db: EligibilityDbClient,
  user: EligibilityUserContext,
  rule: EligibilityRuleRecord,
): Promise<EligibilityRuleEvaluation> {
  if (!rule.role_id) {
    return verdict(rule, false, 'RULE_MISCONFIGURED');
  }

  const assignment = await db.club_role_assignments.findFirst({
    where: {
      user_id: user.user_id,
      role_id: rule.role_id,
      active: true,
      status: 'active',
    },
    select: { assignment_id: true },
  });

  return verdict(rule, !!assignment, 'ROLE_NOT_ACTIVE');
}

export const ELIGIBILITY_RULE_HANDLERS: Record<
  CertificationEligibilityRuleType,
  EligibilityRuleHandler
> = {
  MIN_AGE: evaluateMinAge,
  BAPTIZED: evaluateBaptized,
  INVESTED_CLASS: evaluateInvestedClass,
  ACTIVE_CLUB_TYPE: evaluateActiveClubType,
  ACTIVE_ROLE: evaluateActiveRole,
};
