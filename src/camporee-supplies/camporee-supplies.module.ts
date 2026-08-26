import { Module } from '@nestjs/common';
import { CamporeeSupplyConfigController } from './config.controller';
import { CamporeeSupplyConfigService } from './config.service';
import { CamporeeSupplyFolioService } from './folio.service';
import { CamporeeSupplyPlansController } from './plans.controller';
import { CamporeeSupplyPlansService } from './plans.service';

@Module({
  controllers: [
    CamporeeSupplyConfigController,
    CamporeeSupplyPlansController,
  ],
  providers: [
    CamporeeSupplyFolioService,
    CamporeeSupplyConfigService,
    CamporeeSupplyPlansService,
  ],
})
export class CamporeeSuppliesModule {}
