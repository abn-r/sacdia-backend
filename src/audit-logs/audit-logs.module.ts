import { Module } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CriticalAuditWriterService } from './critical-audit-writer.service';
import { SecurityDenialAuditService } from './security-denial-audit.service';

@Module({
  imports: [PrismaModule],
  providers: [
    AuditLogsService,
    CriticalAuditWriterService,
    SecurityDenialAuditService,
  ],
  exports: [
    AuditLogsService,
    CriticalAuditWriterService,
    SecurityDenialAuditService,
  ],
})
export class AuditLogsModule {}
