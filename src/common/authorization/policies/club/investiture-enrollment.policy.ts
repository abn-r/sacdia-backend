import type { PrismaService } from '../../../../prisma/prisma.service';
import { AppNotFoundException } from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import type { AuthorizationResourceMetadata } from '../../../decorators/authorization-resource.decorator';
import {
  CLUB_ASSIGNMENT_LOCAL_FIELD_SELECT,
  CLUB_ASSIGNMENT_TEMPORAL_FIELDS,
} from '../../club-assignment-temporal';
import { getRequestValue, getRequiredNumericValue } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import {
  buildInstanceScopeFromSection,
  type AssignmentEffectivity,
  type InstanceScopeValidator,
  type ResolvedInstanceScope,
} from '../scope/instance-scope';

export class InvestitureEnrollmentPolicy implements ResourcePolicy<'investiture_enrollment'> {
  readonly type = 'investiture_enrollment' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: InstanceScopeValidator,
    private readonly effectivity: AssignmentEffectivity,
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
      await this.resolveInvestitureEnrollmentScope(request, resource),
    );
  }

  private async resolveInvestitureEnrollmentScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const enrollmentId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'enrollmentId'),
      'Investiture enrollment ID not found in request',
    );

    const enrollment = await this.prisma.enrollments.findFirst({
      where: { enrollment_id: enrollmentId, active: true },
      select: {
        user_id: true,
        ecclesiastical_year_id: true,
        classes: { select: { club_type_id: true } },
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      );
    }

    const assignments = await this.prisma.club_role_assignments.findMany({
      where: {
        user_id: enrollment.user_id,
        active: true,
        status: 'active',
        ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
        club_sections: {
          club_type_id: enrollment.classes.club_type_id,
        },
      },
      select: {
        active: true,
        status: true,
        ...CLUB_ASSIGNMENT_TEMPORAL_FIELDS,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
            clubs:
              CLUB_ASSIGNMENT_LOCAL_FIELD_SELECT.club_sections.select.clubs,
          },
        },
      },
    });
    const assignment = assignments.find((candidate) =>
      this.effectivity.isAssignmentEffective(candidate),
    );

    return buildInstanceScopeFromSection(assignment?.club_sections ?? null);
  }
}
