import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Computes a 0-100 score representing the percentage of camporees (local +
 * union) that a club attended in a given ecclesiastical year.
 *
 * Scope rules (all IDs are integers per DB schema):
 *  - local_camporees: ecclesiastical_year = year AND active = true
 *      AND local_field_id = localFieldId  (club's own local field)
 *  - union_camporees: ecclesiastical_year = year AND active = true
 *      AND union_id = unionId  (skipped entirely when unionId is null)
 *
 * Attended = camporee_clubs row with club_id = clubId AND status = 'approved'
 *   whose camporee_id (local) or union_camporee_id (union) is in scope.
 *
 * Returns 0 when no camporees exist in scope (denom = 0).
 */
@Injectable()
export class CamporeeScoreService {
  private readonly logger = new Logger(CamporeeScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param clubId       - clubs.club_id (integer)
   * @param localFieldId - clubs.local_field_id (integer) — scopes local_camporees
   * @param unionId      - local_fields.union_id (integer | null) — scopes union_camporees
   * @param year         - ecclesiastical_years.year_id (integer)
   */
  async calc(
    clubId: number,
    localFieldId: number,
    unionId: number | null,
    year: number,
  ): Promise<number> {
    // Step 1: count total camporees in scope (denominator)
    const denomRows = await this.prisma.$queryRaw<{ denom: bigint }[]>`
      SELECT COUNT(*)::bigint AS denom FROM (
        SELECT local_camporee_id AS id
          FROM local_camporees
          WHERE ecclesiastical_year = ${year}
            AND active = true
            AND local_field_id = ${localFieldId}
        UNION ALL
        SELECT union_camporee_id AS id
          FROM union_camporees
          WHERE ecclesiastical_year = ${year}
            AND active = true
            AND ${unionId !== null ? true : false} = true
            AND union_id = ${unionId ?? 0}
      ) scope
    `;
    const denom = Number(denomRows[0]?.denom ?? 0n);
    if (denom === 0) return 0;

    // Step 2: count camporees in scope that the club attended (numerator)
    const numerRows = await this.prisma.$queryRaw<{ numer: bigint }[]>`
      SELECT (
        -- local camporees attended
        SELECT COUNT(*)::bigint
        FROM camporee_clubs cc
        WHERE cc.club_id = ${clubId}
          AND cc.status = 'approved'
          AND cc.camporee_id IS NOT NULL
          AND cc.camporee_id IN (
            SELECT local_camporee_id
            FROM local_camporees
            WHERE ecclesiastical_year = ${year}
              AND active = true
              AND local_field_id = ${localFieldId}
          )
      ) + (
        -- union camporees attended (0 when unionId is null)
        SELECT COUNT(*)::bigint
        FROM camporee_clubs cc
        WHERE cc.club_id = ${clubId}
          AND cc.status = 'approved'
          AND cc.union_camporee_id IS NOT NULL
          AND ${unionId !== null ? true : false} = true
          AND cc.union_camporee_id IN (
            SELECT union_camporee_id
            FROM union_camporees
            WHERE ecclesiastical_year = ${year}
              AND active = true
              AND union_id = ${unionId ?? 0}
          )
      ) AS numer
    `;
    const numer = Number(numerRows[0]?.numer ?? 0n);

    const score = (numer / denom) * 100;
    return Number(score.toFixed(2));
  }
}
