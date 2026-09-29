import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { AppNotFoundException } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { BetterAuthService } from '../better-auth/better-auth.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminUsersService } from './admin-users.service';

describe('AdminAuthService', () => {
  let service: AdminAuthService;

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
    },
    session: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    verification: {
      deleteMany: jest.fn(),
    },
  };

  const mockBetterAuthService = {
    hasTotpEnabled: jest.fn(),
    updatePasswordById: jest.fn(),
  };

  const mockAdminUsersService = {
    assertUserInActorScope: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BetterAuthService, useValue: mockBetterAuthService },
        { provide: AdminUsersService, useValue: mockAdminUsersService },
      ],
    }).compile();

    service = module.get<AdminAuthService>(AdminAuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listUserSessions', () => {
    it('lists sessions after asserting the target is in the actor scope', async () => {
      mockAdminUsersService.assertUserInActorScope.mockResolvedValue(undefined);
      mockPrismaService.session.findMany.mockResolvedValue([
        {
          id: 'sess-1',
          userId: 'target-1',
          createdAt: new Date('2026-09-01T10:00:00.000Z'),
          expiresAt: new Date('2026-09-08T10:00:00.000Z'),
          ipAddress: '1.2.3.4',
          userAgent: 'Mozilla/5.0',
        },
      ]);

      const result = await service.listUserSessions('actor-lf', 'target-1');

      expect(
        mockAdminUsersService.assertUserInActorScope,
      ).toHaveBeenCalledWith('actor-lf', 'target-1');
      expect(mockPrismaService.users.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual({
        userId: 'target-1',
        totalSessions: 1,
        sessions: [
          {
            sessionId: 'sess-1',
            userId: 'target-1',
            createdAt: new Date('2026-09-01T10:00:00.000Z'),
            expiresAt: new Date('2026-09-08T10:00:00.000Z'),
            ipAddress: '1.2.3.4',
            userAgent: 'Mozilla/5.0',
          },
        ],
      });
    });

    it('does not list sessions when the target is outside the actor scope', async () => {
      mockAdminUsersService.assertUserInActorScope.mockRejectedValue(
        new AppNotFoundException(ErrorCode.ADMIN_USER_NOT_FOUND),
      );

      await expect(
        service.listUserSessions('actor-lf', 'outside-user'),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_NOT_FOUND });

      expect(mockPrismaService.session.findMany).not.toHaveBeenCalled();
    });
  });

  describe('revokeUserSession', () => {
    it('revokes after asserting actor scope', async () => {
      mockAdminUsersService.assertUserInActorScope.mockResolvedValue(undefined);
      mockPrismaService.session.findFirst.mockResolvedValue({ id: 'sess-1' });
      mockPrismaService.session.delete.mockResolvedValue({ id: 'sess-1' });

      await service.revokeUserSession('actor-lf', 'target-1', 'sess-1');

      expect(
        mockAdminUsersService.assertUserInActorScope,
      ).toHaveBeenCalledWith('actor-lf', 'target-1');
      expect(mockPrismaService.session.delete).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
      });
    });
  });

  describe('revokeAllUserSessions', () => {
    it('revokes all after asserting actor scope', async () => {
      mockAdminUsersService.assertUserInActorScope.mockResolvedValue(undefined);
      mockPrismaService.session.deleteMany.mockResolvedValue({ count: 2 });

      const count = await service.revokeAllUserSessions('actor-lf', 'target-1');

      expect(
        mockAdminUsersService.assertUserInActorScope,
      ).toHaveBeenCalledWith('actor-lf', 'target-1');
      expect(count).toBe(2);
    });
  });
});
