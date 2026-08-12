import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppNotFoundException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  ELIGIBILITY_RULE_HANDLERS,
  type EligibilityRuleEvaluation,
  type EligibilityRuleRecord,
} from './eligibility-rule-handlers';

export type EligibilityResult = {
  eligible: boolean;
  rules: EligibilityRuleEvaluation[];
  reason_code: string | null;
};

export type EligibilityClient = PrismaService | Prisma.TransactionClient;

const NO_RULES_REASON_CODE = 'NO_RULES_CONFIGURED';

/**
 * Evaluates a user against the configurable eligibility rules attached to a
 * certification version. Always evaluates every active rule (never
 * short-circuits) so the caller gets a fully explainable result.
 *
 * A version with zero configured rules is treated as NOT eligible — an
 * unconfigured certification should never silently accept everyone.
 */
@Injectable()
export class CertificationEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluateForVersion(
    userId: string,
    certificationVersionId: number,
    db: EligibilityClient = this.prisma,
  ): Promise<EligibilityResult> {
    const user = await db.users.findUnique({
      where: { user_id: userId },
      select: { user_id: true, birthday: true, baptism: true },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    const rules = (await db.certification_eligibility_rules.findMany({
      where: { certification_version_id: certificationVersionId, active: true },
      orderBy: { sort_order: 'asc' },
    })) as EligibilityRuleRecord[];

    if (rules.length === 0) {
      return { eligible: false, rules: [], reason_code: NO_RULES_REASON_CODE };
    }

    const evaluations = await Promise.all(
      rules.map((rule) =>
        ELIGIBILITY_RULE_HANDLERS[rule.rule_type](db, user, rule),
      ),
    );

    return {
      eligible: evaluations.every((evaluation) => evaluation.satisfied),
      rules: evaluations,
      reason_code: null,
    };
  }

  /**
   * Resolves the currently PUBLISHED version for a certification and
   * evaluates the user against it. Returns `null` when no version is
   * published (caller decides how to surface that — e.g. CERT_VERSION_NOT_PUBLISHED).
   */
  async evaluateForCertification(
    userId: string,
    certificationId: number,
  ): Promise<EligibilityResult | null> {
    const version = await this.prisma.certification_versions.findFirst({
      where: {
        certification_id: certificationId,
        status: 'PUBLISHED',
        active: true,
      },
      orderBy: { version_number: 'desc' },
    });

    if (!version) {
      return null;
    }

    return this.evaluateForVersion(userId, version.certification_version_id);
  }
}
