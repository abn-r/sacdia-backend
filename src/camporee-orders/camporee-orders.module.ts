import { Module } from '@nestjs/common';
import { CamporeeOrdersController } from './camporee-orders.controller';
import { CamporeeOrdersService } from './camporee-orders.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { EligibilityService } from './eligibility.service';
import { CamporeeOrderFolioService } from './folio.service';
import { OfferingsController } from './offerings.controller';
import { OfferingsService } from './offerings.service';

@Module({
  controllers: [
    CatalogController,
    OfferingsController,
    CamporeeOrdersController,
  ],
  providers: [
    CatalogService,
    CamporeeOrderFolioService,
    OfferingsService,
    EligibilityService,
    CamporeeOrdersService,
  ],
})
export class CamporeeOrdersModule {}
