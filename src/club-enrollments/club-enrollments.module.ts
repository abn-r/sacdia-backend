import { Module } from '@nestjs/common';
import { ClubEnrollmentReviewService } from './club-enrollment-review.service';
import { ClubEnrollmentValidationController } from './club-enrollment-validation.controller';
import { ClubEnrollmentsController } from './club-enrollments.controller';
import { ClubEnrollmentsService } from './club-enrollments.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { ReviewerScopeService } from '../common/authorization/reviewer-scope.service';
import { SectionBoardSnapshotService } from '../common/authorization/section-board-snapshot.service';
import { CoordinationModule } from '../coordination/coordination.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    CatalogsModule,
    AuditLogsModule,
    NotificationsModule,
    CoordinationModule,
  ],
  controllers: [ClubEnrollmentsController, ClubEnrollmentValidationController],
  providers: [
    ClubEnrollmentsService,
    ClubEnrollmentReviewService,
    ReviewerScopeService,
    SectionBoardSnapshotService,
  ],
  exports: [ClubEnrollmentsService],
})
export class ClubEnrollmentsModule {}
