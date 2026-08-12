import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const FIELD_PAYMENT_ORDERS_FLAG_KEY = 'field_payment_orders_v1';
export const FIELD_PAYMENT_ORDERS_EXPIRY_DAYS_KEY =
  'field_payment_orders.expiry_days';
export const DEFAULT_EXPIRY_DAYS = 15;

/**
 * Rollout flag + expiry config for field payment orders, backed by the
 * existing global `system_config` table (no per-LF flag mechanism exists).
 *
 * - `field_payment_orders_v1`: JSON array of enabled local_field_id values.
 * - `field_payment_orders.expiry_days`: days before an ISSUED order without
 *   proof expires (default 15).
 */
@Injectable()
export class FieldPaymentOrdersFlagService {
  private readonly logger = new Logger(FieldPaymentOrdersFlagService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isEnabledForLocalField(localFieldId: number): Promise<boolean> {
    const row = await this.prisma.system_config.findUnique({
      where: { config_key: FIELD_PAYMENT_ORDERS_FLAG_KEY },
    });
    if (!row?.config_value) {
      return false;
    }
    try {
      const parsed = JSON.parse(row.config_value);
      return Array.isArray(parsed) && parsed.includes(localFieldId);
    } catch {
      this.logger.warn(
        `Invalid JSON in system_config.${FIELD_PAYMENT_ORDERS_FLAG_KEY}`,
      );
      return false;
    }
  }

  async getExpiryDays(): Promise<number> {
    const row = await this.prisma.system_config.findUnique({
      where: { config_key: FIELD_PAYMENT_ORDERS_EXPIRY_DAYS_KEY },
    });
    if (!row?.config_value) {
      return DEFAULT_EXPIRY_DAYS;
    }
    const parsed = Number.parseInt(row.config_value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_EXPIRY_DAYS;
    }
    return parsed;
  }
}
