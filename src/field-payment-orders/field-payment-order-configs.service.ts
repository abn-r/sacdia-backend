import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertFieldPaymentOrderConfigDto } from './dto/field-payment-order-configs.dto';
import type { OrderActor } from './order-actor';

/**
 * Payment instructions per local field (bank transfer AND/OR field cashier),
 * consumed by the printable order PDF. LF leadership manages its own field;
 * admins without territory can manage any field.
 */
@Injectable()
export class FieldPaymentOrderConfigsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(localFieldId: number | undefined, actor: OrderActor) {
    const targetLf = this.resolveTargetLocalField(localFieldId, actor);
    const config = await this.prisma.field_payment_order_configs.findUnique({
      where: { local_field_id: targetLf },
    });
    if (!config) {
      throw new AppNotFoundException(
        ErrorCode.FIELD_PAYMENT_ORDER_CONFIG_NOT_FOUND,
      );
    }
    return config;
  }

  async upsert(dto: UpsertFieldPaymentOrderConfigDto, actor: OrderActor) {
    const targetLf = this.resolveTargetLocalField(dto.local_field_id, actor);

    const hasBank = Boolean(dto.bank_account || dto.bank_clabe);
    const hasCash = Boolean(dto.cash_instructions?.trim());
    if (!hasBank && !hasCash) {
      // Decisión 8 (banco O caja): al menos una vía de pago configurada.
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_CONFIG_INVALID,
      );
    }

    const data = {
      bank_name: dto.bank_name ?? null,
      bank_account: dto.bank_account ?? null,
      bank_clabe: dto.bank_clabe ?? null,
      bank_holder: dto.bank_holder ?? null,
      cash_instructions: dto.cash_instructions ?? null,
      extra_notes: dto.extra_notes ?? null,
      active: dto.active ?? true,
      modified_by_id: actor.userId,
    };

    return this.prisma.field_payment_order_configs.upsert({
      where: { local_field_id: targetLf },
      create: {
        local_field_id: targetLf,
        ...data,
        created_by_id: actor.userId,
      },
      update: data,
    });
  }

  private resolveTargetLocalField(
    requested: number | undefined,
    actor: OrderActor,
  ): number {
    if (actor.globalAccess) {
      if (typeof requested !== 'number') {
        throw new AppBadRequestException(
          ErrorCode.FIELD_PAYMENT_ORDER_CONFIG_INVALID,
        );
      }
      return requested;
    }
    if (!actor.canReview || typeof actor.localFieldId !== 'number') {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
    }
    if (typeof requested === 'number' && requested !== actor.localFieldId) {
      throw new AppForbiddenException(ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN);
    }
    return actor.localFieldId;
  }
}
