import { Module } from '@nestjs/common';
import { InsuranceService } from './insurance.service';
import { InsuranceController } from './insurance.controller';
import { InsuranceConfigService } from './insurance-config.service';
import { InsuranceConfigScopeResolver } from './insurance-config-scope';

@Module({
  controllers: [InsuranceController],
  providers: [
    InsuranceService,
    InsuranceConfigService,
    InsuranceConfigScopeResolver,
  ],
})
export class InsuranceModule {}
