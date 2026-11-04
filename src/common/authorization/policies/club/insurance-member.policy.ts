import type { PrismaService } from '../../../../prisma/prisma.service';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import type { AuthorizationResourceMetadata } from '../../../decorators/authorization-resource.decorator';
import { getOptionalUuidValue, getRequestValue } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import type {
  AssignmentEffectivity,
  InstanceScopeValidator,
  ResolvedInstanceScope,
} from '../scope/instance-scope';
import { resolveMemberAssignmentScopes } from './member-assignment-scopes';

export class InsuranceMemberPolicy implements ResourcePolicy<'insurance_member'> {
  readonly type = 'insurance_member' as const;

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
    return this.scopes.validateAnyInstanceScope(
      userId,
      resolved,
      await this.resolveInsuranceMemberScopes(request, resource),
    );
  }

  private async resolveInsuranceMemberScopes(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope[]> {
    const memberId = getOptionalUuidValue(
      getRequestValue(request, 'param', resource.idParam ?? 'memberId'),
    );

    if (!memberId) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    const member = await this.prisma.users.findUnique({
      where: { user_id: memberId },
      select: { user_id: true },
    });

    if (!member) {
      throw new AppNotFoundException(ErrorCode.INSURANCE_MEMBER_NOT_FOUND);
    }

    return resolveMemberAssignmentScopes(
      this.prisma,
      this.effectivity,
      memberId,
    );
  }
}
