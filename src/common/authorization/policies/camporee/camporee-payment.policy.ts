import type { PrismaService } from '../../../../prisma/prisma.service';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import { getRequestValue, parseEntityUuid } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import type {
  CamporeeScopeLoader,
  TerritoryScopeValidator,
} from '../scope/territory-scope';

/**
 * Resolves a camporee payment UUID to the camporee of the member it was
 * registered for: local camporee → territory scope, union camporee → union
 * camporee scope (same validators as the camporee routes themselves).
 */
export class CamporeePaymentPolicy implements ResourcePolicy<'camporee_payment'> {
  readonly type = 'camporee_payment' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly territory: TerritoryScopeValidator,
    private readonly loader: CamporeeScopeLoader,
  ) {}

  async resolve({ request, resolved, resource }: PolicyContext) {
    const paymentId = parseEntityUuid(
      getRequestValue(request, 'param', resource.idParam ?? 'paymentId'),
    );

    const payment = await this.prisma.camporee_payments.findUnique({
      where: { camporee_payment_id: paymentId },
      select: {
        camporee_member: {
          select: { camporee_id: true, union_camporee_id: true },
        },
      },
    });

    if (!payment) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_PAYMENT_NOT_FOUND);
    }

    const { camporee_id: localCamporeeId, union_camporee_id: unionCamporeeId } =
      payment.camporee_member;

    if (typeof localCamporeeId === 'number') {
      return this.territory.validateTerritoryScope(
        resolved,
        await this.loader.loadCamporeeScope(localCamporeeId),
      );
    }

    if (typeof unionCamporeeId === 'number') {
      return this.territory.validateUnionCamporeeScope(
        resolved,
        await this.loader.loadUnionCamporeeScope(unionCamporeeId),
      );
    }

    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }
}
