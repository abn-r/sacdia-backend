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

export interface RegisterLedgerEntryInput {
  clubId: number;
  clubSectionId: number;
  financeCategoryId: number;
  kind: EntryKind;
  amountCentavos: number;
  currency: string;
  financeDate: Date;
}

@Injectable()
export class FinanceLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FINANCE_LEDGER_REGISTRATION_AUTHORIZATION)
    private readonly authorization: FinanceLedgerRegistrationAuthorizationPort,
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
      financeDate: input.financeDate.toISOString(),
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
            finance_date: input.financeDate,
            registered_by_id: actorUserId,
          },
          select: this.receiptSelect(),
        });
        await this.recordCreated(
          db,
          entry,
          input,
          actorUserId,
          idempotencyKey,
          input.clubId,
        );
        return entry;
      },
    );
  }

  private async idempotent<T>(
    command: string,
    actorUserId: string,
    idempotencyKey: string,
    payload: object,
    authorize: (transaction: Prisma.TransactionClient) => Promise<void>,
    mutate: (db: PrismaLike) => Promise<T>,
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
      await authorize(tx);
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
      const response = await mutate(db);
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

  private validateEntry(input: RegisterLedgerEntryInput) {
    if (
      !Number.isInteger(input.amountCentavos) ||
      input.amountCentavos <= 0 ||
      !/^[A-Z]{3}$/.test(input.currency) ||
      Number.isNaN(input.financeDate.getTime())
    ) {
      throw new AppBadRequestException(ErrorCode.FINANCE_LEDGER_INPUT_INVALID);
    }
  }

  private async recordCreated(
    db: PrismaLike,
    entry: Record<string, any>,
    input: RegisterLedgerEntryInput,
    actorUserId: string,
    idempotencyKey: string,
    clubId: number,
  ) {
    const payload = {
      club_id: input.clubId,
      club_section_id: input.clubSectionId,
      finance_category_id: input.financeCategoryId,
      kind: input.kind,
      amount_centavos: input.amountCentavos,
      currency: input.currency,
      finance_date: input.financeDate.toISOString().slice(0, 10),
      status: entry.status,
      registered_by_id: actorUserId,
    };
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

  private receiptSelect() {
    return {
      finance_ledger_entry_id: true,
      status: true,
      kind: true,
      amount_centavos: true,
      currency: true,
    };
  }
}
