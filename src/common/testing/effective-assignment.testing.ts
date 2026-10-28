import { TestingClock } from '../clock/testing-clock';
import { TemporalContextFactory } from '../clock/temporal-context.factory';
import { ZonedBusinessTimeService } from '../clock/zoned-business-time.service';
import { ClubAssignmentEffectivityPolicy } from '../authorization/club-assignment-effectivity.policy';
import { LocalFieldTimezoneResolver } from '../authorization/local-field-timezone.resolver';

/**
 * Predicado canónico de vigencia fijado en `now`, para specs de servicios que
 * reciben `MemberTerritoryScopeService`. Sale de la política real, no de un
 * literal: si la política cambia, los specs lo ven.
 */
export function effectiveAssignmentAt(
  now: Date,
  timezone = 'America/Mexico_City',
): ReturnType<ClubAssignmentEffectivityPolicy['toPrismaWhere']> {
  const zoned = new ZonedBusinessTimeService();
  return new ClubAssignmentEffectivityPolicy(zoned).toPrismaWhere(
    new TemporalContextFactory(new TestingClock(now), zoned).forLocalField({
      local_field_id: 1,
      timezone: new LocalFieldTimezoneResolver({} as never).assertTimezone(
        timezone,
      ),
    }),
  );
}
