import { TestingClock } from '../../clock/testing-clock';
import { TemporalContextFactory } from '../../clock/temporal-context.factory';
import { ZonedBusinessTimeService } from '../../clock/zoned-business-time.service';
import { ClubAssignmentEffectivityPolicy } from '../club-assignment-effectivity.policy';

/** Default test instant: business date 2026-06-01 in America/Mexico_City. */
export const EFFECTIVITY_TEST_NOW = new Date('2026-06-01T12:00:00.000Z');

/**
 * Real policy + factory over the real zoned-time service and a TestingClock
 * (never Date.now), so specs decide effectivity exactly as production does.
 */
export function buildClubAssignmentEffectivityDeps(
  now: Date = EFFECTIVITY_TEST_NOW,
) {
  const clock = new TestingClock(now);
  const zoned = new ZonedBusinessTimeService();
  return {
    clock,
    policy: new ClubAssignmentEffectivityPolicy(zoned),
    factory: new TemporalContextFactory(clock, zoned),
  };
}

/** Positional ctor args `[policy, factory]` for guards/services. */
export function clubAssignmentEffectivityArgs(now?: Date) {
  const { policy, factory } = buildClubAssignmentEffectivityDeps(now);
  return [policy, factory] as const;
}
