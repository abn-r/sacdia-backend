import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Mock firebase-admin module BEFORE importing the service under test.
// jest.mock is hoisted to the top of the file, so the factory cannot reference
// variables declared with `const`/`let`. We create the mock functions inline
// and retrieve them via jest.requireMock() in beforeEach.
// ---------------------------------------------------------------------------
jest.mock('../config/firebase-admin.module', () => ({
  firebaseAdmin: {
    apps: ['mock-app'], // non-empty array → isFcmConfigured() returns true
    messaging: jest.fn(() => ({
      sendEachForMulticast: jest.fn(),
    })),
  },
}));

const SENT_BY = '00000000-0000-0000-0000-000000000001';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockSendEachForMulticast: jest.Mock;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let firebaseAdminMock: any;

  const mockPrismaService = {
    user_fcm_tokens: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    club_role_assignments: {
      findMany: jest.fn(),
    },
    notification_logs: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    // Retrieve the mocked module so we can control sendEachForMulticast per test
    firebaseAdminMock = jest.requireMock('../config/firebase-admin.module').firebaseAdmin;
    mockSendEachForMulticast = jest.fn();
    (firebaseAdminMock.messaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    });
    mockPrismaService.notification_logs.create.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Restore apps to non-empty after any test that empties it
    firebaseAdminMock.apps = ['mock-app'];
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // sendToUser
  // ---------------------------------------------------------------------------
  describe('sendToUser', () => {
    const dto = {
      userId: 'user-1',
      title: 'Hola',
      body: 'Mensaje de prueba',
    };

    it('should return failure when no active FCM tokens found', async () => {
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);

      const result = await service.sendToUser(dto, SENT_BY);

      expect(result).toEqual({
        success: false,
        message: 'No active FCM tokens found',
      });
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    });

    it('should send notification and return success counts', async () => {
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
        { token: 'token-a' },
        { token: 'token-b' },
      ]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 2,
        failureCount: 0,
        responses: [{ success: true }, { success: true }],
      });

      const result = await service.sendToUser(dto, SENT_BY);

      expect(mockSendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: ['token-a', 'token-b'],
          notification: { title: dto.title, body: dto.body },
        }),
      );
      expect(result).toEqual({
        success: true,
        successCount: 2,
        failureCount: 0,
      });
      expect(mockPrismaService.notification_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'USER', sent_by: SENT_BY }),
        }),
      );
    });

    it('should deactivate invalid tokens on FCM failure', async () => {
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
        { token: 'token-good' },
        { token: 'token-bad' },
      ]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        responses: [{ success: true }, { success: false }],
      });
      mockPrismaService.user_fcm_tokens.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.sendToUser(dto, SENT_BY);

      expect(mockPrismaService.user_fcm_tokens.updateMany).toHaveBeenCalledWith({
        where: { token: { in: ['token-bad'] } },
        data: { active: false },
      });
      expect(result).toEqual({
        success: true,
        successCount: 1,
        failureCount: 1,
      });
    });

    it('should not call updateMany when all tokens succeed', async () => {
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
        { token: 'token-a' },
      ]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      });

      await service.sendToUser(dto, SENT_BY);

      expect(mockPrismaService.user_fcm_tokens.updateMany).not.toHaveBeenCalled();
    });

    it('should return not-configured message when FCM apps array is empty', async () => {
      firebaseAdminMock.apps = []; // simulate Firebase not initialized

      const result = await service.sendToUser(dto, SENT_BY);

      expect(result).toEqual({
        success: false,
        message: 'FCM service is not configured in this environment',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // broadcast
  // ---------------------------------------------------------------------------
  describe('broadcast', () => {
    const dto = { title: 'Aviso', body: 'Mensaje global' };

    it('should return failure when no active tokens exist', async () => {
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);

      const result = await service.broadcast(dto, SENT_BY);

      expect(result).toEqual({ success: false, message: 'No active tokens' });
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    });

    it('should broadcast to all active tokens in a single batch', async () => {
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
        { token: 'tok-1' },
        { token: 'tok-2' },
      ]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 2,
        failureCount: 0,
        responses: [],
      });

      const result = await service.broadcast(dto, SENT_BY);

      expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        success: true,
        successCount: 2,
        failureCount: 0,
      });
      expect(mockPrismaService.notification_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'BROADCAST', sent_by: SENT_BY }),
        }),
      );
    });

    it('should send in multiple batches when tokens exceed 500', async () => {
      // 510 tokens → 2 batches (500 + 10)
      const tokens = Array.from({ length: 510 }, (_, i) => ({ token: `tok-${i}` }));
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue(tokens);
      mockSendEachForMulticast
        .mockResolvedValueOnce({ successCount: 500, failureCount: 0, responses: [] })
        .mockResolvedValueOnce({ successCount: 10, failureCount: 0, responses: [] });

      const result = await service.broadcast(dto, SENT_BY);

      expect(mockSendEachForMulticast).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        success: true,
        successCount: 510,
        failureCount: 0,
      });
    });

    it('should return not-configured message when FCM apps array is empty', async () => {
      firebaseAdminMock.apps = [];

      const result = await service.broadcast(dto, SENT_BY);

      expect(result).toEqual({
        success: false,
        message: 'FCM service is not configured in this environment',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // sendToClubMembers
  // ---------------------------------------------------------------------------
  describe('sendToClubMembers', () => {
    const clubSectionId = 42;
    const dto = { title: 'Club', body: 'Reunión hoy' };

    it('should return failure when club section has no active members', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([]);

      const result = await service.sendToClubMembers(clubSectionId, dto, SENT_BY);

      expect(result).toEqual({ success: false, message: 'No members found' });
      expect(mockPrismaService.user_fcm_tokens.findMany).not.toHaveBeenCalled();
    });

    it('should return failure when members have no active FCM tokens', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        { user_id: 'user-1' },
        { user_id: 'user-2' },
      ]);
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);

      const result = await service.sendToClubMembers(clubSectionId, dto, SENT_BY);

      expect(result).toEqual({
        success: false,
        message: 'No active tokens for club members',
      });
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    });

    it('should send notifications to all club members with active tokens', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        { user_id: 'user-1' },
        { user_id: 'user-2' },
      ]);
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
        { token: 'tok-1' },
        { token: 'tok-2' },
        { token: 'tok-3' },
      ]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 3,
        failureCount: 0,
        responses: [],
      });

      const result = await service.sendToClubMembers(clubSectionId, dto, SENT_BY);

      expect(mockPrismaService.club_role_assignments.findMany).toHaveBeenCalledWith({
        where: { club_section_id: clubSectionId, active: true },
        select: { user_id: true },
      });
      expect(mockPrismaService.user_fcm_tokens.findMany).toHaveBeenCalledWith({
        where: { user_id: { in: ['user-1', 'user-2'] }, active: true },
        select: { token: true },
      });
      expect(result).toEqual({
        success: true,
        successCount: 3,
        failureCount: 0,
        memberCount: 2,
      });
      expect(mockPrismaService.notification_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'CLUB', sent_by: SENT_BY }),
        }),
      );
    });

    it('should send in batches when club has more than 500 tokens', async () => {
      const members = Array.from({ length: 5 }, (_, i) => ({ user_id: `user-${i}` }));
      const tokens = Array.from({ length: 510 }, (_, i) => ({ token: `tok-${i}` }));

      mockPrismaService.club_role_assignments.findMany.mockResolvedValue(members);
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue(tokens);
      mockSendEachForMulticast
        .mockResolvedValueOnce({ successCount: 500, failureCount: 0, responses: [] })
        .mockResolvedValueOnce({ successCount: 10, failureCount: 0, responses: [] });

      const result = await service.sendToClubMembers(clubSectionId, dto, SENT_BY);

      expect(mockSendEachForMulticast).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        success: true,
        successCount: 510,
        failureCount: 0,
        memberCount: 5,
      });
    });

    it('should return not-configured message when FCM apps array is empty', async () => {
      firebaseAdminMock.apps = [];

      const result = await service.sendToClubMembers(clubSectionId, dto, SENT_BY);

      expect(result).toEqual({
        success: false,
        message: 'FCM service is not configured in this environment',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getNotificationHistory
  // ---------------------------------------------------------------------------
  describe('getNotificationHistory', () => {
    it('should return paginated notification history', async () => {
      const mockLogs = [
        {
          log_id: 1,
          title: 'Test',
          body: 'Body',
          type: 'BROADCAST',
          target_type: 'all',
          target_id: null,
          sent_by: SENT_BY,
          tokens_sent: 10,
          tokens_failed: 0,
          created_at: new Date(),
          users: { user_id: SENT_BY, name: 'Admin', paternal_last_name: null, email: 'a@b.com' },
        },
      ];
      mockPrismaService.notification_logs.findMany.mockResolvedValue(mockLogs);
      mockPrismaService.notification_logs.count.mockResolvedValue(1);

      const result = await service.getNotificationHistory(1, 20);

      expect(result).toEqual({
        data: mockLogs,
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });
  });
});
