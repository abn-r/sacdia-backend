import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppBadRequestException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { OrderActor } from '../order-actor';
import {
  OrderForFulfillment,
  PreparedOrder,
  PurposeFulfillment,
} from './ports';

/**
 * Camporee purpose port. Fase 1 skeleton: real prepare/fulfill logic lands in
 * Fase 3 (Tasks 3.1–3.2). Until then both operations fail loudly so no order
 * can be created or approved for this purpose by accident.
 */
@Injectable()
export class CamporeeFulfillmentService implements PurposeFulfillment {
  async prepareOrder(_dto: unknown, _actor: OrderActor): Promise<PreparedOrder> {
    throw new AppBadRequestException(
      ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
      { reason: 'camporee_fulfillment_not_available' },
    );
  }

  async fulfill(
    _tx: Prisma.TransactionClient,
    _order: OrderForFulfillment,
    _actor: OrderActor,
  ): Promise<void> {
    throw new AppBadRequestException(
      ErrorCode.FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED,
      { reason: 'camporee_fulfillment_not_available' },
    );
  }
}
