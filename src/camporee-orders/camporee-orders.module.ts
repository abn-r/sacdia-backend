import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CamporeeOrderFolioService } from './folio.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, CamporeeOrderFolioService],
})
export class CamporeeOrdersModule {}
