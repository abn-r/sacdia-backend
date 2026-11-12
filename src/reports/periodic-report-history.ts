import type { PrismaService } from '../prisma/prisma.service';

/**
 * Oldest day the daily catch-up may freeze reports for: the start of the
 * ecclesiastical year BEFORE the current one (or of the current one when there
 * is no previous year). The current year is the latest one that already
 * started. Returns null when no ecclesiastical year has started.
 */
export async function resolveHistoryLowerBound(
  prisma: Pick<PrismaService, 'ecclesiastical_years'>,
  today: Date,
): Promise<Date | null> {
  const current = await prisma.ecclesiastical_years.findFirst({
    where: { start_date: { lte: today } },
    orderBy: { start_date: 'desc' },
    select: { start_date: true },
  });
  if (!current) return null;
  const previous = await prisma.ecclesiastical_years.findFirst({
    where: { end_date: { lt: current.start_date } },
    orderBy: { end_date: 'desc' },
    select: { start_date: true },
  });
  return (previous ?? current).start_date;
}
