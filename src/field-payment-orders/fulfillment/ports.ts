import { Prisma } from '@prisma/client';
import type { OrderActor } from '../order-actor';

export const INSURANCE_FULFILLMENT_PORT = 'INSURANCE_FULFILLMENT_PORT';
export const CAMPOREE_FULFILLMENT_PORT = 'CAMPOREE_FULFILLMENT_PORT';

/** Data resolved by a purpose module before the kernel persists the order. */
export interface PreparedOrder {
  local_field_id: number;
  club_id: number;
  club_section_id: number;
  purpose_ref_id: number;
  unit_cost_centavos: number;
  currency: string;
  concept: string;
  beneficiary_user_ids: string[];
}

export interface OrderForFulfillment {
  field_payment_order_id: string;
  purpose: 'INSURANCE' | 'CAMPOREE';
  local_field_id: number;
  club_id: number;
  club_section_id: number;
  insurance_cycle_config_id: number | null;
  local_camporee_id: number | null;
  lines: Array<{
    field_payment_order_line_id: string;
    beneficiary_user_id: string;
    sequence: number;
  }>;
}

/**
 * Purpose port: each domain (insurance, camporee) validates order creation
 * and materializes the domain effects atomically when the LF approves.
 */
export interface PurposeFulfillment {
  /** Validate the create request and resolve costs/scope. Throws AppException on violation. */
  prepareOrder(dto: unknown, actor: OrderActor): Promise<PreparedOrder>;

  /**
   * Materialize domain effects inside the approve transaction.
   * Any throw rolls back the entire approval.
   */
  fulfill(
    tx: Prisma.TransactionClient,
    order: OrderForFulfillment,
    actor: OrderActor,
  ): Promise<void>;
}
