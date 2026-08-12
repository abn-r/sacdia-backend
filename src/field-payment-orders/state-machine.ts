import { AppUnprocessableEntityException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export type FieldPaymentOrderStatus =
  | 'ISSUED'
  | 'PROOF_SUBMITTED'
  | 'APPROVED'
  | 'PROOF_REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export const ACTIVE_ORDER_STATUSES: FieldPaymentOrderStatus[] = [
  'ISSUED',
  'PROOF_SUBMITTED',
  'PROOF_REJECTED',
];

export const ALLOWED_TRANSITIONS: Record<
  FieldPaymentOrderStatus,
  FieldPaymentOrderStatus[]
> = {
  ISSUED: ['PROOF_SUBMITTED', 'CANCELLED', 'EXPIRED'],
  PROOF_SUBMITTED: ['APPROVED', 'PROOF_REJECTED'],
  PROOF_REJECTED: ['PROOF_SUBMITTED', 'CANCELLED'],
  APPROVED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(
  from: FieldPaymentOrderStatus,
  to: FieldPaymentOrderStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(
  from: FieldPaymentOrderStatus,
  to: FieldPaymentOrderStatus,
): void {
  if (!canTransition(from, to)) {
    throw new AppUnprocessableEntityException(
      ErrorCode.FIELD_PAYMENT_ORDER_INVALID_TRANSITION,
      { from, to },
    );
  }
}
