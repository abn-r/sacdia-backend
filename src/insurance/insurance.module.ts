import { Module } from '@nestjs/common';
import { InsuranceService } from './insurance.service';
import { InsuranceController } from './insurance.controller';
import { InsuranceConfigService } from './insurance-config.service';
import { InsuranceConfigScopeResolver } from './insurance-config-scope';
import { InsuranceEvidenceService } from './insurance-evidence.service';
import { InsurancePurchasesService } from './insurance-purchases.service';
import { InsurancePurchasesController } from './insurance-purchases.controller';

@Module({
  controllers: [InsuranceController, InsurancePurchasesController],
  providers: [
    InsuranceService,
    InsuranceConfigService,
    InsuranceConfigScopeResolver,
    InsuranceEvidenceService,
    InsurancePurchasesService,
  ],
})
export class InsuranceModule {}
