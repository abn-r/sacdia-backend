import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import 'multer';
import type { Prisma } from '@prisma/client';
import {
  AuditLogsService,
  type RecordEventDto,
} from '../audit-logs/audit-logs.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
  AppServiceUnavailableException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
  type FileStorageService,
} from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Db } from './guardianship-queries';
import { CONSENT_EVIDENCE_MIME_TYPES } from './consent-evidence-file.pipe';
import {
  ACTIVE_USER_GUARDIAN,
  NOT_REVOKED,
  VISIBLE_DEPENDENT,
  displayName,
  findConsentRow,
  findSectionAssignment,
  lockDependent,
} from './guardianship-queries';

/** Signed GET URLs of consent forms live 15 minutes (FP-69). */
export const CONSENT_EVIDENCE_SIGNED_URL_TTL_SECONDS = 900;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const EVIDENCE_BUCKET_ENV = 'R2_BUCKET_GUARDIANSHIP_EVIDENCE';

export type EvidenceReader = 'guardian' | 'director' | 'admin';

export interface UploadedConsentEvidence {
  evidence_id: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface ConsentEvidenceDownload {
  url: string;
  expires_in: number;
  content_type: string;
  uploaded_at: string;
}

export interface DirectorConsentEvidenceDownload extends ConsentEvidenceDownload {
  uploaded_by_display_name: string;
}

interface CurrentEvidence {
  evidence_id: string;
  guardianship_id: string;
  file_key: string;
  content_type: string;
  uploaded_at: Date;
  uploaded_by: {
    name: string | null;
    paternal_last_name: string | null;
  } | null;
}

/** Where a form is stored: the dependent's consent-bearing guardianship row. */
interface EvidenceTarget {
  guardianshipId: string;
  dependentUserId: string;
}

/**
 * Signed parental-consent forms (photo or PDF) in the PRIVATE
 * GUARDIANSHIP_EVIDENCE bucket.
 *
 * - The form belongs to the dependent's consent row (the active primary holder:
 *   a guardian, or club custody). Whoever uploads (guardian, director) is
 *   recorded in `uploaded_by_user_id`; the director's verification depends on
 *   it for the custodian four-eyes rule.
 * - A re-upload supersedes the previous current row but KEEPS its object (legal
 *   history). At most one row is current (`uq_guardianship_consent_evidences_current`).
 * - Once the consent is verified the verified form stays the current one: a new
 *   upload is a 409 GUARDIANSHIP_CONSENT_ALREADY_VERIFIED (replacing it needs a
 *   revocation, i.e. a new guardianship).
 * - Files are only ever served through signed URLs (TTL 900 s) and every read is
 *   audited. No public URL exists for this bucket.
 * - The audit is fail closed: a read whose audit row cannot be written returns
 *   no URL, an upload whose audit row cannot be written is rolled back (both
 *   503 GUARDIANSHIP_EVIDENCE_UNAVAILABLE). Logs carry ids, never object keys.
 * - Fail closed: while the bucket is not configured every operation is a 503
 *   and the rest of the API keeps working.
 */
@Injectable()
export class GuardianEvidenceService {
  private readonly logger = new Logger(GuardianEvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly storage: FileStorageService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Guardian
  // ---------------------------------------------------------------------------

  async uploadForGuardian(
    guardianId: string,
    dependentId: string,
    file: Express.Multer.File | undefined,
  ): Promise<UploadedConsentEvidence> {
    this.assertConfigured();
    const target = await this.resolveGuardianTarget(guardianId, dependentId);
    return this.store(target, guardianId, file, 'guardian');
  }

  async getForGuardian(
    guardianId: string,
    dependentId: string,
  ): Promise<ConsentEvidenceDownload> {
    this.assertConfigured();
    const target = await this.resolveGuardianTarget(guardianId, dependentId);
    const evidence = await this.requireCurrent(target.guardianshipId);
    return this.signAndAudit(evidence, target, guardianId, 'guardian');
  }

  // ---------------------------------------------------------------------------
  // Director (club_members:approve on the assignment, enforced by the guard)
  // ---------------------------------------------------------------------------

  async uploadForDirector(
    directorId: string,
    clubSectionId: number,
    assignmentId: string,
    file: Express.Multer.File | undefined,
  ): Promise<UploadedConsentEvidence> {
    this.assertConfigured();
    const target = await this.resolveDirectorTarget(
      clubSectionId,
      assignmentId,
      ['pending'],
    );
    return this.store(target, directorId, file, 'director');
  }

  async getForDirector(
    directorId: string,
    clubSectionId: number,
    assignmentId: string,
  ): Promise<DirectorConsentEvidenceDownload> {
    this.assertConfigured();
    const target = await this.resolveDirectorTarget(
      clubSectionId,
      assignmentId,
      ['pending', 'active'],
    );
    const evidence = await this.requireCurrent(target.guardianshipId);
    const download = await this.signAndAudit(
      evidence,
      target,
      directorId,
      'director',
    );
    return {
      ...download,
      uploaded_by_display_name: displayName(evidence.uploaded_by),
    };
  }

  // ---------------------------------------------------------------------------
  // Admin (users:read_detail + legal_representative sensitive read, guard)
  // ---------------------------------------------------------------------------

  /**
   * `guardianshipId` must belong to `userId` as the DEPENDENT, otherwise 404:
   * an admin route addressed with a mismatching pair never leaks another
   * family's form.
   */
  async getForAdmin(
    adminId: string,
    userId: string,
    guardianshipId: string,
  ): Promise<ConsentEvidenceDownload> {
    this.assertConfigured();
    const row = await this.prisma.guardianships.findFirst({
      where: { guardianship_id: guardianshipId, dependent_user_id: userId },
      select: { guardianship_id: true, dependent_user_id: true },
    });
    if (!row) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }
    const evidence = await this.requireCurrent(row.guardianship_id);
    return this.signAndAudit(
      evidence,
      {
        guardianshipId: row.guardianship_id,
        dependentUserId: row.dependent_user_id,
      },
      adminId,
      'admin',
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Fail closed: no bucket configured means no evidence operation at all. */
  private assertConfigured(): void {
    const bucket = this.config.get<string>(EVIDENCE_BUCKET_ENV)?.trim();
    if (!bucket) {
      this.logger.error(
        `${EVIDENCE_BUCKET_ENV} is not set: consent evidence endpoints are disabled`,
      );
      throw new AppServiceUnavailableException(
        ErrorCode.GUARDIANSHIP_EVIDENCE_UNAVAILABLE,
      );
    }
  }

  /**
   * Any active guardian of a visible dependent may upload/read; the form is
   * attached to the dependent's consent row (the primary holder), which is the
   * row the director verifies. A stranger gets 404, never 403.
   */
  private async resolveGuardianTarget(
    guardianId: string,
    dependentId: string,
  ): Promise<EvidenceTarget> {
    const own = await this.prisma.guardianships.findFirst({
      where: {
        ...ACTIVE_USER_GUARDIAN,
        dependent_user_id: dependentId,
        guardian_user_id: guardianId,
        dependent: VISIBLE_DEPENDENT,
      },
      select: { guardianship_id: true },
    });
    if (!own) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }
    return this.consentTarget(dependentId);
  }

  /**
   * The request must belong to the section in the path (a mismatch is the same
   * 404 as a missing one) and be in one of `statuses`; the requester must be a
   * dependent.
   */
  private async resolveDirectorTarget(
    clubSectionId: number,
    assignmentId: string,
    statuses: readonly string[],
  ): Promise<EvidenceTarget> {
    const assignment = await findSectionAssignment(
      this.prisma,
      clubSectionId,
      assignmentId,
    );
    if (
      !assignment ||
      !assignment.active ||
      !assignment.status ||
      !statuses.includes(assignment.status)
    ) {
      throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
    }
    const profile = await this.prisma.dependent_profiles.findUnique({
      where: { user_id: assignment.user_id },
      select: { user_id: true },
    });
    if (!profile) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }
    return this.consentTarget(assignment.user_id);
  }

  private async consentTarget(dependentId: string): Promise<EvidenceTarget> {
    const row = await findConsentRow(this.prisma, dependentId);
    if (!row) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }
    return {
      guardianshipId: row.guardianship_id,
      dependentUserId: row.dependent_user_id,
    };
  }

  private async store(
    target: EvidenceTarget,
    uploaderId: string,
    file: Express.Multer.File | undefined,
    via: EvidenceReader,
  ): Promise<UploadedConsentEvidence> {
    if (!file) {
      throw new AppBadRequestException(ErrorCode.FILE_REQUIRED);
    }
    // Never trust the original file name or a type the pipe did not allow.
    if (!CONSENT_EVIDENCE_MIME_TYPES.includes(file.mimetype)) {
      throw new AppBadRequestException(ErrorCode.FILE_TYPE_INVALID);
    }
    const extension = EXTENSION_BY_MIME[file.mimetype];

    // Fail fast before storing anything; re-checked under the lock below.
    await this.assertConsentNotVerified(this.prisma, target.dependentUserId);

    const uploaded = await this.storage.upload(
      StorageBucketAlias.GUARDIANSHIP_EVIDENCE,
      `${target.guardianshipId}/${randomUUID()}.${extension}`,
      file.buffer,
      { contentType: file.mimetype, overwrite: false },
    );

    let created: { evidence_id: string; uploaded_at: Date };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Same per-dependent lock as verify/revoke: an upload cannot interleave
        // with a verification or a guardian leaving.
        await lockDependent(tx, target.dependentUserId);

        const live = await tx.guardianships.findFirst({
          where: { guardianship_id: target.guardianshipId, ...NOT_REVOKED },
          select: { guardianship_id: true },
        });
        if (!live) {
          throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
        }
        // A verification that won the lock keeps its form current.
        await this.assertConsentNotVerified(tx, target.dependentUserId);

        const now = new Date();
        await tx.guardianship_consent_evidences.updateMany({
          where: {
            guardianship_id: target.guardianshipId,
            superseded_at: null,
            purged_at: null,
          },
          data: { superseded_at: now },
        });
        const row = await tx.guardianship_consent_evidences.create({
          data: {
            guardianship_id: target.guardianshipId,
            file_key: uploaded.key,
            content_type: file.mimetype,
            size_bytes: file.size ?? file.buffer.length,
            uploaded_by_user_id: uploaderId,
            uploaded_at: now,
          },
          select: { evidence_id: true, uploaded_at: true },
        });
        // Same transaction: no audit row, no stored form.
        await this.auditOrUnavailable(
          {
            entity_type: 'guardianship_consent_evidence',
            entity_id: row.evidence_id,
            action: 'uploaded',
            actor_user_id: uploaderId,
            target_user_id: target.dependentUserId,
            summary: 'Ficha de consentimiento subida',
            changes: {
              guardianship_id: target.guardianshipId,
              content_type: file.mimetype,
              size_bytes: file.size ?? file.buffer.length,
              via,
            },
          },
          tx,
        );
        return row;
      });
    } catch (error) {
      await this.discardObject(uploaded.key, target.guardianshipId);
      throw error;
    }

    return {
      evidence_id: created.evidence_id,
      content_type: file.mimetype,
      size_bytes: file.size ?? file.buffer.length,
      uploaded_at: created.uploaded_at.toISOString(),
    };
  }

  /**
   * Same notion of "verified" as the approve gate: any real (non-test) row of
   * the dependent with consent_status verified.
   */
  private async assertConsentNotVerified(
    db: Db,
    dependentUserId: string,
  ): Promise<void> {
    const verified = await db.guardianships.count({
      where: {
        dependent_user_id: dependentUserId,
        consent_status: 'verified',
        is_test_data: false,
      },
    });
    if (verified > 0) {
      throw new AppConflictException(
        ErrorCode.GUARDIANSHIP_CONSENT_ALREADY_VERIFIED,
      );
    }
  }

  private async requireCurrent(
    guardianshipId: string,
  ): Promise<CurrentEvidence> {
    const evidence = await this.prisma.guardianship_consent_evidences.findFirst(
      {
        where: {
          guardianship_id: guardianshipId,
          superseded_at: null,
          purged_at: null,
        },
        select: {
          evidence_id: true,
          guardianship_id: true,
          file_key: true,
          content_type: true,
          uploaded_at: true,
          uploaded_by: { select: { name: true, paternal_last_name: true } },
        },
      },
    );
    if (!evidence) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_EVIDENCE_NOT_FOUND);
    }
    return evidence;
  }

  /**
   * Every read is audited BEFORE the signed URL leaves the server; when the
   * audit row cannot be written the URL is dropped (fail closed).
   */
  private async signAndAudit(
    evidence: CurrentEvidence,
    target: EvidenceTarget,
    readerId: string,
    via: EvidenceReader,
  ): Promise<ConsentEvidenceDownload> {
    const url = await this.storage.getSignedDownloadUrl(
      StorageBucketAlias.GUARDIANSHIP_EVIDENCE,
      evidence.file_key,
      { expiresInSeconds: CONSENT_EVIDENCE_SIGNED_URL_TTL_SECONDS },
    );

    await this.auditOrUnavailable({
      entity_type: 'guardianship_consent_evidence',
      entity_id: evidence.evidence_id,
      action: 'read',
      actor_user_id: readerId,
      target_user_id: target.dependentUserId,
      summary: 'Lectura de ficha de consentimiento',
      changes: { guardianship_id: target.guardianshipId, via },
    });

    return {
      url,
      expires_in: CONSENT_EVIDENCE_SIGNED_URL_TTL_SECONDS,
      content_type: evidence.content_type,
      uploaded_at: evidence.uploaded_at.toISOString(),
    };
  }

  /**
   * Fail-closed audit of a consent-form operation (verify 2c W3). The log line
   * names ids only (S1: never the object key).
   */
  private async auditOrUnavailable(
    event: RecordEventDto,
    db?: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      await (db
        ? this.auditLogs.recordEventOrThrow(event, db)
        : this.auditLogs.recordEventOrThrow(event));
    } catch (error) {
      this.logger.error(
        `Consent evidence ${event.action} not audited (evidence ${event.entity_id}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new AppServiceUnavailableException(
        ErrorCode.GUARDIANSHIP_EVIDENCE_UNAVAILABLE,
      );
    }
  }

  /**
   * The row was not written: do not leave an orphan object behind. The log
   * line names the guardianship, never the object key (S1).
   */
  private async discardObject(
    key: string,
    guardianshipId: string,
  ): Promise<void> {
    try {
      await this.storage.deleteMany(StorageBucketAlias.GUARDIANSHIP_EVIDENCE, [
        key,
      ]);
    } catch (error) {
      this.logger.warn(
        `Could not remove an orphan consent evidence object of guardianship ${guardianshipId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
