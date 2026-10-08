import { Inject, Injectable } from '@nestjs/common';
import {
  assertLocalFieldInActorScope,
  resolveActorTerritoryScope,
  toTerritoryId,
} from '../common/authorization/actor-territory-scope';
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
  lockInvestitureAuthorizationCalendar,
  lockInvestitureAuthorizationYear,
} from '../investiture-requests/investiture-request-lock';
import {
  canEditInvestitureWindow,
  defaultInvestitureWindow,
  investitureWindowAllowsOperation,
  isCivilDate,
} from './field-investiture-window';

const CONSULT_ROLES = new Set([
  'super-admin',
  'admin',
  'assistant-admin',
  'director-lf',
  'assistant-lf',
  'director-union',
  'assistant-union',
  'director-dia',
  'assistant-dia',
]);

export type InvestitureWindowView = {
  local_field_id: number;
  ecclesiastical_year_id: number;
  start_date: string | null;
  end_date: string | null;
  configured: boolean;
  operational: boolean;
  can_edit: boolean;
};

type WindowContext = {
  timeZone: string;
  yearStart: string;
  yearEnd: string;
  yearActive: boolean;
  startDate: string | null;
  endDate: string | null;
};

@Injectable()
export class FieldInvestitureWindowConfigService {
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
  ): Promise<InvestitureWindowView> {
    const at = now ?? this.clock.now();
    await this.assertReadable(authorization, localFieldId);
    const context = await this.loadContext(localFieldId, ecclesiasticalYearId);
    return this.view(
      localFieldId,
      ecclesiasticalYearId,
      context,
      this.canEdit(authorization, localFieldId, context, at),
    );
  }

  async update(
    authorization: AuthorizationSnapshot,
    localFieldId: number,
    ecclesiasticalYearId: number,
    dates: { start_date: string; end_date: string },
    updatedById: string,
    now?: Date,
  ): Promise<InvestitureWindowView> {
    const at = now ?? this.clock.now();
    await this.assertReadable(authorization, localFieldId);
    const context = await this.loadContext(localFieldId, ecclesiasticalYearId);
    if (!this.canEdit(authorization, localFieldId, context, at)) {
      throw this.editDenied(authorization, localFieldId);
    }
    this.assertDates(dates, context.yearStart, context.yearEnd);

    await this.prisma.$transaction(async (tx) => {
      await lockInvestitureAuthorizationYear(tx, ecclesiasticalYearId);
      await lockInvestitureAuthorizationCalendar(
        tx,
        localFieldId,
        ecclesiasticalYearId,
      );
      await tx.local_field_investiture_windows.upsert({
        where: {
          local_field_id_ecclesiastical_year_id: {
            local_field_id: localFieldId,
            ecclesiastical_year_id: ecclesiasticalYearId,
          },
        },
        create: {
          local_field_id: localFieldId,
          ecclesiastical_year_id: ecclesiasticalYearId,
          start_date: civilDateToUtc(dates.start_date),
          end_date: civilDateToUtc(dates.end_date),
          updated_by_id: updatedById,
        },
        update: {
          start_date: civilDateToUtc(dates.start_date),
          end_date: civilDateToUtc(dates.end_date),
          updated_by_id: updatedById,
        },
      });
    });

    return this.view(
      localFieldId,
      ecclesiasticalYearId,
      {
        ...context,
        startDate: dates.start_date,
        endDate: dates.end_date,
      },
      true,
    );
  }

  async allowsOperation(
    localFieldId: number,
    ecclesiasticalYearId: number,
    now?: Date,
  ): Promise<boolean> {
    const at = now ?? this.clock.now();
    const context = await this.loadContext(localFieldId, ecclesiasticalYearId);
    const window = this.effectiveWindow(context);
    return investitureWindowAllowsOperation({
      now: at,
      timeZone: context.timeZone,
      yearStart: context.yearStart,
      yearEnd: context.yearEnd,
      yearActive: context.yearActive,
      windowStart: window?.start_date ?? null,
      windowEnd: window?.end_date ?? null,
    });
  }

  private async assertReadable(
    authorization: AuthorizationSnapshot | undefined,
    localFieldId: number,
  ): Promise<void> {
    const roles = roleSet(authorization);
    const consult = [...roles].some((role) => CONSULT_ROLES.has(role));
    if (!consult) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
    const scope = resolveActorTerritoryScope(authorization);
    if (scope.level === 'open') {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
    await assertLocalFieldInActorScope(this.prisma, localFieldId, scope);
  }

  private async loadContext(
    localFieldId: number,
    ecclesiasticalYearId: number,
  ): Promise<WindowContext> {
    const field = await this.prisma.local_fields.findUnique({
      where: { local_field_id: localFieldId },
      select: { timezone: true },
    });
    if (!field) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_WINDOW_FIELD_NOT_FOUND,
      );
    }
    const year = await this.prisma.ecclesiastical_years.findUnique({
      where: { year_id: ecclesiasticalYearId },
      select: { start_date: true, end_date: true, active: true },
    });
    if (!year?.start_date || !year.end_date) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_WINDOW_YEAR_NOT_FOUND,
      );
    }
    const row = await this.prisma.local_field_investiture_windows.findUnique({
      where: {
        local_field_id_ecclesiastical_year_id: {
          local_field_id: localFieldId,
          ecclesiastical_year_id: ecclesiasticalYearId,
        },
      },
      select: { start_date: true, end_date: true },
    });
    return {
      timeZone: this.timezones.assertTimezone(field.timezone),
      yearStart: civilDate(year.start_date),
      yearEnd: civilDate(year.end_date),
      yearActive: year.active,
      startDate: row ? civilDate(row.start_date) : null,
      endDate: row ? civilDate(row.end_date) : null,
    };
  }

  private canEdit(
    authorization: AuthorizationSnapshot,
    localFieldId: number,
    context: WindowContext,
    now: Date,
  ): boolean {
    const flags = editorFlags(authorization, localFieldId);
    return canEditInvestitureWindow({
      roles: flags.roles,
      now,
      timeZone: context.timeZone,
      yearStart: context.yearStart,
      yearEnd: context.yearEnd,
      yearActive: context.yearActive,
      editsOwnField: flags.editsOwnField,
      editsByAdminScope: flags.editsByAdminScope,
    });
  }

  private editDenied(
    authorization: AuthorizationSnapshot,
    localFieldId: number,
  ): AppForbiddenException {
    const flags = editorFlags(authorization, localFieldId);
    const editor =
      flags.roles.includes('super-admin') ||
      flags.editsOwnField ||
      flags.editsByAdminScope;
    return new AppForbiddenException(
      editor
        ? ErrorCode.INVESTITURE_WINDOW_EDIT_CLOSED
        : ErrorCode.GUARD_PERMISSION_DENIED,
    );
  }

  private assertDates(
    dates: { start_date: string; end_date: string },
    yearStart: string,
    yearEnd: string,
  ): void {
    if (!isCivilDate(dates.start_date) || !isCivilDate(dates.end_date)) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_WINDOW_DATE_INVALID,
      );
    }
    if (
      dates.start_date < yearStart ||
      dates.start_date > yearEnd ||
      dates.end_date < yearStart ||
      dates.end_date > yearEnd
    ) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_WINDOW_OUTSIDE_YEAR,
      );
    }
    if (dates.start_date > dates.end_date) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_WINDOW_START_AFTER_END,
      );
    }
  }

  private explicitWindow(context: WindowContext): {
    start_date: string;
    end_date: string;
  } | null {
    const { startDate, endDate, yearStart, yearEnd } = context;
    if (!startDate || !endDate) {
      return null;
    }
    if (!isCivilDate(startDate) || !isCivilDate(endDate)) {
      return null;
    }
    if (startDate > endDate) {
      return null;
    }
    if (startDate < yearStart || endDate > yearEnd) {
      return null;
    }
    return { start_date: startDate, end_date: endDate };
  }

  private effectiveWindow(context: WindowContext): {
    start_date: string;
    end_date: string;
  } | null {
    return (
      this.explicitWindow(context) ??
      defaultInvestitureWindow(context.yearStart, context.yearEnd)
    );
  }

  private view(
    localFieldId: number,
    ecclesiasticalYearId: number,
    context: WindowContext,
    canEdit: boolean,
  ): InvestitureWindowView {
    const explicit = this.explicitWindow(context);
    const window =
      explicit ?? defaultInvestitureWindow(context.yearStart, context.yearEnd);
    return {
      local_field_id: localFieldId,
      ecclesiastical_year_id: ecclesiasticalYearId,
      start_date: window?.start_date ?? null,
      end_date: window?.end_date ?? null,
      configured: explicit !== null,
      operational: window !== null,
      can_edit: canEdit,
    };
  }
}

function roleSet(
  authorization: AuthorizationSnapshot | undefined,
): Set<string> {
  return new Set(
    (authorization?.grants?.global_roles ?? []).map((grant) =>
      grant.role_name.trim().toLowerCase(),
    ),
  );
}

function editorFlags(
  authorization: AuthorizationSnapshot,
  localFieldId: number,
): {
  roles: string[];
  editsOwnField: boolean;
  editsByAdminScope: boolean;
} {
  const roles = roleSet(authorization);
  const ownFieldId = toTerritoryId(
    authorization.effective?.scope?.global?.local_field?.id,
  );
  return {
    roles: [...roles],
    editsOwnField:
      (roles.has('director-lf') || roles.has('assistant-lf')) &&
      ownFieldId === localFieldId,
    editsByAdminScope: roles.has('admin') || roles.has('assistant-admin'),
  };
}

function civilDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function civilDateToUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
