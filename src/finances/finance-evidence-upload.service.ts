import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  FINANCE_EVIDENCE_MIME_TYPES,
  FINANCE_EVIDENCE_STORAGE,
  FinanceEvidenceMime,
  FinanceEvidenceStoragePort,
} from './finance-evidence-storage.port';
import {
  FINANCE_LEDGER_REGISTRATION_AUTHORIZATION,
  FinanceLedgerRegistrationAuthorizationPort,
} from './finance-ledger.service';

type Db = Record<string, any>;
type Intent = {
  finance_ledger_evidence_upload_intent_id: string;
  actor_user_id: string;
  club_id: number;
  club_section_id: number;
  request_hash: string;
  status: string;
  expires_at: Date;
};
export type IssueFinanceEvidenceUploadInput = {
  clubId: number;
  clubSectionId: number;
  mimeType: FinanceEvidenceMime;
  fileSize: number;
};
export type IssueFinanceEvidenceUploadResult = {
  uploadHandle: string;
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
};

@Injectable()
export class FinanceEvidenceUploadService {
  private static readonly TTL_SECONDS = 300;
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FINANCE_LEDGER_REGISTRATION_AUTHORIZATION)
    private readonly authorization: FinanceLedgerRegistrationAuthorizationPort,
    @Inject(FINANCE_EVIDENCE_STORAGE)
    private readonly storage: FinanceEvidenceStoragePort,
  ) {}

  async issueUpload(
    input: IssueFinanceEvidenceUploadInput,
    actorUserId: string,
    idempotencyKey: string,
  ): Promise<IssueFinanceEvidenceUploadResult> {
    this.assertIssue(input, actorUserId, idempotencyKey);
    const requestHash = this.requestHash(input);
    const intent = await this.prisma.$transaction(async (tx) => {
      const db = tx as Db;
      await this.assertEnabled(db);
      const key = idempotencyKey.toLowerCase();
      await db.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`finance-evidence-upload:${actorUserId}:${key}`}, 0))`,
      );
      await this.authorize(tx, actorUserId, input);
      const existing = (await db.$queryRaw(
        Prisma.sql`SELECT * FROM "finance_ledger_evidence_upload_intents" WHERE "actor_user_id" = ${actorUserId}::uuid AND "idempotency_key" = ${key}::uuid FOR UPDATE`,
      )) as Intent[];
      if (existing.length) {
        if (existing[0].request_hash !== requestHash)
          throw new AppConflictException(
            ErrorCode.FINANCE_LEDGER_IDEMPOTENCY_REUSED,
          );
        if (existing[0].status !== 'issued' || this.remaining(existing[0]) < 1)
          throw this.unavailable();
        return existing[0];
      }
      const expiresAt = new Date(
        Date.now() + FinanceEvidenceUploadService.TTL_SECONDS * 1000,
      );
      const created = await db.finance_ledger_evidence_upload_intents.create({
        data: {
          actor_user_id: actorUserId,
          club_id: input.clubId,
          club_section_id: input.clubSectionId,
          idempotency_key: key,
          request_hash: requestHash,
          expected_mime_type: input.mimeType,
          expected_file_size: input.fileSize,
          expires_at: expiresAt,
        },
      });
      await this.audit(
        db,
        actorUserId,
        input.clubId,
        created.finance_ledger_evidence_upload_intent_id,
        'ISSUED',
      );
      return created as Intent;
    });
    const signed = await this.storage.issueCreateOnlyPut({
      uploadId: intent.finance_ledger_evidence_upload_intent_id,
      clubId: input.clubId,
      clubSectionId: input.clubSectionId,
      mimeType: input.mimeType,
      size: input.fileSize,
      expiresInSeconds: this.remaining(intent),
    });
    return {
      uploadHandle: intent.finance_ledger_evidence_upload_intent_id,
      uploadUrl: signed.uploadUrl,
      expiresAt: new Date(intent.expires_at).toISOString(),
      requiredHeaders: signed.requiredHeaders,
    };
  }

  async revokeUpload(
    input: { clubId: number; clubSectionId: number; uploadHandle: string },
    actorUserId: string,
  ): Promise<void> {
    if (
      !this.scope(input) ||
      !this.uuid(input.uploadHandle) ||
      !this.uuid(actorUserId)
    )
      throw new AppBadRequestException(ErrorCode.FINANCE_LEDGER_INPUT_INVALID);
    await this.prisma.$transaction(async (tx) => {
      const db = tx as Db;
      await this.authorize(tx, actorUserId, input);
      const rows = (await db.$queryRaw(
        Prisma.sql`SELECT * FROM "finance_ledger_evidence_upload_intents" WHERE "finance_ledger_evidence_upload_intent_id" = ${input.uploadHandle}::uuid FOR UPDATE`,
      )) as Intent[];
      const intent = rows[0];
      if (
        !intent ||
        intent.actor_user_id !== actorUserId ||
        intent.club_id !== input.clubId ||
        intent.club_section_id !== input.clubSectionId ||
        this.remaining(intent) < 1
      )
        throw this.unavailable();
      if (intent.status === 'revoked') return;
      if (!['issued', 'verifying'].includes(intent.status))
        throw this.unavailable();
      await db.$queryRaw(
        Prisma.sql`UPDATE "finance_ledger_evidence_upload_intents" SET "status" = 'revoked', "verification_token" = NULL, "verification_expires_at" = NULL WHERE "finance_ledger_evidence_upload_intent_id" = ${input.uploadHandle}::uuid`,
      );
      await this.audit(
        db,
        actorUserId,
        input.clubId,
        input.uploadHandle,
        'REVOKED',
      );
    });
  }

  private async assertEnabled(db: Db) {
    const flag = await db.system_config.findUnique({
      where: { config_key: 'finance.ledger_v2_writes_enabled' },
    });
    if (flag?.config_value !== 'true')
      throw new AppForbiddenException(ErrorCode.FINANCE_LEDGER_DISABLED);
  }
  private async authorize(
    transaction: any,
    actorUserId: string,
    input: { clubId: number; clubSectionId: number },
  ) {
    await this.authorization.assertCanRegister({
      transaction,
      actorUserId,
      clubId: input.clubId,
      clubSectionId: input.clubSectionId,
    });
  }
  private async audit(
    db: Db,
    actorUserId: string,
    clubId: number,
    handle: string,
    action: string,
  ) {
    const entityId = createHash('sha256').update(handle).digest('hex');
    await db.audit_logs.create({
      data: {
        entity_type: 'finance_evidence_upload',
        entity_id: entityId,
        action: `FINANCE_EVIDENCE_UPLOAD_${action}`,
        club_id: clubId,
        actor_user_id: actorUserId,
        changes: { status: action.toLowerCase() },
      },
    });
  }
  private requestHash(input: IssueFinanceEvidenceUploadInput) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          clubId: input.clubId,
          clubSectionId: input.clubSectionId,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
        }),
      )
      .digest('hex');
  }
  private remaining(intent: Intent) {
    return Math.ceil(
      (new Date(intent.expires_at).getTime() - Date.now()) / 1000,
    );
  }
  private unavailable() {
    return new AppConflictException(ErrorCode.FINANCE_LEDGER_STATUS_INVALID);
  }
  private scope(input: { clubId: number; clubSectionId: number }) {
    return (
      Number.isSafeInteger(input.clubId) &&
      input.clubId > 0 &&
      Number.isSafeInteger(input.clubSectionId) &&
      input.clubSectionId > 0
    );
  }
  private assertIssue(
    input: IssueFinanceEvidenceUploadInput,
    actorUserId: string,
    idempotencyKey: string,
  ) {
    const sensitive = [
      'key',
      'uri',
      'storageKey',
      'checksum',
      'contentSha256',
      'expiresInSeconds',
    ];
    if (
      !this.scope(input) ||
      !this.uuid(actorUserId) ||
      !this.uuid(idempotencyKey) ||
      !FINANCE_EVIDENCE_MIME_TYPES.includes(input.mimeType) ||
      !Number.isSafeInteger(input.fileSize) ||
      input.fileSize < 1 ||
      input.fileSize > 5 * 1024 * 1024 ||
      sensitive.some((key) => key in input)
    )
      throw new AppBadRequestException(ErrorCode.FINANCE_LEDGER_INPUT_INVALID);
  }
  private uuid(value: unknown) {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  }
}
