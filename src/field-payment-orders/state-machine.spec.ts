import {
  ACTIVE_ORDER_STATUSES,
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
  FieldPaymentOrderStatus,
} from './state-machine';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

describe('field payment order state machine', () => {
  it('allows the documented lifecycle transitions', () => {
    expect(canTransition('ISSUED', 'PROOF_SUBMITTED')).toBe(true);
    expect(canTransition('ISSUED', 'CANCELLED')).toBe(true);
    expect(canTransition('ISSUED', 'EXPIRED')).toBe(true);
    expect(canTransition('PROOF_SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransition('PROOF_SUBMITTED', 'PROOF_REJECTED')).toBe(true);
    expect(canTransition('PROOF_REJECTED', 'PROOF_SUBMITTED')).toBe(true);
    expect(canTransition('PROOF_REJECTED', 'CANCELLED')).toBe(true);
  });

  it('rejects transitions out of terminal states', () => {
    const terminal: FieldPaymentOrderStatus[] = [
      'APPROVED',
      'CANCELLED',
      'EXPIRED',
    ];
    const all = Object.keys(ALLOWED_TRANSITIONS) as FieldPaymentOrderStatus[];
    for (const from of terminal) {
      for (const to of all) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('rejects skipping proof submission', () => {
    expect(canTransition('ISSUED', 'APPROVED')).toBe(false);
    expect(canTransition('PROOF_REJECTED', 'APPROVED')).toBe(false);
    expect(canTransition('PROOF_SUBMITTED', 'CANCELLED')).toBe(false);
    expect(canTransition('PROOF_SUBMITTED', 'EXPIRED')).toBe(false);
  });

  it('assertTransition throws AppException with typed code', () => {
    expect(() => assertTransition('APPROVED', 'CANCELLED')).toThrow(
      AppException,
    );
    try {
      assertTransition('APPROVED', 'CANCELLED');
    } catch (error) {
      expect((error as AppException).code).toBe(
        ErrorCode.FIELD_PAYMENT_ORDER_INVALID_TRANSITION,
      );
    }
    expect(() => assertTransition('ISSUED', 'PROOF_SUBMITTED')).not.toThrow();
  });

  it('exposes the active (in-flight) statuses', () => {
    expect(ACTIVE_ORDER_STATUSES).toEqual([
      'ISSUED',
      'PROOF_SUBMITTED',
      'PROOF_REJECTED',
    ]);
  });
});
