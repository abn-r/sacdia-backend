import type { PrismaService } from '../../../../prisma/prisma.service';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import type { AuthorizationResourceMetadata } from '../../../decorators/authorization-resource.decorator';
import { getOptionalUuidValue, getRequestValue } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import {
  buildInstanceScopeFromSection,
  type InstanceScopeValidator,
  type ResolvedInstanceScope,
} from '../scope/instance-scope';

export class ClubAssignmentPolicy implements ResourcePolicy<'club_assignment'> {
  readonly type = 'club_assignment' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: InstanceScopeValidator,
  ) {}

  async resolve({
    userId,
    request,
    resolved,
    requirement,
    resource,
  }: PolicyContext): Promise<boolean> {
    return this.scopes.validateInstanceScope(
      userId,
      resolved,
      await this.resolveClubAssignmentScope(request, resource),
      this.scopes.coordinatorSectionsCheck(resolved, requirement, resource),
      request,
    );
  }

  private async resolveClubAssignmentScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const assignmentId = getOptionalUuidValue(
      getRequestValue(request, 'param', resource.idParam ?? 'assignmentId'),
    );

    if (!assignmentId) {
      throw new AppForbiddenException(ErrorCode.GUARD_ASSIGNMENT_SCOPE_INVALID);
    }

    const assignment = await this.prisma.club_role_assignments.findUnique({
      where: { assignment_id: assignmentId },
      select: {
        club_section_id: true,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new AppNotFoundException(ErrorCode.GUARD_ASSIGNMENT_NOT_FOUND);
    }

    return buildInstanceScopeFromSection(assignment.club_sections);
  }
}
