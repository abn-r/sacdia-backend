import { EcclesiasticalCycleDependenciesService } from './ecclesiastical-cycle-dependencies.service';
import type {
  CanonicalProgressionResolution,
  CanonicalProgressionPort,
  EcclesiasticalCycleP0Port,
  MasterGuideRenewalPort,
} from './ports/ecclesiastical-cycle-dependencies.port';
const capability = { available: true, version: 1 };
const access = { actorUserId: 'actor', localFieldId: 1, targetYearId: 2027 };
class FakeP0Port implements EcclesiasticalCycleP0Port {
  value = capability;
  allowed = true;
  capability = jest.fn(async () => this.value);
  authorize = jest.fn(async () =>
    this.allowed
      ? {
          allowed: true as const,
          businessDate: '2026-11-01' as const,
          effectiveSuccessionObserved: true as const,
        }
      : { allowed: false as const },
  );
}
class FakeProgressionPort implements CanonicalProgressionPort {
  value = capability;
  result: CanonicalProgressionResolution = {
    state: 'resolved',
    targetClassId: 2,
    transitionId: null,
  };
  capability = jest.fn(async () => this.value);
  resolve: CanonicalProgressionPort['resolve'] = async () => this.result;
}
class FakeMasterGuidePort implements MasterGuideRenewalPort {
  value = capability;
  capability = jest.fn(async () => this.value);
  renew = jest.fn();
}
describe('EcclesiasticalCycleDependenciesService', () => {
  let p0: FakeP0Port;
  let progression: FakeProgressionPort;
  let masterGuide: FakeMasterGuidePort;
  let service: EcclesiasticalCycleDependenciesService;
  beforeEach(() => {
    p0 = new FakeP0Port();
    progression = new FakeProgressionPort();
    masterGuide = new FakeMasterGuidePort();
    service = new EcclesiasticalCycleDependenciesService(
      p0,
      progression,
      masterGuide,
    );
  });
  it('consumes snapshots and canonical transition identifiers without owner effects', async () => {
    await expect(service.capabilities()).resolves.toEqual({
      p0: capability,
      progression: capability,
      masterGuide: capability,
    });
    await expect(service.assertPlanningAccess(access)).resolves.toMatchObject({
      businessDate: '2026-11-01',
      capabilities: { p0: capability },
    });
    await expect(
      progression.resolve({ sourceEnrollmentId: 1, targetYearId: 2027 }),
    ).resolves.toMatchObject({ transitionId: null });
    progression.result = {
      state: 'resolved',
      targetClassId: 3,
      transitionId: 17,
    };
    await expect(
      progression.resolve({ sourceEnrollmentId: 2, targetYearId: 2027 }),
    ).resolves.toMatchObject({ transitionId: 17 });
    expect(masterGuide.renew).not.toHaveBeenCalled();
  });
  it('fails closed with 403 before exposing capabilities to an unauthorized actor', async () => {
    p0.allowed = false;
    await expect(service.assertPlanningAccess(access)).rejects.toMatchObject({
      status: 403,
      code: 'ECCLESIASTICAL_CYCLE_FORBIDDEN',
    });
    expect(progression.capability).not.toHaveBeenCalled();
  });
  it.each([
    [
      { available: false, version: 1 },
      'ECCLESIASTICAL_CYCLE_CAPABILITY_UNAVAILABLE',
      'CAPABILITY_UNAVAILABLE',
    ],
    [
      { available: true, version: 2 },
      'ECCLESIASTICAL_CYCLE_CAPABILITY_VERSION_INCOMPATIBLE',
      'CAPABILITY_VERSION_INCOMPATIBLE',
    ],
  ])(
    'fails closed with diagnostic metadata for %j',
    async (value, code, reason) => {
      masterGuide.value = value;
      const details = {
        dependency: 'masterGuide',
        expectedVersion: 1,
        receivedVersion: value.version,
        reason,
      };
      await expect(service.assertPlanningAccess(access)).rejects.toMatchObject({
        status: 409,
        code,
        response: { namedArgs: details, publicDetails: details },
      });
    },
  );
});
