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

export class FinancePolicy implements ResourcePolicy<'finance'> {
  readonly type = 'finance' as const;

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
      await this.resolveFinanceScope(request, resource),
    );
  }

  private async resolveFinanceScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const financeId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'financeId'),
      'Finance ID not found in request',
    );

    const finance = await this.prisma.finances.findUnique({
      where: { finance_id: financeId },
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

    if (!finance) {
      throw new AppNotFoundException(ErrorCode.FINANCE_TRANSACTION_NOT_FOUND);
    }

    return buildInstanceScopeFromSection(finance.club_sections);
  }
}
