import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type ActorSectionScope,
  clubSectionScopeWhere,
} from './actor-section-scope';
import { ActorScope } from './actor-scope';
import {
  COORDINATOR_ROLES,
  DIVISION_ROLES,
  LOCAL_FIELD_ROLES,
  UNION_ROLES,
} from './role-sets';
import { ClubRole, GlobalRole } from './roles';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { EcclesiasticalYearService } from '../services/ecclesiastical-year.service';
import { CoordinationService } from '../../coordination/coordination.service';
import { pastorCanAuthorize } from '../../investiture-requests/investiture-pastor-eligibility';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * One way an actor reaches a person or a club section: the role that grants it
 * and the club sections that role covers. `reviewer_role` is the first channel
 * (in the order below) that covers the target.
 */
export type ReviewChannel = { role: string; scope: ActorSectionScope };

export type ReviewerScopeOptions = {
  /** Roles that review everywhere, no territory needed (checked in order). */
  everywhere: readonly string[];
  /** Also open a union channel and a division channel (director-union, director-dia...). */
  includeUnionDivision?: boolean;
};

/**
 * Who a reviewer may reach for one review permission. A role only counts when
 * it carries that permission. Channels, in priority order:
 *  - `everywhere` roles (admin, super-admin...): all sections;
 *  - Local Field (director-lf, assistant-lf): clubs of their local field;
 *  - Union / Division roles (only with `includeUnionDivision`): clubs of
 *    their union / division;
 *  - coordinators: sections of their active coordinator assignments;
 *  - pastor: clubs of the districts they are assigned to
 *    (`district_investiture_pastors`) while they are an eligible pastor.
 *
 * Reusable by any review that decides over club sections or the people in them
 * (counselor credentials, annual enrollments). It adds no club-assignment
 * predicate of its own.
 */
@Injectable()
export class ReviewerScopeService {
  protected readonly logger = new Logger(ReviewerScopeService.name);

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly authorizationContext: AuthorizationContextService,
    protected readonly coordination: CoordinationService,
    protected readonly ecclesiasticalYear: EcclesiasticalYearService,
  ) {}

  async resolveReviewerChannels(
    actorId: string,
    permission: string,
    options: ReviewerScopeOptions,
  ): Promise<ReviewChannel[]> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorId);
    const reviewerRoles = new Set(
      resolved.authorization.grants.global_roles
        .filter((grant) => grant.permissions.includes(permission))
        .map((grant) => grant.role_name.trim().toLowerCase()),
    );
    const held = (names: readonly string[]) =>
      names.find((name) => reviewerRoles.has(name));

    const everywhere = held(options.everywhere);
    if (everywhere) {
      return [{ role: everywhere, scope: { all: true } }];
    }

    const channels: ReviewChannel[] = [];
    const actor = ActorScope.from(resolved);

    const localFieldRole = held(LOCAL_FIELD_ROLES);
    const localFieldId = actor.localFieldId;
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

    if (options.includeUnionDivision) {
      const unionRole = held(UNION_ROLES);
      const { unionId, divisionId } = actor.territory;
      if (unionRole && unionId !== undefined) {
        channels.push({
          role: unionRole,
          scope: {
            all: false,
            sectionIds: [],
            clubs: { local_fields: { union_id: unionId } },
          },
        });
      }
      const divisionRole = held(DIVISION_ROLES);
      if (divisionRole && divisionId !== undefined) {
        channels.push({
          role: divisionRole,
          scope: {
            all: false,
            sectionIds: [],
            clubs: { local_fields: { unions: { division_id: divisionId } } },
          },
        });
      }
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

  /** `club_sections` filter for the combined scope. No channel matches nothing. */
  sectionsWhere(channels: ReviewChannel[]): Prisma.club_sectionsWhereInput {
    const scope = this.combinedScope(channels);
    if (!scope) return { club_section_id: { in: [] } };
    return clubSectionScopeWhere(scope);
  }

  /**
   * The role through which the actor reaches `sectionId`, or null when the
   * section is out of scope (or does not exist).
   */
  async findReviewerRoleForSection(
    channels: ReviewChannel[],
    sectionId: number,
  ): Promise<string | null> {
    for (const channel of channels) {
      if (channel.scope.all) return channel.role;
      const count = await this.prisma.club_sections.count({
        where: {
          AND: [
            { club_section_id: sectionId },
            clubSectionScopeWhere(channel.scope),
          ],
        },
      });
      if (count > 0) return channel.role;
    }
    return null;
  }

  /**
   * True when `userId` holds an active club role assignment other than
   * `member` in that club section and ecclesiastical year. A reviewer in that
   * position is part of the section and must not decide on it.
   */
  async holdsClubRoleInSection(
    userId: string,
    sectionId: number,
    yearId: number,
  ): Promise<boolean> {
    const count = await this.prisma.club_role_assignments.count({
      where: {
        user_id: userId,
        club_section_id: sectionId,
        ecclesiastical_year_id: yearId,
        active: true,
        status: 'active',
        roles: { role_name: { not: ClubRole.MEMBER } },
      },
    });
    return count > 0;
  }

  protected async currentYearId(): Promise<number | null> {
    try {
      return (await this.ecclesiasticalYear.getCurrentYear()).year_id;
    } catch (error) {
      // No current year configured: judge the scope by the active assignment alone.
      this.logger.warn(
        `No current ecclesiastical year for review scope: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
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
}
