import {
  gateAdultUser,
  gateDependentRows,
  gateDependentUser,
  gateTeenUser,
} from './activation-gate.testing';
import { Test, TestingModule } from '@nestjs/testing';
import { MembershipRequestsService } from './membership-requests.service';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ErrorCode } from '../common/errors/error-codes';
import { ClubRoleEligibilityService } from '../club-role-eligibility/club-role-eligibility.service';
import { AppForbiddenException } from '../common/errors/app.exception';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ConsentGateService } from './consent-gate.service';

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
    roles: { role_name: 'member' },
  };

  const createTransactionMock = () => ({
    club_role_assignments: {
      findFirst: jest.fn().mockResolvedValue(pendingAssignment),
      findMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(pendingAssignment),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateManyAndReturn: jest.fn().mockResolvedValue([]),
    },
    users_pr: {
      update: jest.fn().mockResolvedValue({}),
    },
    // Adults are the default: the consent gate is a no-op for them. Minors
    // (dependent profile or under the age of majority) are fed per test.
    users: {
      findUnique: jest.fn().mockResolvedValue(gateAdultUser()),
      findMany: jest.fn().mockResolvedValue([]),
    },
    guardianships: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    // Per-dependent advisory lock taken by the consent gate.
    $executeRaw: jest.fn().mockResolvedValue(1),
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
    // Read by the consent block of listPending and by the new-request copy.
    users: {
      findMany: jest.fn(),
    },
    guardianships: {
      findMany: jest.fn(),
    },
  };

  const mockAuthorizationContext = {
    invalidateUserAuthorizationCache: jest.fn().mockResolvedValue(undefined),
  };

  const mockAuthorizationContextVersion = {
    bump: jest.fn().mockResolvedValue(1n),
    bumpMany: jest.fn().mockResolvedValue(2),
  };

  const mockNotificationsService = {
    sendSilentToSection: jest.fn().mockResolvedValue(undefined),
    sendToSectionRole: jest.fn().mockResolvedValue(undefined),
  };

  const mockRoleEligibility = {
    assertAssignment: jest.fn(),
  };

  const mockAuditLogs = {
    recordEvent: jest.fn().mockResolvedValue(undefined),
  };

  const mockActingForCache = {
    bump: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRoleEligibility.assertAssignment.mockReset().mockResolvedValue({
      allowed: true,
    });
    // Adults by default: no dependent anywhere.
    mockPrismaService.users.findMany.mockReset().mockResolvedValue([]);
    mockPrismaService.guardianships.findMany.mockReset().mockResolvedValue([]);
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
        { provide: ClubRoleEligibilityService, useValue: mockRoleEligibility },
        // Real gate: it only talks to the transaction client, which is mocked.
        ConsentGateService,
        { provide: AuditLogsService, useValue: mockAuditLogs },
        { provide: ActingForCache, useValue: mockActingForCache },
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

    it('asserts member eligibility in the tx before activating', async () => {
      await service.approve(10, pendingAssignment.assignment_id, actorId);

      expect(mockRoleEligibility.assertAssignment).toHaveBeenCalledWith({
        userId,
        roleName: 'member',
        clubSectionId: 10,
        db: transactionMock,
      });
    });

    it.each([
      ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED,
      ErrorCode.CLUB_ROLE_MEMBER_REQUIRES_GUIDE_MAJOR_SECTION,
    ])('hard-fails with %s and activates nothing', async (code) => {
      mockRoleEligibility.assertAssignment.mockRejectedValueOnce(
        new AppForbiddenException(code),
      );

      await expect(
        service.approve(10, pendingAssignment.assignment_id, actorId),
      ).rejects.toMatchObject({ code });

      expect(
        transactionMock.club_role_assignments.updateMany,
      ).not.toHaveBeenCalled();
      expect(mockAuthorizationContextVersion.bump).not.toHaveBeenCalled();
      expect(
        mockAuthorizationContext.invalidateUserAuthorizationCache,
      ).not.toHaveBeenCalled();
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
    describe('consent gate (FP-39)', () => {
      it('blocks a dependent with pending consent with 409 and activates nothing', async () => {
        transactionMock.users.findUnique.mockResolvedValue(
          gateDependentUser(userId),
        );
        transactionMock.guardianships.findFirst.mockResolvedValue(null);

        await expect(
          service.approve(10, pendingAssignment.assignment_id, actorId),
        ).rejects.toMatchObject({
          code: ErrorCode.MR_CONSENT_NOT_VERIFIED,
          status: 409,
        });

        expect(
          transactionMock.club_role_assignments.updateMany,
        ).not.toHaveBeenCalled();
        expect(mockAuthorizationContextVersion.bump).not.toHaveBeenCalled();
        expect(mockAuditLogs.recordEvent).not.toHaveBeenCalled();
      });

      it('blocks a self-registered 16-year-old (no dependent profile) with 409 and activates nothing (FP3-01)', async () => {
        transactionMock.users.findUnique.mockResolvedValue(
          gateTeenUser(userId, 16),
        );
        transactionMock.guardianships.findFirst.mockResolvedValue(null);

        await expect(
          service.approve(10, pendingAssignment.assignment_id, actorId),
        ).rejects.toMatchObject({
          code: ErrorCode.MR_CONSENT_NOT_VERIFIED,
          status: 409,
        });

        expect(
          transactionMock.club_role_assignments.updateMany,
        ).not.toHaveBeenCalled();
      });

      it('approves the same teen once a verified row exists', async () => {
        transactionMock.users.findUnique.mockResolvedValue(
          gateTeenUser(userId, 16),
        );
        transactionMock.guardianships.findFirst.mockResolvedValue({
          guardianship_id: 'g-1',
        });

        await service.approve(10, pendingAssignment.assignment_id, actorId);

        expect(
          transactionMock.club_role_assignments.updateMany,
        ).toHaveBeenCalledTimes(1);
      });

      it('blocks a user without a birthday (fail closed) until an adult birthday is set', async () => {
        transactionMock.users.findUnique.mockResolvedValue({
          ...gateAdultUser(),
          birthday: null,
        });
        transactionMock.guardianships.findFirst.mockResolvedValue(null);

        await expect(
          service.approve(10, pendingAssignment.assignment_id, actorId),
        ).rejects.toMatchObject({ code: ErrorCode.MR_CONSENT_NOT_VERIFIED });

        transactionMock.users.findUnique.mockResolvedValue(gateAdultUser());
        await service.approve(10, pendingAssignment.assignment_id, actorId);
        expect(
          transactionMock.club_role_assignments.updateMany,
        ).toHaveBeenCalledTimes(1);
      });

      it('only counts a real verified row: revoked and test rows are excluded by the query', async () => {
        transactionMock.users.findUnique.mockResolvedValue(
          gateDependentUser(userId),
        );
        transactionMock.guardianships.findFirst.mockResolvedValue(null);

        await expect(
          service.approve(10, pendingAssignment.assignment_id, actorId),
        ).rejects.toMatchObject({ code: ErrorCode.MR_CONSENT_NOT_VERIFIED });

        expect(transactionMock.guardianships.findFirst).toHaveBeenCalledWith({
          where: {
            dependent_user_id: userId,
            consent_status: 'verified',
            is_test_data: false,
          },
          select: { guardianship_id: true },
        });
      });

      it('approves a dependent once consent is verified', async () => {
        transactionMock.users.findUnique.mockResolvedValue(
          gateDependentUser(userId),
        );
        transactionMock.guardianships.findFirst.mockResolvedValue({
          guardianship_id: 'g-1',
        });

        await service.approve(10, pendingAssignment.assignment_id, actorId);

        expect(
          transactionMock.club_role_assignments.updateMany,
        ).toHaveBeenCalledTimes(1);
      });

      it('does not touch adults: no guardianship lookup at all', async () => {
        await service.approve(10, pendingAssignment.assignment_id, actorId);

        expect(transactionMock.guardianships.findFirst).not.toHaveBeenCalled();
        expect(
          transactionMock.club_role_assignments.updateMany,
        ).toHaveBeenCalledTimes(1);
      });

      it('never writes when the row is no longer pending: a row re-pended after the read is not activated ungated (S-N1)', async () => {
        transactionMock.club_role_assignments.findFirst.mockResolvedValue(null);
        transactionMock.club_role_assignments.findUnique.mockResolvedValue({
          ...pendingAssignment,
          status: 'active',
        });
        // Even if the WHERE would now match, the approve must not reach it.
        transactionMock.club_role_assignments.updateMany.mockResolvedValue({
          count: 1,
        });

        await expect(
          service.approve(10, pendingAssignment.assignment_id, actorId),
        ).rejects.toMatchObject({ code: ErrorCode.MR_ALREADY_PENDING });

        expect(
          transactionMock.club_role_assignments.updateMany,
        ).not.toHaveBeenCalled();
        expect(mockAuthorizationContextVersion.bump).not.toHaveBeenCalled();
        expect(mockAuditLogs.recordEvent).not.toHaveBeenCalled();
      });

      it('answers not found when there is no row at all and still writes nothing', async () => {
        transactionMock.club_role_assignments.findFirst.mockResolvedValue(null);
        transactionMock.club_role_assignments.findUnique.mockResolvedValue(
          null,
        );

        await expect(
          service.approve(10, pendingAssignment.assignment_id, actorId),
        ).rejects.toMatchObject({ code: ErrorCode.MR_NOT_FOUND });

        expect(
          transactionMock.club_role_assignments.updateMany,
        ).not.toHaveBeenCalled();
      });

      it('checks consent inside the approving transaction, before activating', async () => {
        transactionMock.users.findUnique.mockResolvedValue(
          gateDependentUser(userId),
        );
        transactionMock.guardianships.findFirst.mockResolvedValue({
          guardianship_id: 'g-1',
        });

        await service.approve(10, pendingAssignment.assignment_id, actorId);

        expect(
          transactionMock.guardianships.findFirst.mock.invocationCallOrder[0],
        ).toBeLessThan(
          transactionMock.club_role_assignments.updateMany.mock
            .invocationCallOrder[0],
        );
        // S2: the per-dependent lock (verify/revoke take it too) comes first.
        expect(transactionMock.$executeRaw).toHaveBeenCalledTimes(1);
        expect(
          transactionMock.$executeRaw.mock.invocationCallOrder[0],
        ).toBeLessThan(
          transactionMock.guardianships.findFirst.mock.invocationCallOrder[0],
        );
        expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      });
    });

    describe('reviewer audit (FP-20)', () => {
      it('records membership_request.approved with the reviewer as actor', async () => {
        await service.approve(10, pendingAssignment.assignment_id, actorId);

        expect(mockAuditLogs.recordEvent).toHaveBeenCalledTimes(1);
        expect(mockAuditLogs.recordEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            entity_type: 'membership_request',
            entity_id: pendingAssignment.assignment_id,
            action: 'approved',
            actor_user_id: actorId,
            actor_kind: 'user',
            target_user_id: userId,
            changes: expect.objectContaining({
              club_section_id: 10,
              to_status: 'active',
            }),
          }),
        );
      });

      it('records membership_request.rejected with the reviewer as actor', async () => {
        const reviewerId = '5b0d6bd6-1f5b-4ca4-a2a0-8f2d2a1d9e11';

        await service.reject(
          10,
          pendingAssignment.assignment_id,
          reviewerId,
          'No',
        );

        expect(mockAuditLogs.recordEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            entity_type: 'membership_request',
            action: 'rejected',
            actor_user_id: reviewerId,
            target_user_id: userId,
          }),
        );
      });

      it('does not audit a review that changed nothing', async () => {
        transactionMock.club_role_assignments.updateMany.mockResolvedValue({
          count: 0,
        });

        await expect(
          service.approve(10, pendingAssignment.assignment_id, actorId),
        ).rejects.toMatchObject({ code: ErrorCode.MR_ALREADY_PENDING });
        expect(mockAuditLogs.recordEvent).not.toHaveBeenCalled();
      });

      it('does not let a failing audit insert undo the review', async () => {
        mockAuditLogs.recordEvent.mockRejectedValueOnce(
          new Error('audit down'),
        );

        // recordEvent is fire-and-forget; the review still succeeds.
        await expect(
          service.approve(10, pendingAssignment.assignment_id, actorId),
        ).resolves.toBeDefined();
      });
    });
  });

  describe('cancelPendingForUser', () => {
    it('reopening the post-registration moves the principal epoch after the commit (unknown-age restriction)', async () => {
      await service.cancelPendingForUser(userId, actorId);

      expect(mockActingForCache.bump).toHaveBeenCalledWith(userId);
      expect(
        mockActingForCache.bump.mock.invocationCallOrder[0],
      ).toBeGreaterThan(
        Math.max(...transactionMock.users_pr.update.mock.invocationCallOrder),
      );
    });

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
    const DAY = 24 * 60 * 60 * 1000;
    const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
    const dependentId = '0d5f0be9-2b45-47b2-9cdf-4d2407a3fa99';
    const otherAdultId = '7c1b5b44-0f3e-4f4a-9a77-4a9c1b1f0c11';

    /** Wires the candidate rows and the dependents' consent for one cron run. */
    const arrange = (opts: {
      candidates: Array<{
        assignment_id: string;
        user_id: string;
        created_at: Date;
      }>;
      dependents?: string[];
      verified?: Array<{ dependent_user_id: string; verified_at: Date }>;
    }) => {
      transactionMock.club_role_assignments.findMany.mockResolvedValue(
        opts.candidates,
      );
      transactionMock.users.findMany.mockResolvedValue(
        gateDependentRows(opts.dependents ?? []),
      );
      transactionMock.guardianships.findMany.mockResolvedValue(
        opts.verified ?? [],
      );
      transactionMock.club_role_assignments.updateManyAndReturn.mockImplementation(
        ({ where }: { where: { assignment_id: { in: string[] } } }) =>
          Promise.resolve(
            opts.candidates
              .filter((c) => where.assignment_id.in.includes(c.assignment_id))
              .map((c) => ({ user_id: c.user_id })),
          ),
      );
    };

    const expiredIds = (): string[] => {
      const calls =
        transactionMock.club_role_assignments.updateManyAndReturn.mock.calls;
      if (calls.length === 0) return [];
      return (calls[0][0] as { where: { assignment_id: { in: string[] } } })
        .where.assignment_id.in;
    };

    it('versions exactly the unique user IDs returned by the bulk write', async () => {
      arrange({
        candidates: [
          { assignment_id: 'a1', user_id: userId, created_at: daysAgo(9) },
          {
            assignment_id: 'a2',
            user_id: dependentId,
            created_at: daysAgo(40),
          },
          { assignment_id: 'a3', user_id: userId, created_at: daysAgo(12) },
        ],
        dependents: [dependentId],
      });

      await expect(service.expireStaleRequests()).resolves.toBe(3);

      const expectedUserIds = [userId, dependentId];
      expect(mockAuthorizationContextVersion.bumpMany).toHaveBeenCalledTimes(1);
      expect(mockAuthorizationContextVersion.bumpMany).toHaveBeenCalledWith(
        transactionMock,
        expectedUserIds,
      );
      expect(mockAuthorizationContextVersion.bump).not.toHaveBeenCalled();
      expect(
        mockAuthorizationContext.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledTimes(2);
      expect(
        mockAuthorizationContext.invalidateUserAuthorizationCache.mock.calls.map(
          ([affectedUserId]) => affectedUserId,
        ),
      ).toEqual(expectedUserIds);
      expect(
        mockAuthorizationContextVersion.bumpMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        Math.min(
          ...mockAuthorizationContext.invalidateUserAuthorizationCache.mock
            .invocationCallOrder,
        ),
      );
      expect(
        transactionMock.club_role_assignments.updateManyAndReturn,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            assignment_id: { in: ['a1', 'a2', 'a3'] },
            status: 'pending',
            active: true,
          },
          select: { user_id: true },
        }),
      );
    });

    it('does not bump or clean up when nothing is stale', async () => {
      arrange({ candidates: [] });

      await expect(service.expireStaleRequests()).resolves.toBe(0);

      expect(
        transactionMock.club_role_assignments.updateManyAndReturn,
      ).not.toHaveBeenCalled();
      expect(mockAuthorizationContextVersion.bumpMany).not.toHaveBeenCalled();
      expect(
        mockAuthorizationContext.invalidateUserAuthorizationCache,
      ).not.toHaveBeenCalled();
    });

    it('rolls back the bulk write before cleanup when a returned user bump fails', async () => {
      arrange({
        candidates: [
          { assignment_id: 'a1', user_id: userId, created_at: daysAgo(9) },
        ],
      });
      mockAuthorizationContextVersion.bumpMany.mockRejectedValueOnce(
        new Error('version write failed'),
      );

      await expect(service.expireStaleRequests()).rejects.toThrow(
        'version write failed',
      );

      expect(
        mockAuthorizationContext.invalidateUserAuthorizationCache,
      ).not.toHaveBeenCalled();
    });

    it('queries only pending requests older than the 8-day base cutoff by default', async () => {
      arrange({ candidates: [] });

      await service.expireStaleRequests();

      const where = (
        transactionMock.club_role_assignments.findMany.mock.calls[0][0] as {
          where: { status: string; active: boolean; created_at: { lt: Date } };
        }
      ).where;
      expect(where).toMatchObject({ status: 'pending', active: true });
      const ageDays = (Date.now() - where.created_at.lt.getTime()) / DAY;
      expect(ageDays).toBeGreaterThan(7.99);
      expect(ageDays).toBeLessThan(8.01);
    });

    it('honors system_config for the base timeout', async () => {
      mockPrismaService.system_config.findUnique.mockResolvedValue({
        config_value: '5',
      });
      arrange({
        candidates: [
          { assignment_id: 'a1', user_id: userId, created_at: daysAgo(6) },
        ],
      });

      await service.expireStaleRequests();

      expect(expiredIds()).toEqual(['a1']);
    });

    describe('dependents with pending consent (FP-40, A1/A11)', () => {
      it('keeps a 9-day-old pending-consent request (30-day window)', async () => {
        arrange({
          candidates: [
            {
              assignment_id: 'dep-9d',
              user_id: dependentId,
              created_at: daysAgo(9),
            },
          ],
          dependents: [dependentId],
        });

        await expect(service.expireStaleRequests()).resolves.toBe(0);
        expect(expiredIds()).toEqual([]);
      });

      it('expires a 31-day-old pending-consent request', async () => {
        arrange({
          candidates: [
            {
              assignment_id: 'dep-31d',
              user_id: dependentId,
              created_at: daysAgo(31),
            },
          ],
          dependents: [dependentId],
        });

        await expect(service.expireStaleRequests()).resolves.toBe(1);
        expect(expiredIds()).toEqual(['dep-31d']);
      });

      it('expires a 9-day-old request of a NON-dependent (8-day rule)', async () => {
        arrange({
          candidates: [
            {
              assignment_id: 'adult-9d',
              user_id: otherAdultId,
              created_at: daysAgo(9),
            },
          ],
        });

        await expect(service.expireStaleRequests()).resolves.toBe(1);
        expect(expiredIds()).toEqual(['adult-9d']);
      });

      it('mixed batch: only the adult and the 31-day dependent expire', async () => {
        arrange({
          candidates: [
            {
              assignment_id: 'adult-9d',
              user_id: otherAdultId,
              created_at: daysAgo(9),
            },
            {
              assignment_id: 'dep-9d',
              user_id: dependentId,
              created_at: daysAgo(9),
            },
            {
              assignment_id: 'dep-31d',
              user_id: '3a8f7c42-1d2a-4c55-8f0e-6d6b2a4f9d10',
              created_at: daysAgo(31),
            },
          ],
          dependents: [dependentId, '3a8f7c42-1d2a-4c55-8f0e-6d6b2a4f9d10'],
        });

        await expect(service.expireStaleRequests()).resolves.toBe(2);
        expect(expiredIds()).toEqual(['adult-9d', 'dep-31d']);
      });
    });

    describe('dependents with verified consent (clock restarts, A11)', () => {
      it('keeps an old request verified 3 days ago (8 days counted from verification)', async () => {
        arrange({
          candidates: [
            {
              assignment_id: 'dep-old',
              user_id: dependentId,
              created_at: daysAgo(20),
            },
          ],
          dependents: [dependentId],
          verified: [
            { dependent_user_id: dependentId, verified_at: daysAgo(3) },
          ],
        });

        await expect(service.expireStaleRequests()).resolves.toBe(0);
        expect(expiredIds()).toEqual([]);
      });

      it('expires a verified request once 8 days passed since verification', async () => {
        arrange({
          candidates: [
            {
              assignment_id: 'dep-old',
              user_id: dependentId,
              created_at: daysAgo(40),
            },
          ],
          dependents: [dependentId],
          verified: [
            { dependent_user_id: dependentId, verified_at: daysAgo(9) },
          ],
        });

        await expect(service.expireStaleRequests()).resolves.toBe(1);
        expect(expiredIds()).toEqual(['dep-old']);
      });

      it('uses the latest verification when several guardians verified', async () => {
        arrange({
          candidates: [
            {
              assignment_id: 'dep-old',
              user_id: dependentId,
              created_at: daysAgo(40),
            },
          ],
          dependents: [dependentId],
          verified: [
            { dependent_user_id: dependentId, verified_at: daysAgo(20) },
            { dependent_user_id: dependentId, verified_at: daysAgo(2) },
          ],
        });

        await expect(service.expireStaleRequests()).resolves.toBe(0);
      });

      it('queries only real verified rows (no test data)', async () => {
        arrange({
          candidates: [
            {
              assignment_id: 'd',
              user_id: dependentId,
              created_at: daysAgo(9),
            },
          ],
          dependents: [dependentId],
        });

        await service.expireStaleRequests();

        expect(transactionMock.guardianships.findMany).toHaveBeenCalledWith({
          where: {
            dependent_user_id: { in: [dependentId] },
            consent_status: 'verified',
            is_test_data: false,
          },
          select: { dependent_user_id: true, verified_at: true },
        });
      });
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

    it('uses the "Menor · consentimiento pendiente" copy for a dependent whose consent is pending', async () => {
      mockPrismaService.users.findMany.mockResolvedValue(
        gateDependentRows([userId]),
      );
      mockPrismaService.guardianships.findMany.mockResolvedValue([]);

      await service.notifyNewRequestCreated({
        userId,
        clubSectionId: 10,
        assignmentId: pendingAssignment.assignment_id,
      });

      const call = mockNotificationsService.sendToSectionRole.mock.calls[0];
      expect(call[2]).toBe('Menor · consentimiento pendiente');
      expect(call[3]).toContain('ficha de consentimiento firmada');
      expect(call[5]).toBe('membership_requests:new_request');
    });

    it('keeps the normal copy for a dependent whose consent is already verified', async () => {
      mockPrismaService.users.findMany.mockResolvedValue(
        gateDependentRows([userId]),
      );
      mockPrismaService.guardianships.findMany.mockResolvedValue([
        { dependent_user_id: userId, verified_at: new Date() },
      ]);

      await service.notifyNewRequestCreated({
        userId,
        clubSectionId: 10,
        assignmentId: pendingAssignment.assignment_id,
      });

      expect(mockNotificationsService.sendToSectionRole.mock.calls[0][2]).toBe(
        'Nueva persona esperando aprobación',
      );
    });

    it('still notifies with the normal copy when the consent lookup fails', async () => {
      mockPrismaService.users.findMany.mockRejectedValue(new Error('db down'));

      await service.notifyNewRequestCreated({
        userId,
        clubSectionId: 10,
        assignmentId: pendingAssignment.assignment_id,
      });

      expect(mockNotificationsService.sendToSectionRole).toHaveBeenCalledTimes(
        1,
      );
      expect(mockNotificationsService.sendToSectionRole.mock.calls[0][2]).toBe(
        'Nueva persona esperando aprobación',
      );
    });
  });

  describe('listPending consent block (FP-72)', () => {
    const dependentA = 'aaaaaaaa-0000-4000-8000-00000000000a';
    const dependentB = 'bbbbbbbb-0000-4000-8000-00000000000b';
    const request = (user_id: string, email: string | null) => ({
      assignment_id: `as-${user_id}`,
      user_id,
      club_section_id: 10,
      status: 'pending',
      created_at: new Date('2026-10-01T12:00:00.000Z'),
      users: { user_id, name: 'N', email },
      roles: { role_id: 'r', role_name: 'member' },
    });

    it('adds null to adults and a block to dependents, with constant consent queries', async () => {
      const adults = ['a1', 'a2', 'a3'];
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        request(adults[0], 'a1@x.org'),
        request(dependentA, null),
        request(adults[1], 'a2@x.org'),
        request(dependentB, null),
        request(adults[2], 'a3@x.org'),
      ]);
      mockPrismaService.users.findMany.mockResolvedValue(
        gateDependentRows([dependentA, dependentB]),
      );
      mockPrismaService.guardianships.findMany.mockResolvedValue([
        {
          guardianship_id: 'g-a',
          dependent_user_id: dependentA,
          is_primary: true,
          is_custodian: false,
          consent_status: 'pending',
          external_name: null,
          relationship_type: { name: 'Madre' },
          guardian: { name: 'María', paternal_last_name: 'Pérez' },
          custodian_club: null,
          consent_evidences: [{ evidence_id: 'e-1' }],
        },
        {
          guardianship_id: 'g-b',
          dependent_user_id: dependentB,
          is_primary: true,
          is_custodian: false,
          consent_status: 'verified',
          external_name: null,
          relationship_type: { name: 'Padre' },
          guardian: { name: 'Luis', paternal_last_name: 'Gómez' },
          custodian_club: null,
          consent_evidences: [],
        },
      ]);

      const result = await service.listPending(10);

      expect(result.map((item) => item.consent === null)).toEqual([
        true,
        false,
        true,
        false,
        true,
      ]);
      expect(result[1].consent).toMatchObject({
        required: true,
        dependent: true,
        guardianship_id: 'g-a',
        status: 'pending',
        evidence_uploaded: true,
        guardians: [
          {
            display_name: 'María Pérez',
            relationship_type_name: 'Madre',
            is_primary: true,
          },
        ],
      });
      expect(result[3].consent).toMatchObject({
        guardianship_id: 'g-b',
        status: 'verified',
        evidence_uploaded: false,
      });
      // Constant: the reads are batched for the whole page (consent blocks +
      // verification dates), never one per request.
      expect(mockPrismaService.users.findMany).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.guardianships.findMany).toHaveBeenCalledTimes(2);
    });

    describe('effective_expires_at (same rule as the cron)', () => {
      const created = new Date('2026-10-01T12:00:00.000Z');
      const iso = (date: Date) => date.toISOString();
      const plusDays = (from: Date, days: number) =>
        new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

      const listOne = async (
        userId: string,
        opts: { dependent: boolean; verifiedAt?: Date },
      ) => {
        mockPrismaService.system_config.findUnique.mockResolvedValue({
          config_value: '8',
        });
        mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
          {
            ...request(userId, opts.dependent ? null : 'x@x.org'),
            created_at: created,
          },
        ]);
        mockPrismaService.users.findMany.mockResolvedValue(
          opts.dependent ? gateDependentRows([userId]) : [],
        );
        mockPrismaService.guardianships.findMany.mockImplementation(
          async (args: any) =>
            args?.where?.consent_status === 'verified' && opts.verifiedAt
              ? [{ dependent_user_id: userId, verified_at: opts.verifiedAt }]
              : [],
        );
        const [item] = await service.listPending(10);
        return item;
      };

      it('an adult gets created_at + the base timeout', async () => {
        const item = await listOne('a1', { dependent: false });
        expect(item.effective_expires_at).toBe(iso(plusDays(created, 8)));
      });

      it('a minor with consent pending gets created_at + max(base, 30) days', async () => {
        const item = await listOne(dependentA, { dependent: true });
        expect(item.effective_expires_at).toBe(iso(plusDays(created, 30)));
      });

      it('a minor with consent verified later restarts the base timeout at verification', async () => {
        const verifiedAt = plusDays(created, 20);
        const item = await listOne(dependentA, {
          dependent: true,
          verifiedAt,
        });
        expect(item.effective_expires_at).toBe(iso(plusDays(verifiedAt, 8)));
      });

      it('a minor verified BEFORE the request counts from created_at', async () => {
        const item = await listOne(dependentA, {
          dependent: true,
          verifiedAt: plusDays(created, -5),
        });
        expect(item.effective_expires_at).toBe(iso(plusDays(created, 8)));
      });

      it('keeps the stored expires_at untouched', async () => {
        mockPrismaService.system_config.findUnique.mockResolvedValue(null);
        const stored = plusDays(created, 8);
        mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
          { ...request('a1', 'x@x.org'), expires_at: stored },
        ]);
        const [item] = await service.listPending(10);
        expect(item.expires_at).toBe(stored);
      });
    });

    it('keeps a null email as null in the item (no 500)', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        request(dependentA, null),
      ]);

      const [item] = await service.listPending(10);

      expect(item.users.email).toBeNull();
    });

    it('does not read guardianships when nobody in the page is a dependent', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        request('a1', 'a1@x.org'),
      ]);

      const result = await service.listPending(10);

      expect(result[0].consent).toBeNull();
      expect(mockPrismaService.guardianships.findMany).not.toHaveBeenCalled();
    });
  });
});
