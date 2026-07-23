import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { InsuranceConfigService } from './insurance-config.service';

describe('InsuranceConfigService', () => {
  const prisma = {
    insurance_products: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    insurance_cycle_configs: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    insurance_purchases: { findFirst: jest.fn() },
    ecclesiastical_years: { findUnique: jest.fn() },
  };

  const service = new InsuranceConfigService(
    prisma as unknown as PrismaService,
  );
  const actor = {
    userId: '0f5f8f58-7ee7-4208-9f80-6988c8fcae0d',
    localFieldId: 41,
  };

  const fixedMonthsProduct = {
    name: 'Seguro anual',
    coverage_scope: 'GENERAL' as const,
    validity_mode: 'FIXED_MONTHS' as const,
    default_duration_months: 12,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.insurance_cycle_configs.findFirst.mockResolvedValue(null);
    prisma.insurance_purchases.findFirst.mockResolvedValue(null);
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      year_id: 2026,
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T00:00:00.000Z'),
    });
  });

  it('creates GENERAL products only with FIXED_MONTHS and a positive duration', async () => {
    prisma.insurance_products.create.mockResolvedValue({
      insurance_product_id: 1,
      local_field_id: actor.localFieldId,
      ...fixedMonthsProduct,
    });

    await expect(
      service.createProduct(fixedMonthsProduct, actor),
    ).resolves.toMatchObject({
      insurance_product_id: 1,
      local_field_id: actor.localFieldId,
    });

    expect(prisma.insurance_products.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        local_field_id: actor.localFieldId,
        created_by_id: actor.userId,
        ...fixedMonthsProduct,
      }),
    });
  });

  it('creates EVENT products only with EVENT_DATES and no default duration', async () => {
    const dto = {
      name: 'Seguro de camporee',
      coverage_scope: 'EVENT' as const,
      validity_mode: 'EVENT_DATES' as const,
    };
    prisma.insurance_products.create.mockResolvedValue({
      insurance_product_id: 2,
      local_field_id: actor.localFieldId,
      ...dto,
      default_duration_months: null,
    });

    await expect(service.createProduct(dto, actor)).resolves.toMatchObject({
      insurance_product_id: 2,
      default_duration_months: null,
    });
  });

  it('rejects an invalid fixed-month duration', async () => {
    await expect(
      service.createProduct(
        { ...fixedMonthsProduct, default_duration_months: 0 },
        actor,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INSURANCE_PRODUCT_DURATION_INVALID,
    });
  });

  it('rejects a cycle when its product belongs to another Campo', async () => {
    prisma.insurance_products.findUnique.mockResolvedValue({
      insurance_product_id: 7,
      local_field_id: 99,
    });

    await expect(
      service.createCycle(cycleInput(), actor),
    ).rejects.toMatchObject({
      code: ErrorCode.INSURANCE_PRODUCT_OUTSIDE_LOCAL_FIELD,
    });
    expect(prisma.insurance_cycle_configs.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate cycle for its effective product, Campo, year and club type', async () => {
    prisma.insurance_products.findUnique.mockResolvedValue({
      insurance_product_id: 7,
      local_field_id: actor.localFieldId,
    });
    prisma.insurance_cycle_configs.findFirst.mockResolvedValue({
      insurance_cycle_config_id: 15,
    });

    await expect(
      service.createCycle(cycleInput(), actor),
    ).rejects.toMatchObject({
      code: ErrorCode.INSURANCE_CYCLE_CONFIG_DUPLICATE,
    });
  });

  it('rejects a cycle deadline outside the ecclesiastical year', async () => {
    prisma.insurance_products.findUnique.mockResolvedValue({
      insurance_product_id: 7,
      local_field_id: actor.localFieldId,
    });

    await expect(
      service.createCycle(
        { ...cycleInput(), purchase_deadline: '2027-01-01' },
        actor,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INSURANCE_CYCLE_DEADLINE_OUTSIDE_YEAR,
    });
  });

  it('rejects an invalid IANA timezone without rejecting a valid timezone', async () => {
    prisma.insurance_products.findUnique.mockResolvedValue({
      insurance_product_id: 7,
      local_field_id: actor.localFieldId,
    });

    await expect(
      service.createCycle(
        { ...cycleInput(), timezone: 'Mexico-City-UTC-6' },
        actor,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INSURANCE_CYCLE_TIMEZONE_INVALID,
    });

    prisma.insurance_cycle_configs.create.mockResolvedValue({
      insurance_cycle_config_id: 18,
      timezone: 'America/Mexico_City',
    });
    await expect(service.createCycle(cycleInput(), actor)).resolves.toEqual(
      expect.objectContaining({ timezone: 'America/Mexico_City' }),
    );
    expect(prisma.insurance_cycle_configs.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ timezone: 'America/Mexico_City' }),
      }),
    );
  });

  it('keeps a cycle deadline immutable after a purchase is CONFIRMED', async () => {
    prisma.insurance_cycle_configs.findUnique.mockResolvedValue({
      insurance_cycle_config_id: 15,
      local_field_id: actor.localFieldId,
      purchase_deadline: new Date('2026-03-31T00:00:00.000Z'),
    });
    prisma.insurance_purchases.findFirst.mockResolvedValue({
      insurance_purchase_id: 90,
    });

    await expect(
      service.updateCycle(15, { purchase_deadline: '2026-04-01' }, actor),
    ).rejects.toMatchObject({
      code: ErrorCode.INSURANCE_CYCLE_DEADLINE_LOCKED,
    });
    expect(prisma.insurance_cycle_configs.update).not.toHaveBeenCalled();
  });
});

function cycleInput() {
  return {
    insurance_product_id: 7,
    ecclesiastical_year_id: 2026,
    club_type_id: 3,
    unit_cost: 125.5,
    purchase_deadline: '2026-03-31',
    timezone: 'America/Mexico_City',
  };
}
