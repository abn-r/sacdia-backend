import { ErrorCode } from '../common/errors/error-codes';
import { assertClassProgressMutable } from './class-progress-mutable';

describe('assertClassProgressMutable', () => {
  it.each(['INVESTIDO', 'EXPIRED'])(
    'blocks the terminal status %s even without the lock',
    (investitureStatus) => {
      expect(() =>
        assertClassProgressMutable({
          investitureStatus,
          lockedForValidation: false,
        }),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.CLASS_PROGRESS_LOCKED }),
      );
    },
  );

  it.each(['IN_PROGRESS', 'CLUB_APPROVED', 'APPROVED'])(
    'blocks %s while locked_for_validation is true',
    (investitureStatus) => {
      expect(() =>
        assertClassProgressMutable({
          investitureStatus,
          lockedForValidation: true,
        }),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.CLASS_PROGRESS_LOCKED }),
      );
    },
  );

  it.each([
    'IN_PROGRESS',
    'REJECTED',
    'SUBMITTED_FOR_VALIDATION',
    'CLUB_APPROVED',
    'COORDINATOR_APPROVED',
    'FIELD_APPROVED',
    'APPROVED',
  ])('allows a released %s record (lock false)', (investitureStatus) => {
    expect(() =>
      assertClassProgressMutable({
        investitureStatus,
        lockedForValidation: false,
      }),
    ).not.toThrow();
  });
});
