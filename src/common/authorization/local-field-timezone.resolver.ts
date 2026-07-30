import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppUnprocessableEntityException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { classifyLocalFieldTimezone } from '../validators/iana-timezone.validator';
import type { TimezoneClassification } from '../timezone/canonical-geographic-iana-timezone';
import type { TemporalLocalField } from '../clock/temporal-context.factory';

export type ResolvedLocalFieldTimezone = TemporalLocalField & {
  active: boolean;
};

@Injectable()
export class LocalFieldTimezoneResolver {
  constructor(private readonly prisma: PrismaService) {}

  async forClubSection(sectionId: number): Promise<ResolvedLocalFieldTimezone> {
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: {
        clubs: {
          select: {
            local_fields: {
              select: { local_field_id: true, active: true, timezone: true },
            },
          },
        },
      },
    });
    const localField = section?.clubs?.local_fields;
    if (!localField)
      this.unavailable({ ok: false, reason: 'MISSING', diagnostic: 'EMPTY' });
    const timezone = this.assertTimezone(localField.timezone);
    return {
      local_field_id: localField.local_field_id,
      active: localField.active,
      timezone,
    };
  }

  assertTimezone(value: unknown): string {
    const classification = classifyLocalFieldTimezone(value);
    if (!classification.ok) this.unavailable(classification);
    return classification.value;
  }

  private unavailable(
    classification: Exclude<TimezoneClassification, { ok: true }>,
  ): never {
    throw new AppUnprocessableEntityException(
      ErrorCode.LOCAL_FIELD_TIMEZONE_UNAVAILABLE,
      { reason: classification.reason },
    );
  }
}
