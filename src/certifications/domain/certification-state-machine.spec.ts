import { ErrorCode } from '../../common/errors/error-codes';
import {
  assertReadyForCloseout,
  assertRequirementEditable,
  assertVersionMutable,
  assertVersionPublished,
  canTransitionEnrollment,
  canTransitionRequirement,
  computeProgressSummary,
  transitionEnrollment,
  transitionRequirement,
} from './certification-state-machine';

describe('certification state machine', () => {
  describe('version immutability', () => {
    it('allows mutation only for DRAFT', () => {
      expect(() => assertVersionMutable('DRAFT')).not.toThrow();
      expect(() => assertVersionMutable('PUBLISHED')).toThrow(
        expect.objectContaining({ code: ErrorCode.CERT_VERSION_IMMUTABLE }),
      );
      expect(() => assertVersionMutable('RETIRED')).toThrow(
        expect.objectContaining({ code: ErrorCode.CERT_VERSION_IMMUTABLE }),
      );
    });

    it('requires PUBLISHED for enrollment binding', () => {
      expect(() => assertVersionPublished('PUBLISHED')).not.toThrow();
      expect(() => assertVersionPublished('DRAFT')).toThrow(
        expect.objectContaining({
          code: ErrorCode.CERT_VERSION_NOT_PUBLISHED,
        }),
      );
    });
  });

  describe('enrollment transitions', () => {
    it('allows the happy-path lifecycle', () => {
      expect(canTransitionEnrollment('ENROLLED', 'IN_PROGRESS')).toBe(true);
      expect(
        canTransitionEnrollment('IN_PROGRESS', 'READY_FOR_CLOSEOUT'),
      ).toBe(true);
      expect(
        canTransitionEnrollment(
          'READY_FOR_CLOSEOUT',
          'SUBMITTED_FOR_FINAL_REVIEW',
        ),
      ).toBe(true);
      expect(
        canTransitionEnrollment('SUBMITTED_FOR_FINAL_REVIEW', 'APPROVED'),
      ).toBe(true);
      expect(canTransitionEnrollment('APPROVED', 'CERTIFIED')).toBe(true);
    });

    it('allows CHANGES_REQUESTED back to IN_PROGRESS from final review', () => {
      expect(
        canTransitionEnrollment(
          'SUBMITTED_FOR_FINAL_REVIEW',
          'CHANGES_REQUESTED',
        ),
      ).toBe(true);
      expect(canTransitionEnrollment('CHANGES_REQUESTED', 'IN_PROGRESS')).toBe(
        true,
      );
    });

    it('rejects terminal reverse transitions', () => {
      expect(canTransitionEnrollment('CERTIFIED', 'APPROVED')).toBe(false);
      expect(canTransitionEnrollment('WITHDRAWN', 'ENROLLED')).toBe(false);
      expect(() => transitionEnrollment('CERTIFIED', 'IN_PROGRESS')).toThrow(
        expect.objectContaining({ code: ErrorCode.CERT_INVALID_TRANSITION }),
      );
    });

    it('returns the target status on valid transition', () => {
      expect(transitionEnrollment('ENROLLED', 'IN_PROGRESS')).toBe(
        'IN_PROGRESS',
      );
    });
  });

  describe('requirement transitions', () => {
    it('allows DRAFT → SUBMITTED → APPROVED', () => {
      expect(canTransitionRequirement('DRAFT', 'SUBMITTED')).toBe(true);
      expect(canTransitionRequirement('SUBMITTED', 'APPROVED')).toBe(true);
      expect(transitionRequirement('DRAFT', 'SUBMITTED')).toBe('SUBMITTED');
    });

    it('allows SUBMITTED → CHANGES_REQUESTED → SUBMITTED', () => {
      expect(canTransitionRequirement('SUBMITTED', 'CHANGES_REQUESTED')).toBe(
        true,
      );
      expect(canTransitionRequirement('CHANGES_REQUESTED', 'SUBMITTED')).toBe(
        true,
      );
    });

    it('rejects editing APPROVED requirements via transition', () => {
      expect(canTransitionRequirement('APPROVED', 'DRAFT')).toBe(false);
      expect(() => transitionRequirement('APPROVED', 'SUBMITTED')).toThrow(
        expect.objectContaining({ code: ErrorCode.CERT_INVALID_TRANSITION }),
      );
    });

    it('locks response edits while SUBMITTED or APPROVED', () => {
      expect(() => assertRequirementEditable('DRAFT')).not.toThrow();
      expect(() => assertRequirementEditable('CHANGES_REQUESTED')).not.toThrow();
      expect(() => assertRequirementEditable('SUBMITTED')).toThrow(
        expect.objectContaining({ code: ErrorCode.CERT_REQUIREMENT_LOCKED }),
      );
      expect(() => assertRequirementEditable('APPROVED')).toThrow(
        expect.objectContaining({ code: ErrorCode.CERT_REQUIREMENT_LOCKED }),
      );
    });
  });

  describe('progress calculation', () => {
    it('computes percent only from required APPROVED requirements', () => {
      const summary = computeProgressSummary([
        { requirementId: 1, required: true, status: 'APPROVED' },
        { requirementId: 2, required: true, status: 'SUBMITTED' },
        { requirementId: 3, required: true, status: 'DRAFT' },
        { requirementId: 4, required: false, status: 'APPROVED' },
      ]);

      expect(summary).toEqual({
        requiredTotal: 3,
        requiredApproved: 1,
        optionalTotal: 1,
        optionalApproved: 1,
        percentComplete: 33,
        allRequiredApproved: false,
      });
    });

    it('ignores optional status for closeout readiness', () => {
      const requirements = [
        { requirementId: 1, required: true, status: 'APPROVED' as const },
        { requirementId: 2, required: true, status: 'APPROVED' as const },
        { requirementId: 3, required: false, status: 'DRAFT' as const },
      ];
      expect(computeProgressSummary(requirements).allRequiredApproved).toBe(
        true,
      );
      expect(() => assertReadyForCloseout(requirements)).not.toThrow();
    });

    it('blocks closeout when a required requirement is not APPROVED', () => {
      expect(() =>
        assertReadyForCloseout([
          { requirementId: 1, required: true, status: 'APPROVED' },
          { requirementId: 2, required: true, status: 'CHANGES_REQUESTED' },
        ]),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.CERT_CLOSEOUT_INCOMPLETE }),
      );
    });
  });
});
