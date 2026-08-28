import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Allocates INS{year}{folio4} per local field and calendar year
 * (America/Mexico_City). Must run inside a $transaction.
 */
@Injectable()
export class CamporeeSupplyFolioService {
  private readonly logger = new Logger(CamporeeSupplyFolioService.name);

  async allocate(
    tx: Prisma.TransactionClient,
    localFieldId: number,
    now: Date = new Date(),
  ): Promise<{ folio: number; folio_reference: string; year: number }> {
    const year = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
      }).format(now),
      10,
    );

    await tx.$executeRawUnsafe(
      `INSERT INTO camporee_supply_folio_counters (local_field_id, year, last_folio, updated_at)
       VALUES ($1, $2, 0, NOW())
       ON CONFLICT (local_field_id, year) DO NOTHING`,
      localFieldId,
      year,
    );

    const rows = await tx.$queryRawUnsafe<Array<{ last_folio: number }>>(
      `SELECT last_folio
       FROM camporee_supply_folio_counters
       WHERE local_field_id = $1 AND year = $2
       FOR UPDATE`,
      localFieldId,
      year,
    );

    const next = rows[0].last_folio + 1;

    await tx.$executeRawUnsafe(
      `UPDATE camporee_supply_folio_counters
       SET last_folio = $1, updated_at = NOW()
       WHERE local_field_id = $2 AND year = $3`,
      next,
      localFieldId,
      year,
    );

    const folio_reference = `INS${year}${next.toString().padStart(4, '0')}`;
    this.logger.debug(
      `Allocated camporee supply folio ${folio_reference} (LF ${localFieldId})`,
    );
    return { folio: next, folio_reference, year };
  }
}
