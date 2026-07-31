import { EcclesiasticalCyclePreflightController } from './ecclesiastical-cycle-preflight.controller';
import { EcclesiasticalCycleDestinationPreflightService } from './ecclesiastical-cycle-destination-preflight.service';
import type { EcclesiasticalCycleCandidatePreflightService } from './ecclesiastical-cycle-candidate-preflight.service';
import type { EcclesiasticalCycleDestinationReadPort } from './ports/ecclesiastical-cycle-preflight-destination.port';
const access = { actorUserId: 'actor', localFieldId: 1, targetYearId: 2027 };
const capability = { available: true, version: 1, internal: 'cap-secret' };
describe('EcclesiasticalCycleDestinationPreflightService', () => {
  const candidatePreflight = {
    execute: jest.fn(async () => ({
      stage: 'candidate_route' as const,
      businessDate: '2026-11-01' as const,
      timezone: 'America/Mexico_City',
      capabilities: {
        p0: capability,
        progression: capability,
        masterGuide: capability,
      },
      reasons: [],
      summary: { total: 4, routeResolved: 3, blocked: 1 },
      cases: [
        {
          userId: 'user-1',
          sourceEnrollmentId: 1,
          state: 'blocked' as const,
          reasons: ['MEMBERSHIP_MISSING' as const],
          sourceAssignmentId: 'must-not-exist',
        },
        {
          userId: 'user-2',
          sourceEnrollmentId: 2,
          sourceAssignmentId: 'assignment-2',
          currentClubId: 10,
          currentClubSectionId: 11,
          state: 'route_resolved' as const,
          reasons: [] as [],
          targetClassId: 20,
          canonicalTransitionId: 17,
          internal: 'candidate-secret',
        },
        {
          userId: 'user-3',
          sourceEnrollmentId: 3,
          sourceAssignmentId: 'assignment-3',
          currentClubId: 10,
          currentClubSectionId: 11,
          state: 'route_resolved' as const,
          reasons: [] as [],
          targetClassId: 30,
          canonicalTransitionId: 18,
        },
        {
          userId: 'user-4',
          sourceEnrollmentId: 4,
          sourceAssignmentId: 'assignment-4',
          currentClubId: 10,
          currentClubSectionId: 11,
          state: 'route_resolved' as const,
          reasons: [] as [],
          targetClassId: 40,
          canonicalTransitionId: null,
        },
      ],
      internal: 'result-secret',
    })),
  } as unknown as EcclesiasticalCycleCandidatePreflightService;
  const destination: EcclesiasticalCycleDestinationReadPort = {
    destinationInCurrentClub: jest.fn(async ({ sourceAssignmentId }) => {
      if (sourceAssignmentId === 'assignment-2') {
        return {
          state: 'resolved' as const,
          clubId: 10,
          clubSectionId: 100,
          internal: 'destination-secret',
        };
      }
      if (sourceAssignmentId === 'assignment-3') {
        return { state: 'resolved' as const, clubId: 20, clubSectionId: 200 };
      }
      return { state: 'missing' as const };
    }),
  };
  const service = new EcclesiasticalCycleDestinationPreflightService(
    candidatePreflight,
    destination,
  );
  beforeEach(() => jest.clearAllMocks());
  it('keeps continuity in the current club and never auto-selects another club', async () => {
    const result = await service.execute(access);
    expect(result).toEqual({
      ready: false,
      businessDate: '2026-11-01',
      timezone: 'America/Mexico_City',
      capabilities: {
        p0: { available: true, version: 1 },
        progression: { available: true, version: 1 },
        masterGuide: { available: true, version: 1 },
      },
      reasons: [],
      summary: { total: 4, ready: 1, pendingChoice: 2, blocked: 1 },
      cases: [
        {
          userId: 'user-1',
          sourceEnrollmentId: 1,
          state: 'blocked',
          reasons: ['MEMBERSHIP_MISSING'],
        },
        {
          userId: 'user-2',
          sourceEnrollmentId: 2,
          sourceAssignmentId: 'assignment-2',
          currentClubId: 10,
          currentClubSectionId: 11,
          targetClassId: 20,
          canonicalTransitionId: 17,
          targetClubSectionId: 100,
          state: 'ready',
          reasons: [],
        },
        {
          userId: 'user-3',
          sourceEnrollmentId: 3,
          sourceAssignmentId: 'assignment-3',
          currentClubId: 10,
          currentClubSectionId: 11,
          targetClassId: 30,
          canonicalTransitionId: 18,
          state: 'pending_choice',
          reasons: ['DESTINATION_OUTSIDE_CURRENT_CLUB'],
        },
        {
          userId: 'user-4',
          sourceEnrollmentId: 4,
          sourceAssignmentId: 'assignment-4',
          currentClubId: 10,
          currentClubSectionId: 11,
          targetClassId: 40,
          canonicalTransitionId: null,
          state: 'pending_choice',
          reasons: ['DESTINATION_CURRENT_CLUB_MISSING'],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /must-not-exist|cap-secret|candidate-secret|destination-secret|result-secret|200/,
    );
    expect(destination.destinationInCurrentClub).toHaveBeenCalledWith({
      localFieldId: 1,
      targetYearId: 2027,
      sourceAssignmentId: 'assignment-3',
      currentClubId: 10,
      currentClubSectionId: 11,
      targetClassId: 30,
    });
  });
});
describe('EcclesiasticalCyclePreflightController', () => {
  it('maps authenticated actor and scope to destination preflight', async () => {
    const execute = jest.fn(async () => ({ ready: true }));
    const controller = new EcclesiasticalCyclePreflightController({
      execute,
    } as never);
    await controller.preflight(2027, 9, { sub: 'actor' });
    expect(execute).toHaveBeenCalledWith({
      actorUserId: 'actor',
      localFieldId: 9,
      targetYearId: 2027,
    });
  });
});
