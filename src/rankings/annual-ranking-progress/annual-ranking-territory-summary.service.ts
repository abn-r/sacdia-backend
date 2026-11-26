import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';
import {
  resolveActorTerritoryScope,
  type ActorTerritoryScope,
} from '../../common/authorization/actor-territory-scope';
import type { AnnualRankingTerritorySummaryRowDto } from './dto/annual-ranking-territory-summary-response.dto';

export interface TerritorySummaryQuery {
  divisionId?: number;
  unionId?: number;
  yearId?: number;
}

/**
 * Per-child counts for the supervision "Progreso anual" drill-down
 * (División -> Uniones, Unión -> Campos Locales). No scoring: only grouped
 * reads of children, clubs and annual ranking configs.
 */
@Injectable()
export class AnnualRankingTerritorySummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(
    query: TerritorySummaryQuery,
    profile?: ResolvedAuthorizationProfile,
  ): Promise<AnnualRankingTerritorySummaryRowDto[]> {
    const scope = resolveActorTerritoryScope(profile);
    // Without union_id the parent is the actor's own unit: a division actor
    // gets its unions, a union actor its local fields. The route never takes
    // a division_id (no tenant binding exists for divisions), so a division
    // is always the caller's own.
    let { divisionId, unionId } = query;
    if (divisionId === undefined && unionId === undefined) {
      if (scope.level === 'division') divisionId = scope.divisionId;
      else if (scope.level === 'union') unionId = scope.unionId;
    }
    if ((divisionId === undefined) === (unionId === undefined)) {
      if (scope.level === 'unconfigured') {
        throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
      }
      if (scope.level === 'local_field') {
        throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
      }
      throw new AppBadRequestException(ErrorCode.ANNUAL_RANKING_SCOPE_INVALID);
    }

    await this.assertInScope(scope, divisionId, unionId);

    const yearId = await this.resolveYearId(query.yearId);
    return this.compute(divisionId, unionId, yearId);
  }

  private async assertInScope(
    scope: ActorTerritoryScope,
    divisionId: number | undefined,
    unionId: number | undefined,
  ): Promise<void> {
    if (scope.level === 'all' || scope.level === 'open') return;
    if (scope.level === 'unconfigured') {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }
    // A local-field actor has no child level to drill into.
    if (scope.level === 'local_field') {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    if (divisionId !== undefined) {
      if (scope.level !== 'division' || scope.divisionId !== divisionId) {
        throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
      }
      return;
    }

    if (scope.level === 'union') {
      if (scope.unionId !== unionId) {
        throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
      }
      return;
    }

    const union = await this.prisma.unions.findUnique({
      where: { union_id: unionId as number },
      select: { division_id: true },
    });
    if (!union || union.division_id !== scope.divisionId) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }

  private async resolveYearId(yearId: number | undefined): Promise<number> {
    const select = { year_id: true } as const;
    const year =
      yearId !== undefined
        ? await this.prisma.ecclesiastical_years.findUnique({
            where: { year_id: yearId },
            select,
          })
        : await this.prisma.ecclesiastical_years.findFirst({
            where: { active: true },
            orderBy: { start_date: 'desc' },
            select,
          });

    if (!year) throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
    return year.year_id;
  }

  private async compute(
    divisionId: number | undefined,
    unionId: number | undefined,
    yearId: number,
  ): Promise<AnnualRankingTerritorySummaryRowDto[]> {
    const children: Array<{ id: number; name: string }> =
      divisionId !== undefined
        ? (
            await this.prisma.unions.findMany({
              where: { division_id: divisionId, active: true },
              select: { union_id: true, name: true },
              orderBy: { name: 'asc' },
            })
          ).map((u) => ({ id: u.union_id, name: u.name }))
        : [];

    const localFields = await this.prisma.local_fields.findMany({
      where:
        divisionId !== undefined
          ? { union_id: { in: children.map((c) => c.id) }, active: true }
          : { union_id: unionId, active: true },
      select: { local_field_id: true, name: true, union_id: true },
      orderBy: { name: 'asc' },
    });

    if (divisionId === undefined) {
      localFields.forEach((lf) =>
        children.push({ id: lf.local_field_id, name: lf.name }),
      );
    }

    const childOfLocalField = new Map<number, number>(
      localFields.map((lf) => [
        lf.local_field_id,
        divisionId !== undefined ? lf.union_id : lf.local_field_id,
      ]),
    );
    const parentUnionOfLocalField = new Map<number, number>(
      localFields.map((lf) => [lf.local_field_id, lf.union_id]),
    );
    const localFieldIds = [...childOfLocalField.keys()];
    const unionIds = [...new Set(parentUnionOfLocalField.values())];

    const rows = new Map<number, AnnualRankingTerritorySummaryRowDto>(
      children.map((c) => [
        c.id,
        { id: c.id, name: c.name, clubs_count: 0, configured: false },
      ]),
    );
    if (localFieldIds.length === 0) return [...rows.values()];

    const [configs, sections] = await Promise.all([
      this.prisma.annual_ranking_configs.findMany({
        where: {
          active: true,
          ecclesiastical_year_id: yearId,
          OR: [
            { local_field_id: { in: localFieldIds } },
            { union_id: { in: unionIds }, local_field_id: null },
          ],
        },
        select: { union_id: true, local_field_id: true },
      }),
      this.prisma.club_sections.findMany({
        where: {
          active: true,
          clubs: { active: true, local_field_id: { in: localFieldIds } },
        },
        select: { clubs: { select: { club_id: true, local_field_id: true } } },
      }),
    ]);

    // A union-level config is inherited by every local field of that union.
    for (const config of configs) {
      const configuredLocalFields =
        config.local_field_id !== null
          ? [config.local_field_id]
          : localFieldIds.filter(
              (id) => parentUnionOfLocalField.get(id) === config.union_id,
            );
      for (const lfId of configuredLocalFields) {
        const row = rows.get(childOfLocalField.get(lfId) as number);
        if (row) row.configured = true;
      }
    }

    const clubsByChild = new Map<number, Set<number>>();
    for (const { clubs } of sections) {
      if (!clubs) continue;
      const childId = childOfLocalField.get(clubs.local_field_id);
      if (childId === undefined) continue;
      if (!clubsByChild.has(childId)) clubsByChild.set(childId, new Set());
      clubsByChild.get(childId)?.add(clubs.club_id);
    }
    for (const [childId, row] of rows) {
      row.clubs_count = clubsByChild.get(childId)?.size ?? 0;
    }

    return [...rows.values()];
  }
}
