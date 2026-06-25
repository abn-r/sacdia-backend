import { RequestsService } from './requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
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
    users_pr: {
      findUnique: jest.fn(),
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

  const authorizationContext = {
    canManageClub: jest.fn().mockResolvedValue(false),
    resolveUserAuthorization: jest.fn(),
    invalidateUserAuthorizationCache: jest.fn().mockResolvedValue(undefined),
  };

  let service: RequestsService;

  beforeEach(() => {
    jest.clearAllMocks();
    authorizationContext.canManageClub.mockResolvedValue(false);
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
    prisma.users_pr.findUnique.mockResolvedValue({
      active_club_assignment_id: 'assignment-1',
    });
    prisma.club_role_assignments.findFirst.mockResolvedValue({
      assignment_id: 'assignment-1',
      club_section_id: 10,
      club_sections: { club_type_id: 2 },
    });
    prisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: 20,
      club_type_id: 2,
      main_club_id: 12,
    });
    authorizationContext.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        grants: {
          club_assignments: [
            {
              status: 'active',
              section: { club_section_id: 20 },
            },
          ],
        },
      },
    });

    service = new RequestsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      authorizationContext as unknown as AuthorizationContextService,
    );
  });

  describe('reviewTransfer', () => {
    it('keeps current class enrollment unchanged when transfer is approved', async () => {
      await service.reviewTransfer('transfer-1', 'reviewer-1', 'approved');

      expect(transactionMock.enrollments.updateMany).not.toHaveBeenCalled();
      expect(transactionMock.enrollments.create).not.toHaveBeenCalled();
      expect(
        transactionMock.club_role_assignments.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          user_id: 'user-1',
          club_section_id: 10,
          active: true,
          status: 'active',
        },
        data: {
          club_section_id: 20,
          modified_at: expect.any(Date),
        },
      });
      expect(
        authorizationContext.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledWith('user-1');
      expect(notifications.notifySafe).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          type: 'transfer',
          entity_id: 'transfer-1',
          action: 'approved',
          route: '/transfer/transfer-1',
        }),
        'requests:transfer_approved',
      );
    });

    it('rejects review when the reviewer is not active in the destination section', async () => {
      authorizationContext.canManageClub.mockResolvedValueOnce(false);
      authorizationContext.resolveUserAuthorization.mockResolvedValueOnce({
        authorization: {
          grants: {
            club_assignments: [
              {
                status: 'active',
                section: { club_section_id: 99 },
              },
            ],
          },
        },
      });

      await expect(
        service.reviewTransfer('transfer-1', 'reviewer-1', 'approved'),
      ).rejects.toMatchObject({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows review when the reviewer can manage the destination club', async () => {
      authorizationContext.canManageClub.mockResolvedValueOnce(true);
      authorizationContext.resolveUserAuthorization.mockResolvedValueOnce({
        authorization: {
          grants: {
            club_assignments: [],
          },
        },
      });

      await service.reviewTransfer('transfer-1', 'reviewer-1', 'approved');

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('createTransferRequest', () => {
    it('includes a deep-link route in transfer-created notifications', async () => {
      prisma.users.findUnique.mockResolvedValue({
        name: 'Ana',
        paternal_last_name: 'López',
      });
      prisma.club_transfer_requests.findFirst.mockResolvedValue(null);
      prisma.club_transfer_requests.create.mockResolvedValue({
        transfer_request_id: 'transfer-1',
      });

      await service.createTransferRequest('user-1', 10, 20);

      expect(notifications.sendToSectionRole).toHaveBeenCalledWith(
        20,
        ['director'],
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          type: 'transfer',
          entity_id: 'transfer-1',
          status: 'pending',
          route: '/transfer/transfer-1',
        }),
        'requests:transfer_created',
      );
    });

    it('rejects transfer requests to a different club type so the class remains stable', async () => {
      prisma.club_sections.findUnique.mockResolvedValue({
        club_section_id: 30,
        club_type_id: 3,
      });

      await expect(
        service.createTransferRequest('user-1', 10, 30),
      ).rejects.toMatchObject({
        code: ErrorCode.REQUEST_TRANSFER_TYPE_MISMATCH,
      });

      expect(prisma.club_transfer_requests.create).not.toHaveBeenCalled();
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
