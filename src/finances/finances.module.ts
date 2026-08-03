import { Module } from '@nestjs/common';
import { FinancesController } from './finances.controller';
import { FinancesService } from './finances.service';
import { FinancePeriodService } from './finance-period.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ClubRolesGuard } from '../common/guards';
import { BackgroundJobsQueueModule } from '../background-jobs/background-jobs-queue.module';
import { FINANCE_EVIDENCE_STORAGE } from './finance-evidence-storage.port';
import { FinanceEvidenceUploadService } from './finance-evidence-upload.service';
import { FinanceLedgerAuthorizationAdapter } from './finance-ledger-authorization.adapter';
import {
  FINANCE_LEDGER_DECISION_AUTHORIZATION,
  FINANCE_LEDGER_REGISTRATION_AUTHORIZATION,
  FINANCE_VOUCHER_EVIDENCE_OWNERSHIP,
  FinanceLedgerService,
} from './finance-ledger.service';
import { R2FinanceEvidenceStorageAdapter } from './r2-finance-evidence-storage.adapter';

@Module({
  imports: [PrismaModule, BackgroundJobsQueueModule],
  controllers: [FinancesController],
  providers: [
    FinancesService,
    FinancePeriodService,
    ClubRolesGuard,
    FinanceLedgerAuthorizationAdapter,
    FinanceLedgerService,
    FinanceEvidenceUploadService,
    R2FinanceEvidenceStorageAdapter,
    {
      provide: FINANCE_LEDGER_REGISTRATION_AUTHORIZATION,
      useExisting: FinanceLedgerAuthorizationAdapter,
    },
    {
      provide: FINANCE_LEDGER_DECISION_AUTHORIZATION,
      useExisting: FinanceLedgerAuthorizationAdapter,
    },
    {
      provide: FINANCE_VOUCHER_EVIDENCE_OWNERSHIP,
      useExisting: FinanceEvidenceUploadService,
    },
    {
      provide: FINANCE_EVIDENCE_STORAGE,
      useExisting: R2FinanceEvidenceStorageAdapter,
    },
  ],
  exports: [FinancesService, FinancePeriodService],
})
export class FinancesModule {}
