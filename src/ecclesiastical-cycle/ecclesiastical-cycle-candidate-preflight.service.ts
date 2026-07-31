import { Inject, Injectable } from '@nestjs/common';
import { classifyLocalFieldTimezone } from '../common/validators/iana-timezone.validator';
import { EcclesiasticalCycleDependenciesService } from './ecclesiastical-cycle-dependencies.service';
import {
  ECCLESIASTICAL_CYCLE_PROGRESSION_PORT,
  type CanonicalProgressionPort,
  type EcclesiasticalCycleAccessDto,
} from './ports/ecclesiastical-cycle-dependencies.port';
import {
  ECCLESIASTICAL_CYCLE_CANDIDATE_READ_PORT,
  type EcclesiasticalCycleCandidateReadPort,
  type EcclesiasticalCyclePreflightCandidate,
} from './ports/ecclesiastical-cycle-preflight-candidate.port';

export type EcclesiasticalCycleCandidatePreflightReason =
  | `TIMEZONE_${'MISSING' | 'UNKNOWN' | 'NON_CANONICAL' | 'DISALLOWED_NAMESPACE'}`
  | `MEMBERSHIP_${'MISSING' | 'AMBIGUOUS'}`
  | `PROGRESSION_${'MISSING' | 'AMBIGUOUS'}`;
type BlockedCase = {
  userId: string;
  sourceEnrollmentId: number;
  sourceAssignmentId?: string;
  currentClubId?: number;
  currentClubSectionId?: number;
  state: 'blocked';
  reasons: EcclesiasticalCycleCandidatePreflightReason[];
};
export type EcclesiasticalCycleRouteResolvedCaseDto = {
  userId: string;
  sourceEnrollmentId: number;
  sourceAssignmentId: string;
  currentClubId: number;
  currentClubSectionId: number;
  state: 'route_resolved';
  reasons: [];
  targetClassId: number;
  canonicalTransitionId: number | null;
};
export type EcclesiasticalCycleCandidatePreflightCaseDto =
  | BlockedCase
  | EcclesiasticalCycleRouteResolvedCaseDto;

@Injectable()
export class EcclesiasticalCycleCandidatePreflightService {
  constructor(
    private readonly dependencies: EcclesiasticalCycleDependenciesService,
    @Inject(ECCLESIASTICAL_CYCLE_PROGRESSION_PORT)
    private readonly progression: CanonicalProgressionPort,
    @Inject(ECCLESIASTICAL_CYCLE_CANDIDATE_READ_PORT)
    private readonly reader: EcclesiasticalCycleCandidateReadPort,
  ) {}

  async execute(input: EcclesiasticalCycleAccessDto) {
    const context = await this.dependencies.assertPlanningAccess(input);
    const timezone = classifyLocalFieldTimezone(context.timezone);
    if (!timezone.ok) {
      return {
        stage: 'candidate_route' as const,
        businessDate: context.businessDate,
        timezone: context.timezone,
        capabilities: context.capabilities,
        reasons: [
          `TIMEZONE_${timezone.reason}` as EcclesiasticalCycleCandidatePreflightReason,
        ],
        summary: { total: 0, routeResolved: 0, blocked: 0 },
        cases: [] as EcclesiasticalCycleCandidatePreflightCaseDto[],
      };
    }
    const candidates = await this.reader.candidates({
      localFieldId: input.localFieldId,
      targetYearId: input.targetYearId,
      businessDate: context.businessDate,
    });
    const cases = await Promise.all(
      candidates.map((candidate) => this.evaluate(input, candidate)),
    );
    const routeResolved = cases.filter(
      (candidate) => candidate.state === 'route_resolved',
    ).length;
    return {
      stage: 'candidate_route' as const,
      businessDate: context.businessDate,
      timezone: timezone.value,
      capabilities: context.capabilities,
      reasons: [] as EcclesiasticalCycleCandidatePreflightReason[],
      summary: {
        total: cases.length,
        routeResolved,
        blocked: cases.length - routeResolved,
      },
      cases,
    };
  }

  private async evaluate(
    input: EcclesiasticalCycleAccessDto,
    candidate: EcclesiasticalCyclePreflightCandidate,
  ): Promise<EcclesiasticalCycleCandidatePreflightCaseDto> {
    if (candidate.membershipState !== 'resolved') {
      return {
        userId: candidate.userId,
        sourceEnrollmentId: candidate.sourceEnrollmentId,
        state: 'blocked',
        reasons: [
          `MEMBERSHIP_${candidate.membershipState.toUpperCase()}` as EcclesiasticalCycleCandidatePreflightReason,
        ],
      };
    }
    const progression = await this.progression.resolve({
      sourceEnrollmentId: candidate.sourceEnrollmentId,
      targetYearId: input.targetYearId,
    });
    if (progression.state !== 'resolved') {
      return {
        userId: candidate.userId,
        sourceEnrollmentId: candidate.sourceEnrollmentId,
        sourceAssignmentId: candidate.sourceAssignmentId,
        currentClubId: candidate.currentClubId,
        currentClubSectionId: candidate.currentClubSectionId,
        state: 'blocked',
        reasons: [
          `PROGRESSION_${progression.state.toUpperCase()}` as EcclesiasticalCycleCandidatePreflightReason,
        ],
      };
    }
    return {
      userId: candidate.userId,
      sourceEnrollmentId: candidate.sourceEnrollmentId,
      sourceAssignmentId: candidate.sourceAssignmentId,
      currentClubId: candidate.currentClubId,
      currentClubSectionId: candidate.currentClubSectionId,
      state: 'route_resolved',
      reasons: [],
      targetClassId: progression.targetClassId,
      canonicalTransitionId: progression.transitionId ?? null,
    };
  }
}
