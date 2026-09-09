import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppServiceUnavailableException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

/**
 * Read-only club/year ledger. Lives in Common so auth can gate the new
 * period without importing YearCutModule (no auth ↔ year-cut DI cycle).
 */
@Injectable()
export class ClubCycleReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Missing row = nothing pending for that club/year (idle).
   * `completed` = cut finished. Any other status is not ready.
   */
  async isReady(clubId: number, yearId: number): Promise<boolean> {
    const row = await this.prisma.club_year_transitions.findUnique({
      where: {
        club_id_ecclesiastical_year_id: {
          club_id: clubId,
          ecclesiastical_year_id: yearId,
        },
      },
      select: { status: true },
    });
    return row == null || row.status === 'completed';
  }

  async readinessByClub(
    clubIds: number[],
    yearId: number,
  ): Promise<Map<number, boolean>> {
    const unique = [...new Set(clubIds.filter((id) => Number.isFinite(id)))];
    const result = new Map<number, boolean>();
    for (const clubId of unique) {
      result.set(clubId, true);
    }
    if (unique.length === 0) {
      return result;
    }

    const rows = await this.prisma.club_year_transitions.findMany({
      where: {
        club_id: { in: unique },
        ecclesiastical_year_id: yearId,
      },
      select: { club_id: true, status: true },
    });

    for (const row of rows) {
      result.set(row.club_id, row.status === 'completed');
    }
    return result;
  }

  async assertReady(clubId: number, yearId: number): Promise<void> {
    if (!(await this.isReady(clubId, yearId))) {
      throw new AppServiceUnavailableException(ErrorCode.CLUB_CYCLE_NOT_READY, {
        clubId,
        yearId,
      });
    }
  }
}
