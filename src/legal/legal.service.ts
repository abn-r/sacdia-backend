import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppBadRequestException,
  AppException,
} from '../common/errors/app.exception';
import { HttpStatus } from '@nestjs/common';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import { RELEASE_THAWABLE_FROZEN_REASONS } from '../guardianships/guardianships.constants';
import { ReleaseCompletionService } from '../guardianships/release-completion.service';
import { ErrorCode } from '../common/errors/error-codes';
import type { SessionRequestContext } from '../better-auth/better-auth.service';
import {
  CURRENT_LEGAL_DOCUMENTS,
  IP_MAX,
  LEGAL_DOCUMENT_TYPES,
  USER_AGENT_MAX,
  type LegalAcceptanceMethod,
} from './legal-documents.constants';
import type {
  AcceptedLegalVersions,
  LegalDocument,
  LegalStatus,
} from './legal.types';

/**
 * Terms/Privacy acceptance. `legal_acceptances` is append-only evidence: this
 * service only ever inserts (skipping duplicates), never updates or deletes.
 * A document is pending iff there is NO row for (user, type, CURRENT version).
 */
@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly releaseCompletion: ReleaseCompletionService,
    private readonly actingForCache: ActingForCache,
  ) {}

  /** Current documents, always ordered terms then privacy. */
  getCurrent(): LegalDocument[] {
    return LEGAL_DOCUMENT_TYPES.map((type) => ({
      document_type: type,
      version: CURRENT_LEGAL_DOCUMENTS[type].version,
      url: CURRENT_LEGAL_DOCUMENTS[type].url,
    }));
  }

  /** Trim only, then exact case-sensitive equality with the current version. */
  assertCurrentVersions(versions: AcceptedLegalVersions): void {
    for (const type of LEGAL_DOCUMENT_TYPES) {
      const sent = versions[type];
      if (
        typeof sent !== 'string' ||
        sent.trim() !== CURRENT_LEGAL_DOCUMENTS[type].version
      ) {
        throw new AppBadRequestException(ErrorCode.LEGAL_VERSION_MISMATCH);
      }
    }
  }

  /**
   * `releaseOnly` (Phase 4, released_user principal): ONLY `method =
   * 'majority_release'` rows count. The guardian-on-behalf rows and the
   * person's own pre-release rows do NOT satisfy the fresh acceptance a
   * released adult owes. Without it the predicate is unchanged.
   */
  async getStatus(
    userId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
    opts: { releaseOnly?: boolean } = {},
  ): Promise<LegalStatus> {
    const accepted = await client.legal_acceptances.findMany({
      where: {
        user_id: userId,
        ...(opts.releaseOnly ? { method: 'majority_release' } : {}),
        OR: LEGAL_DOCUMENT_TYPES.map((type) => ({
          document_type: type,
          document_version: CURRENT_LEGAL_DOCUMENTS[type].version,
        })),
      },
      select: { document_type: true, accepted_at: true },
    });

    const documents = this.getCurrent().map((document) => {
      const row = accepted.find(
        (entry) => entry.document_type === document.document_type,
      );
      return {
        ...document,
        accepted: row !== undefined,
        accepted_at: row ? row.accepted_at.toISOString() : null,
      };
    });

    return {
      requires_acceptance: documents.some((document) => !document.accepted),
      documents,
    };
  }

  /** Gate acceptance: validates versions, writes the missing rows, returns the status. */
  async accept(
    userId: string,
    versions: AcceptedLegalVersions,
    context?: SessionRequestContext,
    acceptedByUserId?: string | null,
  ): Promise<LegalStatus> {
    this.assertCurrentVersions(versions);
    await this.prisma.legal_acceptances.createMany({
      data: this.rows(
        userId,
        versions,
        'acceptance_gate',
        context,
        acceptedByUserId,
      ),
      skipDuplicates: true,
    });
    return this.getStatus(userId);
  }

  /**
   * Phase 4: a released adult accepts the CURRENT documents (per-person row,
   * method 'majority_release', `accepted_by_user_id` NULL). Idempotent: a second
   * accept is a 200 with no duplicate row. Marks `release_accepted_at` and, when
   * an email is on file, completes the release (and thaws a frozen person, R1).
   * 409 FAMILY_RELEASE_NOT_PENDING when the person has no live release.
   */
  async acceptMajorityRelease(
    userId: string,
    versions: AcceptedLegalVersions,
    context?: SessionRequestContext,
  ): Promise<LegalStatus> {
    this.assertCurrentVersions(versions);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.legal_acceptances.createMany({
        data: this.rows(userId, versions, 'majority_release', context),
        skipDuplicates: true,
      });
      const claimed = await tx.dependent_profiles.updateMany({
        where: {
          user_id: userId,
          purged_at: null,
          release_accepted_at: null,
          // A legacy freeze (minor without a guardian) is not a release.
          OR: [
            { frozen_at: null },
            { frozen_reason: { in: [...RELEASE_THAWABLE_FROZEN_REASONS] } },
          ],
        },
        data: { release_accepted_at: now },
      });
      if (claimed.count === 0) {
        const profile = await tx.dependent_profiles.findUnique({
          where: { user_id: userId },
          select: {
            purged_at: true,
            release_accepted_at: true,
            frozen_at: true,
            frozen_reason: true,
          },
        });
        const live =
          profile !== null &&
          profile.purged_at === null &&
          profile.release_accepted_at !== null &&
          (profile.frozen_at === null ||
            (
              RELEASE_THAWABLE_FROZEN_REASONS as readonly (string | null)[]
            ).includes(profile.frozen_reason));
        if (!live) {
          throw new AppException(
            ErrorCode.FAMILY_RELEASE_NOT_PENDING,
            HttpStatus.CONFLICT,
          );
        }
      }
      return this.releaseCompletion.tryComplete(tx, userId, now);
    });
    // After the commit: acting grants and the supervised state moved.
    await this.actingForCache.bump(userId);
    return this.getStatus(userId, this.prisma, { releaseOnly: true });
  }

  /** Register acceptance: runs inside the register transaction. */
  async recordOnRegister(
    tx: Prisma.TransactionClient,
    userId: string,
    versions: AcceptedLegalVersions,
    context?: SessionRequestContext,
  ): Promise<void> {
    await tx.legal_acceptances.createMany({
      data: this.rows(userId, versions, 'register_checkbox', context),
      skipDuplicates: true,
    });
  }

  /**
   * Dependent creation: the guardian accepts Terms/Privacy ON BEHALF of the
   * minor. The row belongs to the dependent; `accepted_by_user_id` keeps the
   * guardian who actually clicked the checkbox. Runs inside the create tx.
   */
  async recordOnBehalf(
    tx: Prisma.TransactionClient,
    dependentId: string,
    versions: AcceptedLegalVersions,
    guardianId: string,
    context?: SessionRequestContext,
  ): Promise<void> {
    await tx.legal_acceptances.createMany({
      data: this.rows(
        dependentId,
        versions,
        'register_checkbox',
        context,
        guardianId,
      ),
      skipDuplicates: true,
    });
  }

  private rows(
    userId: string,
    versions: AcceptedLegalVersions,
    method: LegalAcceptanceMethod,
    context?: SessionRequestContext,
    acceptedByUserId?: string | null,
  ): Prisma.legal_acceptancesCreateManyInput[] {
    return LEGAL_DOCUMENT_TYPES.map((type) => ({
      user_id: userId,
      document_type: type,
      document_version: versions[type].trim(),
      method,
      // sessionContextFromRequest already caps the UA; the slice keeps the
      // column limits local to this table.
      ip_address: context?.ipAddress?.slice(0, IP_MAX) ?? null,
      user_agent: context?.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
      accepted_by_user_id: acceptedByUserId ?? null,
    }));
  }
}
