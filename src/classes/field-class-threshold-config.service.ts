import { Inject, Injectable } from '@nestjs/common';
import { toTerritoryId } from '../common/authorization/actor-territory-scope';
import { LocalFieldTimezoneResolver } from '../common/authorization/local-field-timezone.resolver';
import { CLOCK, type Clock } from '../common/clock/clock';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  canEditFieldClassThreshold,
  DEFAULT_CLASS_THRESHOLD_PERCENT,
} from './field-class-threshold';

export type FieldClassThresholdView = {
  local_field_id: number;
  ecclesiastical_year_id: number;
  minimum_percent: number;
  configured: boolean;
  can_edit: boolean;
};

type ThresholdContext = {
  timeZone: string;
  yearStart: string;
  yearEnd: string;
  yearActive: boolean;
  minimumPercent: number | null;
};

@Injectable()
export class FieldClassThresholdConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timezones: LocalFieldTimezoneResolver,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(
    authorization: AuthorizationSnapshot,
    localFieldId: number,
    ecclesiasticalYearId: number,
    now?: Date,
  ): Promise<FieldClassThresholdView> {
    const at = now ?? this.clock.now();
    this.assertReadable(authorization, localFieldId);
    const context = await this.loadContext(localFieldId, ecclesiasticalYearId);
    return this.view(
      localFieldId,
      ecclesiasticalYearId,
      context,
      this.canEdit(authorization, context, at),
    );
  }

  async update(
    authorization: AuthorizationSnapshot,
    localFieldId: number,
    ecclesiasticalYearId: number,
    minimumPercent: number,
    updatedById: string,
    now?: Date,
  ): Promise<FieldClassThresholdView> {
    this.assertPercent(minimumPercent);
    const at = now ?? this.clock.now();
    this.assertReadable(authorization, localFieldId);
    const context = await this.loadContext(localFieldId, ecclesiasticalYearId);
    if (!this.canEdit(authorization, context, at)) {
      throw new AppForbiddenException(ErrorCode.CLASS_THRESHOLD_EDIT_CLOSED);
    }

    await this.prisma.local_field_class_thresholds.upsert({
      where: {
        local_field_id_ecclesiastical_year_id: {
          local_field_id: localFieldId,
          ecclesiastical_year_id: ecclesiasticalYearId,
        },
      },
      create: {
        local_field_id: localFieldId,
        ecclesiastical_year_id: ecclesiasticalYearId,
        minimum_percent: minimumPercent,
        updated_by_id: updatedById,
      },
      update: {
        minimum_percent: minimumPercent,
        updated_by_id: updatedById,
      },
    });

    return this.view(
      localFieldId,
      ecclesiasticalYearId,
      { ...context, minimumPercent },
      true,
    );
  }

  private assertReadable(
    authorization: AuthorizationSnapshot | undefined,
    localFieldId: number,
  ): void {
    const roles = new Set(
      (authorization?.grants?.global_roles ?? []).map((grant) =>
        grant.role_name.trim().toLowerCase(),
      ),
    );
    if (roles.has('super-admin')) {
      return;
    }
    const fieldEditor = roles.has('director-lf') || roles.has('assistant-lf');
    const ownFieldId = toTerritoryId(
      authorization?.effective?.scope?.global?.local_field?.id,
    );
    if (!fieldEditor || ownFieldId !== localFieldId) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }

  private async loadContext(
    localFieldId: number,
    ecclesiasticalYearId: number,
  ): Promise<ThresholdContext> {
    const field = await this.prisma.local_fields.findUnique({
      where: { local_field_id: localFieldId },
      select: { timezone: true },
    });
    if (!field) {
      throw new AppNotFoundException(ErrorCode.CLASS_THRESHOLD_FIELD_NOT_FOUND);
    }

    const year = await this.prisma.ecclesiastical_years.findUnique({
      where: { year_id: ecclesiasticalYearId },
      select: { start_date: true, end_date: true, active: true },
    });
    if (!year?.start_date || !year.end_date) {
      throw new AppNotFoundException(ErrorCode.CLASS_THRESHOLD_YEAR_NOT_FOUND);
    }

    const row = await this.prisma.local_field_class_thresholds.findUnique({
      where: {
        local_field_id_ecclesiastical_year_id: {
          local_field_id: localFieldId,
          ecclesiastical_year_id: ecclesiasticalYearId,
        },
      },
      select: { minimum_percent: true },
    });

    return {
      timeZone: this.timezones.assertTimezone(field.timezone),
      yearStart: civilDate(year.start_date),
      yearEnd: civilDate(year.end_date),
      yearActive: year.active !== false,
      minimumPercent: row?.minimum_percent ?? null,
    };
  }

  private canEdit(
    authorization: AuthorizationSnapshot,
    context: ThresholdContext,
    now: Date,
  ): boolean {
    if (!context.yearActive) {
      return false;
    }
    return canEditFieldClassThreshold({
      roles: (authorization.grants?.global_roles ?? []).map(
        (grant) => grant.role_name,
      ),
      now,
      timeZone: context.timeZone,
      yearStart: context.yearStart,
      yearEnd: context.yearEnd,
    });
  }

  private assertPercent(minimumPercent: number): void {
    if (
      !Number.isInteger(minimumPercent) ||
      minimumPercent < 0 ||
      minimumPercent > 100
    ) {
      throw new AppBadRequestException(
        ErrorCode.CLASS_THRESHOLD_PERCENT_INVALID,
      );
    }
  }

  private view(
    localFieldId: number,
    ecclesiasticalYearId: number,
    context: ThresholdContext,
    canEdit: boolean,
  ): FieldClassThresholdView {
    return {
      local_field_id: localFieldId,
      ecclesiastical_year_id: ecclesiasticalYearId,
      minimum_percent:
        context.minimumPercent ?? DEFAULT_CLASS_THRESHOLD_PERCENT,
      configured: context.minimumPercent != null,
      can_edit: canEdit,
    };
  }
}

function civilDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
