import type { PrismaService } from '../../../../prisma/prisma.service';
import { AppNotFoundException } from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import type { AuthorizationResourceMetadata } from '../../../decorators/authorization-resource.decorator';
import { getRequestValue, getRequiredNumericValue } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import type {
  AssignmentEffectivity,
  InstanceScopeValidator,
  ResolvedInstanceScope,
} from '../scope/instance-scope';
import { resolveMemberAssignmentScopes } from './member-assignment-scopes';

export class InsuranceRecordPolicy implements ResourcePolicy<'insurance_record'> {
  readonly type = 'insurance_record' as const;

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
      await this.resolveInsuranceRecordScopes(request, resource),
    );
  }

  private async resolveInsuranceRecordScopes(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope[]> {
    const insuranceId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'insuranceId'),
      'Insurance ID not found in request',
    );

    const insurance = await this.prisma.member_insurances.findUnique({
      where: { insurance_id: insuranceId },
      select: { user_id: true },
    });

    if (!insurance) {
      throw new AppNotFoundException(ErrorCode.INSURANCE_NOT_FOUND);
    }

    return resolveMemberAssignmentScopes(
      this.prisma,
      this.effectivity,
      insurance.user_id,
    );
  }
}
