import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LegalController } from './legal.controller';
import { LegalAcceptanceController } from './legal-acceptance.controller';
import { LegalService } from './legal.service';

/**
 * LegalModule — Terms/Privacy versions and acceptance evidence.
 * Dependency direction is Auth -> Legal only; never import AuthModule here.
 */
@Module({
  imports: [PrismaModule],
  controllers: [LegalController, LegalAcceptanceController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
