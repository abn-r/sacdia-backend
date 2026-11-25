import { Module } from '@nestjs/common';
import { AnnualFoldersModule } from '../annual-folders/annual-folders.module';
import { CamporeesModule } from '../camporees/camporees.module';
import { ClubEnrollmentsModule } from '../club-enrollments/club-enrollments.module';
import { RequestsModule } from '../requests/requests.module';
import { SupervisionController } from './supervision.controller';
import { SupervisionService } from './supervision.service';

/**
 * Hub aggregate for the territorial supervision app surface. It only consumes
 * the count methods of four domain modules (nothing imports this module, so no
 * DI cycle can form; `AuthorizationContextService` comes from the global
 * `CommonModule`).
 */
@Module({
  imports: [
    ClubEnrollmentsModule,
    AnnualFoldersModule,
    RequestsModule,
    CamporeesModule,
  ],
  controllers: [SupervisionController],
  providers: [SupervisionService],
})
export class SupervisionModule {}
