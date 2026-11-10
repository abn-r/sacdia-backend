import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CoordinationModule } from '../coordination/coordination.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MyServiceCredentialsController } from './my-service-credentials.controller';
import { MyServiceCredentialsService } from './my-service-credentials.service';
import { ServiceCredentialReviewScopeService } from '../common/authorization/service-credential-review-scope.service';
import { ServiceCredentialReviewService } from './service-credential-review.service';
import { ServiceCredentialsReviewController } from './service-credentials-review.controller';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    NotificationsModule,
    CoordinationModule,
  ],
  controllers: [
    MyServiceCredentialsController,
    ServiceCredentialsReviewController,
  ],
  providers: [
    MyServiceCredentialsService,
    ServiceCredentialReviewScopeService,
    ServiceCredentialReviewService,
  ],
})
export class ServiceCredentialsModule {}
