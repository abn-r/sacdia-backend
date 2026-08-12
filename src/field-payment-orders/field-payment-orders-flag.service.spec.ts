import {
  DEFAULT_EXPIRY_DAYS,
  FieldPaymentOrdersFlagService,
} from './field-payment-orders-flag.service';

describe('FieldPaymentOrdersFlagService', () => {
  function build(configValue: string | null, key?: string) {
    const prisma = {
      system_config: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (key !== undefined && where.config_key !== key) {
            return Promise.resolve(null);
          }
          return Promise.resolve(
            configValue === null
              ? null
              : { config_key: where.config_key, config_value: configValue },
          );
        }),
      },
    };
    return { prisma, service: new FieldPaymentOrdersFlagService(prisma as any) };
  }

  describe('isEnabledForLocalField', () => {
    it('returns true when the LF id is in the JSON list', async () => {
      const { service } = build('[3, 7]');
      await expect(service.isEnabledForLocalField(7)).resolves.toBe(true);
    });

    it('returns false when the LF id is not listed', async () => {
      const { service } = build('[3]');
      await expect(service.isEnabledForLocalField(7)).resolves.toBe(false);
    });

    it('returns false when the key is missing', async () => {
      const { service } = build(null);
      await expect(service.isEnabledForLocalField(7)).resolves.toBe(false);
    });

    it('returns false on malformed JSON', async () => {
      const { service } = build('not-json');
      await expect(service.isEnabledForLocalField(7)).resolves.toBe(false);
    });
  });

  describe('getExpiryDays', () => {
    it('parses the configured value', async () => {
      const { service } = build('30');
      await expect(service.getExpiryDays()).resolves.toBe(30);
    });

    it('falls back to the 15-day default when missing', async () => {
      const { service } = build(null);
      await expect(service.getExpiryDays()).resolves.toBe(DEFAULT_EXPIRY_DAYS);
      expect(DEFAULT_EXPIRY_DAYS).toBe(15);
    });

    it('falls back to the default on invalid values', async () => {
      const { service } = build('-2');
      await expect(service.getExpiryDays()).resolves.toBe(DEFAULT_EXPIRY_DAYS);
    });
  });
});
