import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FinanceAggregationService } from './finance-aggregation.service';

/**
 * Lightweight module so the report modules can share the finance totals
 * without importing the whole FinancesModule (controllers, queues, storage).
 */
@Module({
  imports: [PrismaModule],
  providers: [FinanceAggregationService],
  exports: [FinanceAggregationService],
})
export class FinanceAggregationModule {}
