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
