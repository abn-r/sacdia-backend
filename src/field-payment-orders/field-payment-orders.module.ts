import { Module } from '@nestjs/common';
import { FieldPaymentOrdersController } from './field-payment-orders.controller';
import { FieldPaymentOrdersService } from './field-payment-orders.service';
import { InsuranceReassignmentsController } from './insurance-reassignments.controller';
import { InsuranceReassignmentsService } from './insurance-reassignments.service';
import { FieldPaymentOrderConfigsService } from './field-payment-order-configs.service';
import { FieldPaymentOrdersFlagService } from './field-payment-orders-flag.service';
import { FieldPaymentFolioService } from './folio.service';
import { FieldPaymentOrderPdfService } from './field-payment-order-pdf.service';
import { FieldPaymentOrderProofService } from './field-payment-order-proof.service';
import { CamporeeFulfillmentService } from './fulfillment/camporee-fulfillment.service';
import { InsuranceFulfillmentService } from './fulfillment/insurance-fulfillment.service';
import {
  CAMPOREE_FULFILLMENT_PORT,
  INSURANCE_FULFILLMENT_PORT,
} from './fulfillment/ports';

@Module({
  controllers: [FieldPaymentOrdersController, InsuranceReassignmentsController],
  providers: [
    FieldPaymentOrdersService,
    InsuranceReassignmentsService,
    FieldPaymentOrderConfigsService,
    FieldPaymentOrdersFlagService,
    FieldPaymentFolioService,
    FieldPaymentOrderPdfService,
    FieldPaymentOrderProofService,
    InsuranceFulfillmentService,
    CamporeeFulfillmentService,
    {
      provide: INSURANCE_FULFILLMENT_PORT,
      useExisting: InsuranceFulfillmentService,
    },
    {
      provide: CAMPOREE_FULFILLMENT_PORT,
      useExisting: CamporeeFulfillmentService,
    },
  ],
  exports: [FieldPaymentOrdersFlagService],
})
export class FieldPaymentOrdersModule {}
