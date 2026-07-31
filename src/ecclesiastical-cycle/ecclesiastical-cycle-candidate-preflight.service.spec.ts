import { EcclesiasticalCycleDependenciesService } from './ecclesiastical-cycle-dependencies.service';
import { EcclesiasticalCycleCandidatePreflightService } from './ecclesiastical-cycle-candidate-preflight.service';
import type {
  CanonicalProgressionPort,
  EcclesiasticalCycleP0Port,
  MasterGuideRenewalPort,
} from './ports/ecclesiastical-cycle-dependencies.port';
import type {
  EcclesiasticalCycleCandidateReadPort,
  EcclesiasticalCyclePreflightCandidate,
} from './ports/ecclesiastical-cycle-preflight-candidate.port';

const capability = { available: true, version: 1 };
const access = { actorUserId: 'actor', localFieldId: 1, targetYearId: 2027 };

describe('EcclesiasticalCycleCandidatePreflightService', () => {
  const p0: EcclesiasticalCycleP0Port = {
    capability: jest.fn(async () => capability),
    authorize: jest.fn(async () => ({
      allowed: true as const,
      businessDate: '2026-11-01' as const,
      timezone: 'America/Mexico_City',
      effectiveSuccessionObserved: true as const,
    })),
  };
  const progression: CanonicalProgressionPort = {
    capability: jest.fn(async () => capability),
    resolve: jest.fn(async ({ sourceEnrollmentId }) =>
      sourceEnrollmentId === 4
        ? {
            state: 'missing' as const,
            reason: 'owner-secret',
            internal: 'do-not-leak',
          }
        : {
            state: 'resolved' as const,
            targetClassId: 30,
            transitionId: 17,
            internal: 'do-not-leak',
          },
    ),
  };
  const masterGuide: MasterGuideRenewalPort = {
    capability: jest.fn(async () => capability),
    renew: jest.fn(),
  };
  const candidates: EcclesiasticalCyclePreflightCandidate[] = [
    {
      membershipState: 'missing',
      userId: 'user-1',
      sourceEnrollmentId: 1,
      sourceAssignmentId: 'fabricated-secret',
    } as EcclesiasticalCyclePreflightCandidate,
    {
      membershipState: 'ambiguous',
      userId: 'user-2',
      sourceEnrollmentId: 2,
      assignmentCandidates: ['secret-a', 'secret-b'],
    } as EcclesiasticalCyclePreflightCandidate,
    {
      membershipState: 'resolved',
      userId: 'user-3',
      sourceEnrollmentId: 3,
      sourceAssignmentId: 'assignment-3',
      currentClubId: 10,
      currentClubSectionId: 11,
      internal: 'candidate-secret',
    } as EcclesiasticalCyclePreflightCandidate,
    {
      membershipState: 'resolved',
      userId: 'user-4',
      sourceEnrollmentId: 4,
      sourceAssignmentId: 'assignment-4',
      currentClubId: 10,
      currentClubSectionId: 11,
    },
  ];
  const reader: EcclesiasticalCycleCandidateReadPort = {
    candidates: jest.fn(async () => candidates),
  };
  let service: EcclesiasticalCycleCandidatePreflightService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EcclesiasticalCycleCandidatePreflightService(
      new EcclesiasticalCycleDependenciesService(p0, progression, masterGuide),
      progression,
      reader,
    );
  });

  it('projects a closed discriminated contract without fabricating assignments or leaking extras', async () => {
    const result = await service.execute(access);
    expect(result).toEqual({
      stage: 'candidate_route',
      businessDate: '2026-11-01',
      timezone: 'America/Mexico_City',
      capabilities: {
        p0: capability,
        progression: capability,
        masterGuide: capability,
      },
      reasons: [],
      summary: { total: 4, routeResolved: 1, blocked: 3 },
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
          state: 'blocked',
          reasons: ['MEMBERSHIP_AMBIGUOUS'],
        },
        {
          userId: 'user-3',
          sourceEnrollmentId: 3,
          sourceAssignmentId: 'assignment-3',
          currentClubId: 10,
          currentClubSectionId: 11,
          state: 'route_resolved',
          reasons: [],
          targetClassId: 30,
          canonicalTransitionId: 17,
        },
        {
          userId: 'user-4',
          sourceEnrollmentId: 4,
          sourceAssignmentId: 'assignment-4',
          currentClubId: 10,
          currentClubSectionId: 11,
          state: 'blocked',
          reasons: ['PROGRESSION_MISSING'],
        },
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /fabricated-secret|secret-a|candidate-secret|owner-secret|do-not-leak/,
    );
    expect(progression.resolve).toHaveBeenCalledTimes(2);
    expect(masterGuide.renew).not.toHaveBeenCalled();
  });

  it('fails closed before candidate reads for non-canonical timezone', async () => {
    jest.mocked(p0.authorize).mockResolvedValueOnce({
      allowed: true,
      businessDate: '2026-11-01',
      timezone: 'US/Eastern',
      effectiveSuccessionObserved: true,
    });
    await expect(service.execute(access)).resolves.toMatchObject({
      stage: 'candidate_route',
      reasons: ['TIMEZONE_NON_CANONICAL'],
      summary: { total: 0, routeResolved: 0, blocked: 0 },
      cases: [],
    });
    expect(reader.candidates).not.toHaveBeenCalled();
  });

  it('propagates capability failure before candidate reads', async () => {
    jest
      .mocked(masterGuide.capability)
      .mockResolvedValueOnce({ available: true, version: 2 });
    await expect(service.execute(access)).rejects.toMatchObject({
      status: 409,
      code: 'ECCLESIASTICAL_CYCLE_CAPABILITY_VERSION_INCOMPATIBLE',
    });
    expect(reader.candidates).not.toHaveBeenCalled();
  });
});
