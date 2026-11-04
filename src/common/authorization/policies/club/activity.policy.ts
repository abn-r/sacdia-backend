import type { PrismaService } from '../../../../prisma/prisma.service';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import type { AuthorizationResourceMetadata } from '../../../decorators/authorization-resource.decorator';
import { getRequestValue, getRequiredNumericValue } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import {
  buildInstanceScopeFromSection,
  type InstanceScopeValidator,
  type ResolvedInstanceScope,
  type ResolvedJointActivityScope,
} from '../scope/instance-scope';

export class ActivityPolicy implements ResourcePolicy<'activity'> {
  readonly type = 'activity' as const;

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
    const activityScopeResult = await this.resolveActivityScope(
      request,
      resource,
    );
    if ('participatingSectionIds' in activityScopeResult) {
      return this.scopes.validateJointActivityScope(
        userId,
        resolved,
        activityScopeResult,
      );
    }
    return this.scopes.validateInstanceScope(
      userId,
      resolved,
      activityScopeResult,
    );
  }

  private async resolveActivityScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope | ResolvedJointActivityScope> {
    const activityId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'activityId'),
      'Activity ID not found in request',
    );

    const activity = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      select: {
        is_joint: true,
        club_section_id: true,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
        activity_instances: {
          where: { active: true },
          select: {
            club_section_id: true,
            club_sections: {
              select: {
                club_section_id: true,
                main_club_id: true,
              },
            },
          },
        },
      },
    });

    if (!activity) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_NOT_FOUND);
    }

    // For joint activities, resolve authorization using all participating sections
    if (activity.is_joint) {
      const mainClubId = activity.club_sections?.main_club_id;

      if (!mainClubId) {
        throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
      }

      const participatingSectionIds = activity.activity_instances
        .map((instance) => instance.club_section_id)
        .filter((id): id is number => id !== null);

      return {
        mainClubId,
        participatingSectionIds,
      };
    }

    return buildInstanceScopeFromSection(activity.club_sections);
  }
}
