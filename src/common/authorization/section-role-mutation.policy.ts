import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppForbiddenException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { ClubRole } from './roles';

export type SectionRoleMutation = 'assign' | 'update' | 'revoke';

export type SectionRoleMutationInput = {
  actorUserId: string;
  clubSectionId: number;
  targetRoleName: string;
  targetUserId: string;
  mutation: SectionRoleMutation;
};

/**
 * Exact-authority gate for club role mutations. Role names are compared
 * literally: no aliases, no hierarchy inheritance. Membership flows
 * (`member`) keep their own gates.
 */
@Injectable()
export class SectionRoleMutationPolicy {
  constructor(
    private readonly authorizationContext: AuthorizationContextService,
    private readonly prisma: PrismaService,
  ) {}

  async assertCanMutate(input: SectionRoleMutationInput): Promise<void> {
    if (input.targetRoleName === ClubRole.MEMBER) return;

    const resolved = await this.authorizationContext.resolveUserAuthorization(
      input.actorUserId,
    );
    const { grants, effective } = resolved.authorization;
    const globalRoles = new Set(grants.global_roles.map((g) => g.role_name));

    if (globalRoles.has('super-admin') || globalRoles.has('admin')) return;

    if (globalRoles.has('director-lf') || globalRoles.has('assistant-lf')) {
      const actorLocalFieldId = effective.scope.global.local_field?.id;
      if (actorLocalFieldId !== undefined && actorLocalFieldId !== null) {
        const section = await this.prisma.club_sections.findUnique({
          where: { club_section_id: input.clubSectionId },
          select: { clubs: { select: { local_field_id: true } } },
        });
        const sectionLocalFieldId = section?.clubs?.local_field_id;
        if (
          sectionLocalFieldId !== undefined &&
          sectionLocalFieldId !== null &&
          Number(actorLocalFieldId) === sectionLocalFieldId
        )
          return;
      }
    }

    const isSectionDirector = grants.club_assignments.some(
      (g) =>
        g.operational === true &&
        g.role_name === ClubRole.DIRECTOR &&
        g.section.club_section_id === input.clubSectionId,
    );
    if (
      isSectionDirector &&
      input.targetUserId !== input.actorUserId &&
      input.targetRoleName !== ClubRole.DIRECTOR
    )
      return;

    throw new AppForbiddenException(ErrorCode.CLUB_ROLE_MUTATION_FORBIDDEN);
  }
}
