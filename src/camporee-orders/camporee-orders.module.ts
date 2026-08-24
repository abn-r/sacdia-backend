import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CamporeeOrderFolioService } from './folio.service';
import { OfferingsController } from './offerings.controller';
import { OfferingsService } from './offerings.service';

@Module({
  controllers: [CatalogController, OfferingsController],
  providers: [CatalogService, CamporeeOrderFolioService, OfferingsService],
})
export class CamporeeOrdersModule {}
