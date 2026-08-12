import { InsuranceReassignmentsService } from './insurance-reassignments.service';
import { ErrorCode } from '../common/errors/error-codes';
import type { OrderActor } from './order-actor';

function clubActor(overrides: Partial<OrderActor> = {}): OrderActor {
  return {
    userId: 'director-1',
    localFieldId: 7,
    sectionIds: [11],
    globalAccess: false,
    canReview: false,
    ...overrides,
  };
}

function reviewer(overrides: Partial<OrderActor> = {}): OrderActor {
  return clubActor({
    userId: 'lf-1',
    sectionIds: [],
    canReview: true,
    ...overrides,
  });
}

const ACTIVE_ASSIGNMENT = {
  insurance_assignment_id: 50,
  status: 'ACTIVE',
  subject_type: 'MEMBER',
  user_id: 'from-user',
  valid_until: new Date('2027-08-01'),
  coverage_slot: {
    insurance_coverage_slot_id: 500,
    current_section_id: 11,
    purchase: { insurance_cycle_config_id: 33 },
  },
};

describe('InsuranceReassignmentsService', () => {
  let tx: any;
  let prisma: any;
  let service: InsuranceReassignmentsService;

  beforeEach(() => {
    tx = {
      insurance_assignments: {
        findUnique: jest.fn().mockResolvedValue(ACTIVE_ASSIGNMENT),
        update: jest.fn(),
        create: jest
          .fn()
          .mockResolvedValue({ insurance_assignment_id: 51 }),
      },
      insurance_slot_movements: { createMany: jest.fn() },
      insurance_reassignment_requests: {
        update: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
      },
      club_sections: {
        findUnique: jest.fn().mockResolvedValue({ main_club_id: 5 }),
      },
      club_role_assignments: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ club_sections: { main_club_id: 5 } }]),
      },
    };
    prisma = {
      insurance_assignments: {
        findUnique: jest.fn().mockResolvedValue(ACTIVE_ASSIGNMENT),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      insurance_reassignment_requests: {
        create: jest.fn().mockResolvedValue({ status: 'PENDING' }),
        findUnique: jest.fn().mockResolvedValue({
          insurance_reassignment_request_id: 1,
          insurance_assignment_id: 50,
          from_user_id: 'from-user',
          to_user_id: 'to-user',
          status: 'PENDING',
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      club_sections: tx.club_sections,
      club_role_assignments: tx.club_role_assignments,
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    service = new InsuranceReassignmentsService(prisma);
  });

  describe('create', () => {
    const dto = { insurance_assignment_id: 50, to_user_id: 'to-user' };

    it('creates a PENDING request for a valid same-club destination', async () => {
      await service.create(dto, clubActor());
      expect(
        prisma.insurance_reassignment_requests.create,
      ).toHaveBeenCalledWith({
        data: expect.objectContaining({
          insurance_assignment_id: 50,
          from_user_id: 'from-user',
          to_user_id: 'to-user',
          status: 'PENDING',
          requested_by_id: 'director-1',
        }),
      });
    });

    it('rejects non-active assignments', async () => {
      prisma.insurance_assignments.findUnique.mockResolvedValue({
        ...ACTIVE_ASSIGNMENT,
        status: 'RELEASED',
      });
      await expect(service.create(dto, clubActor())).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
      });
    });

    it('rejects destinations outside the same main club', async () => {
      tx.club_role_assignments.findMany.mockResolvedValue([
        { club_sections: { main_club_id: 99 } },
      ]);
      await expect(service.create(dto, clubActor())).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
      });
    });

    it('rejects destination already covered in the cycle', async () => {
      prisma.insurance_assignments.findFirst.mockResolvedValue({
        insurance_assignment_id: 60,
      });
      await expect(service.create(dto, clubActor())).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
      });
    });

    it('maps P2002 to pending-exists conflict', async () => {
      const p2002 = Object.create(
        require('@prisma/client').Prisma.PrismaClientKnownRequestError
          .prototype,
      );
      p2002.code = 'P2002';
      prisma.insurance_reassignment_requests.create.mockRejectedValue(p2002);
      await expect(service.create(dto, clubActor())).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_PENDING_EXISTS,
      });
    });

    it('rejects actors without scope over the slot section', async () => {
      await expect(
        service.create(dto, clubActor({ sectionIds: [99] })),
      ).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN,
      });
    });
  });

  describe('approve', () => {
    it('releases the old assignment and opens a new ACTIVE one in one TX', async () => {
      await service.approve(1, reviewer());

      expect(tx.insurance_assignments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { insurance_assignment_id: 50 },
          data: expect.objectContaining({ status: 'RELEASED' }),
        }),
      );
      expect(tx.insurance_assignments.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          insurance_coverage_slot_id: 500,
          user_id: 'to-user',
          status: 'ACTIVE',
          valid_until: ACTIVE_ASSIGNMENT.valid_until,
        }),
      });
      expect(tx.insurance_slot_movements.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ movement_type: 'REASSIGNED' })],
      });
      expect(
        tx.insurance_reassignment_requests.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
    });

    it('rejects approvals by non-reviewers', async () => {
      await expect(service.approve(1, clubActor())).rejects.toMatchObject({
        code: ErrorCode.FIELD_PAYMENT_ORDER_FORBIDDEN,
      });
    });

    it('conflicts when the assignment is no longer active', async () => {
      tx.insurance_assignments.findUnique.mockResolvedValue({
        ...ACTIVE_ASSIGNMENT,
        status: 'RELEASED',
      });
      await expect(service.approve(1, reviewer())).rejects.toMatchObject({
        code: ErrorCode.INSURANCE_REASSIGNMENT_INVALID,
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
