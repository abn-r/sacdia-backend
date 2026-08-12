import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogsService } from './audit-logs.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CriticalAuditWriterService } from './critical-audit-writer.service';
import { SecurityDenialAuditService } from './security-denial-audit.service';
import { HttpAuditInterceptor } from './http-audit.interceptor';

@Module({
  imports: [PrismaModule],
  providers: [
    AuditLogsService,
    CriticalAuditWriterService,
    SecurityDenialAuditService,
    // Global HTTP audit trail: registered here (not in main.ts) so the
    // interceptor receives AuditLogsService and Reflector via DI.
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpAuditInterceptor,
    },
  ],
  exports: [
    AuditLogsService,
    CriticalAuditWriterService,
    SecurityDenialAuditService,
  ],
})
export class AuditLogsModule {}
