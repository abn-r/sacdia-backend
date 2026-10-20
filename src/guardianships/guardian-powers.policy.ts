import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOT_REVOKED,
  VISIBLE_DEPENDENT,
  type Db,
} from './guardianship-queries';

export interface VerifiedGuardianRow {
  guardianship_id: string;
  dependent_user_id: string;
  guardian_user_id: string;
}

/**
 * How a guardian whose link is still PENDING is told no:
 *  - `forbidden` (403): control powers (enable / disable / reset a login, ...);
 *  - `conflict` (409): reading the summary (R4), the same code as the spec's
 *    "your consent is not verified yet".
 */
export type PendingGuardianResponse = 'forbidden' | 'conflict';

/**
 * The ONE gate in front of every guardian CONTROL POWER of Phase 3 (supervised
 * login management, the dependent summary, device pairing in 3b).
 *
 * A control power needs a VERIFIED guardianship: an active (not revoked),
 * non-custodian, non-test row of a user guardian in consent 'verified' on a
 * dependent that is not frozen or purged. A guardian whose link is still
 * 'pending' (for a teen: a stranger who found the link code) has NO powers and
 * learns nothing; a custodian or a stranger is a plain 404, indistinguishable
 * from a child that does not exist.
 */
@Injectable()
export class GuardianPowersPolicy {
  constructor(private readonly prisma: PrismaService) {}

  async assertVerifiedGuardian(
    guardianId: string,
    dependentId: string,
    options: { pending?: PendingGuardianResponse; db?: Db } = {},
  ): Promise<VerifiedGuardianRow> {
    const db = options.db ?? this.prisma;
    const row = await db.guardianships.findFirst({
      where: {
        dependent_user_id: dependentId,
        guardian_user_id: guardianId,
        is_custodian: false,
        is_test_data: false,
        ...NOT_REVOKED,
        dependent: VISIBLE_DEPENDENT,
      },
      select: {
        guardianship_id: true,
        dependent_user_id: true,
        guardian_user_id: true,
        consent_status: true,
      },
    });
    if (!row || !row.guardian_user_id) {
      throw new AppException(
        ErrorCode.GUARDIANSHIP_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.consent_status !== 'verified') {
      throw new AppException(
        ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED,
        options.pending === 'conflict'
          ? HttpStatus.CONFLICT
          : HttpStatus.FORBIDDEN,
      );
    }
    return {
      guardianship_id: row.guardianship_id,
      dependent_user_id: row.dependent_user_id,
      guardian_user_id: row.guardian_user_id,
    };
  }
}
