import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TemporalContext } from '../clock/temporal-context.factory';
import {
  type BusinessDate,
  ZonedBusinessTimeService,
} from '../clock/zoned-business-time.service';

type DateOnlyValue = BusinessDate | Date;

export type ClubAssignmentTemporalRecord = {
  active: boolean;
  status: string | null;
  start_date: DateOnlyValue;
  end_date: DateOnlyValue | null;
  expires_at: Date | null;
};

export const CLUB_ASSIGNMENT_NON_AUTHORITY_ALLOWLIST = Object.freeze({
  workflowWhere: Object.freeze({ grantsAuthority: false as const }),
  historicalWhere: Object.freeze({ grantsAuthority: false as const }),
});

function dateOnly(value: DateOnlyValue): BusinessDate | null {
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }
  return Number.isNaN(value.getTime())
    ? null
    : (value.toISOString().slice(0, 10) as BusinessDate);
}

function prismaDate(value: BusinessDate): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

@Injectable()
export class ClubAssignmentEffectivityPolicy {
  constructor(private readonly zonedBusinessTime: ZonedBusinessTimeService) {}

  toPrismaWhere(
    context: TemporalContext,
  ): Prisma.club_role_assignmentsWhereInput {
    const businessDate = prismaDate(context.businessDate);
    return {
      active: true,
      status: 'active',
      start_date: { lte: businessDate },
      AND: [
        { OR: [{ end_date: null }, { end_date: { gte: businessDate } }] },
        {
          OR: [
            { expires_at: null },
            { expires_at: { gt: new Date(context.now) } },
          ],
        },
      ],
    };
  }

  toSql(context: TemporalContext): Prisma.Sql {
    return Prisma.sql`
      active = TRUE
      AND status = 'active'
      AND start_date <= ${context.businessDate}::date
      AND (end_date IS NULL OR end_date >= ${context.businessDate}::date)
      AND (expires_at IS NULL OR expires_at > ${context.now})`;
  }

  isEffective(
    assignment: ClubAssignmentTemporalRecord,
    context: TemporalContext,
  ): boolean {
    const startDate = dateOnly(assignment.start_date);
    const endDate = assignment.end_date ? dateOnly(assignment.end_date) : null;
    return (
      assignment.active &&
      assignment.status === 'active' &&
      startDate !== null &&
      startDate <= context.businessDate &&
      (assignment.end_date === null ||
        (endDate !== null && endDate >= context.businessDate)) &&
      (assignment.expires_at === null ||
        assignment.expires_at.getTime() > context.now.getTime())
    );
  }

  nextBoundary(
    assignment: ClubAssignmentTemporalRecord,
    context: TemporalContext,
  ): Date | null {
    if (!assignment.active || assignment.status !== 'active') return null;
    const candidates: Date[] = [];
    const startDate = dateOnly(assignment.start_date);
    const endDate = assignment.end_date ? dateOnly(assignment.end_date) : null;
    const expiresAt = assignment.expires_at?.getTime();
    if (
      !startDate ||
      (assignment.end_date !== null && !endDate) ||
      (endDate !== null && endDate < startDate) ||
      (endDate !== null && endDate < context.businessDate) ||
      (expiresAt !== undefined &&
        (!Number.isFinite(expiresAt) || expiresAt <= context.now.getTime()))
    ) {
      return null;
    }
    if (startDate && startDate > context.businessDate) {
      const startBoundary = this.zonedBusinessTime.startOfBusinessDate(
        startDate,
        context.businessTimeZone,
      );
      return expiresAt !== undefined && expiresAt <= startBoundary.getTime()
        ? null
        : startBoundary;
    }
    if (endDate && endDate >= context.businessDate) {
      candidates.push(
        this.zonedBusinessTime.startOfNextBusinessDate(
          endDate,
          context.businessTimeZone,
        ),
      );
    }
    if (
      assignment.expires_at &&
      assignment.expires_at.getTime() > context.now.getTime()
    ) {
      candidates.push(new Date(assignment.expires_at));
    }
    return (
      candidates
        .filter((candidate) => candidate.getTime() > context.now.getTime())
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null
    );
  }
}
