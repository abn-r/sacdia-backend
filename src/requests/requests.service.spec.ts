import { RequestsService } from './requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClassAssignmentResolverService } from '../common/services/class-assignment-resolver.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('RequestsService', () => {
  const createTransactionMock = () => ({
    club_role_assignments: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ assignment_id: 'assignment-1' }),
    },
    club_transfer_requests: {
      update: jest.fn().mockResolvedValue({
        transfer_request_id: 'transfer-1',
        user_id: 'user-1',
        status: 'approved',
        user: { user_id: 'user-1', name: 'Ana', paternal_last_name: 'López' },
        from_section: { club_types: { name: 'Aventureros' } },
        to_section: { club_types: { name: 'Conquistadores' } },
        reviewer: {
          user_id: 'reviewer-1',
          name: 'Dir',
          paternal_last_name: 'Ector',
        },
      }),
    },
    club_sections: {
      findUnique: jest.fn().mockResolvedValue({
        club_section_id: 20,
        club_type_id: 2,
      }),
    },
    ecclesiastical_years: {
      findFirst: jest.fn().mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
      }),
    },
    users: {
      findUnique: jest.fn().mockResolvedValue({
        birthday: new Date('2016-01-01'),
      }),
    },
    classes: {
      findFirst: jest.fn().mockResolvedValue({
        class_id: 5,
      }),
    },
    enrollments: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ enrollment_id: 101 }),
      update: jest.fn().mockResolvedValue({ enrollment_id: 101 }),
    },
  });

  let transactionMock: ReturnType<typeof createTransactionMock>;

  const prisma = {
    $transaction: jest.fn(),
    club_transfer_requests: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
    roles: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    role_assignment_requests: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    role_slot_limits: {
      findUnique: jest.fn(),
    },
    ecclesiastical_years: {
      findFirst: jest.fn(),
    },
  };

  const notifications = {
    sendToSectionRole: jest.fn(),
    sendToUser: jest.fn(),
    notifySafe: jest.fn(),
  };

  let service: RequestsService;

  beforeEach(() => {
    jest.clearAllMocks();
    transactionMock = createTransactionMock();
    prisma.$transaction.mockImplementation(
      (
        callback: (
          tx: ReturnType<typeof createTransactionMock>,
        ) => Promise<unknown>,
      ) => callback(transactionMock),
    );
    prisma.club_transfer_requests.findUnique.mockResolvedValue({
      transfer_request_id: 'transfer-1',
      user_id: 'user-1',
      from_section_id: 10,
      to_section_id: 20,
      status: 'pending',
      user: { user_id: 'user-1', name: 'Ana' },
    });

    service = new RequestsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      new ClassAssignmentResolverService(),
    );
  });

  describe('reviewTransfer', () => {
    it('should derive and resolve the current-year class enrollment for the destination club type when transfer is approved', async () => {
      await service.reviewTransfer('transfer-1', 'reviewer-1', 'approved');

      expect(transactionMock.enrollments.updateMany).toHaveBeenCalledWith({
        where: {
          user_id: 'user-1',
          ecclesiastical_year_id: 2026,
          active: true,
          NOT: { class_id: 5 },
        },
        data: { active: false },
      });
      expect(transactionMock.enrollments.create).toHaveBeenCalledWith({
        data: {
          user_id: 'user-1',
          class_id: 5,
          ecclesiastical_year_id: 2026,
        },
      });
    });
  });

  describe('createAssignmentRequest', () => {
    it('rejects requesting a second director in the same section even when role_slot_limits is not seeded', async () => {
      prisma.club_sections.findUnique.mockResolvedValue({
        club_section_id: 20,
      });
      prisma.users.findUnique.mockResolvedValue({ user_id: 'user-2' });
      prisma.roles.findUnique.mockResolvedValue({
        role_id: 'role-director',
        role_name: 'director',
      });
      prisma.role_slot_limits.findUnique.mockResolvedValue(null);
      prisma.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      prisma.club_role_assignments.count.mockResolvedValue(1);
      prisma.role_assignment_requests.count.mockResolvedValue(0);

      await expect(
        service.createAssignmentRequest(
          20,
          'user-2',
          'role-director',
          'requester-1',
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.REQUEST_ROLE_SLOT_LIMIT_REACHED,
      });

      expect(prisma.role_assignment_requests.create).not.toHaveBeenCalled();
    });
  });
});
