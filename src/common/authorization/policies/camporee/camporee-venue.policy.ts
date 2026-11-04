import type { PrismaService } from '../../../../prisma/prisma.service';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import type { InstitutionalHierarchyService } from '../../../services/institutional-hierarchy.service';
import { getRequestValue, getRequiredNumericValue } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import type {
  ResolvedTerritoryScope,
  ResolvedUnionCamporeeScope,
  TerritoryScopeValidator,
} from '../scope/territory-scope';

type VenueScope =
  | { type: 'local_field'; scope: ResolvedTerritoryScope }
  | { type: 'union'; scope: ResolvedUnionCamporeeScope };

/**
 * Resolves territory/union scope for a camporee venue.
 *
 * - PATCH/DELETE /camporee-venues/:venueId → looks up the venue row by id
 *   and returns its `union_id` (union scope) xor `local_field_id`
 *   (local_field scope).
 * - POST /camporee-venues (generic create) → no `idParam` and no row exists
 *   yet, so the scope is read from the request body (`scope` +
 *   `union_id` | `local_field_id`).
 *
 * Note: the camporee-scoped POST endpoints (POST
 * /local-camporees/:id/venues and POST /union-camporees/:id/venues) are
 * still authorized via `camporee` / `union_camporee` resource types —
 * those derive the scope from the parent camporee row.
 */
export class CamporeeVenuePolicy implements ResourcePolicy<'camporee_venue'> {
  readonly type = 'camporee_venue' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hierarchy: InstitutionalHierarchyService,
    private readonly territory: TerritoryScopeValidator,
  ) {}

  async resolve({ request, resolved, resource }: PolicyContext) {
    const venueScope = await this.resolveCamporeeVenueScope(request, resource);
    if (venueScope.type === 'local_field') {
      return this.territory.validateTerritoryScope(resolved, venueScope.scope);
    } else {
      return this.territory.validateUnionCamporeeScope(
        resolved,
        venueScope.scope,
      );
    }
  }

  private async resolveCamporeeVenueScope(
    request: any,
    resource: PolicyContext['resource'],
  ): Promise<VenueScope> {
    // Case 1: mutation by id (PATCH/DELETE).
    const rawId = getRequestValue(
      request,
      'param',
      resource.idParam ?? 'venueId',
    );

    if (rawId !== undefined && rawId !== null && rawId !== '') {
      const venueId = getRequiredNumericValue(
        rawId,
        'Venue ID not found in request',
      );

      const venue = await this.prisma.camporee_venues.findUnique({
        where: { camporee_venue_id: venueId },
        select: {
          scope: true,
          union_id: true,
          local_field_id: true,
        },
      });

      if (!venue) {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_VENUE_NOT_FOUND);
      }

      return this.buildCamporeeVenueScopeFromRow(venue);
    }

    // Case 2: create via generic POST — read from body.
    const body = request.body ?? {};
    return this.buildCamporeeVenueScopeFromRow({
      scope: body.scope,
      union_id: body.union_id ?? null,
      local_field_id: body.local_field_id ?? null,
    });
  }

  async buildCamporeeVenueScopeFromRow(venue: {
    scope: string | null | undefined;
    union_id: number | null | undefined;
    local_field_id: number | null | undefined;
  }): Promise<VenueScope> {
    if (venue.scope === 'union') {
      if (typeof venue.union_id !== 'number') {
        throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
      }

      const union = await this.prisma.unions.findUnique({
        where: { union_id: venue.union_id },
        select: { country_id: true },
      });

      const hierarchy = await this.hierarchy.resolveCurrent({
        unionId: venue.union_id,
      });

      return {
        type: 'union',
        scope: {
          unionId: venue.union_id,
          divisionId: hierarchy.division_id,
          countryId: union?.country_id ?? null,
        },
      };
    }

    if (venue.scope === 'local_field') {
      if (typeof venue.local_field_id !== 'number') {
        throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
      }

      const localField = await this.prisma.local_fields.findUnique({
        where: { local_field_id: venue.local_field_id },
        select: {
          union_id: true,
          unions: { select: { country_id: true } },
        },
      });

      const hierarchy = await this.hierarchy.resolveCurrent({
        localFieldId: venue.local_field_id,
      });

      return {
        type: 'local_field',
        scope: {
          localFieldId: venue.local_field_id,
          unionId: hierarchy.union_id ?? localField?.union_id ?? null,
          divisionId: hierarchy.division_id,
          countryId: localField?.unions?.country_id ?? null,
        },
      };
    }

    // Unknown / missing scope on the row or in the body → reject.
    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }
}
