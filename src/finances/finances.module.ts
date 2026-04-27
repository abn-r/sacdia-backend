import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FinancesController } from './finances.controller';
import { FinancesService } from './finances.service';
import { FinancePeriodService } from './finance-period.service';
import {
  FinancePeriodProcessor,
  FINANCE_PERIOD_QUEUE,
} from './finance-period.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { ClubRolesGuard } from '../common/guards';
import { isPlaceholderUrl } from '../config/bullmq.config';

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

const redisAvailable = isRedisConfigured();

@Module({
  imports: [
    PrismaModule,
    ...(redisAvailable
      ? [BullModule.registerQueue({ name: FINANCE_PERIOD_QUEUE })]
      : []),
  ],
  controllers: [FinancesController],
  providers: [
    FinancesService,
    FinancePeriodService,
    ClubRolesGuard,
    ...(redisAvailable ? [FinancePeriodProcessor] : []),
  ],
  exports: [FinancesService, FinancePeriodService],
})
export class FinancesModule {}
