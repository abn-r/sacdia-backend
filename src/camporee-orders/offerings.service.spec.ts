import { ErrorCode } from '../common/errors/error-codes';
import type { ActorTerritoryScope } from '../common/authorization/actor-territory-scope';
import type { CamporeeOrderActor } from './camporee-order-actor';
import {
  assertOrdersWindow,
  OfferingsService,
} from './offerings.service';

const LF_10 = 10;
const LF_11 = 11;
const UNION_2 = 2;
const UNION_3 = 3;
const DIVISION_1 = 1;
const LOCAL_CAMPOREE_ID = 21;
const UNION_CAMPOREE_ID = 22;
const USER_ID = '33333333-3333-4333-8333-333333333333';
const PRODUCT_LF = '11111111-1111-4111-8111-111111111111';
const PRODUCT_SIBLING_LF = '22222222-2222-4222-8222-222222222222';
const PRODUCT_UNION = '33333333-3333-4333-8333-333333333333';
const PRODUCT_OTHER_UNION = '44444444-4444-4444-8444-444444444444';
const PRODUCT_DIVISION = '55555555-5555-4555-8555-555555555555';
const PRODUCT_LETTER_NO_OPTIONS = '66666666-6666-4666-8666-666666666666';
const PRODUCT_NUMERIC_INACTIVE = '77777777-7777-4777-8777-777777777777';
const PRODUCT_NONE = '88888888-8888-4888-8888-888888888888';
const OFFERING_ID = '99999999-9999-4999-8999-999999999999';

function baseActor(
  overrides: Partial<CamporeeOrderActor> & {
    territory: ActorTerritoryScope;
  },
): CamporeeOrderActor {
  return {
    userId: USER_ID,
    sectionIds: [],
    globalAccess: false,
    canReview: false,
    globalRoles: [],
    ...overrides,
  };
}

function lfActor(localFieldId: number): CamporeeOrderActor {
  return baseActor({
    localFieldId,
    globalRoles: ['director-lf'],
    canReview: true,
    territory: {
      level: 'local_field',
      localFieldId,
      unionId: UNION_2,
      divisionId: DIVISION_1,
    },
  });
}

function unionActor(unionId: number): CamporeeOrderActor {
  return baseActor({
    localFieldId: LF_10,
    globalRoles: ['director-union'],
    territory: {
      level: 'union',
      unionId,
      localFieldId: LF_10,
      divisionId: DIVISION_1,
    },
  });
}

function clubActor(): CamporeeOrderActor {
  return baseActor({
    localFieldId: LF_10,
    sectionIds: [11],
    territory: { level: 'open' },
    activeSection: {
      club_section_id: 11,
      club_id: 5,
      club_name: 'Club Orión',
      club_type_id: 1,
      role_name: 'director',
      local_field_id: LF_10,
    },
  });
}

function superAdminActor(): CamporeeOrderActor {
  return baseActor({
    globalAccess: true,
    canReview: true,
    globalRoles: ['super-admin'],
    territory: { level: 'all' },
  });
}

function localCamporee(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    local_camporee_id: LOCAL_CAMPOREE_ID,
    local_field_id: LF_10,
    orders_enabled: false,
    orders_opens_at: null,
    orders_deadline: null,
    end_date: new Date(Date.UTC(2026, 7, 24)),
    timezone: 'America/Mexico_City',
    local_fields: {
      local_field_id: LF_10,
      union_id: UNION_2,
      unions: { union_id: UNION_2, division_id: DIVISION_1 },
    },
    ...overrides,
  };
}

function unionCamporee(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    union_camporee_id: UNION_CAMPOREE_ID,
    union_id: UNION_2,
    orders_enabled: false,
    orders_opens_at: null,
    orders_deadline: null,
    end_date: new Date(Date.UTC(2026, 7, 24)),
    timezone: 'America/Mexico_City',
    unions: { union_id: UNION_2, division_id: DIVISION_1 },
    ...overrides,
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    camporee_order_product_id: PRODUCT_LF,
    owner_scope: 'LOCAL_FIELD' as const,
    owner_division_id: null,
    owner_union_id: null,
    owner_local_field_id: LF_10,
    title: 'Playera',
    size_scheme: 'LETTER' as const,
    active: true,
    options: [{ active: true, label: 'M', sort_order: 1 }],
    ...overrides,
  };
}

describe('assertOrdersWindow', () => {
  const endDate = new Date(Date.UTC(2026, 7, 24));

  it('fails closed with 403 when orders_enabled is false', () => {
    expect(() =>
      assertOrdersWindow(
        {
          orders_enabled: false,
          orders_opens_at: new Date('2026-01-01T00:00:00.000Z'),
          orders_deadline: new Date('2026-12-31T00:00:00.000Z'),
          end_date: endDate,
          timezone: 'America/Mexico_City',
        },
        new Date('2026-08-10T12:00:00.000Z'),
      ),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CAMPOREE_ORDERS_DISABLED,
        status: 403,
      }),
    );
  });

  it('rejects now before orders_opens_at', () => {
    expect(() =>
      assertOrdersWindow(
        {
          orders_enabled: true,
          orders_opens_at: new Date('2026-08-10T15:00:00.000Z'),
          orders_deadline: null,
          end_date: endDate,
          timezone: 'America/Mexico_City',
        },
        new Date('2026-08-10T14:59:59.999Z'),
      ),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CAMPOREE_ORDERS_NOT_OPEN,
        status: 422,
      }),
    );
  });

  it('keeps the deadline instant open and closes strictly after', () => {
    const deadline = new Date('2026-08-20T18:00:00.000Z');
    const camporee = {
      orders_enabled: true,
      orders_opens_at: null,
      orders_deadline: deadline,
      end_date: endDate,
      timezone: 'America/Mexico_City' as const,
    };

    expect(() => assertOrdersWindow(camporee, deadline)).not.toThrow();
    expect(() =>
      assertOrdersWindow(camporee, new Date(deadline.getTime() + 1)),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CAMPOREE_ORDERS_CLOSED,
        status: 422,
      }),
    );
  });

  it('uses end_date end-of-day in camporee IANA timezone when deadline is null', () => {
    const camporee = {
      orders_enabled: true,
      orders_opens_at: null,
      orders_deadline: null,
      end_date: endDate,
      timezone: 'America/Mexico_City',
    };
    // America/Mexico_City is UTC-6 in 2026. End of 2026-08-24 = 2026-08-25T05:59:59.999Z
    const lastInstant = new Date('2026-08-25T05:59:59.999Z');
    const closedInstant = new Date('2026-08-25T06:00:00.000Z');

    expect(() => assertOrdersWindow(camporee, lastInstant)).not.toThrow();
    expect(() => assertOrdersWindow(camporee, closedInstant)).toThrow(
      expect.objectContaining({
        code: ErrorCode.CAMPOREE_ORDERS_CLOSED,
      }),
    );
  });

  it('does not use the process timezone for the end-of-day fallback', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland';
    try {
      const camporee = {
        orders_enabled: true,
        orders_opens_at: null,
        orders_deadline: null,
        end_date: endDate,
        timezone: 'America/Mexico_City',
      };
      expect(() =>
        assertOrdersWindow(camporee, new Date('2026-08-25T05:59:59.999Z')),
      ).not.toThrow();
      expect(() =>
        assertOrdersWindow(camporee, new Date('2026-08-25T06:00:00.000Z')),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.CAMPOREE_ORDERS_CLOSED }),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previous;
      }
    }
  });
});

describe('OfferingsService', () => {
  let prisma: {
    local_camporees: { findUnique: jest.Mock; update: jest.Mock };
    union_camporees: { findUnique: jest.Mock; update: jest.Mock };
    camporee_order_products: { findMany: jest.Mock };
    camporee_order_offerings: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: OfferingsService;

  beforeEach(() => {
    prisma = {
      local_camporees: { findUnique: jest.fn(), update: jest.fn() },
      union_camporees: { findUnique: jest.fn(), update: jest.fn() },
      camporee_order_products: { findMany: jest.fn() },
      camporee_order_offerings: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    prisma.camporee_order_offerings.findMany.mockResolvedValue([]);
    prisma.camporee_order_offerings.findFirst.mockResolvedValue(null);
    prisma.camporee_order_offerings.updateMany.mockResolvedValue({ count: 0 });
    service = new OfferingsService(prisma as never);
  });

  describe('GET offerings', () => {
    it('returns settings even when orders_enabled is false', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());
      prisma.camporee_order_offerings.findMany.mockResolvedValue([
        {
          camporee_order_offering_id: OFFERING_ID,
          product_id: PRODUCT_LF,
          price_centavos: 15000,
          active: true,
          sort_order: 0,
        },
      ]);

      const result = await service.getOfferings(LOCAL_CAMPOREE_ID, 'local');

      expect(result.settings).toEqual({
        orders_enabled: false,
        orders_opens_at: null,
        orders_deadline: null,
      });
      expect(result.items).toHaveLength(1);
    });
  });

  describe('PATCH settings', () => {
    it('lets the organizing LF update the window', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());
      prisma.local_camporees.update.mockResolvedValue({
        orders_enabled: true,
        orders_opens_at: new Date('2026-08-01T14:00:00.000Z'),
        orders_deadline: null,
      });

      await service.updateSettings(
        LOCAL_CAMPOREE_ID,
        'local',
        {
          orders_enabled: true,
          orders_opens_at: '2026-08-01T08:00:00-06:00',
        },
        lfActor(LF_10),
      );

      expect(prisma.local_camporees.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { local_camporee_id: LOCAL_CAMPOREE_ID },
          data: expect.objectContaining({
            orders_enabled: true,
            orders_opens_at: new Date('2026-08-01T14:00:00.000Z'),
          }),
        }),
      );
    });

    it('forbids a club actor from configuring settings', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());

      await expect(
        service.updateSettings(
          LOCAL_CAMPOREE_ID,
          'local',
          { orders_enabled: true },
          clubActor(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN,
      });
      expect(prisma.local_camporees.update).not.toHaveBeenCalled();
    });
  });

  describe('territorial cascade', () => {
    it('lets a local camporee offer own LF, parent union and parent division products', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());
      prisma.camporee_order_products.findMany.mockResolvedValue([
        product(),
        product({
          camporee_order_product_id: PRODUCT_UNION,
          owner_scope: 'UNION',
          owner_local_field_id: null,
          owner_union_id: UNION_2,
          size_scheme: 'NONE',
          options: [],
        }),
        product({
          camporee_order_product_id: PRODUCT_DIVISION,
          owner_scope: 'DIVISION',
          owner_local_field_id: null,
          owner_division_id: DIVISION_1,
          size_scheme: 'NONE',
          options: [],
        }),
      ]);

      await service.replaceOfferings(
        LOCAL_CAMPOREE_ID,
        'local',
        {
          items: [
            { product_id: PRODUCT_LF, price_centavos: 15000 },
            { product_id: PRODUCT_UNION, price_centavos: 2000 },
            { product_id: PRODUCT_DIVISION, price_centavos: 500 },
          ],
        },
        lfActor(LF_10),
      );

      expect(prisma.camporee_order_offerings.create).toHaveBeenCalledTimes(3);
      expect(prisma.camporee_order_offerings.delete).not.toHaveBeenCalled();
      expect(prisma.camporee_order_offerings.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects a sibling LF product on a local camporee', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());
      prisma.camporee_order_products.findMany.mockResolvedValue([
        product({
          camporee_order_product_id: PRODUCT_SIBLING_LF,
          owner_local_field_id: LF_11,
        }),
      ]);

      await expect(
        service.replaceOfferings(
          LOCAL_CAMPOREE_ID,
          'local',
          {
            items: [{ product_id: PRODUCT_SIBLING_LF, price_centavos: 15000 }],
          },
          lfActor(LF_10),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects another union product on a local camporee', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());
      prisma.camporee_order_products.findMany.mockResolvedValue([
        product({
          camporee_order_product_id: PRODUCT_OTHER_UNION,
          owner_scope: 'UNION',
          owner_local_field_id: null,
          owner_union_id: UNION_3,
        }),
      ]);

      await expect(
        service.replaceOfferings(
          LOCAL_CAMPOREE_ID,
          'local',
          {
            items: [{ product_id: PRODUCT_OTHER_UNION, price_centavos: 15000 }],
          },
          lfActor(LF_10),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
      });
    });

    it('lets a union camporee offer own union and parent division products', async () => {
      prisma.union_camporees.findUnique.mockResolvedValue(unionCamporee());
      prisma.camporee_order_products.findMany.mockResolvedValue([
        product({
          camporee_order_product_id: PRODUCT_UNION,
          owner_scope: 'UNION',
          owner_local_field_id: null,
          owner_union_id: UNION_2,
          size_scheme: 'NONE',
          options: [],
        }),
        product({
          camporee_order_product_id: PRODUCT_DIVISION,
          owner_scope: 'DIVISION',
          owner_local_field_id: null,
          owner_division_id: DIVISION_1,
          size_scheme: 'NONE',
          options: [],
        }),
      ]);

      await service.replaceOfferings(
        UNION_CAMPOREE_ID,
        'union',
        {
          items: [
            { product_id: PRODUCT_UNION, price_centavos: 2000 },
            { product_id: PRODUCT_DIVISION, price_centavos: 500 },
          ],
        },
        unionActor(UNION_2),
      );

      expect(prisma.camporee_order_offerings.create).toHaveBeenCalledTimes(2);
    });

    it('rejects any LOCAL_FIELD product on a union camporee', async () => {
      prisma.union_camporees.findUnique.mockResolvedValue(unionCamporee());
      prisma.camporee_order_products.findMany.mockResolvedValue([product()]);

      await expect(
        service.replaceOfferings(
          UNION_CAMPOREE_ID,
          'union',
          { items: [{ product_id: PRODUCT_LF, price_centavos: 15000 }] },
          unionActor(UNION_2),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
      });
    });
  });

  describe('price and options', () => {
    it('rejects non-positive price_centavos', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());

      await expect(
        service.replaceOfferings(
          LOCAL_CAMPOREE_ID,
          'local',
          { items: [{ product_id: PRODUCT_LF, price_centavos: 0 }] },
          lfActor(LF_10),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_OFFERING_INVALID,
      });
      expect(prisma.camporee_order_products.findMany).not.toHaveBeenCalled();
    });

    it('requires at least one active option for LETTER products', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());
      prisma.camporee_order_products.findMany.mockResolvedValue([
        product({
          camporee_order_product_id: PRODUCT_LETTER_NO_OPTIONS,
          options: [],
        }),
      ]);

      await expect(
        service.replaceOfferings(
          LOCAL_CAMPOREE_ID,
          'local',
          {
            items: [
              { product_id: PRODUCT_LETTER_NO_OPTIONS, price_centavos: 15000 },
            ],
          },
          lfActor(LF_10),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_OPTION_REQUIRED,
      });
    });

    it('requires an active option for NUMERIC products', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());
      prisma.camporee_order_products.findMany.mockResolvedValue([
        product({
          camporee_order_product_id: PRODUCT_NUMERIC_INACTIVE,
          size_scheme: 'NUMERIC',
          options: [{ active: false, label: '14', sort_order: 1 }],
        }),
      ]);

      await expect(
        service.replaceOfferings(
          LOCAL_CAMPOREE_ID,
          'local',
          {
            items: [
              { product_id: PRODUCT_NUMERIC_INACTIVE, price_centavos: 12000 },
            ],
          },
          lfActor(LF_10),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_OPTION_REQUIRED,
      });
    });

    it('allows NONE products without options', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());
      prisma.camporee_order_products.findMany.mockResolvedValue([
        product({
          camporee_order_product_id: PRODUCT_NONE,
          size_scheme: 'NONE',
          options: [],
        }),
      ]);

      await service.replaceOfferings(
        LOCAL_CAMPOREE_ID,
        'local',
        { items: [{ product_id: PRODUCT_NONE, price_centavos: 800 }] },
        lfActor(LF_10),
      );

      expect(prisma.camporee_order_offerings.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            product_id: PRODUCT_NONE,
            price_centavos: 800,
            local_camporee_id: LOCAL_CAMPOREE_ID,
          }),
        }),
      );
    });

    it('soft-deactivates omitted offerings instead of deleting them', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());
      prisma.camporee_order_products.findMany.mockResolvedValue([product()]);
      prisma.camporee_order_offerings.findFirst.mockResolvedValue({
        camporee_order_offering_id: OFFERING_ID,
        product_id: PRODUCT_LF,
        active: true,
      });

      await service.replaceOfferings(
        LOCAL_CAMPOREE_ID,
        'local',
        {
          items: [
            { product_id: PRODUCT_LF, price_centavos: 18000, active: false },
          ],
        },
        lfActor(LF_10),
      );

      expect(prisma.camporee_order_offerings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            price_centavos: 18000,
            active: false,
          }),
        }),
      );
      expect(prisma.camporee_order_offerings.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            local_camporee_id: LOCAL_CAMPOREE_ID,
            product_id: { notIn: [PRODUCT_LF] },
          }),
          data: expect.objectContaining({ active: false }),
        }),
      );
      expect(prisma.camporee_order_offerings.delete).not.toHaveBeenCalled();
      expect(prisma.camporee_order_offerings.deleteMany).not.toHaveBeenCalled();
    });

    it('forbids a club actor from replacing offerings', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());

      await expect(
        service.replaceOfferings(
          LOCAL_CAMPOREE_ID,
          'local',
          { items: [{ product_id: PRODUCT_LF, price_centavos: 15000 }] },
          clubActor(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN,
      });
    });

    it('lets super-admin replace offerings', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());
      prisma.camporee_order_products.findMany.mockResolvedValue([product()]);

      await service.replaceOfferings(
        LOCAL_CAMPOREE_ID,
        'local',
        { items: [{ product_id: PRODUCT_LF, price_centavos: 15000 }] },
        superAdminActor(),
      );

      expect(prisma.camporee_order_offerings.create).toHaveBeenCalled();
    });
  });
});
