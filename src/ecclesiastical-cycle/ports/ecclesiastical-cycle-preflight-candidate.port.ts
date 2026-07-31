import type { BusinessDate } from '../../common/clock/zoned-business-time.service';

export const ECCLESIASTICAL_CYCLE_CANDIDATE_READ_PORT = Symbol(
  'ECCLESIASTICAL_CYCLE_CANDIDATE_READ_PORT',
);

type CandidateIdentity = { userId: string; sourceEnrollmentId: number };
export type EcclesiasticalCyclePreflightCandidate = CandidateIdentity &
  (
    | { membershipState: 'missing' | 'ambiguous' }
    | {
        membershipState: 'resolved';
        sourceAssignmentId: string;
        currentClubId: number;
        currentClubSectionId: number;
      }
  );

export interface EcclesiasticalCycleCandidateReadPort {
  candidates(input: {
    localFieldId: number;
    targetYearId: number;
    businessDate: BusinessDate;
  }): Promise<EcclesiasticalCyclePreflightCandidate[]>;
}
