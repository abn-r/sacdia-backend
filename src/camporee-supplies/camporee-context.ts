import {
  AppNotFoundException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type { CamporeeKind } from './camporee-supply-actor';

export const DEFAULT_SUPPLY_TIMEZONE = 'America/Mexico_City';
export const ELIGIBLE_ENROLLMENT_STATUSES = ['registered', 'approved'] as const;

export type SupplyCamporeeRow = {
  kind: CamporeeKind;
  id: number;
  name: string;
  timezone: string;
  cutoffHm: string;
  localFieldId?: number;
  unionId?: number;
  startDate: string;
  endDate: string;
};

export function utcYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveSupplyTimezone(
  timezone: string | null | undefined,
): string {
  const candidate = timezone?.trim() || DEFAULT_SUPPLY_TIMEZONE;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_SUPPLY_TIMEZONE;
  }
}

export function camporeeWhere(kind: CamporeeKind, camporeeId: number) {
  return kind === 'local'
    ? { local_camporee_id: camporeeId, union_camporee_id: null }
    : { local_camporee_id: null, union_camporee_id: camporeeId };
}

export async function loadSupplyCamporee(
  prisma: PrismaService,
  camporeeId: number,
  kind: CamporeeKind,
): Promise<SupplyCamporeeRow> {
  if (kind === 'local') {
    const row = await prisma.local_camporees.findUnique({
      where: { local_camporee_id: camporeeId },
      select: {
        local_camporee_id: true,
        name: true,
        timezone: true,
        supply_edit_cutoff_local_time: true,
        local_field_id: true,
        start_date: true,
        end_date: true,
      },
    });
    if (!row) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_SUPPLIES_NOT_FOUND);
    }
    return {
      kind: 'local',
      id: row.local_camporee_id,
      name: row.name,
      timezone: resolveSupplyTimezone(row.timezone),
      cutoffHm: row.supply_edit_cutoff_local_time,
      localFieldId: row.local_field_id,
      startDate: utcYmd(row.start_date),
      endDate: utcYmd(row.end_date),
    };
  }

  const row = await prisma.union_camporees.findUnique({
    where: { union_camporee_id: camporeeId },
    select: {
      union_camporee_id: true,
      name: true,
      timezone: true,
      supply_edit_cutoff_local_time: true,
      union_id: true,
      start_date: true,
      end_date: true,
    },
  });
  if (!row) {
    throw new AppNotFoundException(ErrorCode.CAMPOREE_SUPPLIES_NOT_FOUND);
  }
  return {
    kind: 'union',
    id: row.union_camporee_id,
    name: row.name,
    timezone: resolveSupplyTimezone(row.timezone),
    cutoffHm: row.supply_edit_cutoff_local_time,
    unionId: row.union_id,
    startDate: utcYmd(row.start_date),
    endDate: utcYmd(row.end_date),
  };
}

export function assertDateInCamporee(
  ymd: string,
  camporee: SupplyCamporeeRow,
): void {
  if (ymd < camporee.startDate || ymd > camporee.endDate) {
    throw new AppUnprocessableEntityException(
      ErrorCode.CAMPOREE_SUPPLIES_SLOT_INVALID,
    );
  }
}
