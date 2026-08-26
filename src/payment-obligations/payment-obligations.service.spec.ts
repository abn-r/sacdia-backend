import type { OrderActor } from '../field-payment-orders/order-actor';
import { PaymentObligationsService } from './payment-obligations.service';

const LF_10 = 10;
const SECTION_11 = 11;
const SECTION_99 = 99;
const LOCAL_CAMPOREE_ID = 17;
const UNION_CAMPOREE_ID = 8;

function clubActor(overrides: Partial<OrderActor> = {}): OrderActor {
  return {
    userId: 'director-1',
    localFieldId: LF_10,
    sectionIds: [SECTION_11, SECTION_99],
    globalAccess: false,
    canReview: false,
    activeSection: {
      club_section_id: SECTION_11,
      club_id: 5,
      club_name: 'Club Orión',
      club_type_id: 1,
      role_name: 'director',
      local_field_id: LF_10,
    },
    ...overrides,
  };
}

function lfReviewer(overrides: Partial<OrderActor> = {}): OrderActor {
  return {
    userId: 'lf-reviewer-1',
    localFieldId: LF_10,
    sectionIds: [],
    globalAccess: false,
    canReview: true,
    ...overrides,
  };
}

function adminActor(): OrderActor {
  return {
    userId: 'admin-1',
    sectionIds: [],
    globalAccess: true,
    canReview: true,
  };
}

function unscopedActor(): OrderActor {
  return {
    userId: 'orphan-1',
    sectionIds: [SECTION_11],
    globalAccess: false,
    canReview: false,
  };
}

function fpo(overrides: Record<string, unknown> = {}) {
  return {
    field_payment_order_id: 'fpo-1',
    purpose: 'CAMPOREE',
    folio_reference: 'OP20260001',
    total_centavos: 30000,
    currency: 'MXN',
    status: 'ISSUED',
    local_camporee_id: LOCAL_CAMPOREE_ID,
    union_camporee_id: null,
    created_at: new Date('2026-08-24T18:00:00.000Z'),
    ...overrides,
  };
}

function camporeeOrder(overrides: Record<string, unknown> = {}) {
  return {
    camporee_order_id: 'co-1',
    folio_reference: 'PED20260001',
    total_centavos: 425000,
    currency: 'MXN',
    status: 'ISSUED',
    local_camporee_id: LOCAL_CAMPOREE_ID,
    union_camporee_id: null,
    created_at: new Date('2026-08-24T18:00:00.000Z'),
    local_camporee: { name: 'Camporí 2026' },
    union_camporee: null,
    ...overrides,
  };
}

function materialOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mo-1',
    folio_referencia: 'MAT20260001',
    total_centavos: 12000,
    estado: 'aprobada',
    created_at: new Date('2026-08-24T18:00:00.000Z'),
    ...overrides,
  };
}

function supplyPayment(overrides: Record<string, unknown> = {}) {
  return {
    camporee_supply_payment_doc_id: 'ins-1',
    kind: 'PRINCIPAL',
    folio_reference: 'INS20260001',
    total_centavos: 80000,
    local_camporee_id: LOCAL_CAMPOREE_ID,
    union_camporee_id: null,
    created_at: new Date('2026-08-24T19:00:00.000Z'),
    local_camporee: { name: 'Camporí 2026' },
    union_camporee: null,
    ...overrides,
  };
}

describe('PaymentObligationsService', () => {
  let prisma: {
    field_payment_orders: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    camporee_orders: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    camporee_supply_payment_docs: {
      findMany: jest.Mock;
    };
    materialOrder: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    local_camporees: { findMany: jest.Mock };
    union_camporees: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: PaymentObligationsService;

  beforeEach(() => {
    prisma = {
      field_payment_orders: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      camporee_orders: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      camporee_supply_payment_docs: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      materialOrder: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      local_camporees: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { local_camporee_id: LOCAL_CAMPOREE_ID, name: 'Camporí 2026' },
          ]),
      },
      union_camporees: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { union_camporee_id: UNION_CAMPOREE_ID, name: 'Camporí Unión' },
          ]),
      },
      $transaction: jest.fn(),
    };
    service = new PaymentObligationsService(prisma as any);
  });

  describe('listPending', () => {
    it('maps field payment orders, camporee orders and materials as separate rows', async () => {
      prisma.field_payment_orders.findMany.mockResolvedValue([fpo()]);
      prisma.camporee_orders.findMany.mockResolvedValue([camporeeOrder()]);
      prisma.materialOrder.findMany.mockResolvedValue([materialOrder()]);

      const result = await service.listPending({}, clubActor());

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'FIELD_PAYMENT_ORDER',
            source_id: 'fpo-1',
            purpose: 'CAMPOREE',
            folio: 'OP20260001',
            total_centavos: 30000,
            currency: 'MXN',
            camporee: {
              type: 'local',
              id: LOCAL_CAMPOREE_ID,
              name: 'Camporí 2026',
            },
          }),
          expect.objectContaining({
            source: 'CAMPOREE_ORDER',
            source_id: 'co-1',
            purpose: 'CAMPOREE_MATERIALS',
            folio: 'PED20260001',
            total_centavos: 425000,
            camporee: {
              type: 'local',
              id: LOCAL_CAMPOREE_ID,
              name: 'Camporí 2026',
            },
          }),
          expect.objectContaining({
            source: 'MATERIAL_ORDER',
            source_id: 'mo-1',
            purpose: 'MATERIALS',
            folio: 'MAT20260001',
            total_centavos: 12000,
            camporee: null,
          }),
        ]),
      );
      expect(result).toHaveLength(3);
    });

    it('maps issued supply principal and refund as distinct rows', async () => {
      prisma.camporee_supply_payment_docs.findMany.mockResolvedValue([
        supplyPayment(),
        supplyPayment({
          camporee_supply_payment_doc_id: 'ins-2',
          kind: 'REFUND',
          folio_reference: 'INS20260002',
          total_centavos: 10000,
        }),
      ]);

      const result = await service.listPending({}, clubActor());

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'CAMPOREE_SUPPLY_CHARGE',
            purpose: 'CAMPOREE_SUPPLIES',
            folio: 'INS20260001',
            action_required: 'PAY_AT_CAMP',
          }),
          expect.objectContaining({
            source: 'CAMPOREE_SUPPLY_REFUND',
            purpose: 'CAMPOREE_SUPPLIES',
            folio: 'INS20260002',
            action_required: 'PROCESS_REFUND',
          }),
        ]),
      );
    });

    it('maps ISSUED to PAYMENT_DUE / UPLOAD_PROOF', async () => {
      prisma.field_payment_orders.findMany.mockResolvedValue([
        fpo({ status: 'ISSUED' }),
      ]);
      prisma.camporee_orders.findMany.mockResolvedValue([
        camporeeOrder({ status: 'ISSUED' }),
      ]);

      const result = await service.listPending({}, clubActor());

      expect(result).toEqual([
        expect.objectContaining({
          source: 'CAMPOREE_ORDER',
          status: 'PAYMENT_DUE',
          action_required: 'UPLOAD_PROOF',
        }),
        expect.objectContaining({
          source: 'FIELD_PAYMENT_ORDER',
          status: 'PAYMENT_DUE',
          action_required: 'UPLOAD_PROOF',
        }),
      ]);
    });

    it('maps PROOF_SUBMITTED to UNDER_REVIEW / WAIT_REVIEW', async () => {
      prisma.field_payment_orders.findMany.mockResolvedValue([
        fpo({ status: 'PROOF_SUBMITTED' }),
      ]);

      const [row] = await service.listPending({}, clubActor());

      expect(row).toMatchObject({
        status: 'UNDER_REVIEW',
        action_required: 'WAIT_REVIEW',
      });
    });

    it('maps PROOF_REJECTED to PROOF_REJECTED / RESUBMIT_PROOF', async () => {
      prisma.camporee_orders.findMany.mockResolvedValue([
        camporeeOrder({ status: 'PROOF_REJECTED' }),
      ]);

      const [row] = await service.listPending({}, clubActor());

      expect(row).toMatchObject({
        source: 'CAMPOREE_ORDER',
        status: 'PROOF_REJECTED',
        action_required: 'RESUBMIT_PROOF',
      });
    });

    it('maps material en_revision to ORDER_REVIEW / WAIT_APPROVAL', async () => {
      prisma.materialOrder.findMany.mockResolvedValue([
        materialOrder({ estado: 'en_revision', folio_referencia: null }),
      ]);

      const [row] = await service.listPending({}, clubActor());

      expect(row).toMatchObject({
        source: 'MATERIAL_ORDER',
        folio: '—',
        status: 'ORDER_REVIEW',
        action_required: 'WAIT_APPROVAL',
        camporee: null,
      });
    });

    it('maps material aprobada to PAYMENT_DUE / UPLOAD_PROOF', async () => {
      prisma.materialOrder.findMany.mockResolvedValue([
        materialOrder({ estado: 'aprobada' }),
      ]);

      const [row] = await service.listPending({}, clubActor());

      expect(row).toMatchObject({
        status: 'PAYMENT_DUE',
        action_required: 'UPLOAD_PROOF',
      });
    });

    it('maps insurance field payment orders with purpose INSURANCE and no camporee', async () => {
      prisma.field_payment_orders.findMany.mockResolvedValue([
        fpo({
          purpose: 'INSURANCE',
          local_camporee_id: null,
          union_camporee_id: null,
        }),
      ]);

      const [row] = await service.listPending({}, clubActor());

      expect(row).toMatchObject({
        purpose: 'INSURANCE',
        camporee: null,
      });
    });

    it('keeps two camporee orders of the same section and camporee as independent rows', async () => {
      prisma.camporee_orders.findMany.mockResolvedValue([
        camporeeOrder({
          camporee_order_id: 'co-1',
          folio_reference: 'PED20260001',
          total_centavos: 15000,
        }),
        camporeeOrder({
          camporee_order_id: 'co-2',
          folio_reference: 'PED20260002',
          total_centavos: 8000,
        }),
      ]);

      const result = await service.listPending({}, clubActor());

      expect(result).toHaveLength(2);
      expect(result.map((row) => row.source_id).sort()).toEqual([
        'co-1',
        'co-2',
      ]);
      expect(result.map((row) => row.folio).sort()).toEqual([
        'PED20260001',
        'PED20260002',
      ]);
      expect(new Set(result.map((row) => row.source))).toEqual(
        new Set(['CAMPOREE_ORDER']),
      );
    });

    it('scopes a club actor to the active section only', async () => {
      await service.listPending({}, clubActor());

      expect(prisma.field_payment_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ club_section_id: SECTION_11 }),
        }),
      );
      expect(prisma.camporee_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ club_section_id: SECTION_11 }),
        }),
      );
      expect(prisma.materialOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ club_section_id: SECTION_11 }),
        }),
      );
      expect(
        prisma.field_payment_orders.findMany.mock.calls[0][0].where,
      ).not.toEqual(
        expect.objectContaining({
          club_section_id: { in: [SECTION_11, SECTION_99] },
        }),
      );
    });

    it('scopes an LF reviewer to the actor local field', async () => {
      await service.listPending({}, lfReviewer());

      expect(prisma.camporee_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ local_field_id: LF_10 }),
        }),
      );
      expect(prisma.field_payment_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ local_field_id: LF_10 }),
        }),
      );
      expect(prisma.materialOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ local_field_id: LF_10 }),
        }),
      );
    });

    it('returns an empty list when the actor has no active section and no local field', async () => {
      const result = await service.listPending({}, unscopedActor());

      expect(result).toEqual([]);
      expect(prisma.field_payment_orders.findMany).not.toHaveBeenCalled();
      expect(prisma.camporee_orders.findMany).not.toHaveBeenCalled();
      expect(prisma.materialOrder.findMany).not.toHaveBeenCalled();
    });

    it('lets globalAccess list without a territorial filter', async () => {
      await service.listPending({}, adminActor());

      const where = prisma.camporee_orders.findMany.mock.calls[0][0].where;
      expect(where.club_section_id).toBeUndefined();
      expect(where.local_field_id).toBeUndefined();
      expect(where.status).toEqual({
        in: ['ISSUED', 'PROOF_SUBMITTED', 'PROOF_REJECTED'],
      });
    });

    it('queries only pending statuses and material estados', async () => {
      await service.listPending({}, clubActor());

      expect(prisma.field_payment_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['ISSUED', 'PROOF_SUBMITTED', 'PROOF_REJECTED'] },
          }),
        }),
      );
      expect(prisma.materialOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            estado: { in: ['en_revision', 'aprobada'] },
          }),
        }),
      );
    });

    it('filters by local camporee and excludes materials', async () => {
      await service.listPending(
        { camporee_id: LOCAL_CAMPOREE_ID },
        clubActor(),
      );

      expect(prisma.field_payment_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            local_camporee_id: LOCAL_CAMPOREE_ID,
          }),
        }),
      );
      expect(prisma.camporee_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            local_camporee_id: LOCAL_CAMPOREE_ID,
          }),
        }),
      );
      expect(prisma.materialOrder.findMany).not.toHaveBeenCalled();
    });

    it('filters by union camporee and excludes materials', async () => {
      prisma.camporee_orders.findMany.mockResolvedValue([
        camporeeOrder({
          local_camporee_id: null,
          union_camporee_id: UNION_CAMPOREE_ID,
          local_camporee: null,
          union_camporee: { name: 'Camporí Unión' },
        }),
      ]);

      const result = await service.listPending(
        { union_camporee_id: UNION_CAMPOREE_ID },
        clubActor(),
      );

      expect(prisma.camporee_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            union_camporee_id: UNION_CAMPOREE_ID,
          }),
        }),
      );
      expect(prisma.materialOrder.findMany).not.toHaveBeenCalled();
      expect(result[0]?.camporee).toEqual({
        type: 'union',
        id: UNION_CAMPOREE_ID,
        name: 'Camporí Unión',
      });
    });

    it('sorts by created_at desc, then source, then folio', async () => {
      prisma.materialOrder.findMany.mockResolvedValue([
        materialOrder({
          id: 'mo-late',
          folio_referencia: 'MAT-1',
          created_at: new Date('2026-08-24T20:00:00.000Z'),
        }),
      ]);
      prisma.camporee_orders.findMany.mockResolvedValue([
        camporeeOrder({
          camporee_order_id: 'co-2',
          folio_reference: 'PED20260002',
          created_at: new Date('2026-08-24T18:00:00.000Z'),
        }),
        camporeeOrder({
          camporee_order_id: 'co-1',
          folio_reference: 'PED20260001',
          created_at: new Date('2026-08-24T18:00:00.000Z'),
        }),
        camporeeOrder({
          camporee_order_id: 'co-old',
          folio_reference: 'PED20250001',
          created_at: new Date('2026-08-24T17:00:00.000Z'),
        }),
      ]);
      prisma.field_payment_orders.findMany.mockResolvedValue([
        fpo({
          field_payment_order_id: 'fpo-1',
          folio_reference: 'OP20260001',
          created_at: new Date('2026-08-24T18:00:00.000Z'),
        }),
      ]);

      const result = await service.listPending({}, clubActor());

      expect(result.map((row) => row.folio)).toEqual([
        'MAT-1',
        'PED20260001',
        'PED20260002',
        'OP20260001',
        'PED20250001',
      ]);
    });

    it('does not write to any table', async () => {
      prisma.field_payment_orders.findMany.mockResolvedValue([fpo()]);
      prisma.camporee_orders.findMany.mockResolvedValue([camporeeOrder()]);
      prisma.materialOrder.findMany.mockResolvedValue([materialOrder()]);

      await service.listPending({}, clubActor());

      expect(prisma.field_payment_orders.create).not.toHaveBeenCalled();
      expect(prisma.field_payment_orders.update).not.toHaveBeenCalled();
      expect(prisma.field_payment_orders.updateMany).not.toHaveBeenCalled();
      expect(prisma.camporee_orders.create).not.toHaveBeenCalled();
      expect(prisma.camporee_orders.update).not.toHaveBeenCalled();
      expect(prisma.camporee_orders.updateMany).not.toHaveBeenCalled();
      expect(prisma.materialOrder.create).not.toHaveBeenCalled();
      expect(prisma.materialOrder.update).not.toHaveBeenCalled();
      expect(prisma.materialOrder.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('serializes created_at as an ISO string', async () => {
      prisma.camporee_orders.findMany.mockResolvedValue([camporeeOrder()]);

      const [row] = await service.listPending({}, clubActor());

      expect(row.created_at).toBe('2026-08-24T18:00:00.000Z');
    });
  });
});
