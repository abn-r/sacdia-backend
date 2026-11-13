import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ActingForModule } from '../auth/acting-for/acting-for.module';
import { AuthModule } from '../auth/auth.module';
import { LegalModule } from '../legal/legal.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdultClaimController } from './adult-claim.controller';
import { AdultClaimService } from './adult-claim.service';
import { GuardianshipsModule } from './guardianships.module';
import { ReleaseController } from './release.controller';
import { ReleaseService } from './release.service';

/**
 * Majority release, self-service side (Phase 4): the released adult adds an
 * email and a person without an account redeems an access code. They send the
 * verification mail through AuthService, so they cannot live in
 * GuardianshipsModule (Auth -> Guardianships is one-way). Nothing imports this
 * module: it only contributes controllers.
 */
@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    ActingForModule,
    AuthModule,
    LegalModule,
    NotificationsModule,
    GuardianshipsModule,
  ],
  controllers: [ReleaseController, AdultClaimController],
  providers: [ReleaseService, AdultClaimService],
})
export class FamilyReleaseModule {}
