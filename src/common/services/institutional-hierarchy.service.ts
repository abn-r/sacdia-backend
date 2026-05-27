import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppNotFoundException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

export type HierarchyEntityType =
  | 'division'
  | 'union'
  | 'local_field'
  | 'district'
  | 'church'
  | 'club';

export type HierarchyEntityRef = {
  type: HierarchyEntityType;
  id: number;
};

export type ResolveCurrentInput = {
  divisionId?: number;
  unionId?: number;
  localFieldId?: number;
  districtId?: number;
  churchId?: number;
  clubId?: number;
};

export type HierarchyContextSource =
  | 'current'
  | 'as_of'
  | 'snapshot'
  | 'system_backfill';

export type HierarchyContext = {
  hierarchy_context_id?: string;
  division_id: number;
  division_code?: string | null;
  division_name?: string | null;
  union_id?: number | null;
  union_name?: string | null;
  local_field_id?: number | null;
  local_field_name?: string | null;
  district_id?: number | null;
  district_name?: string | null;
  church_id?: number | null;
  church_name?: string | null;
  club_id?: number | null;
  club_name?: string | null;
  as_of: Date;
  source: HierarchyContextSource;
  precision: string;
};

type HierarchyRow = Omit<HierarchyContext, 'as_of'> & {
  as_of: Date | string;
};

@Injectable()
export class InstitutionalHierarchyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCurrent(input: ResolveCurrentInput): Promise<HierarchyContext> {
    const row = await this.resolveCurrentRow(input);
    return this.normalizeRow(row, 'current');
  }

  async resolveAsOf(
    entity: HierarchyEntityRef,
    asOf: Date,
  ): Promise<HierarchyContext> {
    const row = await this.resolveAsOfRow(entity, asOf);
    if (row) {
      return this.normalizeRow(row, 'as_of');
    }

    // Compatibility fallback for entities created after the initial backfill but
    // before all write paths start recording relationship-history rows.
    const current = await this.resolveCurrent(this.toCurrentInput(entity));
    return {
      ...current,
      as_of: asOf,
      source: 'as_of',
      precision: 'unknown',
    };
  }

  async snapshotForClub(
    clubId: number,
    asOf: Date = new Date(),
    createdBy?: string,
  ): Promise<HierarchyContext> {
    const context = await this.resolveAsOf({ type: 'club', id: clubId }, asOf);
    const rows = await this.prisma.$queryRaw<
      Array<{ hierarchy_context_id: string }>
    >(
      Prisma.sql`
        INSERT INTO hierarchy_contexts (
          division_id,
          union_id,
          local_field_id,
          districlub_type_id,
          church_id,
          club_id,
          as_of,
          source,
          precision,
          context,
          created_by
        )
        VALUES (
          ${context.division_id},
          ${context.union_id ?? null},
          ${context.local_field_id ?? null},
          ${context.district_id ?? null},
          ${context.church_id ?? null},
          ${context.club_id ?? clubId},
          ${asOf},
          'snapshot',
          ${context.precision},
          ${JSON.stringify(context)}::jsonb,
          ${createdBy ? Prisma.sql`${createdBy}::uuid` : Prisma.sql`NULL`}
        )
        RETURNING hierarchy_context_id
      `,
    );

    return {
      ...context,
      hierarchy_context_id: rows[0]?.hierarchy_context_id,
      source: 'snapshot',
    };
  }

  private async resolveCurrentRow(
    input: ResolveCurrentInput,
  ): Promise<HierarchyRow> {
    if (input.clubId) {
      return this.expectOne(
        await this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
          SELECT
            d.division_id,
            d.code AS division_code,
            d.name AS division_name,
            u.union_id,
            u.name AS union_name,
            lf.local_field_id,
            lf.name AS local_field_name,
            dist.districlub_type_id AS district_id,
            dist.name AS district_name,
            ch.church_id,
            ch.name AS church_name,
            c.club_id,
            c.name AS club_name,
            NOW() AS as_of,
            'current' AS source,
            'exact' AS precision
          FROM clubs c
          JOIN local_fields lf ON lf.local_field_id = c.local_field_id
          JOIN unions u ON u.union_id = lf.union_id
          JOIN divisions d ON d.division_id = u.division_id
          LEFT JOIN districts dist ON dist.districlub_type_id = c.districlub_type_id
          LEFT JOIN churches ch ON ch.church_id = c.church_id
          WHERE c.club_id = ${input.clubId}
          LIMIT 1
        `),
      );
    }

    if (input.churchId) {
      return this.expectOne(
        await this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
          SELECT
            d.division_id,
            d.code AS division_code,
            d.name AS division_name,
            u.union_id,
            u.name AS union_name,
            lf.local_field_id,
            lf.name AS local_field_name,
            dist.districlub_type_id AS district_id,
            dist.name AS district_name,
            ch.church_id,
            ch.name AS church_name,
            NULL::int AS club_id,
            NULL::text AS club_name,
            NOW() AS as_of,
            'current' AS source,
            'exact' AS precision
          FROM churches ch
          JOIN districts dist ON dist.districlub_type_id = ch.districlub_type_id
          JOIN local_fields lf ON lf.local_field_id = dist.local_field_id
          JOIN unions u ON u.union_id = lf.union_id
          JOIN divisions d ON d.division_id = u.division_id
          WHERE ch.church_id = ${input.churchId}
          LIMIT 1
        `),
      );
    }

    if (input.districtId) {
      return this.expectOne(
        await this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
          SELECT
            d.division_id,
            d.code AS division_code,
            d.name AS division_name,
            u.union_id,
            u.name AS union_name,
            lf.local_field_id,
            lf.name AS local_field_name,
            dist.districlub_type_id AS district_id,
            dist.name AS district_name,
            NULL::int AS church_id,
            NULL::text AS church_name,
            NULL::int AS club_id,
            NULL::text AS club_name,
            NOW() AS as_of,
            'current' AS source,
            'exact' AS precision
          FROM districts dist
          JOIN local_fields lf ON lf.local_field_id = dist.local_field_id
          JOIN unions u ON u.union_id = lf.union_id
          JOIN divisions d ON d.division_id = u.division_id
          WHERE dist.districlub_type_id = ${input.districtId}
          LIMIT 1
        `),
      );
    }

    if (input.localFieldId) {
      return this.expectOne(
        await this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
          SELECT
            d.division_id,
            d.code AS division_code,
            d.name AS division_name,
            u.union_id,
            u.name AS union_name,
            lf.local_field_id,
            lf.name AS local_field_name,
            NULL::int AS district_id,
            NULL::text AS district_name,
            NULL::int AS church_id,
            NULL::text AS church_name,
            NULL::int AS club_id,
            NULL::text AS club_name,
            NOW() AS as_of,
            'current' AS source,
            'exact' AS precision
          FROM local_fields lf
          JOIN unions u ON u.union_id = lf.union_id
          JOIN divisions d ON d.division_id = u.division_id
          WHERE lf.local_field_id = ${input.localFieldId}
          LIMIT 1
        `),
      );
    }

    if (input.unionId) {
      return this.expectOne(
        await this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
          SELECT
            d.division_id,
            d.code AS division_code,
            d.name AS division_name,
            u.union_id,
            u.name AS union_name,
            NULL::int AS local_field_id,
            NULL::text AS local_field_name,
            NULL::int AS district_id,
            NULL::text AS district_name,
            NULL::int AS church_id,
            NULL::text AS church_name,
            NULL::int AS club_id,
            NULL::text AS club_name,
            NOW() AS as_of,
            'current' AS source,
            'exact' AS precision
          FROM unions u
          JOIN divisions d ON d.division_id = u.division_id
          WHERE u.union_id = ${input.unionId}
          LIMIT 1
        `),
      );
    }

    if (input.divisionId) {
      return this.expectOne(
        await this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
          SELECT
            d.division_id,
            d.code AS division_code,
            d.name AS division_name,
            NULL::int AS union_id,
            NULL::text AS union_name,
            NULL::int AS local_field_id,
            NULL::text AS local_field_name,
            NULL::int AS district_id,
            NULL::text AS district_name,
            NULL::int AS church_id,
            NULL::text AS church_name,
            NULL::int AS club_id,
            NULL::text AS club_name,
            NOW() AS as_of,
            'current' AS source,
            'exact' AS precision
          FROM divisions d
          WHERE d.division_id = ${input.divisionId}
          LIMIT 1
        `),
      );
    }

    throw new AppNotFoundException(ErrorCode.HIERARCHY_CONTEXT_NOT_FOUND);
  }

  private async resolveAsOfRow(
    entity: HierarchyEntityRef,
    asOf: Date,
  ): Promise<HierarchyRow | null> {
    switch (entity.type) {
      case 'club':
        return this.first(
          await this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
            SELECT
              h.division_id,
              d.code AS division_code,
              d.name AS division_name,
              h.union_id,
              u.name AS union_name,
              h.local_field_id,
              lf.name AS local_field_name,
              h.districlub_type_id AS district_id,
              dist.name AS district_name,
              h.church_id,
              ch.name AS church_name,
              h.club_id,
              c.name AS club_name,
              ${asOf} AS as_of,
              'as_of' AS source,
              h.precision
            FROM club_institutional_history h
            JOIN divisions d ON d.division_id = h.division_id
            JOIN unions u ON u.union_id = h.union_id
            JOIN local_fields lf ON lf.local_field_id = h.local_field_id
            JOIN districts dist ON dist.districlub_type_id = h.districlub_type_id
            JOIN churches ch ON ch.church_id = h.church_id
            JOIN clubs c ON c.club_id = h.club_id
            WHERE h.club_id = ${entity.id}
              AND h.valid_from <= ${asOf}::date
              AND (h.valid_to IS NULL OR h.valid_to > ${asOf}::date)
            ORDER BY h.valid_from DESC
            LIMIT 1
          `),
        );
      case 'church':
        return this.first(await this.resolveChurchAsOf(entity.id, asOf));
      case 'district':
        return this.first(await this.resolveDistrictAsOf(entity.id, asOf));
      case 'local_field':
        return this.first(await this.resolveLocalFieldAsOf(entity.id, asOf));
      case 'union':
        return this.first(await this.resolveUnionAsOf(entity.id, asOf));
      case 'division':
        return this.first(
          await this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
            SELECT
              d.division_id,
              d.code AS division_code,
              d.name AS division_name,
              NULL::int AS union_id,
              NULL::text AS union_name,
              NULL::int AS local_field_id,
              NULL::text AS local_field_name,
              NULL::int AS district_id,
              NULL::text AS district_name,
              NULL::int AS church_id,
              NULL::text AS church_name,
              NULL::int AS club_id,
              NULL::text AS club_name,
              ${asOf} AS as_of,
              'as_of' AS source,
              'exact' AS precision
            FROM divisions d
            WHERE d.division_id = ${entity.id}
            LIMIT 1
          `),
        );
      default:
        return null;
    }
  }

  private resolveUnionAsOf(unionId: number, asOf: Date) {
    return this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
      SELECT
        ud.division_id,
        d.code AS division_code,
        d.name AS division_name,
        ud.union_id,
        u.name AS union_name,
        NULL::int AS local_field_id,
        NULL::text AS local_field_name,
        NULL::int AS district_id,
        NULL::text AS district_name,
        NULL::int AS church_id,
        NULL::text AS church_name,
        NULL::int AS club_id,
        NULL::text AS club_name,
        ${asOf} AS as_of,
        'as_of' AS source,
        ud.precision
      FROM union_division_history ud
      JOIN divisions d ON d.division_id = ud.division_id
      JOIN unions u ON u.union_id = ud.union_id
      WHERE ud.union_id = ${unionId}
        AND ud.valid_from <= ${asOf}::date
        AND (ud.valid_to IS NULL OR ud.valid_to > ${asOf}::date)
      ORDER BY ud.valid_from DESC
      LIMIT 1
    `);
  }

  private resolveLocalFieldAsOf(localFieldId: number, asOf: Date) {
    return this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
      SELECT
        ud.division_id,
        d.code AS division_code,
        d.name AS division_name,
        lfu.union_id,
        u.name AS union_name,
        lfu.local_field_id,
        lf.name AS local_field_name,
        NULL::int AS district_id,
        NULL::text AS district_name,
        NULL::int AS church_id,
        NULL::text AS church_name,
        NULL::int AS club_id,
        NULL::text AS club_name,
        ${asOf} AS as_of,
        'as_of' AS source,
        CASE
          WHEN lfu.precision = ud.precision THEN lfu.precision
          ELSE 'unknown'
        END AS precision
      FROM local_field_union_history lfu
      JOIN union_division_history ud ON ud.union_id = lfu.union_id
        AND ud.valid_from <= ${asOf}::date
        AND (ud.valid_to IS NULL OR ud.valid_to > ${asOf}::date)
      JOIN divisions d ON d.division_id = ud.division_id
      JOIN unions u ON u.union_id = lfu.union_id
      JOIN local_fields lf ON lf.local_field_id = lfu.local_field_id
      WHERE lfu.local_field_id = ${localFieldId}
        AND lfu.valid_from <= ${asOf}::date
        AND (lfu.valid_to IS NULL OR lfu.valid_to > ${asOf}::date)
      ORDER BY lfu.valid_from DESC
      LIMIT 1
    `);
  }

  private resolveDistrictAsOf(districtId: number, asOf: Date) {
    return this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
      SELECT
        ud.division_id,
        d.code AS division_code,
        d.name AS division_name,
        lfu.union_id,
        u.name AS union_name,
        dlf.local_field_id,
        lf.name AS local_field_name,
        dlf.districlub_type_id AS district_id,
        dist.name AS district_name,
        NULL::int AS church_id,
        NULL::text AS church_name,
        NULL::int AS club_id,
        NULL::text AS club_name,
        ${asOf} AS as_of,
        'as_of' AS source,
        CASE
          WHEN dlf.precision = lfu.precision AND lfu.precision = ud.precision
            THEN dlf.precision
          ELSE 'unknown'
        END AS precision
      FROM district_local_field_history dlf
      JOIN local_field_union_history lfu ON lfu.local_field_id = dlf.local_field_id
        AND lfu.valid_from <= ${asOf}::date
        AND (lfu.valid_to IS NULL OR lfu.valid_to > ${asOf}::date)
      JOIN union_division_history ud ON ud.union_id = lfu.union_id
        AND ud.valid_from <= ${asOf}::date
        AND (ud.valid_to IS NULL OR ud.valid_to > ${asOf}::date)
      JOIN divisions d ON d.division_id = ud.division_id
      JOIN unions u ON u.union_id = lfu.union_id
      JOIN local_fields lf ON lf.local_field_id = dlf.local_field_id
      JOIN districts dist ON dist.districlub_type_id = dlf.districlub_type_id
      WHERE dlf.districlub_type_id = ${districtId}
        AND dlf.valid_from <= ${asOf}::date
        AND (dlf.valid_to IS NULL OR dlf.valid_to > ${asOf}::date)
      ORDER BY dlf.valid_from DESC
      LIMIT 1
    `);
  }

  private resolveChurchAsOf(churchId: number, asOf: Date) {
    return this.prisma.$queryRaw<HierarchyRow[]>(Prisma.sql`
      SELECT
        ud.division_id,
        d.code AS division_code,
        d.name AS division_name,
        lfu.union_id,
        u.name AS union_name,
        dlf.local_field_id,
        lf.name AS local_field_name,
        cd.districlub_type_id AS district_id,
        dist.name AS district_name,
        cd.church_id,
        ch.name AS church_name,
        NULL::int AS club_id,
        NULL::text AS club_name,
        ${asOf} AS as_of,
        'as_of' AS source,
        CASE
          WHEN cd.precision = dlf.precision
            AND dlf.precision = lfu.precision
            AND lfu.precision = ud.precision
            THEN cd.precision
          ELSE 'unknown'
        END AS precision
      FROM church_district_history cd
      JOIN district_local_field_history dlf ON dlf.districlub_type_id = cd.districlub_type_id
        AND dlf.valid_from <= ${asOf}::date
        AND (dlf.valid_to IS NULL OR dlf.valid_to > ${asOf}::date)
      JOIN local_field_union_history lfu ON lfu.local_field_id = dlf.local_field_id
        AND lfu.valid_from <= ${asOf}::date
        AND (lfu.valid_to IS NULL OR lfu.valid_to > ${asOf}::date)
      JOIN union_division_history ud ON ud.union_id = lfu.union_id
        AND ud.valid_from <= ${asOf}::date
        AND (ud.valid_to IS NULL OR ud.valid_to > ${asOf}::date)
      JOIN divisions d ON d.division_id = ud.division_id
      JOIN unions u ON u.union_id = lfu.union_id
      JOIN local_fields lf ON lf.local_field_id = dlf.local_field_id
      JOIN districts dist ON dist.districlub_type_id = cd.districlub_type_id
      JOIN churches ch ON ch.church_id = cd.church_id
      WHERE cd.church_id = ${churchId}
        AND cd.valid_from <= ${asOf}::date
        AND (cd.valid_to IS NULL OR cd.valid_to > ${asOf}::date)
      ORDER BY cd.valid_from DESC
      LIMIT 1
    `);
  }

  private first(rows: HierarchyRow[]): HierarchyRow | null {
    return rows[0] ?? null;
  }

  private expectOne(rows: HierarchyRow[]): HierarchyRow {
    const row = this.first(rows);
    if (!row) {
      throw new AppNotFoundException(ErrorCode.HIERARCHY_CONTEXT_NOT_FOUND);
    }
    return row;
  }

  private normalizeRow(
    row: HierarchyRow,
    fallbackSource: HierarchyContextSource,
  ): HierarchyContext {
    return {
      ...row,
      as_of: row.as_of instanceof Date ? row.as_of : new Date(row.as_of),
      source: row.source ?? fallbackSource,
      precision: row.precision ?? 'unknown',
    };
  }

  private toCurrentInput(entity: HierarchyEntityRef): ResolveCurrentInput {
    switch (entity.type) {
      case 'division':
        return { divisionId: entity.id };
      case 'union':
        return { unionId: entity.id };
      case 'local_field':
        return { localFieldId: entity.id };
      case 'district':
        return { districtId: entity.id };
      case 'church':
        return { churchId: entity.id };
      case 'club':
      default:
        return { clubId: entity.id };
    }
  }
}
