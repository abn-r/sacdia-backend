import { Prisma } from '@prisma/client';
import { ErrorCode } from '../common/errors/error-codes';
import type { ActorTerritoryScope } from '../common/authorization/actor-territory-scope';
import type { CamporeeSupplyActor } from './camporee-supply-actor';
import { CamporeeSupplyFolioService } from './folio.service';
import { CamporeeSupplyPlansService } from './plans.service';

const LF_10 = 10;
const SECTION_11 = 11;
const LOCAL_CAMPOREE_ID = 21;
const PLAN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SLOT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRODUCT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LINE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PRINCIPAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DIRECTOR_ID = '33333333-3333-4333-8333-333333333333';

function clubActor(): CamporeeSupplyActor {
  return {
    userId: DIRECTOR_ID,
    sectionIds: [SECTION_11],
    globalAccess: false,
    canReview: false,
    localFieldId: LF_10,
    globalRoles: [],
    territory: { level: 'open' } satisfies ActorTerritoryScope,
    activeSection: {
      club_section_id: SECTION_11,
      club_id: 5,
      club_name: 'Club Orión',
      club_type_id: 1,
      role_name: 'director',
      local_field_id: LF_10,
    },
  };
}

function lfActor(): CamporeeSupplyActor {
  return {
    userId: 'lf-1',
    sectionIds: [],
    globalAccess: false,
    canReview: true,
    localFieldId: LF_10,
    globalRoles: ['director-lf'],
    territory: {
      level: 'local_field',
      localFieldId: LF_10,
      unionId: 2,
      divisionId: 1,
    },
  };
}

function localCamporee() {
  return {
    local_camporee_id: LOCAL_CAMPOREE_ID,
    name: 'Camporí',
    timezone: 'America/Mexico_City',
    supply_edit_cutoff_local_time: '21:00',
    local_field_id: LF_10,
    start_date: new Date('2026-08-28T00:00:00.000Z'),
    end_date: new Date('2026-08-30T00:00:00.000Z'),
  };
}

function lineRow(qty = '3.000') {
  return {
    camporee_supply_line_id: LINE_ID,
    plan_id: PLAN_ID,
    supply_date: new Date('2026-08-29T00:00:00.000Z'),
    slot_id: SLOT_ID,
    product_id: PRODUCT_ID,
    qty: new Prisma.Decimal(qty),
    unit_cost_centavos: 1000,
    line_total_centavos: 3000,
    slot: { label: 'Almuerzo', deliver_time: '13:00', sort_order: 1 },
    product: { name: 'Tortillas', uom: 'KG' },
    deliveries: [],
  };
}

function principalDoc() {
  return {
    camporee_supply_payment_doc_id: PRINCIPAL_ID,
    kind: 'PRINCIPAL',
    parent_id: null,
    folio_reference: 'INS20260001',
    total_centavos: 3000,
    status: 'ISSUED',
    note: null,
    created_at: new Date('2026-08-20T12:00:00.000Z'),
    paid_at: null,
  };
}

function submittedPlan(overrides: Record<string, unknown> = {}) {
  return {
    camporee_supply_plan_id: PLAN_ID,
    club_section_id: SECTION_11,
    local_field_id: LF_10,
    local_camporee_id: LOCAL_CAMPOREE_ID,
    union_camporee_id: null,
    status: 'SUBMITTED',
    committed_total_centavos: 3000,
    submitted_at: new Date('2026-08-20T12:00:00.000Z'),
    club: { name: 'Club Orión' },
    lines: [lineRow()],
    payments: [principalDoc()],
    ...overrides,
  };
}

describe('CamporeeSupplyPlansService', () => {
  it('emits a PRINCIPAL folio on first submit', async () => {
    const draft = {
      camporee_supply_plan_id: PLAN_ID,
      club_section_id: SECTION_11,
      local_field_id: LF_10,
      status: 'DRAFT',
      lines: [{ line_total_centavos: 3000 }],
      payments: [],
    };
    const tx = {
      camporee_supply_plans: {
        findFirst: jest.fn().mockResolvedValue(draft),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(submittedPlan()),
      },
      camporee_supply_payment_docs: { create: jest.fn() },
      camporee_supply_plan_audits: { create: jest.fn() },
    };
    const prisma = {
      local_camporees: { findUnique: jest.fn().mockResolvedValue(localCamporee()) },
      camporee_clubs: {
        findFirst: jest.fn().mockResolvedValue({ camporee_club_id: 1 }),
      },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const folio = {
      allocate: jest.fn().mockResolvedValue({
        folio: 1,
        folio_reference: 'INS20260001',
        year: 2026,
      }),
    };
    const service = new CamporeeSupplyPlansService(
      prisma as never,
      folio as unknown as CamporeeSupplyFolioService,
    );

    const result = await service.submit(LOCAL_CAMPOREE_ID, 'local', clubActor());

    expect(folio.allocate).toHaveBeenCalled();
    expect(tx.camporee_supply_payment_docs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'PRINCIPAL',
          folio_reference: 'INS20260001',
          total_centavos: 3000,
        }),
      }),
    );
    expect(result.payments[0].folio_reference).toBe('INS20260001');
    expect(result.net_centavos).toBe(3000);
  });

  it('issues a CHARGE child when a submitted plan increases', async () => {
    const tx = {
      camporee_supply_plans: {
        findFirst: jest.fn().mockResolvedValue(submittedPlan()),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(
          submittedPlan({
            committed_total_centavos: 4000,
            payments: [
              principalDoc(),
              {
                ...principalDoc(),
                camporee_supply_payment_doc_id: 'charge-1',
                kind: 'CHARGE',
                parent_id: PRINCIPAL_ID,
                folio_reference: 'INS20260002',
                total_centavos: 1000,
              },
            ],
            lines: [lineRow('4.000')],
          }),
        ),
      },
      camporee_supply_slots: {
        findMany: jest.fn().mockResolvedValue([
          { camporee_supply_slot_id: SLOT_ID },
        ]),
      },
      camporee_supply_products: {
        findMany: jest.fn().mockResolvedValue([
          {
            camporee_supply_product_id: PRODUCT_ID,
            unit_cost_centavos: 1000,
          },
        ]),
      },
      camporee_supply_lines: {
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          { line_total_centavos: 4000 },
        ]),
      },
      camporee_supply_payment_docs: { create: jest.fn() },
      camporee_supply_plan_audits: { create: jest.fn() },
    };
    const prisma = {
      local_camporees: { findUnique: jest.fn().mockResolvedValue(localCamporee()) },
      camporee_clubs: {
        findFirst: jest.fn().mockResolvedValue({ camporee_club_id: 1 }),
      },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const folio = {
      allocate: jest.fn().mockResolvedValue({
        folio: 2,
        folio_reference: 'INS20260002',
        year: 2026,
      }),
    };
    const service = new CamporeeSupplyPlansService(
      prisma as never,
      folio as unknown as CamporeeSupplyFolioService,
    );
    service.clock = { now: () => new Date('2026-08-26T15:00:00-06:00') };

    await service.adjustLine(
      LOCAL_CAMPOREE_ID,
      'local',
      {
        date: '2026-08-29',
        slot_id: SLOT_ID,
        product_id: PRODUCT_ID,
        qty: 4,
      },
      clubActor(),
    );

    expect(tx.camporee_supply_payment_docs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'CHARGE',
          parent_id: PRINCIPAL_ID,
          total_centavos: 1000,
          folio_reference: 'INS20260002',
        }),
      }),
    );
  });

  it('locks today for a club after submit', async () => {
    const tx = {
      camporee_supply_plans: {
        findFirst: jest.fn().mockResolvedValue(
          submittedPlan({
            lines: [
              {
                ...lineRow(),
                supply_date: new Date('2026-08-26T00:00:00.000Z'),
              },
            ],
          }),
        ),
      },
    };
    const prisma = {
      local_camporees: { findUnique: jest.fn().mockResolvedValue(localCamporee()) },
      camporee_clubs: {
        findFirst: jest.fn().mockResolvedValue({ camporee_club_id: 1 }),
      },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const service = new CamporeeSupplyPlansService(
      prisma as never,
      { allocate: jest.fn() } as unknown as CamporeeSupplyFolioService,
    );
    service.clock = { now: () => new Date('2026-08-26T10:00:00-06:00') };

    await expect(
      service.adjustLine(
        LOCAL_CAMPOREE_ID,
        'local',
        {
          date: '2026-08-26',
          slot_id: SLOT_ID,
          product_id: PRODUCT_ID,
          qty: 1,
        },
        clubActor(),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_SUPPLIES_DAY_LOCKED });
  });

  it('requires a reason when LF bypasses freeze', async () => {
    const tx = {
      camporee_supply_plans: {
        findFirst: jest.fn().mockResolvedValue(submittedPlan()),
      },
    };
    const prisma = {
      local_camporees: { findUnique: jest.fn().mockResolvedValue(localCamporee()) },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const service = new CamporeeSupplyPlansService(
      prisma as never,
      { allocate: jest.fn() } as unknown as CamporeeSupplyFolioService,
    );
    service.clock = { now: () => new Date('2026-08-26T10:00:00-06:00') };

    await expect(
      service.adjustLine(
        LOCAL_CAMPOREE_ID,
        'local',
        {
          club_section_id: SECTION_11,
          date: '2026-08-26',
          slot_id: SLOT_ID,
          product_id: PRODUCT_ID,
          qty: 1,
        },
        lfActor(),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_SUPPLIES_BYPASS_REASON_REQUIRED,
    });
  });
});
