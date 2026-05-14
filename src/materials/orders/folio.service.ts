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
   * Allocates the next folio for the (local_field, year) combination derived
   * from `now` in America/Mexico_City. Two local_fields hold independent
   * counters: SOL20260001 in LF=1 and SOL20260001 in LF=2 may coexist (each
   * field has its own bank account, so the reference is only unique within
   * the field).
   *
   * @param tx             - Prisma interactive transaction client. MUST be inside $transaction().
   * @param localFieldId   - Local field that owns the counter row.
   * @param now            - Reference timestamp (defaults to Date.now()). Override in tests.
   */
  async allocate(
    tx: Prisma.TransactionClient,
    localFieldId: number,
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

    // Ensure the counter row exists for this (local_field, year) tuple
    // (idempotent — no-op if it already exists)
    await tx.$executeRawUnsafe(
      `INSERT INTO material_folio_counters (local_field_id, year, last_folio, updated_at)
       VALUES ($1, $2, 0, NOW())
       ON CONFLICT (local_field_id, year) DO NOTHING`,
      localFieldId,
      year,
    );

    // Acquire row-level lock and read current counter (serializes concurrent
    // approvals on the same local_field)
    const rows = await tx.$queryRawUnsafe<Array<{ last_folio: number }>>(
      `SELECT last_folio
         FROM material_folio_counters
        WHERE local_field_id = $1 AND year = $2
        FOR UPDATE`,
      localFieldId,
      year,
    );

    const next = rows[0].last_folio + 1;

    // Persist the incremented counter
    await tx.$executeRawUnsafe(
      `UPDATE material_folio_counters
          SET last_folio = $1, updated_at = NOW()
        WHERE local_field_id = $2 AND year = $3`,
      next,
      localFieldId,
      year,
    );

    const folio_referencia = `SOL${year}${next.toString().padStart(4, '0')}`;

    this.logger.log({
      event: 'folio.allocated',
      local_field_id: localFieldId,
      folio: next,
      folio_referencia,
      year,
    });

    return { folio: next, folio_referencia, year };
  }
}
