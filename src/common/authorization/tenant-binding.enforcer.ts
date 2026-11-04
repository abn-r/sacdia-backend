import type { PrismaService } from '../../prisma/prisma.service';
import {
  AppForbiddenException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import type { AuthorizationResourceMetadata } from '../decorators/authorization-resource.decorator';
import type {
  AuthorizationContextService,
  ResolvedAuthorizationProfile,
} from '../services/authorization-context.service';
import { assertClubAccess } from './policies/scope/club-access';
import {
  getRequestValue,
  parseEntityUuid,
  parseTenantId,
  requireMainClubId,
} from './policies/request-values';
import type { PolicyContext } from './policies/resource-policy';
import type {
  CamporeeScopeLoader,
  TerritoryScopeValidator,
} from './policies/scope/territory-scope';

/**
 * Binds the tenant identifiers a route accepts (`resource.bind`) to the
 * actor's own scope. Runs for owners too, and after the resource policy.
 */
export class TenantBindingEnforcer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly territory: TerritoryScopeValidator,
    private readonly loader: CamporeeScopeLoader,
  ) {}

  async enforce(ctx: PolicyContext): Promise<void> {
    const { userId, request, resolved, resource } = ctx;
    for (const binding of resource.bind ?? []) {
      const rawValue = getRequestValue(request, binding.source, binding.field);

      if (rawValue === undefined || rawValue === null || rawValue === '') {
        if (binding.optional) {
          continue;
        }
        throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
      }

      if (binding.kind === 'club_enrollment_territory') {
        await this.assertClubEnrollmentTerritoryAccess(
          userId,
          parseEntityUuid(rawValue),
        );
        continue;
      }

      const tenantId = parseTenantId(rawValue);

      switch (binding.kind) {
        case 'club':
          await assertClubAccess(
            this.authorizationContext,
            userId,
            resolved,
            tenantId,
          );
          break;
        case 'club_section':
          await this.assertClubSectionAccess(
            userId,
            request,
            resolved,
            resource,
            tenantId,
          );
          break;
        case 'local_field':
          this.territory.assertHierarchyAccess(
            resolved,
            await this.territory.loadHierarchyScope({ localFieldId: tenantId }),
          );
          break;
        case 'union':
          this.territory.assertHierarchyAccess(
            resolved,
            await this.territory.loadHierarchyScope({ unionId: tenantId }),
          );
          break;
        case 'camporee':
          this.territory.validateTerritoryScope(
            resolved,
            await this.loader.loadCamporeeScope(tenantId),
          );
          break;
        case 'union_camporee':
          this.territory.assertUnionCamporeeOwnerScope(
            resolved,
            await this.loader.loadUnionCamporeeScope(tenantId),
          );
          break;
        default: {
          const _exhaustive: never = binding.kind;
          void _exhaustive;
          throw new AppInternalServerErrorException(
            ErrorCode.GUARD_RBAC_MISCONFIGURATION,
          );
        }
      }
    }
  }

  /**
   * A bound section must belong to the route's club (when the route carries
   * one) and the actor must be able to act on that club.
   */
  private async assertClubSectionAccess(
    userId: string,
    request: any,
    resolved: ResolvedAuthorizationProfile,
    resource: AuthorizationResourceMetadata,
    sectionId: number,
  ): Promise<void> {
    const routeClubIdValue = getRequestValue(
      request,
      'param',
      resource.clubIdParam ?? 'clubId',
    );
    const routeClubId =
      routeClubIdValue === undefined || routeClubIdValue === null
        ? null
        : parseTenantId(routeClubIdValue);

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { club_section_id: true, main_club_id: true },
    });

    if (
      !section ||
      (routeClubId !== null && section.main_club_id !== routeClubId)
    ) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    const mainClubId = requireMainClubId(
      section.main_club_id,
      'Club section without main club',
    );

    await assertClubAccess(
      this.authorizationContext,
      userId,
      resolved,
      mainClubId,
    );
  }

  /**
   * Resolves a club enrollment UUID to its club and requires the actor's
   * territory to cover it (Campo Local review). An active club assignment
   * does not qualify: a club cannot approve its own enrollment.
   */
  private async assertClubEnrollmentTerritoryAccess(
    userId: string,
    enrollmentId: string,
  ): Promise<void> {
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      select: { club_section: { select: { main_club_id: true } } },
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.CE_ENROLLMENT_NOT_FOUND);
    }

    const mainClubId = requireMainClubId(
      enrollment.club_section?.main_club_id,
      'Club enrollment section without main club',
    );

    if (!(await this.authorizationContext.canManageClub(userId, mainClubId))) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }
  }
}
