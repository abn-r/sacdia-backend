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

export class ClassCounselorAssignmentPolicy implements ResourcePolicy<'class_counselor_assignment'> {
  readonly type = 'class_counselor_assignment' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: InstanceScopeValidator,
  ) {}

  async resolve({
    userId,
    request,
    resolved,
    resource,
  }: PolicyContext): Promise<boolean> {
    return this.scopes.validateInstanceScope(
      userId,
      resolved,
      await this.resolveClassCounselorAssignmentScope(request, resource),
    );
  }

  private async resolveClassCounselorAssignmentScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const assignmentId = getOptionalUuidValue(
      getRequestValue(request, 'param', resource.idParam ?? 'assignmentId'),
    );

    if (!assignmentId) {
      throw new AppForbiddenException(ErrorCode.GUARD_ASSIGNMENT_SCOPE_INVALID);
    }

    const assignment = await (
      this.prisma as any
    ).class_counselor_assignments.findUnique({
      where: { assignment_id: assignmentId },
      select: {
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
      throw new AppNotFoundException(
        ErrorCode.CLASS_COUNSELOR_ASSIGNMENT_NOT_FOUND,
      );
    }

    return buildInstanceScopeFromSection(assignment.club_sections);
  }
}
