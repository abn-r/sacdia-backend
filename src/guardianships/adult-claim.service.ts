import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthService } from '../auth/auth.service';
import {
  AppConflictException,
  AppException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { adultClaimTargetState } from './adult-claim-issue.service';
import { MAJORITY_HANDOVER_SOURCE } from './family-majority-release-cron.service';
import type { RedeemAdultClaimDto } from './dto';
import { lockDependent } from './guardianship-queries';
import { LINK_CODE_MAX_FAILURES } from './guardianships.constants';
import { LinkCodeFailureCounter } from './link-code-failure-counter';
import { isUniqueViolation } from './login-handle.util';
import {
  deriveLinkCodeKey,
  hashLinkCode,
  isWellFormedLinkCode,
  normalizeLinkCode,
} from './link-code.util';

const BCRYPT_ROUNDS = 12;

function invalidCode(): AppException {
  return new AppException(
    ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID,
    HttpStatus.BAD_REQUEST,
  );
}

/**
 * A released adult WITHOUT credentials claims their own account (Phase 4,
 * public endpoint). One transaction: consume the `adult_claim` code, set the
 * email and create the credential. It does NOT accept the terms: the person
 * logs in normally and lands on the release screen, so there is ONE legal path
 * (acceptance + email thaws, rulings R1/R6).
 *
 * Every way the code itself can be wrong is the same 400 (also a code of
 * another purpose); failures count per IP (10 in 24h => 429, the code is not
 * even looked at). A failure that is not about the code (not released, email
 * taken) rolls back, so the code survives.
 */
@Injectable()
export class AdultClaimService {
  private readonly logger = new Logger(AdultClaimService.name);
  private key: Buffer | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly failures: LinkCodeFailureCounter,
    private readonly actingForCache: ActingForCache,
    private readonly audit: AuditLogsService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
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

  async redeem(
    dto: RedeemAdultClaimDto,
    ip: string,
  ): Promise<{ status: 'success' }> {
    const counterKey = `ip:${ip}`;
    if (await this.isLockedOut(counterKey)) {
      throw new AppException(
        ErrorCode.GUARDIANSHIP_LINK_CODE_LOCKED,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const normalized = normalizeLinkCode(dto.code);
    if (!isWellFormedLinkCode(normalized)) {
      await this.recordFailure(counterKey);
      throw invalidCode();
    }
    const codeHash = hashLinkCode(normalized, this.hashKey());
    // Cheap pre-check: an unknown code must not buy a bcrypt hash (CPU
    // amplification on a public endpoint). The transaction re-checks it.
    const open = await this.prisma.guardianship_link_codes.findFirst({
      where: {
        code_hash: codeHash,
        purpose: 'adult_claim',
        consumed_at: null,
        revoked_at: null,
        expires_at: { gt: new Date() },
      },
      select: { link_code_id: true },
    });
    if (!open) {
      await this.recordFailure(counterKey);
      throw invalidCode();
    }
    // Slow: before the transaction and its lock.
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    let claim: { dependentId: string; issuerId: string };
    try {
      claim = await this.prisma.$transaction((tx) =>
        this.redeemInTransaction(tx, codeHash, dto.email, passwordHash),
      );
    } catch (error) {
      if (
        error instanceof AppException &&
        error.code === ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID
      ) {
        await this.recordFailure(counterKey);
      }
      if (isUniqueViolation(error)) {
        throw new AppConflictException(
          ErrorCode.FAMILY_ADULT_CLAIM_EMAIL_UNAVAILABLE,
        );
      }
      throw error;
    }

    await this.actingForCache.bump(claim.dependentId);
    try {
      await this.auth.sendVerificationEmail(claim.dependentId);
    } catch (error) {
      this.logger.warn(
        `adult claim verification email failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      await this.notifications.sendToUser(
        {
          userId: claim.issuerId,
          title: 'Tu código de acceso fue canjeado',
          body: 'La persona ya reclamó su cuenta y podrá iniciar sesión.',
          data: {
            type: 'majority_handover',
            dependent_user_id: claim.dependentId,
          },
        },
        'system',
        MAJORITY_HANDOVER_SOURCE,
      );
    } catch (error) {
      this.logger.warn(
        `adult claim issuer notice failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { status: 'success' };
  }

  private async redeemInTransaction(
    tx: Prisma.TransactionClient,
    codeHash: string,
    email: string,
    passwordHash: string,
  ): Promise<{ dependentId: string; issuerId: string }> {
    const now = new Date();
    const code = await tx.guardianship_link_codes.findFirst({
      where: {
        code_hash: codeHash,
        purpose: 'adult_claim',
        consumed_at: null,
        revoked_at: null,
        expires_at: { gt: now },
      },
    });
    if (!code) throw invalidCode();

    const dependentId = code.dependent_user_id;
    await lockDependent(tx, dependentId);

    // Atomic single use: of two concurrent redeems exactly one gets count 1.
    const consumed = await tx.guardianship_link_codes.updateMany({
      where: {
        link_code_id: code.link_code_id,
        consumed_at: null,
        revoked_at: null,
        expires_at: { gt: now },
      },
      data: { consumed_at: now, consumed_by_user_id: dependentId },
    });
    if (consumed.count !== 1) throw invalidCode();

    const state = await adultClaimTargetState(tx, dependentId);
    if (state === 'gone') throw invalidCode();
    if (state !== 'claimable') {
      // Rolls back: the code survives for when the person can use it.
      throw new AppNotFoundException(ErrorCode.FAMILY_ADULT_CLAIM_NOT_RELEASED);
    }

    const taken = await tx.users.findFirst({
      where: { email, NOT: { user_id: dependentId } },
      select: { user_id: true },
    });
    if (taken) {
      throw new AppConflictException(
        ErrorCode.FAMILY_ADULT_CLAIM_EMAIL_UNAVAILABLE,
      );
    }

    await tx.users.update({
      where: { user_id: dependentId },
      data: { email, email_verified: false },
    });
    await tx.account.create({
      data: {
        id: randomUUID(),
        accountId: dependentId,
        providerId: 'credential',
        userId: dependentId,
        password: passwordHash,
      },
    });
    // Neither the code nor the email nor the password reach the audit trail.
    await this.audit.recordEventOrThrow(
      {
        entity_type: 'dependent_profile',
        entity_id: dependentId,
        action: 'family.adult_claim.redeemed',
        actor_kind: 'anonymous',
        target_user_id: dependentId,
        changes: { issued_by_user_id: code.issued_by_user_id },
      },
      tx,
    );
    return { dependentId, issuerId: code.issued_by_user_id };
  }

  private async isLockedOut(key: string): Promise<boolean> {
    try {
      return (await this.failures.current(key)) >= LINK_CODE_MAX_FAILURES;
    } catch (error) {
      this.logger.warn(
        `Adult claim lockout read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async recordFailure(key: string): Promise<void> {
    try {
      await this.failures.increment(key);
    } catch (error) {
      this.logger.warn(
        `Adult claim failure not recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
