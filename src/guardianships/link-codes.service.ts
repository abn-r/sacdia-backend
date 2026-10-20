import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import { principalScopeDenied } from '../auth/acting-for/acting-for.errors';
import { ageToday } from '../common/age/age.util';
import { CountryAgePolicyService } from '../common/age/country-age-policy.service';
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
  VISIBLE_DEPENDENT,
  countActiveGuardians,
  hasLiveAssignmentInSection,
  lockDependent,
} from './guardianship-queries';
import {
  DIRECTOR_CLAIM_CODE_TTL_MS,
  LINK_CODE_MAX_FAILURES,
  MAX_DEPENDENTS_PER_GUARDIAN,
  MAX_GUARDIANS_PER_DEPENDENT,
  SECOND_GUARDIAN_CODE_TTL_MS,
  TEEN_LINK_CODE_TTL_MS,
  type LinkCodePurpose,
} from './guardianships.constants';
import {
  LINKED_DEVICE_REVOKER,
  type LinkedDeviceRevoker,
} from './linked-device-revoker.port';
import { LinkCodeFailureCounter } from './link-code-failure-counter';
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
 * Link codes: a guardian invites a second guardian (`second_guardian`, 72h), a
 * club director hands a custodial dependent back to a family
 * (`director_claim`, 7d) and a self-registered teen without a guardian asks an
 * adult to take responsibility (`teen_guardian_link`, 72h, Phase 3a).
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
    private readonly failures: LinkCodeFailureCounter,
    private readonly actingForCache: ActingForCache,
    private readonly guardianships: GuardianshipsService,
    private readonly countryAgePolicy: CountryAgePolicyService,
    @Inject(LINKED_DEVICE_REVOKER)
    private readonly deviceRevoker: LinkedDeviceRevoker,
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
      select: {
        guardianship_id: true,
        consent_status: true,
        dependent: { select: { account: { select: { id: true }, take: 1 } } },
      },
    });
    if (!own) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }
    // A teen holds an account: only a VERIFIED guardian may bring another
    // adult in. A pending link (a stranger holding a leaked teen code) has no
    // powers until the director verifies the consent.
    if (own.dependent.account.length > 0 && own.consent_status !== 'verified') {
      throw new AppConflictException(
        ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED,
      );
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
  // Issue: teen guardian link (Phase 3a)
  // ---------------------------------------------------------------------------

  /**
   * A self-registered teen asks an adult to link as their guardian. Only a
   * teen can do it (the route's scope belongs to TEEN_PENDING_SCOPES; an adult
   * is unrestricted by scopes, so this re-checks from the database): an active
   * account holder under the age of majority, not frozen or purged, with NO
   * active user guardian yet (a pending link counts as linked) and room for
   * another guardian. The code lives 72 h and replaces any open code of the
   * same (teen, purpose).
   */
  async issueTeenGuardianLink(teenId: string): Promise<IssuedLinkCode> {
    const teen = await this.prisma.users.findFirst({
      where: { user_id: teenId, active: true, account: { some: {} } },
      select: {
        birthday: true,
        country_id: true,
        dependent_profile: { select: { frozen_at: true, purged_at: true } },
      },
    });
    if (!teen || !teen.birthday) {
      // A dependent has no account and cannot call this; an unknown age cannot
      // be proven a minor.
      throw principalScopeDenied('guardian_link:issue', 'user');
    }
    const policy = await this.countryAgePolicy.getPolicy(teen.country_id);
    if (ageToday(teen.birthday, policy.timeZone) >= policy.ageOfMajority) {
      throw principalScopeDenied('guardian_link:issue', 'user');
    }
    if (
      teen.dependent_profile?.frozen_at ||
      teen.dependent_profile?.purged_at
    ) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }

    const linked = await countActiveGuardians(this.prisma, teenId);
    if (linked > 0) {
      throw new AppConflictException(ErrorCode.GUARDIANSHIP_ALREADY_GUARDIAN);
    }
    if (linked >= MAX_GUARDIANS_PER_DEPENDENT) {
      throw new AppConflictException(
        ErrorCode.GUARDIANSHIP_GUARDIAN_LIMIT_REACHED,
      );
    }

    return this.createCode({
      purpose: 'teen_guardian_link',
      dependentId: teenId,
      issuedBy: teenId,
      ttlMs: TEEN_LINK_CODE_TTL_MS,
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

    // Four-eyes: nobody redeems a code they issued. Checked before the code is
    // consumed, and the throw rolls the transaction back, so the code survives
    // for the person it was meant for. Not a code failure: it does not feed the
    // brute-force counter.
    if (code.issued_by_user_id === userId) {
      throw new AppException(
        ErrorCode.GUARDIANSHIP_LINK_CODE_SELF_REDEEM,
        HttpStatus.FORBIDDEN,
      );
    }

    // From here the guardian set of this child is being decided: serialize with
    // leave / revoke / account deletion so none of them reads a half-state.
    await lockDependent(tx, code.dependent_user_id);

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

    if (code.purpose === 'teen_guardian_link') {
      await this.linkAsTeenGuardian(tx, userId, dependentId, dto, now);
      return dependentId;
    }

    // `director_claim` is for custodial children only (no account). A
    // `second_guardian` invitation also works for a teen, who holds an account.
    const dependent = await tx.users.findFirst({
      where: {
        user_id: dependentId,
        active: true,
        ...(code.purpose === 'director_claim' ? { account: { none: {} } } : {}),
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

  /**
   * An adult redeems a teen's code (Phase 3a, design 5.2 step 4). Runs in the
   * redeem transaction, under the teen's dependent lock:
   *  - the teen must still be an active, unfrozen account holder under the age
   *    of majority with NO active user guardian; anything else is the uniform
   *    invalid code (the whole redeem rolls back, the code survives);
   *  - the redeemer becomes the PRIMARY, NON-custodian guardian in consent
   *    'pending' with no inviter: a teen link NEVER auto-verifies, so the
   *    stranger who found the code has no powers until the director's check;
   *  - the teen's dependent profile is created now (profile semantics: "managed
   *    by a guardian"), club custody (if the club held the child) is handed
   *    over like a director claim, and the guardian-less clock stops.
   */
  private async linkAsTeenGuardian(
    tx: Prisma.TransactionClient,
    userId: string,
    teenId: string,
    dto: RedeemLinkCodeDto,
    now: Date,
  ): Promise<void> {
    const teen = await tx.users.findFirst({
      where: { user_id: teenId, active: true, account: { some: {} } },
      select: {
        birthday: true,
        country_id: true,
        dependent_profile: { select: { frozen_at: true, purged_at: true } },
      },
    });
    if (
      !teen?.birthday ||
      teen.dependent_profile?.frozen_at ||
      teen.dependent_profile?.purged_at
    ) {
      throw invalidCode();
    }
    const policy = await this.countryAgePolicy.getPolicy(teen.country_id);
    if (ageToday(teen.birthday, policy.timeZone) >= policy.ageOfMajority) {
      throw invalidCode();
    }

    const already = await tx.guardianships.findFirst({
      where: {
        dependent_user_id: teenId,
        guardian_user_id: userId,
        ...NOT_REVOKED,
      },
      select: { guardianship_id: true },
    });
    if (already) {
      throw new AppConflictException(ErrorCode.GUARDIANSHIP_ALREADY_GUARDIAN);
    }
    if ((await countActiveGuardians(tx, teenId)) > 0) {
      // Somebody linked first: the code no longer means anything.
      throw invalidCode();
    }

    // The 10-dependent cap counts teens too; serialize the redeemer's links.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guardianships:create:${userId}`}))`;
    const activeDependents = await tx.guardianships.count({
      where: {
        guardian_user_id: userId,
        is_custodian: false,
        ...NOT_REVOKED,
        dependent: VISIBLE_DEPENDENT,
      },
    });
    if (activeDependents >= MAX_DEPENDENTS_PER_GUARDIAN) {
      throw new AppConflictException(
        ErrorCode.GUARDIANSHIP_DEPENDENT_LIMIT_REACHED,
      );
    }

    await tx.dependent_profiles.upsert({
      where: { user_id: teenId },
      update: {},
      create: { user_id: teenId, created_by_user_id: teenId },
    });

    // Club custody (a guardian left while the teen had a club membership) hands
    // over to the family exactly like a director claim; the unique index allows
    // one active primary. Verification is NOT inherited.
    await tx.guardianships.updateMany({
      where: {
        dependent_user_id: teenId,
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

    const linked = await tx.guardianships.create({
      data: {
        dependent_user_id: teenId,
        guardian_user_id: userId,
        relationship_type_id: dto.relationship_type_id,
        is_primary: true,
        is_custodian: false,
        consent_status: 'pending',
        sworn_declaration_at: now,
        invited_by_guardianship_id: null,
      },
      select: { guardianship_id: true },
    });

    // Stops the 90-day guardian-less clock (a pending link counts as linked)
    // and records who linked.
    await tx.supervised_logins.upsert({
      where: { user_id: teenId },
      update: {
        enabled_by_guardianship_id: linked.guardianship_id,
        enabled_by_user_id: userId,
        enabled_at: now,
        pending_since: null,
        pending_reminder_level: 0,
      },
      create: {
        user_id: teenId,
        method: 'email',
        origin: 'self_registered',
        password_set_by: 'self',
        enabled_by_guardianship_id: linked.guardianship_id,
        enabled_by_user_id: userId,
        enabled_at: now,
        pending_since: null,
        pending_reminder_level: 0,
      },
    });

    // No device should exist for an account holder; the port keeps 3b honest.
    await this.deviceRevoker.revokeAllForDependent(
      tx,
      teenId,
      'teen_login_enabled',
    );
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

  private async isLockedOut(userId: string): Promise<boolean> {
    try {
      return (await this.failures.current(userId)) >= LINK_CODE_MAX_FAILURES;
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
   * Atomic increment (see LinkCodeFailureCounter). The window is anchored at
   * the FIRST failure: later failures keep counting but never extend it, so the
   * lockout clears 24h after the first one.
   */
  private async recordFailure(userId: string): Promise<void> {
    try {
      await this.failures.increment(userId);
    } catch (error) {
      this.logger.warn(
        `Link code failure not recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
