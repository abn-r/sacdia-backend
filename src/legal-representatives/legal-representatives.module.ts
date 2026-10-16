import { Module } from '@nestjs/common';
import { LegalRepresentativesController } from './legal-representatives.controller';
import { LegalRepresentativesService } from './legal-representatives.service';

@Module({
  controllers: [LegalRepresentativesController],
  providers: [LegalRepresentativesService],
  exports: [LegalRepresentativesService],
})
export class LegalRepresentativesModule {}
