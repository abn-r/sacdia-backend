import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { CamporeeStaffController } from './camporee-staff.controller';
import { CamporeeStaffService } from './camporee-staff.service';

@Module({
  imports: [CommonModule],
  controllers: [CamporeeStaffController],
  providers: [CamporeeStaffService],
  exports: [CamporeeStaffService],
})
export class CamporeeStaffModule {}
