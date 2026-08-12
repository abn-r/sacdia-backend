import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import 'multer';
import {
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  FileStorageService,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertTransition, FieldPaymentOrderStatus } from './state-machine';
import { extensionFromMime, ProofMime } from './proof-file-validation.pipe';

export const PROOF_BUCKET = StorageBucketAlias.EVIDENCE_FILES;
export const PROOF_SIGNED_URL_TTL_SECONDS = 900; // 15 min, same as materials

export interface ProofActor {
  userId: string;
}

/**
 * Proof lifecycle for field payment orders:
 * - upload: allowed from ISSUED | PROOF_REJECTED → PROOF_SUBMITTED (same folio)
 * - signed read: short-lived download URL for the latest proof
 *
 * Scope/permission checks live in FieldPaymentOrdersService; this service
 * assumes the caller already authorized the actor against the order.
 */
@Injectable()
export class FieldPaymentOrderProofService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  async upload(
    order: {
      field_payment_order_id: string;
      local_field_id: number;
      status: FieldPaymentOrderStatus;
    },
    file: Express.Multer.File,
    actor: ProofActor,
  ) {
    assertTransition(order.status, 'PROOF_SUBMITTED');

    const mime = file.mimetype as ProofMime;
    const key = `field-payment-orders/lf-${order.local_field_id}/order-${order.field_payment_order_id}/${randomUUID()}.${extensionFromMime(mime)}`;

    const uploaded = await this.fileStorage.upload(
      PROOF_BUCKET,
      key,
      file.buffer,
      { contentType: mime, overwrite: false },
    );

    return this.prisma.$transaction(async (tx) => {
      const proof = await tx.field_payment_order_proofs.create({
        data: {
          field_payment_order_id: order.field_payment_order_id,
          r2_key: uploaded.key,
          file_name: file.originalname ?? `proof.${extensionFromMime(mime)}`,
          mime_type: mime,
          size_bytes: file.size,
          status: 'SUBMITTED',
          uploaded_by_id: actor.userId,
        },
      });
      const updated = await tx.field_payment_orders.update({
        where: { field_payment_order_id: order.field_payment_order_id },
        data: { status: 'PROOF_SUBMITTED' },
      });
      return { proof, order: updated };
    });
  }

  async getSignedDownload(orderId: string) {
    const proof = await this.prisma.field_payment_order_proofs.findFirst({
      where: { field_payment_order_id: orderId },
      orderBy: { created_at: 'desc' },
    });
    if (!proof) {
      throw new AppNotFoundException(
        ErrorCode.FIELD_PAYMENT_ORDER_PROOF_NOT_FOUND,
      );
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
