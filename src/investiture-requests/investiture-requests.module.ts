import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { ClassesModule } from '../classes/classes.module';
import { InvestitureAuthorizationRequestsController } from './investiture-authorization-requests.controller';
import { InvestitureAuthorizationRequestService } from './investiture-authorization-requests.service';

@Module({
  imports: [ClassesModule, AchievementsModule],
  controllers: [InvestitureAuthorizationRequestsController],
  providers: [InvestitureAuthorizationRequestService],
  exports: [InvestitureAuthorizationRequestService],
})
export class InvestitureRequestsModule {}
