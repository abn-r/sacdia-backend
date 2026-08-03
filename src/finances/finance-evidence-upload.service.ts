import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppException,
  AppForbiddenException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  FINANCE_EVIDENCE_MIME_TYPES,
  FINANCE_EVIDENCE_STORAGE,
  FinanceEvidenceMime,
  FinanceEvidenceObjectHead,
  FinanceEvidenceStoragePort,
} from './finance-evidence-storage.port';
import {
  FinanceVoucherEvidenceOwnershipPort,
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
  namespace?: string;
  storage_key?: string;
  expected_mime_type?: FinanceEvidenceMime;
  expected_file_size?: number;
  verification_token?: string | null;
  verification_expires_at?: Date | null;
  finance_ledger_evidence_id?: string | null;
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
export type CompleteFinanceEvidenceUploadInput = {
  clubId: number;
  clubSectionId: number;
  uploadHandle: string;
};
export type CompleteFinanceEvidenceUploadResult = {
  evidenceHandle: string;
  status: 'completed';
};

@Injectable()
export class FinanceEvidenceUploadService implements FinanceVoucherEvidenceOwnershipPort {
  private static readonly TTL_SECONDS = 300;
  private static readonly LEASE_SECONDS = 60;
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

  async completeUpload(
    input: CompleteFinanceEvidenceUploadInput,
    actorUserId: string,
  ): Promise<CompleteFinanceEvidenceUploadResult> {
    this.assertCompletion(input, actorUserId);
    const claim = await this.claim(input, actorUserId);
    if (claim.intent.status === 'completed')
      return { evidenceHandle: input.uploadHandle, status: 'completed' };
    const head = await this.head(input);
    this.assertHead(head, claim.intent, input);
    const digest = await this.digest(input, head.etag, claim.intent);
    try {
      await this.prisma.$transaction(async (tx) => {
        const db = tx as Db;
        await this.authorize(tx, actorUserId, input);
        const intent = await this.lock(db, input.uploadHandle);
        if (
          !this.owned(intent, input, actorUserId) ||
          intent.status !== 'verifying' ||
          intent.verification_token !== claim.token ||
          !this.live(intent) ||
          !this.leaseLive(intent)
        )
          throw this.completionUnavailable();
        const evidence = await db.finance_ledger_evidence.create({
          data: {
            club_section_id: input.clubSectionId,
            storage_key: intent.storage_key,
            mime_type: intent.expected_mime_type,
            file_size: intent.expected_file_size,
            content_sha256: digest,
            created_by_id: actorUserId,
          },
        });
        await db.finance_ledger_evidence_upload_intents.update({
          where: {
            finance_ledger_evidence_upload_intent_id: input.uploadHandle,
          },
          data: {
            status: 'completed',
            finance_ledger_evidence_id: evidence.finance_ledger_evidence_id,
          },
        });
        await this.audit(
          db,
          actorUserId,
          input.clubId,
          input.uploadHandle,
          'COMPLETED',
        );
      });
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (['P2002', 'P2025'].includes((error as { code?: string }).code ?? ''))
        throw this.completionUnavailable();
      throw error;
    }
    return { evidenceHandle: input.uploadHandle, status: 'completed' };
  }

  async resolveOwnedEvidence(context: {
    transaction: Prisma.TransactionClient;
    actorUserId: string;
    clubId: number;
    clubSectionId: number;
    opaqueEvidenceHandle: string;
  }): Promise<{ financeLedgerEvidenceId: string }> {
    const { transaction, actorUserId, opaqueEvidenceHandle, ...input } =
      context;
    await this.authorize(transaction, actorUserId, input);
    if (!this.uuid(opaqueEvidenceHandle)) throw this.completionUnavailable();
    const intent = await this.lock(transaction, opaqueEvidenceHandle);
    if (
      !this.owned(intent, input, actorUserId) ||
      intent.status !== 'completed' ||
      !intent.finance_ledger_evidence_id
    )
      throw this.completionUnavailable();
    return { financeLedgerEvidenceId: intent.finance_ledger_evidence_id };
  }

  private async claim(
    input: CompleteFinanceEvidenceUploadInput,
    actorUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as Db;
      await this.authorize(tx, actorUserId, input);
      const intent = await this.lock(db, input.uploadHandle);
      if (!this.owned(intent, input, actorUserId) || !this.live(intent))
        throw this.completionUnavailable();
      if (intent.status === 'completed') return { intent, token: '' };
      if (
        !['issued', 'verifying'].includes(intent.status) ||
        this.leaseLive(intent)
      )
        throw this.completionUnavailable();
      const token = randomUUID();
      const expiresAt = new Date(
        Math.min(
          new Date(intent.expires_at).getTime(),
          Date.now() + FinanceEvidenceUploadService.LEASE_SECONDS * 1000,
        ),
      );
      await db.$queryRaw(
        Prisma.sql`UPDATE "finance_ledger_evidence_upload_intents" SET "status" = 'verifying', "verification_token" = ${token}::uuid, "verification_expires_at" = ${expiresAt} WHERE "finance_ledger_evidence_upload_intent_id" = ${input.uploadHandle}::uuid`,
      );
      await this.audit(
        db,
        actorUserId,
        input.clubId,
        input.uploadHandle,
        'CLAIMED',
      );
      intent.status = 'verifying';
      intent.verification_token = token;
      intent.verification_expires_at = expiresAt;
      return {
        intent,
        token,
      };
    });
  }

  private async lock(db: Db, uploadHandle: string): Promise<Intent> {
    const rows = (await db.$queryRaw(
      Prisma.sql`SELECT * FROM "finance_ledger_evidence_upload_intents" WHERE "finance_ledger_evidence_upload_intent_id" = ${uploadHandle}::uuid FOR UPDATE`,
    )) as Intent[];
    return rows[0];
  }
  private async head(input: CompleteFinanceEvidenceUploadInput) {
    try {
      const result = await this.storage.head({
        uploadId: input.uploadHandle,
        clubId: input.clubId,
        clubSectionId: input.clubSectionId,
      });
      if (!result)
        throw new AppUnprocessableEntityException(
          ErrorCode.FINANCE_EVIDENCE_UPLOAD_INCOMPLETE,
        );
      return result;
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        ErrorCode.FINANCE_EVIDENCE_UPLOAD_STORAGE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
  private assertHead(
    head: FinanceEvidenceObjectHead,
    intent: Intent,
    input: CompleteFinanceEvidenceUploadInput,
  ) {
    if (
      head.metadata.uploadId !== input.uploadHandle ||
      head.metadata.clubId !== input.clubId ||
      head.metadata.clubSectionId !== input.clubSectionId ||
      head.metadata.size !== intent.expected_file_size ||
      head.size !== intent.expected_file_size ||
      !FINANCE_EVIDENCE_MIME_TYPES.includes(head.mimeType) ||
      head.mimeType !== intent.expected_mime_type
    )
      throw new AppUnprocessableEntityException(
        ErrorCode.FINANCE_EVIDENCE_UPLOAD_INTEGRITY_FAILED,
      );
  }
  private async digest(
    input: CompleteFinanceEvidenceUploadInput,
    etag: string,
    intent: Intent,
  ) {
    try {
      const stream = await this.storage.getStream({
        uploadId: input.uploadHandle,
        clubId: input.clubId,
        clubSectionId: input.clubSectionId,
        etag,
      });
      const hash = createHash('sha256');
      let length = 0;
      let prefix = Buffer.alloc(0);
      for await (const value of stream) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        hash.update(chunk);
        length += chunk.length;
        if (prefix.length < 12)
          prefix = Buffer.concat([
            prefix,
            chunk.subarray(0, 12 - prefix.length),
          ]);
      }
      if (
        length !== intent.expected_file_size ||
        !this.magic(prefix, intent.expected_mime_type)
      )
        throw new AppUnprocessableEntityException(
          ErrorCode.FINANCE_EVIDENCE_UPLOAD_INTEGRITY_FAILED,
        );
      return hash.digest('hex');
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        ErrorCode.FINANCE_EVIDENCE_UPLOAD_STORAGE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
  private magic(prefix: Buffer, mime: FinanceEvidenceMime | undefined) {
    if (mime === 'image/jpeg')
      return prefix.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    if (mime === 'image/png')
      return prefix
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return (
      prefix.subarray(0, 4).equals(Buffer.from('RIFF')) &&
      prefix.subarray(8, 12).equals(Buffer.from('WEBP'))
    );
  }
  private owned(
    intent: Intent | undefined,
    input: { clubId: number; clubSectionId: number },
    actorUserId: string,
  ) {
    return (
      !!intent &&
      intent.actor_user_id === actorUserId &&
      intent.club_id === input.clubId &&
      intent.club_section_id === input.clubSectionId &&
      intent.namespace === 'finance-ledger'
    );
  }
  private live(intent: Intent) {
    return new Date(intent.expires_at).getTime() > Date.now();
  }
  private leaseLive(intent: Intent) {
    return (
      !!intent.verification_expires_at &&
      new Date(intent.verification_expires_at).getTime() > Date.now()
    );
  }
  private assertCompletion(
    input: CompleteFinanceEvidenceUploadInput,
    actorUserId: string,
  ) {
    if (
      !this.scope(input) ||
      !this.uuid(input.uploadHandle) ||
      !this.uuid(actorUserId)
    )
      throw new AppBadRequestException(
        ErrorCode.FINANCE_EVIDENCE_UPLOAD_INVALID,
      );
  }
  private completionUnavailable() {
    return new AppConflictException(
      ErrorCode.FINANCE_EVIDENCE_UPLOAD_UNAVAILABLE,
    );
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
