import { AppUnprocessableEntityException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export type CamporeeOrderStatus =
  | 'ISSUED'
  | 'PROOF_SUBMITTED'
  | 'PROOF_REJECTED'
  | 'PAID'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'EXPIRED';

export const ALLOWED_TRANSITIONS: Record<
  CamporeeOrderStatus,
  CamporeeOrderStatus[]
> = {
  ISSUED: ['PROOF_SUBMITTED', 'PAID', 'CANCELLED', 'EXPIRED'],
  PROOF_SUBMITTED: ['PAID', 'PROOF_REJECTED'],
  PROOF_REJECTED: ['PROOF_SUBMITTED', 'PAID', 'CANCELLED'],
  PAID: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(
  from: CamporeeOrderStatus,
  to: CamporeeOrderStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(
  from: CamporeeOrderStatus,
  to: CamporeeOrderStatus,
): void {
  if (!canTransition(from, to)) {
    throw new AppUnprocessableEntityException(
      ErrorCode.CAMPOREE_ORDER_INVALID_TRANSITION,
      { from, to },
    );
  }
}
