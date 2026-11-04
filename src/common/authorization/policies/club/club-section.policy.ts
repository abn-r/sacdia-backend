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
} from '../scope/instance-scope';

export class ClubSectionPolicy implements ResourcePolicy<'club_section'> {
  readonly type = 'club_section' as const;

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
      await this.resolveClubSectionScope(request, resource),
      this.scopes.coordinatorSectionsCheck(resolved, requirement, resource),
      request,
    );
  }

  private async resolveClubSectionScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const sectionId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'sectionId'),
      'Club section ID not found in request',
    );
    const expectedClubIdValue = getRequestValue(
      request,
      'param',
      resource.clubIdParam ?? 'clubId',
    );
    const expectedClubId =
      expectedClubIdValue === undefined || expectedClubIdValue === null
        ? null
        : getRequiredNumericValue(
            expectedClubIdValue,
            'Club ID not found in request',
          );

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { club_section_id: true, main_club_id: true, club_type_id: true },
    });

    if (
      !section ||
      (expectedClubId !== null && section.main_club_id !== expectedClubId)
    ) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    return buildInstanceScopeFromSection(section);
  }
}
