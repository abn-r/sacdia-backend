import { InsuranceFulfillmentService } from './insurance-fulfillment.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { OrderActor } from '../order-actor';

function actorWithSection(overrides: Partial<OrderActor> = {}): OrderActor {
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

const CYCLE = {
  insurance_cycle_config_id: 33,
  insurance_product_id: 2,
  local_field_id: 7,
  club_type_id: 1,
  unit_cost: 150.5,
  purchase_deadline: new Date('2026-10-01'),
  active: true,
  product: {
    insurance_product_id: 2,
    name: 'Seguro anual Conquistadores',
    active: true,
    validity_mode: 'FIXED_MONTHS',
    default_duration_months: 12,
  },
};

const SECTION_ROW = {
  club_type_id: 1,
  main_club_id: 5,
  clubs: { club_id: 5, local_field_id: 7 },
};

describe('InsuranceFulfillmentService.prepareOrder', () => {
  let prisma: any;
  let service: InsuranceFulfillmentService;

  const dto = {
    insurance_cycle_config_id: 33,
    beneficiary_user_ids: ['ben-1', 'ben-2'],
  };

  beforeEach(() => {
    prisma = {
      insurance_cycle_configs: {
        findUnique: jest.fn().mockResolvedValue(CYCLE),
      },
      club_sections: { findUnique: jest.fn().mockResolvedValue(SECTION_ROW) },
      club_role_assignments: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ user_id: 'ben-1' }, { user_id: 'ben-2' }]),
      },
      insurance_assignments: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new InsuranceFulfillmentService(prisma);
  });

  it('prepares the order with cost snapshot in centavos', async () => {
    const prepared = await service.prepareOrder(dto, actorWithSection());

    expect(prepared).toEqual({
      local_field_id: 7,
      club_id: 5,
      club_section_id: 11,
      purpose_ref_id: 33,
      unit_cost_centavos: 15050,
      currency: 'MXN',
      concept: 'Seguro anual Conquistadores',
      beneficiary_user_ids: ['ben-1', 'ben-2'],
    });
  });

  it('rejects actors without an active section', async () => {
    await expect(
      service.prepareOrder(dto, actorWithSection({ activeSection: undefined })),
    ).rejects.toMatchObject({ code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN });
  });

  it('rejects inactive cycles', async () => {
    prisma.insurance_cycle_configs.findUnique.mockResolvedValue({
      ...CYCLE,
      active: false,
    });
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
    });
  });

  it('rejects a cycle scoped to another LF or club type', async () => {
    prisma.insurance_cycle_configs.findUnique.mockResolvedValue({
      ...CYCLE,
      club_type_id: 2,
    });
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
    });
  });

  it('rejects zero-cost cycles as configuration error', async () => {
    prisma.insurance_cycle_configs.findUnique.mockResolvedValue({
      ...CYCLE,
      unit_cost: 0,
    });
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_COST_NOT_CONFIGURED,
    });
  });

  it('rejects beneficiaries that are not active members of the section', async () => {
    prisma.club_role_assignments.findMany.mockResolvedValue([
      { user_id: 'ben-1' },
    ]);
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED,
    });
  });

  it('rejects beneficiaries already covered in the cycle', async () => {
    prisma.insurance_assignments.findMany.mockResolvedValue([
      { user_id: 'ben-2' },
    ]);
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
    });
  });
});

describe('InsuranceFulfillmentService.fulfill', () => {
  let tx: any;
  let service: InsuranceFulfillmentService;

  const order = {
    field_payment_order_id: 'o1',
    purpose: 'INSURANCE' as const,
    local_field_id: 7,
    club_id: 5,
    club_section_id: 11,
    insurance_cycle_config_id: 33,
    local_camporee_id: null,
    folio_reference: 'ORD20260007',
    issued_by_id: 'director-1',
    unit_cost_centavos: 15050,
    total_centavos: 30100,
    lines: [
      {
        field_payment_order_line_id: 'l1',
        beneficiary_user_id: 'ben-1',
        sequence: 1,
      },
      {
        field_payment_order_line_id: 'l2',
        beneficiary_user_id: 'ben-2',
        sequence: 2,
      },
    ],
  };

  const reviewer = actorWithSection({
    userId: 'lf-reviewer-1',
    canReview: true,
    activeSection: undefined,
    sectionIds: [],
  });

  beforeEach(() => {
    let slotSeq = 0;
    let assignmentSeq = 0;
    tx = {
      insurance_cycle_configs: {
        findUnique: jest.fn().mockResolvedValue(CYCLE),
      },
      club_role_assignments: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ user_id: 'ben-1' }, { user_id: 'ben-2' }]),
      },
      insurance_assignments: {
        findMany: jest.fn().mockResolvedValue([]),
        createManyAndReturn: jest.fn().mockImplementation(({ data }: { data: Array<{ insurance_coverage_slot_id: number }> }) =>
          Promise.resolve(
            data.map((row) => ({
              insurance_assignment_id: ++assignmentSeq,
              insurance_coverage_slot_id: row.insurance_coverage_slot_id,
            })),
          ),
        ),
      },
      insurance_purchases: {
        create: jest.fn().mockResolvedValue({ insurance_purchase_id: 900 }),
      },
      insurance_coverage_slots: {
        createManyAndReturn: jest.fn().mockImplementation(({ data }: { data: Array<{ sequence_number: number }> }) =>
          Promise.resolve(
            data.map((row) => ({
              insurance_coverage_slot_id: ++slotSeq,
              sequence_number: row.sequence_number,
            })),
          ),
        ),
      },
      insurance_slot_movements: { createMany: jest.fn() },
      member_insurances: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
        updateMany: jest.fn(),
      },
      field_payment_order_lines: { update: jest.fn() },
    };
    service = new InsuranceFulfillmentService({} as any);
  });

  it('materializes purchase CONFIRMED + slot ASSIGNED + assignment ACTIVE + bridge per line', async () => {
    await service.fulfill(tx, order, reviewer);

    expect(tx.insurance_purchases.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        insurance_cycle_config_id: 33,
        quantity: 2,
        status: 'CONFIRMED',
        external_reference: 'ORD20260007',
        submitted_by_id: 'director-1',
        reviewed_by_id: 'lf-reviewer-1',
      }),
    });
    expect(tx.insurance_coverage_slots.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.insurance_coverage_slots.createManyAndReturn).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ status: 'ASSIGNED', sequence_number: 1 }),
        expect.objectContaining({ status: 'ASSIGNED', sequence_number: 2 }),
      ]),
    });
    expect(tx.insurance_assignments.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.insurance_assignments.createManyAndReturn).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          subject_type: 'MEMBER',
          user_id: 'ben-1',
          status: 'ACTIVE',
        }),
      ]),
    });
    expect(tx.member_insurances.findMany).toHaveBeenCalledTimes(1);
    expect(tx.member_insurances.createMany).toHaveBeenCalledTimes(1);
    expect(tx.member_insurances.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ user_id: 'ben-1' }),
        expect.objectContaining({ user_id: 'ben-2' }),
      ]),
    });
    expect(tx.field_payment_order_lines.update).toHaveBeenCalledWith({
      where: { field_payment_order_line_id: 'l1' },
      data: { insurance_assignment_id: 1 },
    });
  });

  it('extends the bridge instead of duplicating when an active policy covers the start', async () => {
    tx.member_insurances.findMany.mockResolvedValue([
      {
        insurance_id: 77,
        user_id: 'ben-1',
        end_date: new Date('2026-01-01'),
      },
      {
        insurance_id: 78,
        user_id: 'ben-2',
        end_date: new Date('2026-01-01'),
      },
    ]);
    await service.fulfill(tx, order, reviewer);

    expect(tx.member_insurances.createMany).not.toHaveBeenCalled();
    expect(tx.member_insurances.updateMany).toHaveBeenCalledWith({
      where: { insurance_id: { in: [77, 78] } },
      data: expect.objectContaining({
        end_date: expect.any(Date),
        modified_by_id: 'lf-reviewer-1',
      }),
    });
  });

  it('fails with 409 and no side effects when membership broke before approve', async () => {
    tx.club_role_assignments.findMany.mockResolvedValue([
      { user_id: 'ben-1' },
    ]);
    await expect(service.fulfill(tx, order, reviewer)).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED,
    });
    expect(tx.insurance_purchases.create).not.toHaveBeenCalled();
  });

  it('fails when a beneficiary got covered between issue and approve', async () => {
    tx.insurance_assignments.findMany.mockResolvedValue([
      { user_id: 'ben-2' },
    ]);
    await expect(service.fulfill(tx, order, reviewer)).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
    });
    expect(tx.insurance_purchases.create).not.toHaveBeenCalled();
  });

  it('propagates bridge failures so the whole approve rolls back', async () => {
    tx.member_insurances.createMany.mockRejectedValue(new Error('bridge down'));
    await expect(service.fulfill(tx, order, reviewer)).rejects.toThrow(
      'bridge down',
    );
  });
});
