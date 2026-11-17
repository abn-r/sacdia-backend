import { InsuranceReassignmentsService } from './insurance-reassignments.service';
import { InsuranceCoverageService } from './insurance-coverage.service';
import { ErrorCode } from '../common/errors/error-codes';
import type { OrderActor } from './order-actor';

// Fixed "today": 2026-11-17. Year 5: 2026-01-01 .. 2026-12-31.
const NOW = new Date('2026-11-17T18:00:00.000Z');
const YEAR = {
  year_id: 5,
  start_date: new Date('2026-01-01T00:00:00.000Z'),
  end_date: new Date('2026-12-31T00:00:00.000Z'),
};

beforeAll(() => {
  jest.useFakeTimers({ now: NOW });
});
afterAll(() => {
  jest.useRealTimers();
});

function leaderActor(overrides: Partial<OrderActor> = {}): OrderActor {
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

function reviewer(overrides: Partial<OrderActor> = {}): OrderActor {
  return leaderActor({
    userId: 'lf-1',
    sectionIds: [],
    canReview: true,
    activeSection: undefined,
    ...overrides,
  });
}

const ACTIVE_ASSIGNMENT = {
  insurance_assignment_id: 50,
  status: 'ACTIVE',
  subject_type: 'MEMBER',
  user_id: 'from-user',
  valid_until: YEAR.end_date,
  coverage_slot: {
    insurance_coverage_slot_id: 500,
    current_section_id: 11,
    current_section: { main_club_id: 5, clubs: { local_field_id: 7 } },
    purchase: {
      external_reference: 'ORD20260001',
      cycle_config: {
        ecclesiastical_year_id: 5,
        product: { name: 'Seguro anual' },
      },
    },
  },
};

describe('InsuranceReassignmentsService', () => {
  let tx: any;
  let prisma: any;
  let service: InsuranceReassignmentsService;

  beforeEach(() => {
    tx = {
      ecclesiastical_years: { findFirst: jest.fn().mockResolvedValue(YEAR) },
      insurance_assignments: {
        findUnique: jest.fn().mockResolvedValue(ACTIVE_ASSIGNMENT),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ insurance_assignment_id: 51 }),
      },
      insurance_slot_movements: { create: jest.fn() },
      insurance_reassignment_requests: {
        create: jest.fn().mockResolvedValue({
          insurance_reassignment_request_id: 7,
          status: 'APPROVED',
        }),
        update: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
        findUnique: jest.fn(),
      },
      club_role_assignments: {
        // Club-wide lookup (`club_sections` filter): the source holder is NOT
        // in the club any more. Section lookup: the destination IS active.
        findMany: jest
          .fn()
          .mockImplementation(({ where }: any) =>
            Promise.resolve(
              where.club_sections ? [] : [{ user_id: where.user_id.in[0] }],
            ),
          ),
      },
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
      },
      club_sections: { findMany: jest.fn().mockResolvedValue([]) },
      users: { findMany: jest.fn().mockResolvedValue([]) },
      member_insurances: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        createMany: jest.fn(),
      },
    };
    prisma = {
      ...tx,
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    service = new InsuranceReassignmentsService(
      prisma,
      new InsuranceCoverageService(prisma),
    );
  });

  describe('create (direct reassignment)', () => {
    const input = { insurance_assignment_id: 50, to_user_id: 'to-user' };

    it('executes immediately and audits the request as APPROVED by the actor', async () => {
      const result = await service.create(
        { ...input, reason: ' se fue ' },
        leaderActor(),
      );

      expect(result).toMatchObject({ status: 'APPROVED' });
      // release old
      expect(tx.insurance_assignments.updateMany).toHaveBeenCalledWith({
        where: { insurance_assignment_id: 50, status: 'ACTIVE' },
        data: expect.objectContaining({
          status: 'RELEASED',
          modified_by_id: 'director-1',
        }),
      });
      // new ACTIVE on the same slot with the same valid_until
      expect(tx.insurance_assignments.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          insurance_coverage_slot_id: 500,
          user_id: 'to-user',
          status: 'ACTIVE',
          valid_until: YEAR.end_date,
        }),
      });
      expect(tx.insurance_slot_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          insurance_coverage_slot_id: 500,
          movement_type: 'REASSIGNED',
          insurance_assignment_id: 51,
          performed_by_id: 'director-1',
        }),
      });
      // bridge moved: old holder off, destination on
      expect(tx.member_insurances.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          user_id: 'from-user',
          active: true,
          policy_number: 'ORD20260001',
        }),
        data: { active: false, modified_by_id: 'director-1' },
      });
      expect(tx.member_insurances.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            user_id: 'to-user',
            policy_number: 'ORD20260001',
            end_date: YEAR.end_date,
            active: true,
          }),
        ],
      });
      // audit row
      expect(tx.insurance_reassignment_requests.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          insurance_assignment_id: 50,
          from_user_id: 'from-user',
          to_user_id: 'to-user',
          reason: 'se fue',
          status: 'APPROVED',
          requested_by_id: 'director-1',
          reviewed_by_id: 'director-1',
          reviewed_at: expect.any(Date),
        }),
      });
      // never creates PENDING rows any more
      expect(
        tx.insurance_reassignment_requests.create.mock.calls.every(
          ([arg]: any) => arg.data.status === 'APPROVED',
        ),
      ).toBe(true);
    });

    it('rejects non-active or non-member assignments', async () => {
      tx.insurance_assignments.findUnique.mockResolvedValue({
        ...ACTIVE_ASSIGNMENT,
        status: 'RELEASED',
      });
      await expect(service.create(input, leaderActor())).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
      });
    });

    it('rejects an expired assignment', async () => {
      tx.insurance_assignments.findUnique.mockResolvedValue({
        ...ACTIVE_ASSIGNMENT,
        valid_until: new Date('2026-11-16T00:00:00.000Z'),
      });
      await expect(service.create(input, leaderActor())).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
      });
    });

    it('rejects an assignment from another ecclesiastical year', async () => {
      tx.insurance_assignments.findUnique.mockResolvedValue({
        ...ACTIVE_ASSIGNMENT,
        coverage_slot: {
          ...ACTIVE_ASSIGNMENT.coverage_slot,
          purchase: {
            ...ACTIVE_ASSIGNMENT.coverage_slot.purchase,
            cycle_config: {
              ecclesiastical_year_id: 4,
              product: { name: 'Seguro anual' },
            },
          },
        },
      });
      await expect(service.create(input, leaderActor())).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
      });
      expect(tx.insurance_assignments.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when the holder is still an active member/staff of the club', async () => {
      tx.club_role_assignments.findMany.mockResolvedValue([
        { user_id: 'from-user' },
      ]);
      await expect(service.create(input, leaderActor())).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
      });
      expect(tx.insurance_assignments.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a destination that is not active in the same section', async () => {
      tx.club_role_assignments.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.club_sections ? [] : []),
      );
      await expect(service.create(input, leaderActor())).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
      });
      expect(tx.insurance_assignments.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a destination already covered this year (any club)', async () => {
      tx.insurance_assignments.findMany.mockResolvedValue([
        {
          insurance_assignment_id: 99,
          user_id: 'to-user',
          valid_until: YEAR.end_date,
          coverage_slot: {
            purchasing_section: {
              club_types: { name: 'Guías Mayores' },
              clubs: { name: 'Club Sirio' },
            },
            purchase: { external_reference: 'ORD9', owner_club: null },
          },
        },
      ]);
      await expect(service.create(input, leaderActor())).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
      });
      expect(tx.insurance_assignments.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a destination that is in a live-or-paid order this year', async () => {
      tx.field_payment_order_lines.findMany.mockResolvedValue([
        {
          beneficiary_user_id: 'to-user',
          order: {
            field_payment_order_id: 'o1',
            folio_reference: 'ORD2',
            status: 'ISSUED',
            expires_at: new Date('2026-12-01T00:00:00.000Z'),
            club_section_id: 11,
          },
        },
      ]);
      await expect(service.create(input, leaderActor())).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
      });
    });

    it('rejects reassigning to the same holder', async () => {
      await expect(
        service.create({ ...input, to_user_id: 'from-user' }, leaderActor()),
      ).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
      });
    });

    it('conflicts when a concurrent request already released the assignment', async () => {
      tx.insurance_assignments.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.create(input, leaderActor())).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
      });
      expect(tx.insurance_assignments.create).not.toHaveBeenCalled();
    });

    it('rejects leaders whose active section is not the slot section', async () => {
      await expect(
        service.create(
          input,
          leaderActor({
            activeSection: {
              ...leaderActor().activeSection!,
              club_section_id: 99,
            },
          }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN,
      });
      expect(tx.insurance_assignments.updateMany).not.toHaveBeenCalled();
    });

    it('allows an LF reviewer of the same territory but not of another LF', async () => {
      await expect(service.create(input, reviewer())).resolves.toMatchObject({
        status: 'APPROVED',
      });
      await expect(
        service.create(input, reviewer({ localFieldId: 8 })),
      ).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN,
      });
    });
  });

  describe('approve (legacy PENDING rows only)', () => {
    const pending = {
      insurance_reassignment_request_id: 1,
      insurance_assignment_id: 50,
      from_user_id: 'from-user',
      to_user_id: 'to-user',
      reason: null,
      status: 'PENDING',
      requested_by_id: 'director-1',
    };

    it('executes a PENDING row and marks it APPROVED by the reviewer', async () => {
      tx.insurance_reassignment_requests.findUnique.mockResolvedValue(pending);
      prisma.insurance_reassignment_requests.findUnique.mockResolvedValue(
        pending,
      );
      await service.approve(1, reviewer());
      expect(tx.insurance_assignments.create).toHaveBeenCalled();
      expect(tx.insurance_reassignment_requests.update).toHaveBeenCalledWith({
        where: { insurance_reassignment_request_id: 1 },
        data: expect.objectContaining({
          status: 'APPROVED',
          reviewed_by_id: 'lf-1',
        }),
      });
      expect(tx.member_insurances.updateMany).toHaveBeenCalled();
    });

    it('answers 409 for any non-PENDING row', async () => {
      prisma.insurance_reassignment_requests.findUnique.mockResolvedValue({
        ...pending,
        status: 'APPROVED',
      });
      await expect(service.approve(1, reviewer())).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects approvals by non-reviewers', async () => {
      await expect(service.approve(1, leaderActor())).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN,
      });
    });

    it('rejects reviewers from another local field', async () => {
      prisma.insurance_reassignment_requests.findUnique.mockResolvedValue(
        pending,
      );
      await expect(
        service.approve(1, reviewer({ localFieldId: 8 })),
      ).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN,
      });
    });
  });

  describe('reject', () => {
    it('requires a comment', async () => {
      await expect(service.reject(1, ' ', reviewer())).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_REJECT_REASON_REQUIRED,
      });
    });

    it('marks the request as REJECTED with the comment', async () => {
      prisma.insurance_reassignment_requests.findUnique.mockResolvedValue({
        insurance_reassignment_request_id: 1,
        status: 'PENDING',
      });
      await service.reject(1, 'no procede', reviewer());
      expect(
        prisma.insurance_reassignment_requests.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REJECTED',
            review_comment: 'no procede',
          }),
        }),
      );
    });
  });
});
