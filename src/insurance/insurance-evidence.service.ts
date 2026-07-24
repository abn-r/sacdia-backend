import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
  type FileStorageService,
} from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';

const MAX_PURCHASE_PROOF_SIZE = 10 * 1024 * 1024;
const PURCHASE_PROOF_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
const EXTENSIONS: Record<(typeof PURCHASE_PROOF_MIMES)[number], string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAGIC_BYTES: Record<
  (typeof PURCHASE_PROOF_MIMES)[number],
  { offset: number; bytes: number[] }
> = {
  'application/pdf': { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  'image/png': { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
  'image/webp': { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
};

export type InsuranceEvidenceActor = {
  userId: string;
  localFieldId?: number;
  globalAccess?: boolean;
};
export type UploadedInsuranceProof = {
  fileKey: string;
  fileName: string;
  mimeType: (typeof PURCHASE_PROOF_MIMES)[number];
  fileSize: number;
};

@Injectable()
export class InsuranceEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE) private readonly storage: FileStorageService,
  ) {}

  async assertPurchaseProof(
    file: Express.Multer.File | undefined,
  ): Promise<Express.Multer.File> {
    if (!file)
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_EVIDENCE_FILE_REQUIRED,
      );
    if (file.size > MAX_PURCHASE_PROOF_SIZE)
      throw new AppBadRequestException(ErrorCode.FILE_TOO_LARGE);
    if (
      !PURCHASE_PROOF_MIMES.includes(
        file.mimetype as (typeof PURCHASE_PROOF_MIMES)[number],
      )
    ) {
      throw new AppBadRequestException(ErrorCode.FILE_TYPE_INVALID);
    }
    const signature =
      MAGIC_BYTES[file.mimetype as (typeof PURCHASE_PROOF_MIMES)[number]];
    if (
      !file.buffer ||
      file.buffer.length < signature.offset + signature.bytes.length ||
      !signature.bytes.every(
        (byte, index) => file.buffer[signature.offset + index] === byte,
      )
    ) {
      throw new AppBadRequestException(ErrorCode.FILE_TYPE_INVALID);
    }
    return file;
  }

  async uploadPurchaseProof(
    purchaseId: number | 'pending',
    file: Express.Multer.File | undefined,
    actor: InsuranceEvidenceActor,
  ): Promise<UploadedInsuranceProof> {
    const validFile = await this.assertPurchaseProof(file);
    const mimeType =
      validFile.mimetype as (typeof PURCHASE_PROOF_MIMES)[number];
    const extension = EXTENSIONS[mimeType];
    const scope = actor.localFieldId ?? 'global';
    const fileKey = `insurance/lf-${scope}/purchase-${purchaseId}/${randomUUID()}.${extension}`;
    const uploaded = await this.storage.upload(
      StorageBucketAlias.INSURANCE_EVIDENCE,
      fileKey,
      validFile.buffer,
      { contentType: mimeType, overwrite: false },
    );
    return {
      fileKey: uploaded.key,
      fileName: validFile.originalname ?? `purchase-proof.${extension}`,
      mimeType,
      fileSize: validFile.size,
    };
  }

  async persistPurchaseProof(
    db: any,
    purchaseId: number,
    proof: UploadedInsuranceProof,
    actor: InsuranceEvidenceActor,
  ) {
    return db.insurance_evidence_files.create({
      data: {
        insurance_purchase_id: purchaseId,
        evidence_type: 'PURCHASE_PROOF',
        file_key: proof.fileKey,
        file_name: proof.fileName,
        mime_type: proof.mimeType,
        file_size: proof.fileSize,
        uploaded_by_id: actor.userId,
        created_by_id: actor.userId,
        modified_by_id: actor.userId,
      },
    });
  }

  async storePurchaseProof(
    purchaseId: number,
    file: Express.Multer.File | undefined,
    actor: InsuranceEvidenceActor,
  ) {
    const proof = await this.uploadPurchaseProof(purchaseId, file, actor);
    try {
      return await this.persistPurchaseProof(
        this.prisma as any,
        purchaseId,
        proof,
        actor,
      );
    } catch (error) {
      await this.storage.deleteMany(StorageBucketAlias.INSURANCE_EVIDENCE, [
        proof.fileKey,
      ]);
      throw error;
    }
  }

  async discardUploadedProof(fileKey: string): Promise<void> {
    await this.storage.deleteMany(StorageBucketAlias.INSURANCE_EVIDENCE, [
      fileKey,
    ]);
  }

  async getPurchaseProofUrl(
    purchaseId: number,
    actor: InsuranceEvidenceActor,
  ): Promise<string> {
    const evidence = await (
      this.prisma as any
    ).insurance_evidence_files.findFirst({
      where: {
        insurance_purchase_id: purchaseId,
        evidence_type: 'PURCHASE_PROOF',
      },
      select: {
        file_key: true,
        purchase: {
          select: { cycle_config: { select: { local_field_id: true } } },
        },
      },
    });
    if (!evidence)
      throw new AppNotFoundException(ErrorCode.INSURANCE_EVIDENCE_NOT_FOUND);
    const localFieldId = evidence.purchase?.cycle_config?.local_field_id;
    if (
      !actor.globalAccess &&
      (typeof actor.localFieldId !== 'number' ||
        actor.localFieldId !== localFieldId)
    ) {
      throw new AppForbiddenException(
        ErrorCode.INSURANCE_EVIDENCE_OUTSIDE_LOCAL_FIELD,
      );
    }
    return this.storage.getSignedDownloadUrl(
      StorageBucketAlias.INSURANCE_EVIDENCE,
      evidence.file_key,
      { expiresInSeconds: 300 },
    );
  }
}
