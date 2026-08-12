import { FieldPaymentOrdersService } from './field-payment-orders.service';
import { ErrorCode } from '../common/errors/error-codes';
import type { OrderActor } from './order-actor';
import type { PreparedOrder } from './fulfillment/ports';

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

function directorActor(overrides: Partial<OrderActor> = {}): OrderActor {
  return {
    userId: 'director-1',
    localFieldId: 7,
    sectionIds: [11],
    globalAccess: false,
    canReview: false,
    activeSection: {
      club_section_id: 11,
      club_id: 5,
      club_name: 'Club Orión',
      club_type_id: 1,
      role_name: 'director',
      local_field_id: 7,
    },
    ...overrides,
  };
}

function reviewerActor(overrides: Partial<OrderActor> = {}): OrderActor {
  return {
    userId: 'lf-reviewer-1',
    localFieldId: 7,
    sectionIds: [],
    globalAccess: false,
    canReview: true,
    ...overrides,
  };
}

function preparedOrder(overrides: Partial<PreparedOrder> = {}): PreparedOrder {
  return {
    local_field_id: 7,
    club_id: 5,
    club_section_id: 11,
    purpose_ref_id: 33,
    unit_cost_centavos: 15000,
    currency: 'MXN',
    concept: 'Seguro anual 2026',
    beneficiary_user_ids: ['ben-1', 'ben-2'],
    ...overrides,
  };
}

describe('FieldPaymentOrdersService', () => {
  let tx: any;
  let prisma: any;
  let folio: any;
  let flag: any;
  let proofs: any;
  let pdf: any;
  let insurancePort: any;
  let camporeePort: any;
  let service: FieldPaymentOrdersService;

  beforeEach(() => {
    tx = {
      field_payment_orders: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      field_payment_order_lines: { updateMany: jest.fn() },
      field_payment_order_proofs: { update: jest.fn() },
    };
    prisma = {
      field_payment_orders: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      field_payment_order_proofs: { findFirst: jest.fn() },
      field_payment_order_configs: { findUnique: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    folio = {
      allocate: jest
        .fn()
        .mockResolvedValue({ folio: 1, folio_reference: 'ORD20260001', year: 2026 }),
    };
    flag = {
      isEnabledForLocalField: jest.fn().mockResolvedValue(true),
      getExpiryDays: jest.fn().mockResolvedValue(15),
    };
    proofs = { upload: jest.fn(), getSignedDownload: jest.fn() };
    pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF')) };
    insurancePort = {
      prepareOrder: jest.fn().mockResolvedValue(preparedOrder()),
      fulfill: jest.fn().mockResolvedValue(undefined),
    };
    camporeePort = { prepareOrder: jest.fn(), fulfill: jest.fn() };
    service = new FieldPaymentOrdersService(
      prisma,
      folio,
      flag,
      proofs,
      pdf,
      insurancePort,
      camporeePort,
    );
  });

  describe('create', () => {
    it('creates an insurance order with folio, expiry and lines', async () => {
      tx.field_payment_orders.create.mockResolvedValue({ id: 'o1' });

      await service.createInsuranceOrder(
        { insurance_cycle_config_id: 33, beneficiary_user_ids: ['ben-1', 'ben-2'] },
        directorActor(),
      );

      expect(folio.allocate).toHaveBeenCalledWith(tx, 7);
      const data = tx.field_payment_orders.create.mock.calls[0][0].data;
      expect(data.purpose).toBe('INSURANCE');
      expect(data.insurance_cycle_config_id).toBe(33);
      expect(data.local_camporee_id).toBeNull();
      expect(data.total_centavos).toBe(30000);
      expect(data.lines.create).toHaveLength(2);
      expect(data.lines.create[0]).toMatchObject({
        sequence: 1,
        beneficiary_user_id: 'ben-1',
        purpose: 'INSURANCE',
        purpose_ref_id: 33,
      });
      // expiry ≈ now + 15 days
      const deltaDays =
        (data.expires_at.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(deltaDays).toBeGreaterThan(14.9);
      expect(deltaDays).toBeLessThanOrEqual(15);
    });

    it('rejects creation when the LF flag is off', async () => {
      flag.isEnabledForLocalField.mockResolvedValue(false);
      await expect(
        service.createInsuranceOrder(
          { insurance_cycle_config_id: 33, beneficiary_user_ids: ['ben-1'] },
          directorActor(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_FLAG_DISABLED,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('maps P2002 to duplicate beneficiary conflict', async () => {
      const p2002 = Object.create(
        require('@prisma/client').Prisma.PrismaClientKnownRequestError
          .prototype,
      );
      p2002.code = 'P2002';
      prisma.$transaction.mockRejectedValue(p2002);

      await expect(
        service.createInsuranceOrder(
          { insurance_cycle_config_id: 33, beneficiary_user_ids: ['ben-1'] },
          directorActor(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
      });
    });

    it('returns the existing order when the idempotency key was used', async () => {
      prisma.field_payment_orders.findFirst.mockResolvedValue({ id: 'prev' });
      const result = await service.createInsuranceOrder(
        { insurance_cycle_config_id: 33, beneficiary_user_ids: ['ben-1'] },
        directorActor(),
        'b7f43c60-0000-4000-8000-000000000001',
      );
      expect(result).toEqual({ id: 'prev' });
      expect(insurancePort.prepareOrder).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels an ISSUED order and releases the beneficiary guard', async () => {
      prisma.field_payment_orders.findUnique.mockResolvedValue({
        field_payment_order_id: 'o1',
        club_section_id: 11,
        local_field_id: 7,
        status: 'ISSUED',
        expires_at: FUTURE,
      });
      tx.field_payment_orders.update.mockResolvedValue({ status: 'CANCELLED' });

      await service.cancel('o1', directorActor());

      expect(tx.field_payment_order_lines.updateMany).toHaveBeenCalledWith({
        where: { field_payment_order_id: 'o1' },
        data: { active_guard: false },
      });
    });

    it('rejects cancel on PROOF_SUBMITTED', async () => {
      prisma.field_payment_orders.findUnique.mockResolvedValue({
        field_payment_order_id: 'o1',
        club_section_id: 11,
        local_field_id: 7,
        status: 'PROOF_SUBMITTED',
        expires_at: FUTURE,
      });
      await expect(service.cancel('o1', directorActor())).rejects.toMatchObject(
        { code: ErrorCode.FIELD_PAYMENT_ORDER_INVALID_TRANSITION },
      );
    });

    it('rejects actors outside the order section', async () => {
      prisma.field_payment_orders.findUnique.mockResolvedValue({
        field_payment_order_id: 'o1',
        club_section_id: 99,
        local_field_id: 7,
        status: 'ISSUED',
        expires_at: FUTURE,
      });
      await expect(service.cancel('o1', directorActor())).rejects.toMatchObject(
        { code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN },
      );
    });
  });

  describe('lazy expiry', () => {
    it('expires an ISSUED order past its deadline on read', async () => {
      prisma.field_payment_orders.findUnique.mockResolvedValue({
        field_payment_order_id: 'o1',
        club_section_id: 11,
        local_field_id: 7,
        status: 'ISSUED',
        expires_at: PAST,
      });

      const result = await service.get('o1', directorActor());

      expect(result.status).toBe('EXPIRED');
      expect(tx.field_payment_orders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { field_payment_order_id: 'o1', status: 'ISSUED' },
        }),
      );
      expect(tx.field_payment_order_lines.updateMany).toHaveBeenCalledWith({
        where: { field_payment_order_id: 'o1' },
        data: { active_guard: false },
      });
    });

    it('blocks proof upload on an expired order', async () => {
      prisma.field_payment_orders.findUnique.mockResolvedValue({
        field_payment_order_id: 'o1',
        club_section_id: 11,
        local_field_id: 7,
        status: 'ISSUED',
        expires_at: PAST,
      });
      await expect(
        service.uploadProof('o1', {} as any, directorActor()),
      ).rejects.toMatchObject({ code: ErrorCode.FIELD_PAYMENT_ORDER_EXPIRED });
      expect(proofs.upload).not.toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    const submittedOrder = {
      field_payment_order_id: 'o1',
      purpose: 'INSURANCE',
      club_section_id: 11,
      local_field_id: 7,
      status: 'PROOF_SUBMITTED',
      expires_at: FUTURE,
      lines: [],
    };

    beforeEach(() => {
      prisma.field_payment_orders.findUnique.mockResolvedValue(submittedOrder);
      prisma.field_payment_order_proofs.findFirst.mockResolvedValue({
        field_payment_order_proof_id: 'p1',
        uploaded_by_id: 'director-1',
        status: 'SUBMITTED',
      });
      tx.field_payment_orders.update.mockResolvedValue({
        ...submittedOrder,
        status: 'APPROVED',
      });
    });

    it('approves, fulfills atomically and marks the proof', async () => {
      await service.approve('o1', reviewerActor());

      expect(insurancePort.fulfill).toHaveBeenCalled();
      expect(tx.field_payment_orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { field_payment_order_id: 'o1', status: 'PROOF_SUBMITTED' },
          data: expect.objectContaining({
            status: 'APPROVED',
            approved_by_id: 'lf-reviewer-1',
          }),
        }),
      );
      expect(tx.field_payment_order_proofs.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
    });

    it('enforces maker-checker: uploader cannot approve', async () => {
      await expect(
        service.approve('o1', reviewerActor({ userId: 'director-1' })),
      ).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_MAKER_CHECKER,
      });
      expect(insurancePort.fulfill).not.toHaveBeenCalled();
    });

    it('rejects reviewers from another local field', async () => {
      await expect(
        service.approve('o1', reviewerActor({ localFieldId: 99 })),
      ).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN,
      });
    });

    it('rejects non-reviewers', async () => {
      await expect(
        service.approve('o1', directorActor()),
      ).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN,
      });
    });

    it('rolls back approval if fulfillment throws', async () => {
      insurancePort.fulfill.mockRejectedValue(new Error('slots exhausted'));
      await expect(service.approve('o1', reviewerActor())).rejects.toThrow(
        'slots exhausted',
      );
      // proof update happens after fulfill: never reached on failure
      expect(tx.field_payment_order_proofs.update).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    beforeEach(() => {
      prisma.field_payment_orders.findUnique.mockResolvedValue({
        field_payment_order_id: 'o1',
        club_section_id: 11,
        local_field_id: 7,
        status: 'PROOF_SUBMITTED',
        expires_at: FUTURE,
      });
      prisma.field_payment_order_proofs.findFirst.mockResolvedValue({
        field_payment_order_proof_id: 'p1',
        uploaded_by_id: 'director-1',
        status: 'SUBMITTED',
      });
      tx.field_payment_orders.update.mockResolvedValue({
        status: 'PROOF_REJECTED',
      });
    });

    it('requires a reason', async () => {
      await expect(
        service.reject('o1', '   ', reviewerActor()),
      ).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_REJECT_REASON_REQUIRED,
      });
    });

    it('marks proof REJECTED and order PROOF_REJECTED', async () => {
      await service.reject('o1', 'monto no coincide', reviewerActor());

      expect(tx.field_payment_order_proofs.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REJECTED',
            reject_reason: 'monto no coincide',
          }),
        }),
      );
      expect(tx.field_payment_orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'PROOF_REJECTED' },
        }),
      );
    });
  });

  describe('list scope', () => {
    it('scopes club actors to their sections', async () => {
      await service.list({}, directorActor());
      const where = prisma.field_payment_orders.findMany.mock.calls.at(-1)[0]
        .where;
      expect(where.club_section_id).toEqual({ in: [11] });
    });

    it('scopes LF reviewers to their local field', async () => {
      await service.list({}, reviewerActor());
      const where = prisma.field_payment_orders.findMany.mock.calls.at(-1)[0]
        .where;
      expect(where.local_field_id).toBe(7);
    });
  });
});
