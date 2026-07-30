import { Injectable, Inject } from '@nestjs/common';
import type { Clock } from './clock';
import { CLOCK } from './clock';
import type { BusinessDate } from './zoned-business-time.service';
import { ZonedBusinessTimeService } from './zoned-business-time.service';
import type { CanonicalGeographicIanaTimezone } from '../timezone/canonical-geographic-iana-timezone';

export type TemporalLocalField = {
  local_field_id: number;
  timezone: CanonicalGeographicIanaTimezone;
};

export type TemporalContext = {
  now: Date;
  businessDate: BusinessDate;
  businessTimeZone: CanonicalGeographicIanaTimezone;
  localFieldId: number;
};

@Injectable()
export class TemporalContextFactory {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly zonedBusinessTime: ZonedBusinessTimeService,
  ) {}

  forLocalField(
    localField: TemporalLocalField,
    now = this.clock.now(),
  ): TemporalContext {
    return {
      now: new Date(now),
      businessDate: this.zonedBusinessTime.businessDate(
        now,
        localField.timezone,
      ),
      businessTimeZone: localField.timezone,
      localFieldId: localField.local_field_id,
    };
  }
}
