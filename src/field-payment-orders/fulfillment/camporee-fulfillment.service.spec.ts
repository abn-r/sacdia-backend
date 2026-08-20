import { CamporeeFulfillmentService } from './camporee-fulfillment.service';
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

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const CAMPOREE = {
  local_camporee_id: 40,
  name: 'Camporee de Conquistadores 2026',
  local_field_id: 7,
  active: true,
  registration_cost: 250,
  member_registration_deadline: FUTURE,
  start_date: new Date('2026-11-20'),
  end_date: new Date('2026-11-23'),
};

const UNION_CAMPOREE = {
  name: 'Camporee de Unión 2026',
  active: true,
  registration_cost: 400,
  member_registration_deadline: FUTURE,
  union_camporee_local_fields: [{ local_field_id: 7 }],
};

function buildDb() {
  return {
    local_camporees: { findUnique: jest.fn().mockResolvedValue(CAMPOREE) },
    union_camporees: {
      findUnique: jest.fn().mockResolvedValue(UNION_CAMPOREE),
    },
    club_sections: {
      findUnique: jest.fn().mockResolvedValue({
        club_type_id: 1,
        clubs: { club_id: 5, local_field_id: 7 },
      }),
    },
    camporee_clubs: {
      findFirst: jest.fn().mockResolvedValue({ camporee_club_id: 70 }),
    },
    club_role_assignments: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ user_id: 'ben-1' }, { user_id: 'ben-2' }]),
    },
    camporee_members: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    insurance_assignments: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ user_id: 'ben-1' }, { user_id: 'ben-2' }]),
    },
    member_insurances: { findMany: jest.fn().mockResolvedValue([]) },
    clubs: { findUnique: jest.fn().mockResolvedValue({ name: 'Club Orión' }) },
    field_payment_order_lines: { update: jest.fn() },
    camporee_payments: { create: jest.fn() },
  };
}

describe('CamporeeFulfillmentService.prepareOrder', () => {
  const dto = { camporee_id: 40, beneficiary_user_ids: ['ben-1', 'ben-2'] };
  let db: any;
  let service: CamporeeFulfillmentService;

  beforeEach(() => {
    db = buildDb();
    service = new CamporeeFulfillmentService(db);
  });

  it('prepares the order with the camporee cost snapshot', async () => {
    const prepared = await service.prepareOrder(dto, actorWithSection());
    expect(prepared).toEqual({
      local_field_id: 7,
      club_id: 5,
      club_section_id: 11,
      purpose_ref_id: 40,
      camporee_scope: 'local',
      unit_cost_centavos: 25000,
      currency: 'MXN',
      concept: 'Camporee de Conquistadores 2026',
      beneficiary_user_ids: ['ben-1', 'ben-2'],
    });
  });

  it('blocks camporees without configured cost (no free camporees)', async () => {
    db.local_camporees.findUnique.mockResolvedValue({
      ...CAMPOREE,
      registration_cost: null,
    });
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_COST_NOT_CONFIGURED,
    });
  });

  it('blocks zero-cost camporees explicitly', async () => {
    db.local_camporees.findUnique.mockResolvedValue({
      ...CAMPOREE,
      registration_cost: 0,
    });
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_COST_NOT_CONFIGURED,
    });
  });

  it('rejects camporees from another local field', async () => {
    db.local_camporees.findUnique.mockResolvedValue({
      ...CAMPOREE,
      local_field_id: 99,
    });
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
    });
  });

  it('rejects when member registration deadline passed', async () => {
    db.local_camporees.findUnique.mockResolvedValue({
      ...CAMPOREE,
      member_registration_deadline: new Date('2020-01-01'),
    });
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
    });
  });

  it('rejects when the section is not enrolled in the camporee', async () => {
    db.camporee_clubs.findFirst.mockResolvedValue(null);
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
    });
  });

  it('rejects beneficiaries without valid insurance', async () => {
    db.insurance_assignments.findMany.mockResolvedValue([
      { user_id: 'ben-1' },
    ]);
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED,
    });
  });

  it('accepts legacy member_insurances as valid insurance', async () => {
    db.insurance_assignments.findMany.mockResolvedValue([]);
    db.member_insurances.findMany.mockResolvedValue([
      { user_id: 'ben-1', insurance_id: 1 },
      { user_id: 'ben-2', insurance_id: 2 },
    ]);
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).resolves.toBeDefined();
  });

  it('rejects beneficiaries already registered in the camporee', async () => {
    db.camporee_members.findMany.mockResolvedValue([{ user_id: 'ben-2' }]);
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
    });
  });
});

describe('CamporeeFulfillmentService.prepareOrder (union camporees, v1.1)', () => {
  const dto = {
    camporee_id: 90,
    camporee_type: 'union' as const,
    beneficiary_user_ids: ['ben-1', 'ben-2'],
  };
  let db: any;
  let service: CamporeeFulfillmentService;

  beforeEach(() => {
    db = buildDb();
    service = new CamporeeFulfillmentService(db);
  });

  it('prepares a union order scoped to the issuing local field', async () => {
    const prepared = await service.prepareOrder(dto, actorWithSection());
    expect(prepared).toEqual({
      local_field_id: 7,
      club_id: 5,
      club_section_id: 11,
      purpose_ref_id: 90,
      camporee_scope: 'union',
      unit_cost_centavos: 40000,
      currency: 'MXN',
      concept: 'Camporee de Unión 2026',
      beneficiary_user_ids: ['ben-1', 'ben-2'],
    });
    expect(db.union_camporees.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { union_camporee_id: 90 } }),
    );
    expect(db.camporee_clubs.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ union_camporee_id: 90 }),
      }),
    );
  });

  it('rejects when the local field does not participate in the union camporee', async () => {
    db.union_camporees.findUnique.mockResolvedValue({
      ...UNION_CAMPOREE,
      union_camporee_local_fields: [],
    });
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
    });
  });

  it('rejects inactive union camporees', async () => {
    db.union_camporees.findUnique.mockResolvedValue({
      ...UNION_CAMPOREE,
      active: false,
    });
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
    });
  });

  it('blocks union camporees without configured cost', async () => {
    db.union_camporees.findUnique.mockResolvedValue({
      ...UNION_CAMPOREE,
      registration_cost: null,
    });
    await expect(
      service.prepareOrder(dto, actorWithSection()),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_COST_NOT_CONFIGURED,
    });
  });
});

describe('CamporeeFulfillmentService.fulfill', () => {
  const order = {
    field_payment_order_id: 'o1',
    purpose: 'CAMPOREE' as const,
    local_field_id: 7,
    club_id: 5,
    club_section_id: 11,
    insurance_cycle_config_id: null,
    local_camporee_id: 40,
    union_camporee_id: null,
    folio_reference: 'ORD20260009',
    issued_by_id: 'director-1',
    unit_cost_centavos: 25000,
    total_centavos: 50000,
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
    userId: 'lf-1',
    canReview: true,
    activeSection: undefined,
    sectionIds: [],
  });

  let tx: any;
  let service: CamporeeFulfillmentService;

  beforeEach(() => {
    tx = buildDb();
    tx.member_insurances.findMany.mockResolvedValue([
      { user_id: 'ben-1', insurance_id: 101 },
      { user_id: 'ben-2', insurance_id: 102 },
    ]);
    let memberSeq = 0;
    tx.camporee_members.create.mockImplementation(() =>
      Promise.resolve({ camporee_member_id: ++memberSeq }),
    );
    service = new CamporeeFulfillmentService({} as any);
  });

  it('creates approved members with verified insurance and links the lines', async () => {
    await service.fulfill(tx, order, reviewer);

    expect(tx.camporee_members.create).toHaveBeenCalledTimes(2);
    expect(tx.camporee_members.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        camporee_club_id: 70,
        camporee_id: 40,
        camporee_type: 'local',
        user_id: 'ben-1',
        insurance_verified: true,
        insurance_id: 101,
        status: 'approved',
        approved_by: 'lf-1',
      }),
    });
    expect(tx.field_payment_order_lines.update).toHaveBeenCalledWith({
      where: { field_payment_order_line_id: 'l1' },
      data: { camporee_member_id: 1 },
    });
    expect(tx.camporee_payments.create).toHaveBeenCalledTimes(2);
    expect(tx.camporee_payments.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        camporee_member_id: 1,
        amount: 250,
        payment_type: 'inscription',
        reference: 'ORD20260009',
        notes: 'field_payment_order:o1',
        registered_by: 'director-1',
        approved_by: 'lf-1',
        status: 'approved',
      }),
    });
  });

  it('creates zero members when a line lost its insurance before approve', async () => {
    tx.insurance_assignments.findMany.mockResolvedValue([]);
    tx.member_insurances.findMany.mockResolvedValue([
      { user_id: 'ben-1', insurance_id: 101 },
    ]);
    await expect(service.fulfill(tx, order, reviewer)).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED,
    });
    expect(tx.camporee_members.create).not.toHaveBeenCalled();
  });

  it('fails when the section enrollment disappeared', async () => {
    tx.camporee_clubs.findFirst.mockResolvedValue(null);
    await expect(service.fulfill(tx, order, reviewer)).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_CAMPOREE_INVALID,
    });
    expect(tx.camporee_members.create).not.toHaveBeenCalled();
  });

  it('creates union members linked to the union camporee (v1.1)', async () => {
    const unionOrder = {
      ...order,
      local_camporee_id: null,
      union_camporee_id: 90,
    };
    await service.fulfill(tx, unionOrder, reviewer);

    expect(tx.union_camporees.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { union_camporee_id: 90 } }),
    );
    expect(tx.camporee_members.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        camporee_id: null,
        union_camporee_id: 90,
        camporee_type: 'union',
        local_field_id: 7,
        status: 'approved',
        approved_by: 'lf-1',
      }),
    });
    expect(tx.camporee_members.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ union_camporee_id: 90 }),
      }),
    );
  });
});
