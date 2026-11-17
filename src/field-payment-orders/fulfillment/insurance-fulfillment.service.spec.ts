import { InsuranceFulfillmentService } from './insurance-fulfillment.service';
import { InsuranceCoverageService } from '../insurance-coverage.service';
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

// Fixed "today": 2026-11-17 (America/Mexico_City). Year: 2026-01-01 .. 2026-12-31.
const NOW = new Date('2026-11-17T18:00:00.000Z');
const YEAR = {
  year_id: 5,
  start_date: new Date('2026-01-01T00:00:00.000Z'),
  end_date: new Date('2026-12-31T00:00:00.000Z'),
};

/** Prisma mock slice used by InsuranceCoverageService with "nothing conflicting". */
function coverageMocks(overrides: Record<string, any> = {}) {
  return {
    ecclesiastical_years: { findFirst: jest.fn().mockResolvedValue(YEAR) },
    club_role_assignments: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ user_id: 'ben-1' }, { user_id: 'ben-2' }]),
    },
    insurance_assignments: { findMany: jest.fn().mockResolvedValue([]) },
    insurance_cycle_configs: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ insurance_cycle_config_id: 33 }]),
    },
    field_payment_orders: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
    field_payment_order_lines: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    club_sections: { findMany: jest.fn().mockResolvedValue([]) },
    users: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

beforeAll(() => {
  jest.useFakeTimers({ now: NOW });
});
afterAll(() => {
  jest.useRealTimers();
});

const CYCLE = {
  insurance_cycle_config_id: 33,
  ecclesiastical_year_id: 5,
  ecclesiastical_year: YEAR,
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
    prisma = coverageMocks();
    prisma.insurance_cycle_configs.findUnique = jest
      .fn()
      .mockResolvedValue(CYCLE);
    prisma.club_sections.findUnique = jest.fn().mockResolvedValue(SECTION_ROW);
    service = new InsuranceFulfillmentService(
      prisma,
      new InsuranceCoverageService(prisma),
    );
  });

  it('prepares the order with cost snapshot in centavos and the year as purpose_ref_id', async () => {
    const prepared = await service.prepareOrder(dto, actorWithSection());

    expect(prepared).toEqual({
      local_field_id: 7,
      club_id: 5,
      club_section_id: 11,
      purpose_ref_id: 5,
      insurance_cycle_config_id: 33,
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

  it('rejects a cycle whose ecclesiastical year already ended', async () => {
    prisma.insurance_cycle_configs.findUnique.mockResolvedValue({
      ...CYCLE,
      ecclesiastical_year: {
        ...YEAR,
        end_date: new Date('2026-06-30T00:00:00.000Z'),
      },
    });
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_CYCLE_INVALID,
    });
  });

  it('accepts staff (directiva) of the section as beneficiaries', async () => {
    // club_role_assignments rows are role-agnostic: a director row qualifies.
    const prepared = await service.prepareOrder(
      { ...dto, beneficiary_user_ids: ['ben-1', 'ben-2'] },
      actorWithSection(),
    );
    expect(prepared.beneficiary_user_ids).toHaveLength(2);
    expect(prisma.club_role_assignments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          club_section_id: 11,
          active: true,
          status: 'active',
          ecclesiastical_year_id: 5,
        }),
      }),
    );
    const where = prisma.club_role_assignments.findMany.mock.calls[0][0].where;
    expect(where.roles).toBeUndefined();
  });

  it('rejects a person already covered this year anywhere, reporting where it was paid', async () => {
    prisma.insurance_assignments.findMany.mockResolvedValue([
      {
        insurance_assignment_id: 9,
        user_id: 'ben-2',
        valid_until: new Date('2026-12-31T00:00:00.000Z'),
        coverage_slot: {
          purchasing_section: {
            club_types: { name: 'Guías Mayores' },
            clubs: { name: 'Club Sirio' },
          },
          purchase: {
            external_reference: 'ORD20260003',
            owner_club: { name: 'Club Sirio' },
          },
        },
      },
    ]);
    prisma.users.findMany.mockResolvedValue([
      {
        user_id: 'ben-2',
        name: 'Ana',
        paternal_last_name: 'Pérez',
        maternal_last_name: null,
      },
    ]);
    const error: any = await service
      .prepareOrder(dto, actorWithSection())
      .catch((e) => e);
    expect(error.code).toBe(
      ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
    );
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse().data.conflicts).toEqual([
      {
        user_id: 'ben-2',
        name: 'Ana Pérez',
        reason: 'already_covered',
        section_name: 'Guías Mayores',
        club_name: 'Club Sirio',
        folio: 'ORD20260003',
        valid_until: '2026-12-31',
      },
    ]);
    // Coverage is searched by ecclesiastical year (any club type), not by cycle.
    const where = prisma.insurance_assignments.findMany.mock.calls[0][0].where;
    expect(where.coverage_slot.purchase).toEqual({
      cycle_config: { ecclesiastical_year_id: 5 },
    });
    expect(where.status).toBe('ACTIVE');
    expect(where.valid_until).toEqual({
      gte: new Date('2026-11-17T00:00:00.000Z'),
    });
  });

  it('rejects a person already in a live-or-paid order of the same year', async () => {
    prisma.field_payment_order_lines.findMany.mockResolvedValue([
      {
        beneficiary_user_id: 'ben-1',
        order: {
          field_payment_order_id: 'o-other',
          folio_reference: 'ORD20260009',
          status: 'PROOF_SUBMITTED',
          expires_at: new Date('2026-12-01T00:00:00.000Z'),
          club_section_id: 40,
        },
      },
    ]);
    prisma.club_sections.findMany.mockResolvedValue([
      {
        club_section_id: 40,
        club_types: { name: 'Aventureros' },
        clubs: { name: 'Club Orión' },
      },
    ]);
    const error: any = await service
      .prepareOrder(dto, actorWithSection())
      .catch((e) => e);
    expect(error.code).toBe(
      ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
    );
    expect(error.getResponse().data.conflicts[0]).toMatchObject({
      user_id: 'ben-1',
      reason: 'in_live_order',
      folio: 'ORD20260009',
      order_status: 'PROOF_SUBMITTED',
      section_name: 'Aventureros',
    });
    const where =
      prisma.field_payment_order_lines.findMany.mock.calls[0][0].where;
    expect(where.order.status).toEqual({
      in: ['ISSUED', 'PROOF_SUBMITTED', 'PROOF_REJECTED', 'APPROVED'],
    });
    expect(where.order.insurance_cycle_config_id).toEqual({ in: [33] });
  });

  it('releases expired ISSUED orders before checking conflicts', async () => {
    prisma.field_payment_orders.findMany.mockResolvedValue([
      { field_payment_order_id: 'o-stale' },
    ]);
    await service.prepareOrder(dto, actorWithSection());
    expect(prisma.field_payment_orders.updateMany).toHaveBeenCalledWith({
      where: { field_payment_order_id: { in: ['o-stale'] }, status: 'ISSUED' },
      data: { status: 'EXPIRED', expired_at: expect.any(Date) },
    });
    expect(prisma.field_payment_order_lines.updateMany).toHaveBeenCalledWith({
      where: { field_payment_order_id: { in: ['o-stale'] } },
      data: { active_guard: false },
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
    const base = coverageMocks();
    tx = {
      ...base,
      insurance_cycle_configs: {
        findUnique: jest.fn().mockResolvedValue(CYCLE),
        findMany: base.insurance_cycle_configs.findMany,
      },
      insurance_assignments: {
        findMany: jest.fn().mockResolvedValue([]),
        createManyAndReturn: jest
          .fn()
          .mockImplementation(
            ({
              data,
            }: {
              data: Array<{ insurance_coverage_slot_id: number }>;
            }) =>
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
        createManyAndReturn: jest
          .fn()
          .mockImplementation(
            ({ data }: { data: Array<{ sequence_number: number }> }) =>
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
    };
    service = new InsuranceFulfillmentService(
      {} as any,
      new InsuranceCoverageService({} as any),
    );
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
    expect(
      tx.insurance_coverage_slots.createManyAndReturn,
    ).toHaveBeenCalledTimes(1);
    expect(
      tx.insurance_coverage_slots.createManyAndReturn,
    ).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ status: 'ASSIGNED', sequence_number: 1 }),
        expect.objectContaining({ status: 'ASSIGNED', sequence_number: 2 }),
      ]),
    });
    expect(tx.insurance_assignments.createManyAndReturn).toHaveBeenCalledTimes(
      1,
    );
    expect(tx.insurance_assignments.createManyAndReturn).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          subject_type: 'MEMBER',
          user_id: 'ben-1',
          status: 'ACTIVE',
          // approved on 2026-11-17 (after the year start) -> until year end
          valid_from: NOW,
          valid_until: YEAR.end_date,
        }),
      ]),
    });
    expect(tx.member_insurances.findMany).toHaveBeenCalledTimes(1);
    expect(tx.member_insurances.createMany).toHaveBeenCalledTimes(1);
    expect(tx.member_insurances.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          user_id: 'ben-1',
          end_date: YEAR.end_date,
        }),
        expect.objectContaining({
          user_id: 'ben-2',
          end_date: YEAR.end_date,
        }),
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
    tx.club_role_assignments.findMany.mockResolvedValue([{ user_id: 'ben-1' }]);
    await expect(service.fulfill(tx, order, reviewer)).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED,
    });
    expect(tx.insurance_purchases.create).not.toHaveBeenCalled();
  });

  it('starts at the year start when approval happens before it', async () => {
    const future = {
      ...YEAR,
      start_date: new Date('2027-01-01T00:00:00.000Z'),
      end_date: new Date('2027-12-31T00:00:00.000Z'),
    };
    tx.insurance_cycle_configs.findUnique.mockResolvedValue({
      ...CYCLE,
      ecclesiastical_year: future,
    });
    await service.fulfill(tx, order, reviewer);
    expect(tx.insurance_assignments.createManyAndReturn).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          valid_from: future.start_date,
          valid_until: future.end_date,
        }),
      ]),
    });
  });

  it('re-checks at approve: fails when a beneficiary got covered elsewhere between issue and approve', async () => {
    tx.insurance_assignments.findMany.mockResolvedValue([
      {
        insurance_assignment_id: 9,
        user_id: 'ben-2',
        valid_until: YEAR.end_date,
        coverage_slot: {
          purchasing_section: {
            club_types: { name: 'Guías Mayores' },
            clubs: { name: 'Club Sirio' },
          },
          purchase: { external_reference: 'ORD1', owner_club: null },
        },
      },
    ]);
    await expect(service.fulfill(tx, order, reviewer)).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
    });
    expect(tx.insurance_purchases.create).not.toHaveBeenCalled();
  });

  it('excludes the order being approved from the live-order check', async () => {
    await service.fulfill(tx, order, reviewer);
    const where = tx.field_payment_order_lines.findMany.mock.calls[0][0].where;
    expect(where.order.field_payment_order_id).toEqual({ not: 'o1' });
  });

  it('propagates bridge failures so the whole approve rolls back', async () => {
    tx.member_insurances.createMany.mockRejectedValue(new Error('bridge down'));
    await expect(service.fulfill(tx, order, reviewer)).rejects.toThrow(
      'bridge down',
    );
  });
});
