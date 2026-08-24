import { Module } from '@nestjs/common';
import { PaymentObligationsController } from './payment-obligations.controller';
import { PaymentObligationsService } from './payment-obligations.service';

@Module({
  controllers: [PaymentObligationsController],
  providers: [PaymentObligationsService],
})
export class PaymentObligationsModule {}
