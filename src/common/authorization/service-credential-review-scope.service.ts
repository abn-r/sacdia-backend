import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type ActorSectionScope,
  activeMembershipInScopeWhere,
} from './actor-section-scope';
import { ActorScope } from './actor-scope';
import { COORDINATOR_ROLES, LOCAL_FIELD_ROLES } from './role-sets';
import { GlobalRole } from './roles';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { EcclesiasticalYearService } from '../services/ecclesiastical-year.service';
import { CoordinationService } from '../../coordination/coordination.service';
import { pastorCanAuthorize } from '../../investiture-requests/investiture-pastor-eligibility';
import { PrismaService } from '../../prisma/prisma.service';
import { SERVICE_CREDENTIAL_PERMISSION } from '../../service-credentials/service-credentials.constants';

/**
 * One way an actor reaches a person: the role that grants it and the club
 * sections that role covers. `reviewer_role` is the first channel (in the
 * order below) that covers the person.
 */
export type ReviewChannel = { role: string; scope: ActorSectionScope };

const MATCH_NOTHING: Prisma.service_credentialsWhereInput = {
  credential_id: { in: [] },
};

/**
 * Who a reviewer of counselor credentials may see.
 *
 * Scope = the credential owner holds an active club assignment (any role,
 * current ecclesiastical year) in a club section the reviewer covers:
 *  - admin / super-admin: everyone, no assignment needed;
 *  - Local Field (director-lf, assistant-lf): clubs of their local field;
 *  - coordinators: sections of their active coordinator assignments;
 *  - pastor: clubs of the districts they are assigned to
 *    (`district_investiture_pastors`) while they are an eligible pastor.
 * The membership predicate is `activeMembershipInScopeWhere` (the one the
 * role-request and consent reviews use); this service adds no assignment
 * predicate of its own.
 */
@Injectable()
export class ServiceCredentialReviewScopeService {
  private readonly logger = new Logger(
    ServiceCredentialReviewScopeService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly coordination: CoordinationService,
    private readonly ecclesiasticalYear: EcclesiasticalYearService,
  ) {}

  /** Channels in priority order: admin, Local Field, coordinator, pastor. */
  async resolveChannels(actorId: string): Promise<ReviewChannel[]> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorId);
    // A role only counts when it carries the review permission.
    const reviewerRoles = new Set(
      resolved.authorization.grants.global_roles
        .filter((grant) =>
          grant.permissions.includes(SERVICE_CREDENTIAL_PERMISSION),
        )
        .map((grant) => grant.role_name.trim().toLowerCase()),
    );
    const held = (names: readonly string[]) =>
      names.find((name) => reviewerRoles.has(name));

    const everywhere = held([GlobalRole.SUPER_ADMIN, GlobalRole.ADMIN]);
    if (everywhere) {
      return [{ role: everywhere, scope: { all: true } }];
    }

    const channels: ReviewChannel[] = [];

    const localFieldRole = held(LOCAL_FIELD_ROLES);
    const localFieldId = ActorScope.from(resolved).localFieldId;
    if (localFieldRole && localFieldId !== undefined) {
      channels.push({
        role: localFieldRole,
        scope: {
          all: false,
          sectionIds: [],
          clubs: { local_field_id: localFieldId },
        },
      });
    }

    const coordinatorRole = held(COORDINATOR_ROLES);
    if (coordinatorRole) {
      const sectionIds =
        await this.coordination.getEffectiveCoordinatorSectionIds(actorId);
      if (sectionIds.length > 0) {
        channels.push({
          role: coordinatorRole,
          scope: { all: false, sectionIds, clubs: null },
        });
      }
    }

    if (held([GlobalRole.PASTOR])) {
      const districtIds = await this.pastorDistrictIds(actorId);
      if (districtIds.length > 0) {
        channels.push({
          role: GlobalRole.PASTOR,
          scope: {
            all: false,
            sectionIds: [],
            clubs: { districlub_type_id: { in: districtIds } },
          },
        });
      }
    }
    return channels;
  }

  /** Every channel merged into one section scope (for lists and counts). */
  combinedScope(channels: ReviewChannel[]): ActorSectionScope | null {
    if (channels.length === 0) return null;
    if (channels.some((channel) => channel.scope.all)) return { all: true };
    const sectionIds = new Set<number>();
    const clubs: Prisma.clubsWhereInput[] = [];
    for (const { scope } of channels) {
      if (scope.all) continue;
      scope.sectionIds.forEach((id) => sectionIds.add(id));
      if (scope.clubs) clubs.push(scope.clubs);
    }
    return {
      all: false,
      sectionIds: [...sectionIds].sort((a, b) => a - b),
      clubs:
        clubs.length === 0
          ? null
          : clubs.length === 1
            ? clubs[0]
            : { OR: clubs },
    };
  }

  /** `service_credentials` filter: the owner is inside the combined scope. */
  async ownerInScopeWhere(
    channels: ReviewChannel[],
  ): Promise<Prisma.service_credentialsWhereInput> {
    const scope = this.combinedScope(channels);
    if (!scope) return MATCH_NOTHING;
    if (scope.all) return {};
    const yearId = await this.currentYearId();
    return {
      owner: {
        club_role_assignments: {
          some: {
            ...activeMembershipInScopeWhere(scope),
            ...(yearId === null ? {} : { ecclesiastical_year_id: yearId }),
          },
        },
      },
    };
  }

  /** Assignment filter used to name the club a person is reviewed through. */
  async membershipWhere(
    channels: ReviewChannel[],
  ): Promise<Prisma.club_role_assignmentsWhereInput | null> {
    const scope = this.combinedScope(channels);
    if (!scope) return null;
    const yearId = await this.currentYearId();
    return {
      ...activeMembershipInScopeWhere(scope),
      ...(yearId === null ? {} : { ecclesiastical_year_id: yearId }),
    };
  }

  /**
   * The role through which the actor reaches `ownerId`, or null when the
   * person is out of scope. Admin / super-admin reach everyone.
   */
  async findReviewerRole(
    channels: ReviewChannel[],
    ownerId: string,
  ): Promise<string | null> {
    const yearId = await this.currentYearId();
    for (const channel of channels) {
      if (channel.scope.all) return channel.role;
      const count = await this.prisma.club_role_assignments.count({
        where: {
          user_id: ownerId,
          ...activeMembershipInScopeWhere(channel.scope),
          ...(yearId === null ? {} : { ecclesiastical_year_id: yearId }),
        },
      });
      if (count > 0) return channel.role;
    }
    return null;
  }

  private async pastorDistrictIds(actorId: string): Promise<number[]> {
    const rows = await this.prisma.district_investiture_pastors.findMany({
      where: { user_id: actorId, active: true },
      select: { districlub_type_id: true },
    });
    if (
      rows.length === 0 ||
      !(await pastorCanAuthorize(this.prisma, actorId))
    ) {
      return [];
    }
    return rows.map((row) => row.districlub_type_id);
  }

  private async currentYearId(): Promise<number | null> {
    try {
      return (await this.ecclesiasticalYear.getCurrentYear()).year_id;
    } catch (error) {
      // No current year configured: judge the scope by the active assignment alone.
      this.logger.warn(
        `No current ecclesiastical year for credential review scope: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
