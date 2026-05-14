import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * FolioService — allocates the next sequential folio for a given year.
 *
 * Design rules (locked by spec REQ-ORD-008, SC-03, SC-18):
 *   - Year derived from `now` in America/Mexico_City timezone.
 *   - Counter row (material_folio_counters) locked with SELECT … FOR UPDATE
 *     so concurrent approvals serialize cleanly.
 *   - Must be called INSIDE a Prisma interactive transaction (tx).
 *   - Returns folio number, formatted reference string, and year.
 *
 * Format: SOL{year}{folio4} — e.g. SOL20260001
 * On year rollover, a new counter row is created via INSERT … ON CONFLICT DO NOTHING.
 */
@Injectable()
export class FolioService {
  private readonly logger = new Logger(FolioService.name);

  /**
   * Allocates the next folio for the year derived from `now` in America/Mexico_City.
   *
   * @param tx   - Prisma interactive transaction client. MUST be inside $transaction().
   * @param now  - Reference timestamp (defaults to Date.now()). Override in tests.
   */
  async allocate(
    tx: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<{ folio: number; folio_referencia: string; year: number }> {
    // Derive year in Mexico City timezone — never use UTC (spec: SC-18)
    const year = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
      }).format(now),
      10,
    );

    // Ensure the counter row exists for this year (idempotent — no-op if it already exists)
    await tx.$executeRawUnsafe(
      `INSERT INTO material_folio_counters (year, last_folio, updated_at)
       VALUES ($1, 0, NOW())
       ON CONFLICT (year) DO NOTHING`,
      year,
    );

    // Acquire row-level lock and read current counter (serializes concurrent approvals)
    const rows = await tx.$queryRawUnsafe<Array<{ last_folio: number }>>(
      `SELECT last_folio FROM material_folio_counters WHERE year = $1 FOR UPDATE`,
      year,
    );

    const next = rows[0].last_folio + 1;

    // Persist the incremented counter
    await tx.$executeRawUnsafe(
      `UPDATE material_folio_counters SET last_folio = $1, updated_at = NOW() WHERE year = $2`,
      next,
      year,
    );

    const folio_referencia = `SOL${year}${next.toString().padStart(4, '0')}`;

    this.logger.log({
      event: 'folio.allocated',
      folio: next,
      folio_referencia,
      year,
    });

    return { folio: next, folio_referencia, year };
  }
}
