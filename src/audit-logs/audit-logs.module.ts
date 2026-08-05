import { Module } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CriticalAuditWriterService } from './critical-audit-writer.service';

@Module({
  imports: [PrismaModule],
  providers: [AuditLogsService, CriticalAuditWriterService],
  exports: [AuditLogsService, CriticalAuditWriterService],
})
export class AuditLogsModule {}
