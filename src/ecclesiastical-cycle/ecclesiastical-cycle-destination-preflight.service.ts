import { Inject, Injectable } from '@nestjs/common';
import {
  EcclesiasticalCycleCandidatePreflightService,
  type EcclesiasticalCycleCandidatePreflightCaseDto,
  type EcclesiasticalCycleCandidatePreflightReason,
  type EcclesiasticalCycleRouteResolvedCaseDto,
} from './ecclesiastical-cycle-candidate-preflight.service';
import type {
  EcclesiasticalCycleAccessDto,
  EcclesiasticalCycleCapabilityDto,
} from './ports/ecclesiastical-cycle-dependencies.port';
import {
  ECCLESIASTICAL_CYCLE_DESTINATION_READ_PORT,
  type EcclesiasticalCycleDestinationReadPort,
} from './ports/ecclesiastical-cycle-preflight-destination.port';
type DestinationReason =
  | EcclesiasticalCycleCandidatePreflightReason
  | `DESTINATION_${
      | 'OUTSIDE_CURRENT_CLUB'
      | 'CURRENT_CLUB_MISSING'
      | 'CURRENT_CLUB_AMBIGUOUS'
      | 'CURRENT_CLUB_INACTIVE'}`;
@Injectable()
export class EcclesiasticalCycleDestinationPreflightService {
  constructor(
    private readonly candidates: EcclesiasticalCycleCandidatePreflightService,
    @Inject(ECCLESIASTICAL_CYCLE_DESTINATION_READ_PORT)
    private readonly destinations: EcclesiasticalCycleDestinationReadPort,
  ) {}

  async execute(input: EcclesiasticalCycleAccessDto) {
    const preflight = await this.candidates.execute(input);
    const cases = await Promise.all(
      preflight.cases.map((candidate) => this.evaluate(input, candidate)),
    );
    const ready = cases.filter((item) => item.state === 'ready').length;
    const pendingChoice = cases.filter(
      (item) => item.state === 'pending_choice',
    ).length;
    const blocked = cases.length - ready - pendingChoice;
    return {
      ready:
        preflight.reasons.length === 0 && blocked === 0 && pendingChoice === 0,
      businessDate: preflight.businessDate,
      timezone: preflight.timezone,
      capabilities: {
        p0: this.capability(preflight.capabilities.p0),
        progression: this.capability(preflight.capabilities.progression),
        masterGuide: this.capability(preflight.capabilities.masterGuide),
      },
      reasons: preflight.reasons.map((reason) => reason),
      summary: { total: cases.length, ready, pendingChoice, blocked },
      cases,
    };
  }

  private capability(capability: EcclesiasticalCycleCapabilityDto) {
    return { available: capability.available, version: capability.version };
  }

  private async evaluate(
    input: EcclesiasticalCycleAccessDto,
    candidate: EcclesiasticalCycleCandidatePreflightCaseDto,
  ) {
    if (candidate.state === 'blocked') {
      return this.blocked(candidate);
    }
    const destination = await this.destinations.destinationInCurrentClub({
      localFieldId: input.localFieldId,
      targetYearId: input.targetYearId,
      sourceAssignmentId: candidate.sourceAssignmentId,
      currentClubId: candidate.currentClubId,
      currentClubSectionId: candidate.currentClubSectionId,
      targetClassId: candidate.targetClassId,
    });
    if (destination.state === 'resolved') {
      if (destination.clubId !== candidate.currentClubId) {
        return this.pending(candidate, 'DESTINATION_OUTSIDE_CURRENT_CLUB');
      }
      return {
        userId: candidate.userId,
        sourceEnrollmentId: candidate.sourceEnrollmentId,
        sourceAssignmentId: candidate.sourceAssignmentId,
        currentClubId: candidate.currentClubId,
        currentClubSectionId: candidate.currentClubSectionId,
        targetClassId: candidate.targetClassId,
        canonicalTransitionId: candidate.canonicalTransitionId,
        targetClubSectionId: destination.clubSectionId,
        state: 'ready' as const,
        reasons: [] as DestinationReason[],
      };
    }
    const suffix = destination.state.toUpperCase() as
      | 'MISSING'
      | 'AMBIGUOUS'
      | 'INACTIVE';
    return this.pending(candidate, `DESTINATION_CURRENT_CLUB_${suffix}`);
  }

  private blocked(
    candidate: Extract<
      EcclesiasticalCycleCandidatePreflightCaseDto,
      { state: 'blocked' }
    >,
  ) {
    if (
      candidate.sourceAssignmentId === undefined ||
      candidate.currentClubId === undefined ||
      candidate.currentClubSectionId === undefined
    ) {
      return {
        userId: candidate.userId,
        sourceEnrollmentId: candidate.sourceEnrollmentId,
        state: 'blocked' as const,
        reasons: candidate.reasons.map((reason) => reason),
      };
    }
    return {
      userId: candidate.userId,
      sourceEnrollmentId: candidate.sourceEnrollmentId,
      sourceAssignmentId: candidate.sourceAssignmentId,
      currentClubId: candidate.currentClubId,
      currentClubSectionId: candidate.currentClubSectionId,
      state: 'blocked' as const,
      reasons: candidate.reasons.map((reason) => reason),
    };
  }

  private pending(
    candidate: EcclesiasticalCycleRouteResolvedCaseDto,
    reason: DestinationReason,
  ) {
    return {
      userId: candidate.userId,
      sourceEnrollmentId: candidate.sourceEnrollmentId,
      sourceAssignmentId: candidate.sourceAssignmentId,
      currentClubId: candidate.currentClubId,
      currentClubSectionId: candidate.currentClubSectionId,
      targetClassId: candidate.targetClassId,
      canonicalTransitionId: candidate.canonicalTransitionId,
      state: 'pending_choice' as const,
      reasons: [reason],
    };
  }
}
