import { Test, TestingModule } from '@nestjs/testing';
import { MembershipRequestsService } from './membership-requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';
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
      findMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(pendingAssignment),
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

  const mockAuthorizationContextVersion = {
    bump: jest.fn().mockResolvedValue(1n),
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
        input:
          | ((tx: ReturnType<typeof createTransactionMock>) => Promise<unknown>)
          | Promise<unknown>[],
      ) => (Array.isArray(input) ? Promise.all(input) : input(transactionMock)),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipRequestsService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContext,
        },
        {
          provide: AuthorizationContextVersionService,
          useValue: mockAuthorizationContextVersion,
        },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<MembershipRequestsService>(MembershipRequestsService);
  });

  describe('approve/reject', () => {
    beforeEach(() => {
      mockPrismaService.club_role_assignments.findUnique.mockResolvedValue(
        pendingAssignment,
      );
    });

    it('approves only when assignment belongs to the path club section', async () => {
      mockPrismaService.club_role_assignments.updateMany.mockResolvedValue({
        count: 1,
      });

      await service.approve(10, pendingAssignment.assignment_id, actorId);

      expect(
        transactionMock.club_role_assignments.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          assignment_id: pendingAssignment.assignment_id,
          club_section_id: 10,
          status: 'pending',
          active: true,
        },
        data: {
          status: 'active',
          expires_at: null,
          modified_at: expect.any(Date),
        },
      });
      expect(mockAuthorizationContextVersion.bump).toHaveBeenCalledWith(
        transactionMock,
        userId,
      );
    });

    it('rejects path/assignment section mismatches as not found', async () => {
      transactionMock.club_role_assignments.updateMany.mockResolvedValue({
        count: 0,
      });
      transactionMock.club_role_assignments.findUnique.mockResolvedValue({
        ...pendingAssignment,
        club_section_id: 99,
      });

      await expect(
        service.approve(10, pendingAssignment.assignment_id, actorId),
      ).rejects.toMatchObject({ code: ErrorCode.MR_NOT_FOUND });

      expect(
        mockAuthorizationContext.invalidateUserAuthorizationCache,
      ).not.toHaveBeenCalled();
      expect(
        mockNotificationsService.sendSilentToSection,
      ).not.toHaveBeenCalled();
    });

    it('rejects only when assignment belongs to the path club section', async () => {
      mockPrismaService.club_role_assignments.updateMany.mockResolvedValue({
        count: 1,
      });

      await service.reject(10, pendingAssignment.assignment_id, actorId, 'No');

      expect(
        transactionMock.club_role_assignments.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          assignment_id: pendingAssignment.assignment_id,
          club_section_id: 10,
          status: 'pending',
          active: true,
        },
        data: {
          status: 'rejected',
          expires_at: null,
          rejection_reason: 'No',
          modified_at: expect.any(Date),
        },
      });
      expect(mockAuthorizationContextVersion.bump).toHaveBeenCalledWith(
        transactionMock,
        userId,
      );
    });
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
      expect(mockAuthorizationContextVersion.bump).toHaveBeenCalledWith(
        transactionMock,
        userId,
      );
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

    it('does not run Redis cleanup when the durable version write rejects', async () => {
      mockAuthorizationContextVersion.bump.mockRejectedValueOnce(
        new Error('version write failed'),
      );

      await expect(
        service.cancelPendingForUser(userId, actorId),
      ).rejects.toThrow('version write failed');

      expect(
        mockAuthorizationContext.invalidateUserAuthorizationCache,
      ).not.toHaveBeenCalled();
    });
  });

  describe('expireStaleRequests', () => {
    it('versions every affected user in the bulk expiration transaction', async () => {
      transactionMock.club_role_assignments.findMany.mockResolvedValue([
        { user_id: userId },
        { user_id: '0d5f0be9-2b45-47b2-9cdf-4d2407a3fa99' },
        { user_id: userId },
      ]);

      await expect(service.expireStaleRequests()).resolves.toBe(1);

      expect(mockAuthorizationContextVersion.bump).toHaveBeenCalledWith(
        transactionMock,
        userId,
      );
      expect(mockAuthorizationContextVersion.bump).toHaveBeenCalledWith(
        transactionMock,
        '0d5f0be9-2b45-47b2-9cdf-4d2407a3fa99',
      );
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
        'Nueva persona esperando aprobación',
        'Hay una solicitud de membresía lista para revisar en tu sección.',
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
