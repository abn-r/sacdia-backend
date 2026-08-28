import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import 'multer';
import { AppNotFoundException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertTransition, type CamporeeOrderStatus } from './state-machine';
import { extensionFromMime, ProofMime } from './proof-file-validation.pipe';

export const PROOF_BUCKET = StorageBucketAlias.EVIDENCE_FILES;
export const PROOF_SIGNED_URL_TTL_SECONDS = 900; // 15 min, same as materials / FPO

export interface ProofActor {
  userId: string;
}

export type ProofOrder = {
  camporee_order_id: string;
  local_field_id: number;
  status: CamporeeOrderStatus;
  authorized_without_proof: boolean;
};

function isDocumentaryLaterProof(order: ProofOrder): boolean {
  return (
    order.authorized_without_proof === true &&
    (order.status === 'PAID' || order.status === 'DELIVERED')
  );
}

/**
 * Proof lifecycle for camporee orders:
 * - upload from ISSUED | PROOF_REJECTED → PROOF_SUBMITTED (same folio)
 * - documentary upload from PAID | DELIVERED when authorized_without_proof:
 *   stores the file, does not change order status
 * - signed read: short-lived download URL for the latest proof
 *
 * Scope/permission checks live in CamporeeOrdersService.
 */
@Injectable()
export class CamporeeOrderProofService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  async upload(
    order: ProofOrder,
    file: Express.Multer.File,
    actor: ProofActor,
  ) {
    const documentary = isDocumentaryLaterProof(order);
    if (!documentary) {
      assertTransition(order.status, 'PROOF_SUBMITTED');
    }

    const mime = file.mimetype as ProofMime;
    const key = `camporee-orders/lf-${order.local_field_id}/order-${order.camporee_order_id}/${randomUUID()}.${extensionFromMime(mime)}`;

    const uploaded = await this.fileStorage.upload(
      PROOF_BUCKET,
      key,
      file.buffer,
      { contentType: mime, overwrite: false },
    );

    return this.prisma.$transaction(async (tx) => {
      const proof = await tx.camporee_order_proofs.create({
        data: {
          order_id: order.camporee_order_id,
          r2_key: uploaded.key,
          file_name: file.originalname ?? `proof.${extensionFromMime(mime)}`,
          mime_type: mime,
          size_bytes: file.size,
          status: 'SUBMITTED',
          uploaded_by_id: actor.userId,
        },
      });
      if (documentary) {
        return { proof, order, documentary: true as const };
      }
      const updated = await tx.camporee_orders.update({
        where: { camporee_order_id: order.camporee_order_id },
        data: { status: 'PROOF_SUBMITTED' },
      });
      return { proof, order: updated, documentary: false as const };
    });
  }

  async getSignedDownload(orderId: string) {
    const proof = await this.prisma.camporee_order_proofs.findFirst({
      where: { order_id: orderId },
      orderBy: { created_at: 'desc' },
    });
    if (!proof) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_PROOF_NOT_FOUND);
    }
    const url = await this.fileStorage.getSignedDownloadUrl(
      PROOF_BUCKET,
      proof.r2_key,
      { expiresInSeconds: PROOF_SIGNED_URL_TTL_SECONDS },
    );
    return {
      url,
      expires_in: PROOF_SIGNED_URL_TTL_SECONDS,
      file_name: proof.file_name,
      mime_type: proof.mime_type,
      status: proof.status,
      uploaded_by_id: proof.uploaded_by_id,
      created_at: proof.created_at,
    };
  }
}
