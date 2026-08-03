import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

type PrismaLike = Record<string, any>;
type EntryKind = 'income' | 'expense' | 'payable';
type LedgerDecision = 'approve' | 'reject';
type LockedSection = { club_section_id: number; main_club_id: number | null };

export const financeSectionLockQuery = (sectionIds: number[]) =>
  Prisma.sql`SELECT "club_section_id", "main_club_id" FROM "club_sections"
    WHERE "club_section_id" IN (${Prisma.join(
      [...new Set(sectionIds)].sort((left, right) => left - right),
    )}) ORDER BY "club_section_id" FOR UPDATE`;

export const FINANCE_LEDGER_REGISTRATION_AUTHORIZATION = Symbol(
  'FINANCE_LEDGER_REGISTRATION_AUTHORIZATION',
);

export interface FinanceLedgerRegistrationAuthorizationPort {
  assertCanRegister(context: {
    transaction: Prisma.TransactionClient;
    actorUserId: string;
    clubId: number;
    clubSectionId: number;
  }): Promise<void>;
}

export const FINANCE_LEDGER_DECISION_AUTHORIZATION = Symbol(
  'FINANCE_LEDGER_DECISION_AUTHORIZATION',
);

export const FINANCE_VOUCHER_EVIDENCE_OWNERSHIP = Symbol(
  'FINANCE_VOUCHER_EVIDENCE_OWNERSHIP',
);

export interface FinanceLedgerDecisionAuthorizationPort {
  assertCanDecide(context: {
    transaction: Prisma.TransactionClient;
    actorUserId: string;
    clubId: number;
    clubSectionId: number;
  }): Promise<void>;
}

export interface FinanceVoucherEvidenceOwnershipPort {
  resolveOwnedEvidence(context: {
    transaction: Prisma.TransactionClient;
    actorUserId: string;
    clubId: number;
    clubSectionId: number;
    opaqueEvidenceHandle: string;
  }): Promise<{ financeLedgerEvidenceId: string }>;
}

export interface RegisterLedgerEntryInput {
  clubId: number;
  clubSectionId: number;
  financeCategoryId: number;
  kind: EntryKind;
  amountCentavos: number;
  currency: string;
  financeDate: Date;
}

export interface DecideLedgerEntryInput {
  entryId: string;
  decision: LedgerDecision;
  reason?: string;
}

export interface AmendLedgerEntryInput extends Omit<
  RegisterLedgerEntryInput,
  'clubId'
> {
  entryId: string;
}

export interface AttachFinanceVoucherInput {
  clubId: number;
  clubSectionId: number;
  entryId: string;
  opaqueEvidenceHandle: string;
}

export interface AllocateFinanceReceiptInput {
  clubId: number;
  clubSectionId: number;
  financeVoucherId: string;
  obligationEntryId: string;
  amountCentavos: number;
}

@Injectable()
export class FinanceLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FINANCE_LEDGER_REGISTRATION_AUTHORIZATION)
    private readonly authorization: FinanceLedgerRegistrationAuthorizationPort,
    @Inject(FINANCE_LEDGER_DECISION_AUTHORIZATION)
    private readonly decisionAuthorization: FinanceLedgerDecisionAuthorizationPort,
    @Inject(FINANCE_VOUCHER_EVIDENCE_OWNERSHIP)
    private readonly evidenceOwnership: FinanceVoucherEvidenceOwnershipPort,
  ) {}

  async registerEntry(
    input: RegisterLedgerEntryInput,
    actorUserId: string,
    idempotencyKey: string,
  ): Promise<Record<string, any>> {
    this.validateEntry(input);
    const payload = {
      clubId: input.clubId,
      clubSectionId: input.clubSectionId,
      financeCategoryId: input.financeCategoryId,
      kind: input.kind,
      amountCentavos: input.amountCentavos,
      currency: input.currency,
      financeDate: this.businessDate(input.financeDate),
    };
    return this.idempotent(
      'register-entry',
      actorUserId,
      idempotencyKey,
      payload,
      (transaction) =>
        this.authorization.assertCanRegister({
          transaction,
          actorUserId,
          clubId: input.clubId,
          clubSectionId: input.clubSectionId,
        }),
      async (db) => {
        await db.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(${input.clubId}::integer, ${input.clubSectionId}::integer)`,
        );
        const category = await db.finances_categories.findUnique({
          where: { finance_category_id: input.financeCategoryId },
        });
        if (!category) {
          throw new AppNotFoundException(ErrorCode.FINANCE_CATEGORY_NOT_FOUND);
        }
        if (!category.active) {
          throw new AppBadRequestException(ErrorCode.FINANCE_CATEGORY_INACTIVE);
        }
        if (category.type !== (input.kind === 'income' ? 0 : 1)) {
          throw new AppBadRequestException(
            ErrorCode.FINANCE_CATEGORY_TYPE_INVALID,
          );
        }
        const currency = await db.finance_currencies.findUnique({
          where: { currency_code: input.currency },
        });
        if (!currency?.active) {
          throw new AppBadRequestException(
            ErrorCode.FINANCE_LEDGER_INPUT_INVALID,
          );
        }
        const entry = await db.finance_ledger_entries.create({
          data: {
            club_section_id: input.clubSectionId,
            finance_category_id: input.financeCategoryId,
            kind: input.kind,
            amount_centavos: input.amountCentavos,
            currency: input.currency,
            finance_date: this.businessDate(input.financeDate),
            registered_by_id: actorUserId,
          },
          select: this.receiptSelect(),
        });
        await this.recordCreated(
          db,
          entry,
          actorUserId,
          idempotencyKey,
          input.clubId,
        );
        return entry;
      },
    );
  }

  async decideEntry(
    input: DecideLedgerEntryInput,
    actorUserId: string,
    idempotencyKey: string,
  ): Promise<Record<string, any>> {
    const reason = input.reason?.trim();
    if (!['approve', 'reject'].includes(input.decision)) {
      throw new AppBadRequestException(ErrorCode.FINANCE_LEDGER_INPUT_INVALID);
    }
    if (input.decision === 'reject' && !reason) {
      throw new AppBadRequestException(
        ErrorCode.FINANCE_LEDGER_REJECTION_REASON_REQUIRED,
      );
    }
    if (reason && reason.length > 500) {
      throw new AppBadRequestException(ErrorCode.FINANCE_LEDGER_INPUT_INVALID);
    }
    return this.idempotent(
      'decide-entry',
      actorUserId,
      idempotencyKey,
      {
        entryId: input.entryId,
        decision: input.decision,
        reason: reason ?? null,
      },
      async (tx) => {
        const db = tx as PrismaLike;
        await db.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`finance-ledger-entry:${input.entryId}`}, 0))`,
        );
        const entry = await db.finance_ledger_entries.findUnique({
          where: { finance_ledger_entry_id: input.entryId },
          include: { club_section: { select: { main_club_id: true } } },
        });
        if (!entry) {
          throw new AppNotFoundException(
            ErrorCode.FINANCE_LEDGER_ENTRY_NOT_FOUND,
          );
        }
        const clubId = entry.club_section.main_club_id;
        if (clubId === null) {
          throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
        }
        await this.decisionAuthorization.assertCanDecide({
          transaction: tx,
          actorUserId,
          clubId,
          clubSectionId: entry.club_section_id,
        });
        return { entry, clubId };
      },
      async (db, context) => {
        const { entry, clubId } = context;
        if (entry.status !== 'pending_approval') {
          throw new AppConflictException(
            ErrorCode.FINANCE_LEDGER_STATUS_INVALID,
          );
        }
        const updated = await db.finance_ledger_entries.update({
          where: { finance_ledger_entry_id: input.entryId },
          data: {
            status: input.decision === 'approve' ? 'approved' : 'rejected',
            decided_by_id: actorUserId,
            decided_at: new Date(),
            rejection_reason: input.decision === 'reject' ? reason : null,
          },
          select: this.receiptSelect(),
        });
        await this.recordDecision(
          db,
          entry,
          updated,
          input.decision,
          actorUserId,
          idempotencyKey,
          clubId,
        );
        return updated;
      },
    );
  }

  async attachVoucher(
    input: AttachFinanceVoucherInput,
    actorUserId: string,
    idempotencyKey: string,
  ): Promise<Record<string, any>> {
    if (
      !Number.isSafeInteger(input.clubId) ||
      input.clubId <= 0 ||
      !Number.isSafeInteger(input.clubSectionId) ||
      input.clubSectionId <= 0 ||
      !this.isUuid(input.entryId) ||
      typeof input.opaqueEvidenceHandle !== 'string' ||
      !input.opaqueEvidenceHandle.trim()
    ) {
      throw new AppBadRequestException(ErrorCode.FINANCE_LEDGER_INPUT_INVALID);
    }
    return this.idempotent(
      'attach-voucher',
      actorUserId,
      idempotencyKey,
      {
        clubId: input.clubId,
        clubSectionId: input.clubSectionId,
        entryId: input.entryId,
        opaqueEvidenceHandle: input.opaqueEvidenceHandle,
      },
      async (tx) => {
        const db = tx as PrismaLike;
        await this.authorization.assertCanRegister({
          transaction: tx,
          actorUserId,
          clubId: input.clubId,
          clubSectionId: input.clubSectionId,
        });
        await db.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`finance-ledger-entry:${input.entryId}`}, 0))`,
        );
        const entry = await db.finance_ledger_entries.findUnique({
          where: { finance_ledger_entry_id: input.entryId },
        });
        if (!entry || entry.club_section_id !== input.clubSectionId) {
          throw new AppConflictException(
            ErrorCode.FINANCE_LEDGER_STATUS_INVALID,
          );
        }
        const owned = await this.evidenceOwnership.resolveOwnedEvidence({
          transaction: tx,
          actorUserId,
          clubId: input.clubId,
          clubSectionId: input.clubSectionId,
          opaqueEvidenceHandle: input.opaqueEvidenceHandle,
        });
        const evidence = (await db.$queryRaw(
          Prisma.sql`SELECT "finance_ledger_evidence_id", "storage_key", "mime_type", "file_size"
            FROM "finance_ledger_evidence"
            WHERE "finance_ledger_evidence_id" = ${owned.financeLedgerEvidenceId}::uuid
              AND "club_section_id" = ${input.clubSectionId}::integer
            FOR UPDATE`,
        )) as Array<Record<string, any>>;
        if (evidence.length !== 1 || entry.status !== 'approved') {
          throw new AppConflictException(
            ErrorCode.FINANCE_LEDGER_STATUS_INVALID,
          );
        }
        return { entry, evidence: evidence[0] };
      },
      async (db, context) => {
        let voucher: Record<string, any>;
        try {
          voucher = await db.finance_vouchers.create({
            data: {
              ledger_entry_id: context.entry.finance_ledger_entry_id,
              finance_ledger_evidence_id:
                context.evidence.finance_ledger_evidence_id,
              amount_centavos: context.entry.amount_centavos,
              currency: context.entry.currency,
              source_uri: context.evidence.storage_key,
              file_name: 'finance-ledger-evidence',
              mime_type: context.evidence.mime_type,
              file_size: context.evidence.file_size,
              recorded_by_id: actorUserId,
            },
            select: {
              finance_voucher_id: true,
              ledger_entry_id: true,
              finance_ledger_evidence_id: true,
              amount_centavos: true,
              currency: true,
            },
          });
        } catch (error) {
          if ((error as { code?: string }).code === 'P2002') {
            throw new AppConflictException(
              ErrorCode.FINANCE_LEDGER_STATUS_INVALID,
            );
          }
          throw error;
        }
        const payload = {
          club_id: input.clubId,
          club_section_id: input.clubSectionId,
          entry_id: context.entry.finance_ledger_entry_id,
        };
        await db.finance_ledger_events.create({
          data: {
            finance_voucher_id: voucher.finance_voucher_id,
            event_type: 'VOUCHER_ATTACHED',
            actor_user_id: actorUserId,
            payload,
          },
        });
        await db.audit_logs.create({
          data: {
            entity_type: 'finance_voucher',
            entity_id: voucher.finance_voucher_id,
            action: 'FINANCE_VOUCHER_ATTACHED',
            club_id: input.clubId,
            actor_user_id: actorUserId,
            changes: payload,
            event_key: `finance-ledger:VOUCHER_ATTACHED:${actorUserId}:${idempotencyKey.toLowerCase()}`,
            correlation_id: idempotencyKey.toLowerCase(),
            idempotency_key: idempotencyKey.toLowerCase(),
          },
        });
        return voucher;
      },
    );
  }

  async allocateReceipt(
    input: AllocateFinanceReceiptInput,
    actorUserId: string,
    idempotencyKey: string,
  ): Promise<Record<string, any>> {
    if (
      !Number.isSafeInteger(input.clubId) ||
      input.clubId <= 0 ||
      !Number.isSafeInteger(input.clubSectionId) ||
      input.clubSectionId <= 0 ||
      !Number.isSafeInteger(input.amountCentavos) ||
      input.amountCentavos <= 0 ||
      input.amountCentavos > 2147483647 ||
      !this.isUuid(input.financeVoucherId) ||
      !this.isUuid(input.obligationEntryId)
    ) {
      throw new AppBadRequestException(ErrorCode.FINANCE_LEDGER_INPUT_INVALID);
    }
    return this.idempotent(
      'allocate-receipt',
      actorUserId,
      idempotencyKey,
      input,
      async (tx) => {
        const db = tx as PrismaLike;
        await this.authorization.assertCanRegister({
          transaction: tx,
          actorUserId,
          clubId: input.clubId,
          clubSectionId: input.clubSectionId,
        });
        for (const lock of [
          `finance-ledger-voucher:${input.financeVoucherId}`,
          `finance-ledger-obligation:${input.obligationEntryId}`,
        ].sort()) {
          await db.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`,
          );
        }
        const voucher = await db.finance_vouchers.findUnique({
          where: { finance_voucher_id: input.financeVoucherId },
          include: { ledger_entry: true },
        });
        const obligation = await db.finance_ledger_entries.findUnique({
          where: { finance_ledger_entry_id: input.obligationEntryId },
        });
        if (
          !voucher ||
          !obligation ||
          voucher.ledger_entry?.status !== 'approved' ||
          voucher.ledger_entry?.club_section_id !== input.clubSectionId ||
          obligation.status !== 'approved' ||
          obligation.kind !== 'payable' ||
          obligation.club_section_id !== input.clubSectionId ||
          voucher.currency !== obligation.currency
        ) {
          throw new AppConflictException(
            ErrorCode.FINANCE_LEDGER_STATUS_INVALID,
          );
        }
        return { voucher, obligation };
      },
      async (db, { voucher, obligation }) => {
        const voucherAllocated = await db.finance_receipt_allocations.aggregate(
          {
            where: { finance_voucher_id: input.financeVoucherId },
            _sum: { amount_centavos: true },
          },
        );
        const obligationAllocated =
          await db.finance_receipt_allocations.aggregate({
            where: { obligation_entry_id: input.obligationEntryId },
            _sum: { amount_centavos: true },
          });
        if (
          (voucherAllocated._sum.amount_centavos ?? 0) + input.amountCentavos >
            voucher.amount_centavos ||
          (obligationAllocated._sum.amount_centavos ?? 0) +
            input.amountCentavos >
            obligation.amount_centavos
        ) {
          throw new AppConflictException(
            ErrorCode.FINANCE_LEDGER_STATUS_INVALID,
          );
        }
        let allocation: Record<string, any>;
        try {
          allocation = await db.finance_receipt_allocations.create({
            data: {
              finance_voucher_id: input.financeVoucherId,
              obligation_entry_id: input.obligationEntryId,
              amount_centavos: input.amountCentavos,
            },
            select: {
              finance_receipt_allocation_id: true,
              finance_voucher_id: true,
              obligation_entry_id: true,
              amount_centavos: true,
            },
          });
        } catch (error) {
          if ((error as { code?: string }).code === 'P2002') {
            throw new AppConflictException(
              ErrorCode.FINANCE_LEDGER_STATUS_INVALID,
            );
          }
          throw error;
        }
        const payload = {
          club_id: input.clubId,
          club_section_id: input.clubSectionId,
          finance_voucher_id: input.financeVoucherId,
          obligation_entry_id: input.obligationEntryId,
          amount_centavos: input.amountCentavos,
          currency: voucher.currency,
        };
        await db.finance_ledger_events.create({
          data: {
            finance_receipt_allocation_id:
              allocation.finance_receipt_allocation_id,
            event_type: 'RECEIPT_ALLOCATED',
            actor_user_id: actorUserId,
            payload,
          },
        });
        await db.audit_logs.create({
          data: {
            entity_type: 'finance_receipt_allocation',
            entity_id: allocation.finance_receipt_allocation_id,
            action: 'FINANCE_RECEIPT_ALLOCATED',
            club_id: input.clubId,
            actor_user_id: actorUserId,
            changes: payload,
            event_key: `finance-ledger:RECEIPT_ALLOCATED:${actorUserId}:${idempotencyKey.toLowerCase()}`,
            correlation_id: idempotencyKey.toLowerCase(),
            idempotency_key: idempotencyKey.toLowerCase(),
          },
        });
        return allocation;
      },
    );
  }

  async amendEntry(
    input: AmendLedgerEntryInput,
    actorUserId: string,
    idempotencyKey: string,
  ): Promise<Record<string, any>> {
    this.validateEntry(input);
    const data = this.amendmentData(input);
    return this.idempotent(
      'amend-entry',
      actorUserId,
      idempotencyKey,
      {
        entryId: input.entryId,
        ...data,
        finance_date: this.businessDate(input.financeDate),
      },
      async (tx) => {
        const db = tx as PrismaLike;
        await db.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`finance-ledger-entry:${input.entryId}`}, 0))`,
        );
        const entry = await db.finance_ledger_entries.findUnique({
          where: { finance_ledger_entry_id: input.entryId },
        });
        if (!entry) {
          throw new AppNotFoundException(
            ErrorCode.FINANCE_LEDGER_ENTRY_NOT_FOUND,
          );
        }
        if (entry.registered_by_id !== actorUserId) {
          throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
        }
        if (entry.status !== 'pending_approval') {
          throw new AppConflictException(
            ErrorCode.FINANCE_LEDGER_STATUS_INVALID,
          );
        }
        const sectionIds = [
          ...new Set([entry.club_section_id, input.clubSectionId]),
        ].sort((left, right) => left - right);
        const lockedSections = (await db.$queryRaw(
          financeSectionLockQuery(sectionIds),
        )) as LockedSection[];
        const clubId = lockedSections.find(
          (section) => section.club_section_id === entry.club_section_id,
        )?.main_club_id;
        if (
          clubId == null ||
          lockedSections.length !== sectionIds.length ||
          lockedSections.some((section) => section.main_club_id !== clubId)
        ) {
          throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
        }
        for (const clubSectionId of sectionIds) {
          await this.authorization.assertCanRegister({
            transaction: tx,
            actorUserId,
            clubId,
            clubSectionId,
          });
        }
        return { entry, clubId };
      },
      async (db, context) => {
        const target = this.snapshot(
          { ...context.entry, ...data },
          context.clubId,
        );
        if (
          JSON.stringify(this.snapshot(context.entry, context.clubId)) ===
          JSON.stringify(target)
        ) {
          throw new AppConflictException(ErrorCode.FINANCE_LEDGER_NO_CHANGES);
        }
        await this.assertMaterialReferences(db, input);
        const updated = await db.finance_ledger_entries.update({
          where: { finance_ledger_entry_id: input.entryId },
          data,
          select: this.receiptSelect(),
        });
        await this.recordAmended(
          db,
          context.entry,
          updated,
          actorUserId,
          idempotencyKey,
          context.clubId,
        );
        return updated;
      },
    );
  }

  private async idempotent<T, TAuthorization = undefined>(
    command: string,
    actorUserId: string,
    idempotencyKey: string,
    payload: object,
    authorize: (
      transaction: Prisma.TransactionClient,
    ) => Promise<TAuthorization>,
    mutate: (db: PrismaLike, context: TAuthorization) => Promise<T>,
  ): Promise<T> {
    const key = idempotencyKey.toLowerCase();
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ command, ...payload }))
      .digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const db = tx as PrismaLike;
      const flag = await db.system_config.findUnique({
        where: { config_key: 'finance.ledger_v2_writes_enabled' },
      });
      if (flag?.config_value !== 'true') {
        throw new AppForbiddenException(ErrorCode.FINANCE_LEDGER_DISABLED);
      }
      const lock = `finance-ledger-idempotency:${actorUserId}:${key}`;
      await db.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`,
      );
      const context = await authorize(tx);
      const existing = await db.finance_idempotency_receipts.findUnique({
        where: {
          actor_user_id_idempotency_key: {
            actor_user_id: actorUserId,
            idempotency_key: key,
          },
        },
      });
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new AppConflictException(
            ErrorCode.FINANCE_LEDGER_IDEMPOTENCY_REUSED,
          );
        }
        return existing.response as T;
      }
      const response = JSON.parse(
        JSON.stringify(await mutate(db, context)),
      ) as T;
      await db.finance_idempotency_receipts.create({
        data: {
          actor_user_id: actorUserId,
          idempotency_key: key,
          command,
          request_hash: requestHash,
          response,
        },
      });
      return response;
    });
  }

  private isUuid(value: string) {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  }

  private validateEntry(
    input: Pick<
      RegisterLedgerEntryInput,
      | 'clubSectionId'
      | 'financeCategoryId'
      | 'kind'
      | 'amountCentavos'
      | 'currency'
      | 'financeDate'
    >,
  ) {
    if (
      !Number.isSafeInteger(input.clubSectionId) ||
      input.clubSectionId <= 0 ||
      !Number.isSafeInteger(input.financeCategoryId) ||
      input.financeCategoryId <= 0 ||
      !Number.isSafeInteger(input.amountCentavos) ||
      input.amountCentavos <= 0 ||
      input.amountCentavos > 2147483647 ||
      !['income', 'expense', 'payable'].includes(input.kind) ||
      typeof input.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(input.currency) ||
      !(input.financeDate instanceof Date) ||
      Number.isNaN(input.financeDate.getTime())
    ) {
      throw new AppBadRequestException(ErrorCode.FINANCE_LEDGER_INPUT_INVALID);
    }
  }

  private amendmentData(input: AmendLedgerEntryInput) {
    return {
      club_section_id: input.clubSectionId,
      finance_category_id: input.financeCategoryId,
      kind: input.kind,
      amount_centavos: input.amountCentavos,
      currency: input.currency,
      finance_date: this.businessDate(input.financeDate),
    };
  }

  private async assertMaterialReferences(
    db: PrismaLike,
    input: Pick<
      RegisterLedgerEntryInput,
      'financeCategoryId' | 'kind' | 'currency'
    >,
  ) {
    const category = await db.finances_categories.findUnique({
      where: { finance_category_id: input.financeCategoryId },
    });
    if (!category) {
      throw new AppNotFoundException(ErrorCode.FINANCE_CATEGORY_NOT_FOUND);
    }
    if (!category.active) {
      throw new AppBadRequestException(ErrorCode.FINANCE_CATEGORY_INACTIVE);
    }
    if (category.type !== (input.kind === 'income' ? 0 : 1)) {
      throw new AppBadRequestException(ErrorCode.FINANCE_CATEGORY_TYPE_INVALID);
    }
    const currency = await db.finance_currencies.findUnique({
      where: { currency_code: input.currency },
    });
    if (!currency?.active) {
      throw new AppBadRequestException(ErrorCode.FINANCE_LEDGER_INPUT_INVALID);
    }
  }

  private async recordCreated(
    db: PrismaLike,
    entry: Record<string, any>,
    actorUserId: string,
    idempotencyKey: string,
    clubId: number,
  ) {
    const payload = this.snapshot(entry, clubId);
    await db.finance_ledger_events.create({
      data: {
        finance_ledger_entry_id: entry.finance_ledger_entry_id,
        event_type: 'CREATED',
        actor_user_id: actorUserId,
        payload,
      },
    });
    await db.audit_logs.create({
      data: {
        entity_type: 'finance_ledger_entry',
        entity_id: entry.finance_ledger_entry_id,
        action: 'FINANCE_LEDGER_ENTRY_REGISTERED',
        club_id: clubId,
        actor_user_id: actorUserId,
        changes: payload,
        event_key: `finance-ledger:CREATED:${actorUserId}:${idempotencyKey.toLowerCase()}`,
        correlation_id: idempotencyKey.toLowerCase(),
        idempotency_key: idempotencyKey.toLowerCase(),
      },
    });
  }

  private async recordDecision(
    db: PrismaLike,
    before: Record<string, any>,
    after: Record<string, any>,
    decision: LedgerDecision,
    actorUserId: string,
    idempotencyKey: string,
    clubId: number,
  ) {
    const payload = {
      club_id: clubId,
      club_section_id: before.club_section_id,
      decision,
      before: this.snapshot(before, clubId),
      after: this.snapshot(after, clubId),
    };
    const eventType = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    await db.finance_ledger_events.create({
      data: {
        finance_ledger_entry_id: before.finance_ledger_entry_id,
        event_type: eventType,
        actor_user_id: actorUserId,
        payload,
      },
    });
    await db.audit_logs.create({
      data: {
        entity_type: 'finance_ledger_entry',
        entity_id: before.finance_ledger_entry_id,
        action: `FINANCE_LEDGER_ENTRY_${eventType}`,
        club_id: clubId,
        actor_user_id: actorUserId,
        changes: payload,
        event_key: `finance-ledger:${eventType}:${actorUserId}:${idempotencyKey.toLowerCase()}`,
        correlation_id: idempotencyKey.toLowerCase(),
        idempotency_key: idempotencyKey.toLowerCase(),
      },
    });
  }

  private async recordAmended(
    db: PrismaLike,
    before: Record<string, any>,
    after: Record<string, any>,
    actorUserId: string,
    idempotencyKey: string,
    clubId: number,
  ) {
    const payload = {
      club_id: clubId,
      before: this.snapshot(before, clubId),
      after: this.snapshot(after, clubId),
    };
    await db.finance_ledger_events.create({
      data: {
        finance_ledger_entry_id: before.finance_ledger_entry_id,
        event_type: 'AMENDED',
        actor_user_id: actorUserId,
        payload,
      },
    });
    await db.audit_logs.create({
      data: {
        entity_type: 'finance_ledger_entry',
        entity_id: before.finance_ledger_entry_id,
        action: 'FINANCE_LEDGER_ENTRY_AMENDED',
        club_id: clubId,
        actor_user_id: actorUserId,
        changes: payload,
        event_key: `finance-ledger:AMENDED:${actorUserId}:${idempotencyKey.toLowerCase()}`,
        correlation_id: idempotencyKey.toLowerCase(),
        idempotency_key: idempotencyKey.toLowerCase(),
      },
    });
  }

  private snapshot(entry: Record<string, any>, clubId = entry.club_id) {
    return {
      club_id: clubId,
      club_section_id: entry.club_section_id,
      finance_category_id: entry.finance_category_id,
      kind: entry.kind,
      amount_centavos: entry.amount_centavos,
      currency: entry.currency,
      finance_date:
        entry.finance_date?.toISOString?.().slice(0, 10) ?? entry.finance_date,
      status: entry.status,
      registered_by_id: entry.registered_by_id,
      decided_by_id: entry.decided_by_id,
      decided_at: entry.decided_at?.toISOString?.() ?? entry.decided_at,
      rejection_reason: entry.rejection_reason,
    };
  }

  private businessDate(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private receiptSelect() {
    return {
      finance_ledger_entry_id: true,
      club_section_id: true,
      finance_category_id: true,
      status: true,
      kind: true,
      amount_centavos: true,
      currency: true,
      finance_date: true,
      registered_by_id: true,
      decided_by_id: true,
      decided_at: true,
      rejection_reason: true,
    };
  }
}
