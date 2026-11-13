import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ActingForModule } from '../auth/acting-for/acting-for.module';
import { ReleaseCompletionService } from '../guardianships/release-completion.service';
import { LegalController } from './legal.controller';
import { LegalAcceptanceController } from './legal-acceptance.controller';
import { LegalService } from './legal.service';

/**
 * LegalModule — Terms/Privacy versions and acceptance evidence.
 * Dependency direction is Auth -> Legal only; never import AuthModule here.
 */
@Module({
  // Phase 4: the release acceptance bumps the acting-for epoch and writes audit
  // rows through ReleaseCompletionService (which has no module of its own; it is
  // exported from here for the guardianships module that already imports this one).
  imports: [PrismaModule, AuditLogsModule, ActingForModule],
  controllers: [LegalController, LegalAcceptanceController],
  providers: [LegalService, ReleaseCompletionService],
  exports: [LegalService, ReleaseCompletionService],
})
export class LegalModule {}
