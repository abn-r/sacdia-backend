import { Injectable } from '@nestjs/common';
import {
  type ActorSectionScope,
  type ActorSectionScopePermissions,
  activeMembershipInScopeWhere,
  actorHasCoordinatorPermission,
  buildActorSectionScope,
  clubSectionScopeWhere,
  isActorSectionScopeEmpty,
} from '../common/authorization/actor-section-scope';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CoordinationService } from './coordination.service';

/**
 * Resolves which club sections an actor may review/manage and answers
 * membership questions against that scope. Lives next to CoordinationService
 * because coordinator-assigned sections are part of the scope.
 */
@Injectable()
export class ActorSectionScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly coordinationService: CoordinationService,
  ) {}

  async resolve(
    actorId: string,
    permissions: ActorSectionScopePermissions,
  ): Promise<ActorSectionScope> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorId);
    const coordinatorSectionIds = actorHasCoordinatorPermission(
      resolved,
      permissions.global,
    )
      ? await this.coordinationService.getEffectiveCoordinatorSectionIds(
          actorId,
        )
      : [];

    return buildActorSectionScope(resolved, permissions, coordinatorSectionIds);
  }

  /** The club section belongs to the scope. Unknown sections are outside. */
  async includesSection(
    scope: ActorSectionScope,
    clubSectionId: number,
  ): Promise<boolean> {
    if (scope.all) {
      return true;
    }
    if (scope.sectionIds.includes(clubSectionId)) {
      return true;
    }
    if (scope.clubs === null) {
      return false;
    }

    const count = await this.prisma.club_sections.count({
      where: {
        AND: [{ club_section_id: clubSectionId }, clubSectionScopeWhere(scope)],
      },
    });
    return count > 0;
  }

  /** The user holds an active club assignment inside the scope. */
  async includesMember(
    scope: ActorSectionScope,
    userId: string,
  ): Promise<boolean> {
    if (scope.all) {
      return true;
    }
    if (isActorSectionScopeEmpty(scope)) {
      return false;
    }

    const count = await this.prisma.club_role_assignments.count({
      where: { user_id: userId, ...activeMembershipInScopeWhere(scope) },
    });
    return count > 0;
  }
}
