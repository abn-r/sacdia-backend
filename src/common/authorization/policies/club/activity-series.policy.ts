import type { PrismaService } from '../../../../prisma/prisma.service';
import { AppNotFoundException } from '../../../errors/app.exception';
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

export class ActivitySeriesPolicy implements ResourcePolicy<'activity_series'> {
  readonly type = 'activity_series' as const;

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
    const seriesScope = await this.resolveActivitySeriesScope(
      request,
      resource,
    );
    if ('participatingSectionIds' in seriesScope) {
      return this.scopes.validateJointActivityScope(
        userId,
        resolved,
        seriesScope,
      );
    }
    return this.scopes.validateInstanceScope(userId, resolved, seriesScope);
  }

  private async resolveActivitySeriesScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope | ResolvedJointActivityScope> {
    const seriesId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'seriesId'),
      'Activity series ID not found in request',
    );

    const series = await this.prisma.activity_series.findUnique({
      where: { activity_series_id: seriesId },
      select: {
        is_joint: true,
        club_id: true,
        club_section_id: true,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
        activity_series_sections: {
          select: { club_section_id: true },
        },
      },
    });

    if (!series) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_SERIES_NOT_FOUND);
    }

    const participatingSectionIds = series.activity_series_sections.map(
      (row) => row.club_section_id,
    );

    if (series.is_joint || participatingSectionIds.length > 1) {
      return {
        mainClubId: series.club_id,
        participatingSectionIds:
          participatingSectionIds.length > 0
            ? participatingSectionIds
            : series.club_section_id
              ? [series.club_section_id]
              : [],
      };
    }

    return buildInstanceScopeFromSection(series.club_sections);
  }
}
