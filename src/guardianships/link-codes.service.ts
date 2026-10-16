import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Cache } from 'cache-manager';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import {
  AppConflictException,
  AppException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type { RedeemLinkCodeDto } from './dto';
import {
  ACTIVE_USER_GUARDIAN,
  NOT_REVOKED,
  countActiveGuardians,
  hasLiveAssignmentInSection,
} from './guardianship-queries';
import {
  DIRECTOR_CLAIM_CODE_TTL_MS,
  LINK_CODE_FAILURE_WINDOW_MS,
  LINK_CODE_MAX_FAILURES,
  MAX_GUARDIANS_PER_DEPENDENT,
  SECOND_GUARDIAN_CODE_TTL_MS,
  type LinkCodePurpose,
} from './guardianships.constants';
import { GuardianshipsService } from './guardianships.service';
import type { DependentSummary } from './guardianships.types';
import {
  deriveLinkCodeKey,
  formatLinkCode,
  generateLinkCode,
  hashLinkCode,
  isWellFormedLinkCode,
  normalizeLinkCode,
} from './link-code.util';

interface FailureRecord {
  count: number;
  first_at: number;
}

export interface IssuedLinkCode {
  code: string;
  expires_at: string;
}

const MAX_ISSUE_ATTEMPTS = 3;

function invalidCode(): AppException {
  return new AppException(
    ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID,
    HttpStatus.BAD_REQUEST,
  );
}

/**
 * Link codes: a guardian invites a second guardian (`second_guardian`, 72h) and
 * a club director hands a custodial dependent back to a family
 * (`director_claim`, 7d).
 *
 * Only the HMAC of the code is stored. Every way a redeem can fail on the code
 * itself (unknown, expired, consumed, revoked, malformed, stale) is the same
 * 400, and failures feed a per-user counter (10 in 24h from the FIRST failure
 * => 429 even for a valid code). A redeem that fails for a reason that is not
 * about the code (already a guardian, limit, not an adult) rolls back, so the
 * code is NOT consumed.
 */
@Injectable()
export class LinkCodesService {
  private readonly logger = new Logger(LinkCodesService.name);
  private key: Buffer | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly actingForCache: ActingForCache,
    private readonly guardianships: GuardianshipsService,
  ) {}

  private hashKey(): Buffer {
    if (!this.key) {
      const secret = this.config.get<string>('BETTER_AUTH_SECRET')?.trim();
      if (!secret) {
        throw new Error('BETTER_AUTH_SECRET is required for link codes');
      }
      this.key = deriveLinkCodeKey(secret);
    }
    return this.key;
  }

  // ---------------------------------------------------------------------------
  // Issue: second guardian
  // ---------------------------------------------------------------------------

  async issueSecondGuardianCode(
    guardianId: string,
    dependentId: string,
  ): Promise<IssuedLinkCode> {
    const own = await this.prisma.guardianships.findFirst({
      where: {
        ...ACTIVE_USER_GUARDIAN,
        dependent_user_id: dependentId,
        guardian_user_id: guardianId,
        dependent: {
          dependent_profile: { is: { frozen_at: null, purged_at: null } },
        },
      },
      select: { guardianship_id: true },
    });
    if (!own) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }

    if (
      (await countActiveGuardians(this.prisma, dependentId)) >=
      MAX_GUARDIANS_PER_DEPENDENT
    ) {
      throw new AppConflictException(
        ErrorCode.GUARDIANSHIP_GUARDIAN_LIMIT_REACHED,
      );
    }

    return this.createCode({
      purpose: 'second_guardian',
      dependentId,
      issuedBy: guardianId,
      ttlMs: SECOND_GUARDIAN_CODE_TTL_MS,
      clubSectionId: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Issue: director claim
  // ---------------------------------------------------------------------------

  /**
   * A director hands a custodial dependent back to a family. The permission
   * (`club_members:approve` on the section) is enforced by the controller; this
   * checks the dependent really is a custodial one of that section.
   */
  async issueDirectorClaimCode(
    directorId: string,
    clubSectionId: number,
    dependentId: string,
  ): Promise<IssuedLinkCode> {
    const profile = await this.prisma.dependent_profiles.findFirst({
      where: { user_id: dependentId, frozen_at: null, purged_at: null },
      select: { user_id: true },
    });
    const inSection = profile
      ? await hasLiveAssignmentInSection(
          this.prisma,
          dependentId,
          clubSectionId,
        )
      : false;
    if (!profile || !inSection) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }

    if ((await countActiveGuardians(this.prisma, dependentId)) > 0) {
      // A family already has this child: nothing to claim.
      throw new AppConflictException(ErrorCode.GUARDIANSHIP_ALREADY_GUARDIAN);
    }

    return this.createCode({
      purpose: 'director_claim',
      dependentId,
      issuedBy: directorId,
      ttlMs: DIRECTOR_CLAIM_CODE_TTL_MS,
      clubSectionId,
    });
  }

  private async createCode(input: {
    purpose: LinkCodePurpose;
    dependentId: string;
    issuedBy: string;
    ttlMs: number;
    clubSectionId: number | null;
  }): Promise<IssuedLinkCode> {
    const expiresAt = new Date(Date.now() + input.ttlMs);

    for (let attempt = 1; attempt <= MAX_ISSUE_ATTEMPTS; attempt += 1) {
      const normalized = generateLinkCode();
      try {
        await this.prisma.$transaction(async (tx) => {
          // A new code replaces the open ones of the same (dependent, purpose).
          await tx.guardianship_link_codes.updateMany({
            where: {
              dependent_user_id: input.dependentId,
              purpose: input.purpose,
              consumed_at: null,
              revoked_at: null,
            },
            data: { revoked_at: new Date() },
          });
          await tx.guardianship_link_codes.create({
            data: {
              code_hash: hashLinkCode(normalized, this.hashKey()),
              dependent_user_id: input.dependentId,
              purpose: input.purpose,
              issued_by_user_id: input.issuedBy,
              issued_for_club_section_id: input.clubSectionId,
              expires_at: expiresAt,
            },
          });
        });
        // The plain code leaves the server exactly once, in this response.
        return {
          code: formatLinkCode(normalized),
          expires_at: expiresAt.toISOString(),
        };
      } catch (error) {
        const hashCollision =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        if (!hashCollision || attempt === MAX_ISSUE_ATTEMPTS) {
          throw error;
        }
      }
    }
    // Unreachable: the loop either returns or throws.
    throw new Error('link code issuance exhausted its attempts');
  }

  // ---------------------------------------------------------------------------
  // Redeem
  // ---------------------------------------------------------------------------

  async redeem(
    userId: string,
    dto: RedeemLinkCodeDto,
  ): Promise<DependentSummary> {
    if (await this.isLockedOut(userId)) {
      // The code is not even looked at, so a valid one stays unconsumed.
      throw new AppException(
        ErrorCode.GUARDIANSHIP_LINK_CODE_LOCKED,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.guardianships.assertAdult(userId);
    await this.guardianships.assertRelationshipType(dto.relationship_type_id);

    const normalized = normalizeLinkCode(dto.code);
    if (!isWellFormedLinkCode(normalized)) {
      await this.recordFailure(userId);
      throw invalidCode();
    }
    const codeHash = hashLinkCode(normalized, this.hashKey());

    let dependentId: string;
    try {
      dependentId = await this.prisma.$transaction((tx) =>
        this.redeemInTransaction(tx, userId, codeHash, dto),
      );
    } catch (error) {
      if (
        error instanceof AppException &&
        error.code === ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID
      ) {
        await this.recordFailure(userId);
      }
      throw error;
    }

    await this.actingForCache.bump(dependentId);
    return this.guardianships.getSummaryForGuardian(userId, dependentId);
  }

  private async redeemInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    codeHash: string,
    dto: RedeemLinkCodeDto,
  ): Promise<string> {
    const now = new Date();

    const code = await tx.guardianship_link_codes.findFirst({
      where: {
        code_hash: codeHash,
        consumed_at: null,
        revoked_at: null,
        expires_at: { gt: now },
      },
    });
    if (!code) {
      throw invalidCode();
    }

    // Atomic single use: of two concurrent redeems exactly one gets count 1.
    const consumed = await tx.guardianship_link_codes.updateMany({
      where: {
        link_code_id: code.link_code_id,
        consumed_at: null,
        revoked_at: null,
        expires_at: { gt: now },
      },
      data: { consumed_at: now, consumed_by_user_id: userId },
    });
    if (consumed.count !== 1) {
      throw invalidCode();
    }

    const dependentId = code.dependent_user_id;
    const dependent = await tx.users.findFirst({
      where: {
        user_id: dependentId,
        active: true,
        account: { none: {} },
        dependent_profile: { is: { frozen_at: null, purged_at: null } },
      },
      select: { user_id: true },
    });
    if (!dependent) {
      // The child is gone, frozen or got an account since the code was issued.
      throw invalidCode();
    }

    if (code.purpose === 'director_claim') {
      await this.claimFromClub(tx, userId, dependentId, dto, now);
    } else {
      await this.joinAsSecondGuardian(
        tx,
        userId,
        dependentId,
        code.issued_by_user_id,
        dto,
        now,
      );
    }
    return dependentId;
  }

  private async joinAsSecondGuardian(
    tx: Prisma.TransactionClient,
    userId: string,
    dependentId: string,
    inviterUserId: string,
    dto: RedeemLinkCodeDto,
    now: Date,
  ): Promise<void> {
    const inviter = await tx.guardianships.findFirst({
      where: {
        ...ACTIVE_USER_GUARDIAN,
        dependent_user_id: dependentId,
        guardian_user_id: inviterUserId,
      },
      select: { guardianship_id: true, consent_status: true },
    });
    if (!inviter) {
      // The inviter left after issuing the code: nobody vouches for it anymore.
      throw invalidCode();
    }

    const existing = await tx.guardianships.findFirst({
      where: {
        dependent_user_id: dependentId,
        guardian_user_id: userId,
        ...NOT_REVOKED,
      },
      select: { guardianship_id: true },
    });
    if (existing) {
      throw new AppConflictException(ErrorCode.GUARDIANSHIP_ALREADY_GUARDIAN);
    }

    if (
      (await countActiveGuardians(tx, dependentId)) >=
      MAX_GUARDIANS_PER_DEPENDENT
    ) {
      throw new AppConflictException(
        ErrorCode.GUARDIANSHIP_GUARDIAN_LIMIT_REACHED,
      );
    }

    const verified = inviter.consent_status === 'verified';
    await tx.guardianships.create({
      data: {
        dependent_user_id: dependentId,
        guardian_user_id: userId,
        relationship_type_id: dto.relationship_type_id,
        is_primary: false,
        consent_status: verified ? 'verified' : 'pending',
        verification_method: verified ? 'guardian_invite' : null,
        verified_at: verified ? now : null,
        verified_by_user_id: verified ? inviterUserId : null,
        sworn_declaration_at: now,
        invited_by_guardianship_id: inviter.guardianship_id,
      },
    });
  }

  /**
   * The family takes the child back from the club. Club custody (and any
   * legacy external holder) is revoked FIRST so the one-active-primary unique
   * index lets the new primary in. Earlier verification is NOT inherited: the
   * director verifies the new guardian again with a new signed form.
   */
  private async claimFromClub(
    tx: Prisma.TransactionClient,
    userId: string,
    dependentId: string,
    dto: RedeemLinkCodeDto,
    now: Date,
  ): Promise<void> {
    if ((await countActiveGuardians(tx, dependentId)) > 0) {
      // A family claimed it first.
      throw invalidCode();
    }

    await tx.guardianships.updateMany({
      where: {
        dependent_user_id: dependentId,
        guardian_user_id: null,
        ...NOT_REVOKED,
      },
      data: {
        consent_status: 'revoked',
        revoked_at: now,
        revoked_reason: 'claimed',
        modified_at: now,
      },
    });

    await tx.guardianships.create({
      data: {
        dependent_user_id: dependentId,
        guardian_user_id: userId,
        relationship_type_id: dto.relationship_type_id,
        is_primary: true,
        consent_status: 'pending',
        sworn_declaration_at: now,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Brute-force lockout (Redis, best effort)
  // ---------------------------------------------------------------------------

  private failureKey(userId: string): string {
    return `linkcode:fail:${userId}`;
  }

  private async isLockedOut(userId: string): Promise<boolean> {
    try {
      const record = await this.cache.get<FailureRecord>(
        this.failureKey(userId),
      );
      return (
        !!record &&
        record.count >= LINK_CODE_MAX_FAILURES &&
        record.first_at + LINK_CODE_FAILURE_WINDOW_MS > Date.now()
      );
    } catch (error) {
      // The throttler still bounds attempts; do not lock everyone out on a
      // cache outage.
      this.logger.warn(
        `Link code lockout read failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * The window is anchored at the FIRST failure: later failures keep counting
   * but never extend it, so the lockout clears 24h after the first one.
   */
  private async recordFailure(userId: string): Promise<void> {
    const key = this.failureKey(userId);
    const now = Date.now();
    try {
      const current = await this.cache.get<FailureRecord>(key);
      const live =
        current && current.first_at + LINK_CODE_FAILURE_WINDOW_MS > now
          ? current
          : null;
      const next: FailureRecord = live
        ? { count: live.count + 1, first_at: live.first_at }
        : { count: 1, first_at: now };
      const remainingMs = next.first_at + LINK_CODE_FAILURE_WINDOW_MS - now;
      await this.cache.set(key, next, Math.max(remainingMs, 1));
    } catch (error) {
      this.logger.warn(
        `Link code failure not recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
