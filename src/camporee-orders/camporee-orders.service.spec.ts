import { ErrorCode } from '../common/errors/error-codes';
import type { ActorTerritoryScope } from '../common/authorization/actor-territory-scope';
import type { CamporeeOrderActor } from './camporee-order-actor';
import { CamporeeOrdersService } from './camporee-orders.service';
import { EligibilityService } from './eligibility.service';
import type { CreateCamporeeOrderDto } from './dto/create-camporee-order.dto';

const LF_10 = 10;
const SECTION_11 = 11;
const LOCAL_CAMPOREE_ID = 21;
const UNION_CAMPOREE_ID = 22;
const MEMBER_801 = 801;
const MEMBER_802 = 802;
const USER_801 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_802 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DIRECTOR_ID = '33333333-3333-4333-8333-333333333333';
const PRODUCT_PLAYERA = '11111111-1111-4111-8111-111111111111';
const PRODUCT_GORRA = '22222222-2222-4222-8222-222222222222';
const OFFERING_PLAYERA = '99999999-9999-4999-8999-999999999999';
const OFFERING_GORRA = '88888888-8888-4888-8888-888888888888';
const OPTION_M = '77777777-7777-4777-8777-777777777777';
const IDEMPOTENCY_KEY = 'b7f43c60-0000-4000-8000-000000000001';

function baseActor(
  overrides: Partial<CamporeeOrderActor> & {
    territory: ActorTerritoryScope;
  },
): CamporeeOrderActor {
  return {
    userId: DIRECTOR_ID,
    sectionIds: [SECTION_11],
    globalAccess: false,
    canReview: false,
    globalRoles: [],
    ...overrides,
  };
}

function clubActor(): CamporeeOrderActor {
  return baseActor({
    localFieldId: LF_10,
    territory: { level: 'open' },
    activeSection: {
      club_section_id: SECTION_11,
      club_id: 5,
      club_name: 'Club Orión',
      club_type_id: 1,
      role_name: 'director',
      local_field_id: LF_10,
    },
  });
}

function lfReviewer(): CamporeeOrderActor {
  return baseActor({
    userId: 'lf-reviewer-1',
    localFieldId: LF_10,
    sectionIds: [],
    canReview: true,
    globalRoles: ['director-lf'],
    territory: {
      level: 'local_field',
      localFieldId: LF_10,
      unionId: 2,
      divisionId: 1,
    },
  });
}

function localCamporee(overrides: Record<string, unknown> = {}) {
  return {
    orders_enabled: true,
    orders_opens_at: null,
    orders_deadline: new Date('2026-12-31T06:00:00.000Z'),
    end_date: new Date(Date.UTC(2026, 7, 24)),
    timezone: 'America/Mexico_City',
    ...overrides,
  };
}

function paymentConfig(overrides: Record<string, unknown> = {}) {
  return {
    local_field_id: LF_10,
    active: true,
    bank_name: 'BBVA',
    bank_account: '123456',
    bank_clabe: '012345678901234567',
    bank_holder: 'Asociación',
    cash_instructions: 'Caja LF',
    extra_notes: 'Usar folio PED',
    ...overrides,
  };
}

function playeraOffering(overrides: Record<string, unknown> = {}) {
  return {
    camporee_order_offering_id: OFFERING_PLAYERA,
    local_camporee_id: LOCAL_CAMPOREE_ID,
    union_camporee_id: null,
    product_id: PRODUCT_PLAYERA,
    price_centavos: 15000,
    active: true,
    product: {
      camporee_order_product_id: PRODUCT_PLAYERA,
      title: 'Playera',
      size_scheme: 'LETTER',
      active: true,
      options: [
        {
          camporee_order_product_option_id: OPTION_M,
          product_id: PRODUCT_PLAYERA,
          label: 'M',
          active: true,
        },
      ],
    },
    ...overrides,
  };
}

function gorraOffering() {
  return {
    camporee_order_offering_id: OFFERING_GORRA,
    local_camporee_id: LOCAL_CAMPOREE_ID,
    union_camporee_id: null,
    product_id: PRODUCT_GORRA,
    price_centavos: 8000,
    active: true,
    product: {
      camporee_order_product_id: PRODUCT_GORRA,
      title: 'Gorra',
      size_scheme: 'NONE',
      active: true,
      options: [],
    },
  };
}

function member(id: number, userId: string, name: string) {
  return {
    camporee_member_id: id,
    user_id: userId,
    active: true,
    status: 'approved',
    camporee_id: LOCAL_CAMPOREE_ID,
    union_camporee_id: null,
    camporee_club: {
      club_section_id: SECTION_11,
      active: true,
      status: 'approved',
    },
    users: {
      name,
      paternal_last_name: 'García',
      maternal_last_name: 'López',
    },
  };
}

function createDto(
  lines: CreateCamporeeOrderDto['lines'],
): CreateCamporeeOrderDto {
  return { lines };
}

function existingOrder(overrides: Record<string, unknown> = {}) {
  return {
    camporee_order_id: 'order-1',
    local_field_id: LF_10,
    club_id: 5,
    club_section_id: SECTION_11,
    local_camporee_id: LOCAL_CAMPOREE_ID,
    union_camporee_id: null,
    folio: 1,
    folio_reference: 'PED20260001',
    status: 'ISSUED',
    currency: 'MXN',
    total_centavos: 15000,
    expires_at: new Date('2026-09-08T18:00:00.000Z'),
    issued_by_id: DIRECTOR_ID,
    authorized_without_proof: false,
    bank_name: 'BBVA',
    bank_account: '123456',
    bank_clabe: '012345678901234567',
    bank_holder: 'Asociación',
    cash_instructions: 'Caja LF',
    extra_notes: 'Usar folio PED',
    created_at: new Date('2026-08-24T18:00:00.000Z'),
    modified_at: new Date('2026-08-24T18:00:00.000Z'),
    lines: [
      {
        camporee_order_line_id: 'line-1',
        sequence: 1,
        camporee_member_id: MEMBER_801,
        beneficiary_user_id: USER_801,
        beneficiary_name_snapshot: 'Ana García López',
        offering_id: OFFERING_PLAYERA,
        product_id: PRODUCT_PLAYERA,
        option_id: OPTION_M,
        product_title_snapshot: 'Playera',
        option_label_snapshot: 'M',
        qty: 1,
        unit_price_centavos: 15000,
        line_total_centavos: 15000,
        delivered_to_member_at: null,
        delivered_to_member_by_id: null,
      },
    ],
    ...overrides,
  };
}

describe('CamporeeOrdersService', () => {
  let tx: any;
  let prisma: any;
  let folio: any;
  let service: CamporeeOrdersService;
  const stored = new Map<string, any>();

  beforeEach(() => {
    stored.clear();
    tx = {
      camporee_orders: {
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    prisma = {
      local_camporees: { findUnique: jest.fn() },
      union_camporees: { findUnique: jest.fn() },
      field_payment_order_configs: { findUnique: jest.fn() },
      camporee_order_offerings: { findMany: jest.fn() },
      camporee_orders: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      camporee_members: { findMany: jest.fn() },
      camporee_clubs: { findFirst: jest.fn() },
      union_camporee_local_fields: { findFirst: jest.fn() },
      system_config: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    folio = {
      allocate: jest.fn().mockResolvedValue({
        folio: 1,
        folio_reference: 'PED20260001',
        year: 2026,
      }),
    };
    prisma.local_camporees.findUnique.mockResolvedValue(localCamporee());
    prisma.field_payment_order_configs.findUnique.mockResolvedValue(
      paymentConfig(),
    );
    prisma.camporee_clubs.findFirst.mockResolvedValue({ camporee_club_id: 44 });
    prisma.camporee_members.findMany.mockResolvedValue([
      member(MEMBER_801, USER_801, 'Ana'),
      member(MEMBER_802, USER_802, 'Luis'),
    ]);
    prisma.camporee_order_offerings.findMany.mockImplementation(
      async ({
        where,
      }: {
        where: { camporee_order_offering_id: { in: string[] } };
      }) => {
        const catalog = [playeraOffering(), gorraOffering()];
        return catalog.filter((row) =>
          where.camporee_order_offering_id.in.includes(
            row.camporee_order_offering_id,
          ),
        );
      },
    );
    tx.camporee_orders.create.mockImplementation(
      ({ data }: { data: Record<string, any> }) => {
        const { lines, ...header } = data;
        const id = `order-${stored.size + 1}`;
        const row = {
          camporee_order_id: id,
          ...header,
          created_at: new Date('2026-08-24T18:00:00.000Z'),
          modified_at: new Date('2026-08-24T18:00:00.000Z'),
          lines: (lines.create as any[]).map((line, index) => ({
            camporee_order_line_id: `${id}-l${index + 1}`,
            delivered_to_member_at: null,
            delivered_to_member_by_id: null,
            ...line,
          })),
        };
        stored.set(id, structuredClone(row));
        return row;
      },
    );
    service = new CamporeeOrdersService(
      prisma,
      folio,
      new EligibilityService(prisma),
    );
  });

  describe('create', () => {
    it('issues an enrolled-member order with folio, snapshots and derived total', async () => {
      const result = await service.create(
        LOCAL_CAMPOREE_ID,
        'local',
        createDto([
          {
            camporee_member_id: MEMBER_801,
            offering_id: OFFERING_PLAYERA,
            option_id: OPTION_M,
            qty: 1,
          },
          {
            camporee_member_id: MEMBER_802,
            offering_id: OFFERING_GORRA,
            option_id: null,
            qty: 2,
          },
        ]),
        clubActor(),
      );

      expect(folio.allocate).toHaveBeenCalledWith(
        expect.anything(),
        LF_10,
        expect.any(Date),
      );
      expect(result).toMatchObject({
        folio_reference: 'PED20260001',
        status: 'ISSUED',
        currency: 'MXN',
        authorized_without_proof: false,
        total_centavos: 31000,
        local_camporee_id: LOCAL_CAMPOREE_ID,
        union_camporee_id: null,
        bank_name: 'BBVA',
        bank_clabe: '012345678901234567',
        distribution_status: 'NOT_STARTED',
      });
      expect(result.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            camporee_member_id: MEMBER_801,
            beneficiary_name_snapshot: 'Ana García López',
            product_title_snapshot: 'Playera',
            option_label_snapshot: 'M',
            unit_price_centavos: 15000,
            line_total_centavos: 15000,
          }),
          expect.objectContaining({
            camporee_member_id: MEMBER_802,
            product_title_snapshot: 'Gorra',
            option_label_snapshot: null,
            qty: 2,
            unit_price_centavos: 8000,
            line_total_centavos: 16000,
          }),
        ]),
      );
      expect(result.summary).toEqual([
        {
          product_title_snapshot: 'Playera',
          option_label_snapshot: 'M',
          qty: 1,
          subtotal_centavos: 15000,
        },
        {
          product_title_snapshot: 'Gorra',
          option_label_snapshot: null,
          qty: 2,
          subtotal_centavos: 16000,
        },
      ]);
      const data = tx.camporee_orders.create.mock.calls[0][0].data;
      expect(data.lines.create).toHaveLength(2);
      const deltaDays =
        (data.expires_at.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(deltaDays).toBeGreaterThan(14.9);
      expect(deltaDays).toBeLessThanOrEqual(15);
    });

    it('lets the same section issue two independent orders', async () => {
      folio.allocate
        .mockResolvedValueOnce({
          folio: 1,
          folio_reference: 'PED20260001',
          year: 2026,
        })
        .mockResolvedValueOnce({
          folio: 2,
          folio_reference: 'PED20260002',
          year: 2026,
        });

      const first = await service.create(
        LOCAL_CAMPOREE_ID,
        'local',
        createDto([
          {
            camporee_member_id: MEMBER_801,
            offering_id: OFFERING_PLAYERA,
            option_id: OPTION_M,
            qty: 1,
          },
        ]),
        clubActor(),
      );
      const second = await service.create(
        LOCAL_CAMPOREE_ID,
        'local',
        createDto([
          {
            camporee_member_id: MEMBER_802,
            offering_id: OFFERING_GORRA,
            option_id: null,
            qty: 1,
          },
        ]),
        clubActor(),
      );

      expect(first.folio_reference).toBe('PED20260001');
      expect(second.folio_reference).toBe('PED20260002');
      expect(first.camporee_order_id).not.toBe(second.camporee_order_id);
      expect(first.total_centavos).toBe(15000);
      expect(second.total_centavos).toBe(8000);
      expect(first.status).toBe('ISSUED');
      expect(second.status).toBe('ISSUED');
      expect(folio.allocate).toHaveBeenCalledTimes(2);
    });

    it('does not mutate a previous order when issuing a supplementary one', async () => {
      folio.allocate
        .mockResolvedValueOnce({
          folio: 1,
          folio_reference: 'PED20260001',
          year: 2026,
        })
        .mockResolvedValueOnce({
          folio: 2,
          folio_reference: 'PED20260002',
          year: 2026,
        });

      const first = await service.create(
        LOCAL_CAMPOREE_ID,
        'local',
        createDto([
          {
            camporee_member_id: MEMBER_801,
            offering_id: OFFERING_PLAYERA,
            option_id: OPTION_M,
            qty: 1,
          },
        ]),
        clubActor(),
      );
      const firstSnapshot = structuredClone(
        stored.get(first.camporee_order_id),
      );

      const second = await service.create(
        LOCAL_CAMPOREE_ID,
        'local',
        createDto([
          {
            camporee_member_id: MEMBER_802,
            offering_id: OFFERING_GORRA,
            option_id: null,
            qty: 1,
          },
        ]),
        clubActor(),
      );

      expect(second.lines.map((line) => line.camporee_member_id)).toEqual([
        MEMBER_802,
      ]);
      expect(stored.get(first.camporee_order_id)).toEqual(firstSnapshot);
      expect(prisma.camporee_orders.update).not.toHaveBeenCalled();
      expect(tx.camporee_orders.update).not.toHaveBeenCalled();
    });

    it('replays the same idempotency key and payload', async () => {
      prisma.camporee_orders.findFirst.mockResolvedValue(existingOrder());

      const result = await service.create(
        LOCAL_CAMPOREE_ID,
        'local',
        createDto([
          {
            camporee_member_id: MEMBER_801,
            offering_id: OFFERING_PLAYERA,
            option_id: OPTION_M,
            qty: 1,
          },
        ]),
        clubActor(),
        IDEMPOTENCY_KEY,
      );

      expect(result.camporee_order_id).toBe('order-1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('conflicts when the same idempotency key is reused with a different payload', async () => {
      prisma.camporee_orders.findFirst.mockResolvedValue(existingOrder());

      await expect(
        service.create(
          LOCAL_CAMPOREE_ID,
          'local',
          createDto([
            {
              camporee_member_id: MEMBER_802,
              offering_id: OFFERING_GORRA,
              option_id: null,
              qty: 1,
            },
          ]),
          clubActor(),
          IDEMPOTENCY_KEY,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.IDEMPOTENCY_KEY_REUSED,
        status: 409,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects create when the local field has no active payment config', async () => {
      prisma.field_payment_order_configs.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          LOCAL_CAMPOREE_ID,
          'local',
          createDto([
            {
              camporee_member_id: MEMBER_801,
              offering_id: OFFERING_PLAYERA,
              option_id: OPTION_M,
              qty: 1,
            },
          ]),
          clubActor(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_PAYMENT_CONFIG_REQUIRED,
        status: 422,
      });
    });

    it('creates a union camporee order when the LF participates', async () => {
      prisma.union_camporees.findUnique.mockResolvedValue(localCamporee());
      prisma.union_camporee_local_fields.findFirst.mockResolvedValue({
        local_field_id: LF_10,
      });
      prisma.camporee_members.findMany.mockResolvedValue([
        {
          ...member(MEMBER_801, USER_801, 'Ana'),
          camporee_id: null,
          union_camporee_id: UNION_CAMPOREE_ID,
        },
      ]);
      prisma.camporee_order_offerings.findMany.mockResolvedValue([
        {
          ...playeraOffering(),
          local_camporee_id: null,
          union_camporee_id: UNION_CAMPOREE_ID,
        },
      ]);

      const result = await service.create(
        UNION_CAMPOREE_ID,
        'union',
        createDto([
          {
            camporee_member_id: MEMBER_801,
            offering_id: OFFERING_PLAYERA,
            option_id: OPTION_M,
            qty: 1,
          },
        ]),
        clubActor(),
      );

      expect(result.union_camporee_id).toBe(UNION_CAMPOREE_ID);
      expect(result.local_camporee_id).toBeNull();
      expect(prisma.union_camporee_local_fields.findFirst).toHaveBeenCalled();
    });
  });

  describe('read', () => {
    it('lists every visible order without collapsing supplementary folios', async () => {
      prisma.camporee_orders.findMany.mockResolvedValue([
        existingOrder({
          camporee_order_id: 'order-2',
          folio: 2,
          folio_reference: 'PED20260002',
          total_centavos: 8000,
        }),
        existingOrder(),
      ]);

      const result = await service.list({}, clubActor());

      expect(result).toHaveLength(2);
      expect(result.map((order) => order.folio_reference)).toEqual([
        'PED20260002',
        'PED20260001',
      ]);
      expect(prisma.camporee_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ club_section_id: SECTION_11 }),
        }),
      );
    });

    it('lists local-field orders for an LF reviewer', async () => {
      prisma.camporee_orders.findMany.mockResolvedValue([existingOrder()]);

      await service.list({}, lfReviewer());

      expect(prisma.camporee_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ local_field_id: LF_10 }),
        }),
      );
    });

    it('derives distribution_status from named lines', async () => {
      const partial = existingOrder({
        lines: [
          {
            ...existingOrder().lines[0],
            delivered_to_member_at: new Date('2026-08-24T20:00:00.000Z'),
            delivered_to_member_by_id: DIRECTOR_ID,
          },
          {
            ...existingOrder().lines[0],
            camporee_order_line_id: 'line-2',
            sequence: 2,
            camporee_member_id: MEMBER_802,
            delivered_to_member_at: null,
          },
        ],
      });
      prisma.camporee_orders.findUnique.mockResolvedValue(partial);

      const result = await service.get('order-1', clubActor());
      expect(result.distribution_status).toBe('PARTIAL');
    });
  });
});
