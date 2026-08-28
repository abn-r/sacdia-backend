import { Injectable } from '@nestjs/common';
import {
  AppForbiddenException,
  AppNotFoundException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertCanDistribute,
  type CamporeeOrderActor,
} from './camporee-order-actor';
import { deriveDistributionStatus } from './dto/camporee-order.dto';
import type { CamporeeOrderStatus } from './state-machine';

export type DistributionOrder = {
  camporee_order_id: string;
  club_section_id: number;
  status: CamporeeOrderStatus | string;
};

/**
 * Named delivery of camporee-order lines. LF delivery to the section is a
 * different transition (PAID → DELIVERED) owned by CamporeeOrdersService.
 * Only the active director of the issuing section may mark a line, and only
 * after the order is DELIVERED. Supplementary orders keep independent lines.
 */
@Injectable()
export class CamporeeOrderDistributionService {
  constructor(private readonly prisma: PrismaService) {}

  async deliverToMember(
    order: DistributionOrder,
    lineId: string,
    actor: CamporeeOrderActor,
  ) {
    if (order.status !== 'DELIVERED') {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_NOT_DELIVERED_TO_SECTION,
      );
    }

    try {
      assertCanDistribute(actor, order.club_section_id);
    } catch {
      throw new AppForbiddenException(
        ErrorCode.CAMPOREE_ORDER_DISTRIBUTION_FORBIDDEN,
      );
    }

    const line = await this.prisma.camporee_order_lines.findFirst({
      where: {
        camporee_order_line_id: lineId,
        order_id: order.camporee_order_id,
      },
    });
    if (!line) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_LINE_NOT_FOUND);
    }

    if (line.delivered_to_member_at) {
      return line;
    }

    return this.prisma.camporee_order_lines.update({
      where: { camporee_order_line_id: lineId },
      data: {
        delivered_to_member_by_id: actor.userId,
        delivered_to_member_at: new Date(),
      },
    });
  }

  progressOf(
    lines: Array<{ delivered_to_member_at: Date | null }>,
  ): ReturnType<typeof deriveDistributionStatus> {
    return deriveDistributionStatus(lines);
  }
}
