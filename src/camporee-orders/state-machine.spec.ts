import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
  CamporeeOrderStatus,
} from './state-machine';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

const ALL_STATUSES: CamporeeOrderStatus[] = [
  'ISSUED',
  'PROOF_SUBMITTED',
  'PROOF_REJECTED',
  'PAID',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED',
];

const ALLOWED_PAIRS: Array<[CamporeeOrderStatus, CamporeeOrderStatus]> = [
  ['ISSUED', 'PROOF_SUBMITTED'],
  ['ISSUED', 'PAID'],
  ['ISSUED', 'CANCELLED'],
  ['ISSUED', 'EXPIRED'],
  ['PROOF_SUBMITTED', 'PAID'],
  ['PROOF_SUBMITTED', 'PROOF_REJECTED'],
  ['PROOF_REJECTED', 'PROOF_SUBMITTED'],
  ['PROOF_REJECTED', 'PAID'],
  ['PROOF_REJECTED', 'CANCELLED'],
  ['PAID', 'DELIVERED'],
];

function isAllowed(from: CamporeeOrderStatus, to: CamporeeOrderStatus): boolean {
  return ALLOWED_PAIRS.some(([a, b]) => a === from && b === to);
}

describe('camporee order state machine', () => {
  it('allows the documented lifecycle transitions', () => {
    expect(canTransition('ISSUED', 'PROOF_SUBMITTED')).toBe(true);
    expect(canTransition('ISSUED', 'PAID')).toBe(true);
    expect(canTransition('ISSUED', 'CANCELLED')).toBe(true);
    expect(canTransition('ISSUED', 'EXPIRED')).toBe(true);
    expect(canTransition('PROOF_SUBMITTED', 'PAID')).toBe(true);
    expect(canTransition('PROOF_SUBMITTED', 'PROOF_REJECTED')).toBe(true);
    expect(canTransition('PROOF_REJECTED', 'PROOF_SUBMITTED')).toBe(true);
    expect(canTransition('PROOF_REJECTED', 'PAID')).toBe(true);
    expect(canTransition('PROOF_REJECTED', 'CANCELLED')).toBe(true);
    expect(canTransition('PAID', 'DELIVERED')).toBe(true);
  });

  it('allows PAID from ISSUED and PROOF_REJECTED as authorize-without-proof', () => {
    expect(canTransition('ISSUED', 'PAID')).toBe(true);
    expect(canTransition('PROOF_REJECTED', 'PAID')).toBe(true);
  });

  it('rejects every pair that is not an allowed outbound transition', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(canTransition(from, to)).toBe(isAllowed(from, to));
      }
    }
  });

  it('rejects transitions out of terminal states', () => {
    const terminal: CamporeeOrderStatus[] = [
      'DELIVERED',
      'CANCELLED',
      'EXPIRED',
    ];
    const all = Object.keys(ALLOWED_TRANSITIONS) as CamporeeOrderStatus[];
    for (const from of terminal) {
      for (const to of all) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('rejects the documented forbidden and skip-ahead transitions', () => {
    expect(canTransition('ISSUED', 'DELIVERED')).toBe(false);
    expect(canTransition('ISSUED', 'PROOF_REJECTED')).toBe(false);
    expect(canTransition('PROOF_SUBMITTED', 'CANCELLED')).toBe(false);
    expect(canTransition('PROOF_SUBMITTED', 'EXPIRED')).toBe(false);
    expect(canTransition('PROOF_SUBMITTED', 'DELIVERED')).toBe(false);
    expect(canTransition('PROOF_REJECTED', 'DELIVERED')).toBe(false);
    expect(canTransition('PROOF_REJECTED', 'EXPIRED')).toBe(false);
    expect(canTransition('PAID', 'CANCELLED')).toBe(false);
    expect(canTransition('PAID', 'EXPIRED')).toBe(false);
    expect(canTransition('PAID', 'PROOF_SUBMITTED')).toBe(false);
    expect(canTransition('PAID', 'PROOF_REJECTED')).toBe(false);
  });

  it('does not treat post-PAID proof upload as a status transition', () => {
    expect(canTransition('PAID', 'PROOF_SUBMITTED')).toBe(false);
    expect(canTransition('DELIVERED', 'PROOF_SUBMITTED')).toBe(false);
  });

  it('assertTransition throws AppException with typed code', () => {
    expect(() => assertTransition('DELIVERED', 'CANCELLED')).toThrow(
      AppException,
    );
    try {
      assertTransition('ISSUED', 'DELIVERED');
    } catch (error) {
      expect((error as AppException).code).toBe(
        ErrorCode.CAMPOREE_ORDER_INVALID_TRANSITION,
      );
    }
    expect(() => assertTransition('ISSUED', 'PROOF_SUBMITTED')).not.toThrow();
    expect(() => assertTransition('PAID', 'DELIVERED')).not.toThrow();
  });
});
