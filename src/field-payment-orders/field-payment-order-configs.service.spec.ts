import { FieldPaymentOrderConfigsService } from './field-payment-order-configs.service';
import { ErrorCode } from '../common/errors/error-codes';
import type { OrderActor } from './order-actor';

const LF_REVIEWER: OrderActor = {
  userId: 'lf-1',
  localFieldId: 7,
  sectionIds: [],
  globalAccess: false,
  canReview: true,
};

const GLOBAL_ADMIN: OrderActor = {
  userId: 'admin-1',
  sectionIds: [],
  globalAccess: true,
  canReview: true,
};

const DIRECTOR: OrderActor = {
  userId: 'director-1',
  localFieldId: 7,
  sectionIds: [11],
  globalAccess: false,
  canReview: false,
};

describe('FieldPaymentOrderConfigsService', () => {
  let prisma: any;
  let service: FieldPaymentOrderConfigsService;

  beforeEach(() => {
    prisma = {
      field_payment_order_configs: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    service = new FieldPaymentOrderConfigsService(prisma);
  });

  describe('get', () => {
    it('returns the config of the reviewer own local field', async () => {
      const config = { field_payment_order_config_id: 1, local_field_id: 7 };
      prisma.field_payment_order_configs.findUnique.mockResolvedValue(config);

      await expect(service.get(undefined, LF_REVIEWER)).resolves.toBe(config);
      expect(
        prisma.field_payment_order_configs.findUnique,
      ).toHaveBeenCalledWith({ where: { local_field_id: 7 } });
    });

    it('throws when the config does not exist yet', async () => {
      prisma.field_payment_order_configs.findUnique.mockResolvedValue(null);
      await expect(service.get(undefined, LF_REVIEWER)).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_CONFIG_NOT_FOUND,
      });
    });

    it('forbids reading another local field config', async () => {
      await expect(service.get(99, LF_REVIEWER)).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN,
      });
    });

    it('forbids club directors entirely', async () => {
      await expect(service.get(7, DIRECTOR)).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN,
      });
    });

    it('requires an explicit local field for global admins', async () => {
      await expect(service.get(undefined, GLOBAL_ADMIN)).rejects.toMatchObject(
        { code: ErrorCode.FIELD_PAYMENT_ORDER_CONFIG_INVALID },
      );
    });
  });

  describe('upsert', () => {
    it('upserts bank-only payment instructions', async () => {
      prisma.field_payment_order_configs.upsert.mockResolvedValue({ id: 1 });

      await service.upsert(
        {
          local_field_id: 7,
          bank_name: 'Banco Norte',
          bank_account: '1234567890',
          bank_clabe: '012345678901234567',
          bank_holder: 'Asociación Test',
        },
        LF_REVIEWER,
      );

      expect(prisma.field_payment_order_configs.upsert).toHaveBeenCalledWith({
        where: { local_field_id: 7 },
        create: expect.objectContaining({
          local_field_id: 7,
          bank_account: '1234567890',
          created_by_id: 'lf-1',
        }),
        update: expect.objectContaining({
          bank_account: '1234567890',
          cash_instructions: null,
          modified_by_id: 'lf-1',
        }),
      });
    });

    it('accepts cashier-only instructions', async () => {
      prisma.field_payment_order_configs.upsert.mockResolvedValue({ id: 1 });
      await expect(
        service.upsert(
          {
            local_field_id: 7,
            cash_instructions: 'Pagar en la caja del Campo Local, L-V 9-17h',
          },
          LF_REVIEWER,
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a config without any payment method', async () => {
      await expect(
        service.upsert(
          { local_field_id: 7, bank_name: 'Solo nombre' },
          LF_REVIEWER,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_CONFIG_INVALID,
      });
      expect(prisma.field_payment_order_configs.upsert).not.toHaveBeenCalled();
    });

    it('lets a global admin manage any local field', async () => {
      prisma.field_payment_order_configs.upsert.mockResolvedValue({ id: 1 });
      await service.upsert(
        { local_field_id: 42, cash_instructions: 'Caja del campo' },
        GLOBAL_ADMIN,
      );
      expect(prisma.field_payment_order_configs.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { local_field_id: 42 } }),
      );
    });
  });
});
