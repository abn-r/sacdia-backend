import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { isPlaceholderUrl } from '../../config/bullmq.config';
import { CERTIFICATE_OCR_QUEUE } from './certificate-ocr.queue';

export function isCertificateOcrQueueConfigured(): boolean {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl || isPlaceholderUrl(rawUrl)) return false;
  try {
    new URL(rawUrl);
    return true;
  } catch {
    return false;
  }
}

const redisAvailable = isCertificateOcrQueueConfigured();

/**
 * Dedicated queue. It does not share the finance/rankings worker.
 * When Redis is absent the queue is not registered and the import service
 * refuses to call the vendor on the request thread.
 */
@Module({
  imports: [
    ...(redisAvailable
      ? [BullModule.registerQueue({ name: CERTIFICATE_OCR_QUEUE })]
      : []),
  ],
  exports: redisAvailable ? [BullModule] : [],
})
export class CertificateOcrQueueModule {}
