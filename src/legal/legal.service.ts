import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppBadRequestException } from '../common/errors/app.exception';
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
  constructor(private readonly prisma: PrismaService) {}

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

  async getStatus(
    userId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<LegalStatus> {
    const accepted = await client.legal_acceptances.findMany({
      where: {
        user_id: userId,
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
  ): Promise<LegalStatus> {
    this.assertCurrentVersions(versions);
    await this.prisma.legal_acceptances.createMany({
      data: this.rows(userId, versions, 'acceptance_gate', context),
      skipDuplicates: true,
    });
    return this.getStatus(userId);
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

  private rows(
    userId: string,
    versions: AcceptedLegalVersions,
    method: LegalAcceptanceMethod,
    context?: SessionRequestContext,
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
      accepted_by_user_id: null,
    }));
  }
}
