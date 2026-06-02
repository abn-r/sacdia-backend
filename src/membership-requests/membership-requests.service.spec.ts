import { Test, TestingModule } from '@nestjs/testing';
import { MembershipRequestsService } from './membership-requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('MembershipRequestsService', () => {
  let service: MembershipRequestsService;

  const userId = '20a9a762-a4fa-49dd-93a6-3851e27f8b69';
  const actorId = userId;

  const pendingAssignment = {
    assignment_id: '0ef7d3c0-bb8a-47a9-af39-ec30dc3c0b5b',
    user_id: userId,
    club_section_id: 10,
    status: 'pending',
    active: true,
    expires_at: new Date('2026-05-30T00:00:00.000Z'),
  };

  const createTransactionMock = () => ({
    club_role_assignments: {
      findFirst: jest.fn().mockResolvedValue(pendingAssignment),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    users_pr: {
      update: jest.fn().mockResolvedValue({}),
    },
  });

  let transactionMock: ReturnType<typeof createTransactionMock>;

  const mockPrismaService = {
    $transaction: jest.fn(),
    club_role_assignments: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    system_config: {
      findUnique: jest.fn(),
    },
  };

  const mockAuthorizationContext = {
    invalidateUserAuthorizationCache: jest.fn().mockResolvedValue(undefined),
  };

  const mockNotificationsService = {
    sendSilentToSection: jest.fn().mockResolvedValue(undefined),
    sendToSectionRole: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    transactionMock = createTransactionMock();
    mockPrismaService.$transaction.mockImplementation(
      (
        callback: (
          tx: ReturnType<typeof createTransactionMock>,
        ) => Promise<unknown>,
      ) => callback(transactionMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipRequestsService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContext,
        },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<MembershipRequestsService>(MembershipRequestsService);
  });

  describe('cancelPendingForUser', () => {
    it('should cancel the only pending request and reset post-registration club selection', async () => {
      const result = await service.cancelPendingForUser(userId, actorId);

      expect(
        transactionMock.club_role_assignments.findFirst,
      ).toHaveBeenCalledWith({
        where: {
          user_id: userId,
          status: 'pending',
          active: true,
        },
        orderBy: { created_at: 'desc' },
      });
      expect(
        transactionMock.club_role_assignments.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          assignment_id: pendingAssignment.assignment_id,
          user_id: userId,
          status: 'pending',
          active: true,
        },
        data: {
          status: 'cancelled',
          active: false,
          expires_at: null,
          end_date: expect.any(Date),
          modified_at: expect.any(Date),
        },
      });
      expect(transactionMock.users_pr.update).toHaveBeenCalledWith({
        where: { user_id: userId },
        data: {
          club_selection_complete: false,
          complete: false,
          date_completed: null,
          active_club_assignment_id: null,
        },
      });
      expect(
        mockAuthorizationContext.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledWith(userId);
      expect(mockNotificationsService.sendSilentToSection).toHaveBeenCalledWith(
        expect.objectContaining({
          sectionId: pendingAssignment.club_section_id,
          resource: 'members',
          action: 'DELETED',
          entityId: pendingAssignment.assignment_id,
          actorId,
        }),
      );
      expect(result).toMatchObject({
        assignment_id: pendingAssignment.assignment_id,
        status: 'cancelled',
        active: false,
      });
    });

    it('should fail without resetting post-registration when there is no pending request', async () => {
      transactionMock.club_role_assignments.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelPendingForUser(userId, actorId),
      ).rejects.toMatchObject({ code: ErrorCode.MR_NOT_FOUND });

      expect(
        transactionMock.club_role_assignments.updateMany,
      ).not.toHaveBeenCalled();
      expect(transactionMock.users_pr.update).not.toHaveBeenCalled();
    });
  });

  describe('notifyNewRequestCreated', () => {
    it('should notify the section director, deputy director, secretary and secretary-treasurer', async () => {
      await service.notifyNewRequestCreated({
        userId,
        clubSectionId: 10,
        assignmentId: pendingAssignment.assignment_id,
      });

      expect(mockNotificationsService.sendToSectionRole).toHaveBeenCalledWith(
        10,
        ['director', 'deputy-director', 'secretary', 'secretary-treasurer'],
        'Nueva solicitud de membresía',
        'Hay una nueva solicitud pendiente de aprobación para tu sección.',
        {
          type: 'membership_request_created',
          userId,
          assignmentId: pendingAssignment.assignment_id,
          clubSectionId: '10',
        },
        'membership_requests:new_request',
      );
    });
  });
});
