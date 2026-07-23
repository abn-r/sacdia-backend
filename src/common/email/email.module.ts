import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { isPlaceholderUrl } from '../../config/bullmq.config';
import { EmailService } from './email.service';
import { EmailQueueProducer, EMAIL_QUEUE } from './email.queue';
import { EmailProcessor } from './email.processor';
import { ResendEmailProvider } from './providers/resend.provider';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';

/**
 * Checks whether a valid REDIS_URL is available in process.env.
 *
 * Mirror of the same guard used in NotificationsModule and DataExportModule.
 * Must run at decorator evaluation time (file-load), so it reads process.env
 * directly rather than using ConfigService (not yet instantiated at that point).
 */
function isRedisConfigured(): boolean {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl || isPlaceholderUrl(rawUrl)) return false;
  try {
    new URL(rawUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * @Global() EmailModule
 *
 * Provides EmailService to every module in the application without needing
 * explicit imports. This mirrors the CommonModule pattern for shared services.
 *
 * BullMQ registration:
 *   - Queue name: 'emails'
 *   - Rate limiter: 90 jobs/day is enforced at the @Processor decorator level
 *     (protects Resend free tier of 100/day, leaving 10 headroom for manual sends)
 *
 * When Redis is unavailable, the queue and processor are skipped. EmailService
 * is still exported so callers don't break — but enqueue() will throw at
 * runtime (InjectQueue returns null-ish without BullModule registration).
 * In practice, Redis is always available when EMAIL_ENABLED=true.
 */
@Global()
@Module({
  imports: [
    ...(isRedisConfigured()
      ? [
          BullModule.registerQueue({
            name: EMAIL_QUEUE,
          }),
        ]
      : []),
  ],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      useClass: ResendEmailProvider,
    },
    EmailService,
    EmailQueueProducer,
    ...(isRedisConfigured() ? [EmailProcessor] : []),
  ],
  exports: [EmailService],
})
export class EmailModule {}
