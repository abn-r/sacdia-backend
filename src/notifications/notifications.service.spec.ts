import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { FcmTokensService } from './fcm-tokens.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { buildAuthorizationSnapshot } from '../../test/helpers/rbac-test-helpers';

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

  let firebaseAdminMock: any;

  const mockFcmTokensService = {
    updateLastUsed: jest.fn().mockResolvedValue(undefined),
  };

  const mockPreferencesService = {
    isAllowedForUser: jest.fn().mockResolvedValue(true),
    filterAllowedUsers: jest
      .fn()
      .mockImplementation((userIds: string[]) =>
        Promise.resolve(new Set(userIds)),
      ),
  };

  const mockAuthorizationContextService = {
    hasAnyGlobalRole: jest.fn().mockResolvedValue(false),
    resolveUserAuthorization: jest.fn(),
  };

  const mockPrismaService = {
    users: {
      findMany: jest.fn(),
    },
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
    notification_deliveries: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    // $transaction: callback style — executes the callback with `this` as the tx
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    // Retrieve the mocked module so we can control sendEachForMulticast per test
    firebaseAdminMock = jest.requireMock(
      '../config/firebase-admin.module',
    ).firebaseAdmin;
    mockSendEachForMulticast = jest.fn();
    (firebaseAdminMock.messaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    });
    mockPrismaService.users.findMany.mockResolvedValue([]);
    mockPrismaService.notification_logs.create.mockResolvedValue({ log_id: 1 });
    mockPrismaService.notification_deliveries.create.mockResolvedValue({});
    mockPrismaService.notification_deliveries.createMany.mockResolvedValue({ count: 1 });
    mockPrismaService.notification_deliveries.count.mockResolvedValue(0);
    mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
      {
        profile: { user_id: SENT_BY },
        authorization: buildAuthorizationSnapshot({
          assignmentId: 'assignment-1',
          activePermissions: ['notifications:club'],
          clubSectionId: 42,
          clubId: 7,
          clubTypeName: 'adventurers',
          localFieldId: 10,
          unionId: 20,
          countryId: 30,
        }),
      } as any,
    );

    // $transaction: simulate the interactive callback style — run callback with prisma mock as tx
    mockPrismaService.$transaction.mockImplementation(
      (cbOrArray: unknown) => {
        if (typeof cbOrArray === 'function') {
          return cbOrArray(mockPrismaService);
        }
        return Promise.resolve([]);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FcmTokensService, useValue: mockFcmTokensService },
        {
          provide: NotificationPreferencesService,
          useValue: mockPreferencesService,
        },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContextService,
        },
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

    it('should create delivery and return success even when user has no FCM tokens (regression: inbox must not depend on tokens)', async () => {
      // This is the exact scenario that was silently broken: admin sends to a
      // user who has never logged in from mobile (no registered FCM tokens).
      // Expected: delivery row created, success: true, push skipped gracefully.
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);

      const result = await service.sendToUser(dto, SENT_BY);

      // Must succeed — the inbox is the source of truth
      expect(result).toMatchObject({ success: true, skippedPush: true });
      // FCM multicast must NOT have been called
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
      // Delivery + log must have been persisted
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.notification_deliveries.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: dto.userId }),
        }),
      );
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
      expect(result).toMatchObject({
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
        responses: [
          { success: true },
          {
            success: false,
            error: { code: 'messaging/registration-token-not-registered' },
          },
        ],
      });
      mockPrismaService.user_fcm_tokens.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.sendToUser(dto, SENT_BY);

      expect(mockPrismaService.user_fcm_tokens.updateMany).toHaveBeenCalledWith(
        {
          where: { token: { in: ['token-bad'] } },
          data: { active: false },
        },
      );
      expect(result).toMatchObject({
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

      expect(
        mockPrismaService.user_fcm_tokens.updateMany,
      ).not.toHaveBeenCalled();
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

    it('should return failure when no active users exist', async () => {
      mockPrismaService.users.findMany.mockResolvedValue([]);

      const result = await service.broadcast(dto, SENT_BY);

      expect(result).toEqual({ success: false, message: 'No active users' });
      expect(mockPrismaService.user_fcm_tokens.findMany).not.toHaveBeenCalled();
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    });

    it('should create deliveries for all active users even when none have FCM tokens', async () => {
      // Regression: broadcast to users with no registered devices must still
      // create delivery rows so the inbox is populated.
      mockPrismaService.users.findMany.mockResolvedValue([
        { user_id: 'user-1' },
        { user_id: 'user-2' },
      ]);
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);

      const result = await service.broadcast(dto, SENT_BY);

      expect(result).toMatchObject({
        success: true,
        skippedPush: true,
        deliveriesCreated: 2,
      });
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.notification_deliveries.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ user_id: 'user-1' }),
            expect.objectContaining({ user_id: 'user-2' }),
          ]),
        }),
      );
    });

    it('should broadcast to all active users and push to those with tokens', async () => {
      mockPrismaService.users.findMany.mockResolvedValue([
        { user_id: 'user-1' },
        { user_id: 'user-2' },
      ]);
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
      expect(result).toMatchObject({
        success: true,
        successCount: 2,
        failureCount: 0,
      });
      expect(mockPrismaService.notification_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'BROADCAST',
            sent_by: SENT_BY,
          }),
        }),
      );
    });

    it('should send in multiple batches when tokens exceed 500', async () => {
      // 510 users, 510 tokens → 2 batches (500 + 10)
      const users = Array.from({ length: 510 }, (_, i) => ({
        user_id: `user-${i}`,
      }));
      const tokens = Array.from({ length: 510 }, (_, i) => ({
        token: `tok-${i}`,
      }));
      mockPrismaService.users.findMany.mockResolvedValue(users);
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue(tokens);
      mockSendEachForMulticast
        .mockResolvedValueOnce({
          successCount: 500,
          failureCount: 0,
          responses: [],
        })
        .mockResolvedValueOnce({
          successCount: 10,
          failureCount: 0,
          responses: [],
        });

      const result = await service.broadcast(dto, SENT_BY);

      expect(mockSendEachForMulticast).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
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

    it('should reject club sends when the active assignment does not match the target section', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        { user_id: 'user-1' },
      ]);
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValueOnce(
        {
          profile: { user_id: SENT_BY },
          authorization: buildAuthorizationSnapshot({
            assignmentId: 'assignment-1',
            activePermissions: ['notifications:club'],
            clubSectionId: 11,
            clubId: 7,
            clubTypeName: 'adventurers',
            localFieldId: 10,
            unionId: 20,
            countryId: 30,
          }),
        } as any,
      );

      await expect(
        service.sendToClubMembers(clubSectionId, dto, SENT_BY),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.notification_logs.create).not.toHaveBeenCalled();
    });

    it('should not resolve system callers through user authorization and should still send to club members', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        { user_id: 'user-1' },
      ]);
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);
      mockAuthorizationContextService.resolveUserAuthorization.mockImplementation(
        async (userId: string) => {
          if (userId === 'system') {
            throw new Error('system user must not be resolved');
          }

          return {
            profile: { user_id: userId },
            authorization: buildAuthorizationSnapshot({
              assignmentId: 'assignment-1',
              activePermissions: ['notifications:club'],
              clubSectionId,
              clubId: 7,
              clubTypeName: 'adventurers',
              localFieldId: 10,
              unionId: 20,
              countryId: 30,
            }),
          } as any;
        },
      );

      const result = await service.sendToClubMembers(
        clubSectionId,
        dto,
        'system',
      );

      expect(result).toMatchObject({
        success: true,
        skippedPush: true,
        memberCount: 1,
      });
      expect(
        mockAuthorizationContextService.resolveUserAuthorization,
      ).not.toHaveBeenCalledWith('system');
      expect(mockPrismaService.club_role_assignments.findMany).toHaveBeenCalled();
    });

    it('should return failure when club section has no active members', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([]);

      const result = await service.sendToClubMembers(
        clubSectionId,
        dto,
        SENT_BY,
      );

      expect(result).toEqual({ success: false, message: 'No members found' });
      expect(mockPrismaService.user_fcm_tokens.findMany).not.toHaveBeenCalled();
    });

    it('should create deliveries and return success when members have no active FCM tokens', async () => {
      // Regression: club members without registered devices must still get
      // delivery rows so their inbox is populated when they open the app.
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        { user_id: 'user-1' },
        { user_id: 'user-2' },
      ]);
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);

      const result = await service.sendToClubMembers(
        clubSectionId,
        dto,
        SENT_BY,
      );

      expect(result).toMatchObject({
        success: true,
        skippedPush: true,
        memberCount: 2,
      });
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.notification_deliveries.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ user_id: 'user-1' }),
            expect.objectContaining({ user_id: 'user-2' }),
          ]),
        }),
      );
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

      const result = await service.sendToClubMembers(
        clubSectionId,
        dto,
        SENT_BY,
      );

      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).toHaveBeenCalledWith({
        where: { club_section_id: clubSectionId, active: true },
        select: { user_id: true },
      });
      expect(mockPrismaService.user_fcm_tokens.findMany).toHaveBeenCalledWith({
        where: { user_id: { in: ['user-1', 'user-2'] }, active: true },
        select: { token: true },
      });
      expect(result).toMatchObject({
        success: true,
        successCount: 3,
        failureCount: 0,
        memberCount: 2,
      });
      expect(mockPrismaService.notification_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CLUB',
            sent_by: SENT_BY,
            tokens_sent: 0,
          }),
        }),
      );
    });

    it('should send in batches when club has more than 500 tokens', async () => {
      const members = Array.from({ length: 5 }, (_, i) => ({
        user_id: `user-${i}`,
      }));
      const tokens = Array.from({ length: 510 }, (_, i) => ({
        token: `tok-${i}`,
      }));

      mockPrismaService.club_role_assignments.findMany.mockResolvedValue(
        members,
      );
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue(tokens);
      mockSendEachForMulticast
        .mockResolvedValueOnce({
          successCount: 500,
          failureCount: 0,
          responses: [],
        })
        .mockResolvedValueOnce({
          successCount: 10,
          failureCount: 0,
          responses: [],
        });

      const result = await service.sendToClubMembers(
        clubSectionId,
        dto,
        SENT_BY,
      );

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

      const result = await service.sendToClubMembers(
        clubSectionId,
        dto,
        SENT_BY,
      );

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
    const CALLER_ID = '00000000-0000-0000-0000-000000000099';
    const DELIVERY_ID = '00000000-0000-0000-0000-000000000088';

    it('regular user: should query notification_deliveries (not notification_logs)', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(false);

      const mockDeliveries = [
        {
          delivery_id: DELIVERY_ID,
          log_id: 1,
          user_id: CALLER_ID,
          read_at: null,
          created_at: new Date(),
          notification_log: {
            log_id: 1,
            title: 'Test',
            body: 'Body',
            type: 'SECTION_ROLE',
            target_type: 'section_role',
            source: null,
            created_at: new Date(),
          },
        },
      ];
      mockPrismaService.notification_deliveries.findMany.mockResolvedValue(mockDeliveries);
      mockPrismaService.notification_deliveries.count.mockResolvedValue(1);

      const result = await service.getNotificationHistory(CALLER_ID, 1, 20);

      expect(
        mockAuthorizationContextService.hasAnyGlobalRole,
      ).toHaveBeenCalledWith(CALLER_ID, [
        'admin',
        'super_admin',
        'assistant_admin',
      ]);
      // Must NOT query notification_logs directly for regular users
      expect(mockPrismaService.notification_logs.findMany).not.toHaveBeenCalled();
      expect(mockPrismaService.notification_deliveries.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: CALLER_ID },
          include: { notification_log: true },
          orderBy: { created_at: 'desc' },
        }),
      );
      expect(result.data[0]).toMatchObject({
        delivery_id: DELIVERY_ID,
        read_at: null,
        title: 'Test',
        type: 'SECTION_ROLE',
      });
      expect(result.total).toBe(1);
    });

    it('admin user with local-field scope should include system logs delivered to that territory and exclude others', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: { user_id: CALLER_ID, local_field_id: 10 },
          authorization: buildAuthorizationSnapshot({
            globalPermissions: ['notifications:club'],
            globalRoleName: 'admin',
            localFieldId: 10,
            countryId: 30,
          }),
        } as any,
      );

      const logs = [
        {
          log_id: 7,
          title: 'Local field alert',
          body: 'Allowed',
          type: 'BROADCAST',
          target_type: 'club_section',
          target_id: '42',
          sent_by: null,
          tokens_sent: 3,
          tokens_failed: 0,
          created_at: new Date(),
          deliveries: [
            {
              user: {
                user_id: CALLER_ID,
                local_field_id: 10,
                name: 'Admin',
                paternal_last_name: null,
                email: 'local@test.com',
              },
            },
          ],
        },
        {
          log_id: 8,
          title: 'Other field alert',
          body: 'Should stay hidden',
          type: 'BROADCAST',
          target_type: 'club_section',
          target_id: '99',
          sent_by: null,
          tokens_sent: 2,
          tokens_failed: 0,
          created_at: new Date(),
          deliveries: [
            {
              user: {
                user_id: '00000000-0000-0000-0000-000000000777',
                local_field_id: 99,
                name: 'Other Admin',
                paternal_last_name: null,
                email: 'other@test.com',
              },
            },
          ],
        },
      ];

      mockPrismaService.notification_logs.findMany.mockImplementation(
        async ({ where }) =>
          logs.filter(
            (log) =>
              log.deliveries?.some(
                (delivery) =>
                  delivery.user?.local_field_id ===
                  where?.deliveries?.some?.user?.local_field_id,
              ),
          ),
      );
      mockPrismaService.notification_logs.count.mockImplementation(
        async ({ where }) =>
          logs.filter(
            (log) =>
              log.deliveries?.some(
                (delivery) =>
                  delivery.user?.local_field_id ===
                  where?.deliveries?.some?.user?.local_field_id,
              ),
          ).length,
      );

      const result = await service.getNotificationHistory(CALLER_ID, 1, 20);

      expect(mockPrismaService.notification_logs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deliveries: {
              some: {
                user: {
                  local_field_id: 10,
                },
              },
            },
          },
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ log_id: 7, title: 'Local field alert' });
      expect(result.total).toBe(1);
    });

    it('admin user with broader union scope should not be narrowed to local-field and should include system logs from that union', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: { user_id: CALLER_ID, local_field_id: 10, union_id: 20 },
          authorization: buildAuthorizationSnapshot({
            globalPermissions: ['notifications:club'],
            globalRoleName: 'admin',
            localFieldId: 10,
            unionId: 20,
            countryId: 30,
          }),
        } as any,
      );

      const logs = [
        {
          log_id: 11,
          title: 'Union system alert',
          body: 'Allowed for union',
          type: 'CLUB',
          target_type: 'club_section',
          target_id: '88',
          sent_by: null,
          tokens_sent: 1,
          tokens_failed: 0,
          created_at: new Date(),
          deliveries: [
            {
              user: { user_id: 'user-union', union_id: 20, local_field_id: 11 },
            },
          ],
        },
        {
          log_id: 12,
          title: 'Local field only alert',
          body: 'Should be hidden for union scope when it belongs to another field',
          type: 'CLUB',
          target_type: 'club_section',
          target_id: '99',
          sent_by: null,
          tokens_sent: 1,
          tokens_failed: 0,
          created_at: new Date(),
          deliveries: [
            {
              user: { user_id: 'user-local', union_id: 999, local_field_id: 10 },
            },
          ],
        },
      ];

      mockPrismaService.notification_logs.findMany.mockImplementation(
        async ({ where }) =>
          logs.filter(
            (log) =>
              log.deliveries?.some(
                (delivery) =>
                  delivery.user?.union_id === where?.deliveries?.some?.user?.union_id,
              ) ||
              log.deliveries?.some(
                (delivery) =>
                  delivery.user?.local_field_id ===
                  where?.deliveries?.some?.user?.local_field_id,
              ),
          ),
      );
      mockPrismaService.notification_logs.count.mockImplementation(
        async ({ where }) =>
          logs.filter(
            (log) =>
              log.deliveries?.some(
                (delivery) =>
                  delivery.user?.union_id === where?.deliveries?.some?.user?.union_id,
              ) ||
              log.deliveries?.some(
                (delivery) =>
                  delivery.user?.local_field_id ===
                  where?.deliveries?.some?.user?.local_field_id,
              ),
          ).length,
      );

      const result = await service.getNotificationHistory(CALLER_ID, 1, 20);

      expect(mockPrismaService.notification_logs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deliveries: {
              some: {
                user: {
                  union_id: 20,
                },
              },
            },
          },
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        log_id: 11,
        title: 'Union system alert',
      });
      expect(result.total).toBe(1);
    });

    it('admin user: should return all logs with user relation included', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: { user_id: SENT_BY },
          authorization: buildAuthorizationSnapshot({
            globalPermissions: ['notifications:club'],
            globalRoleName: 'super_admin',
            countryId: 30,
          }),
        } as any,
      );

      const mockLogs = [
        {
          log_id: 2,
          title: 'Broadcast',
          body: 'Global',
          type: 'BROADCAST',
          target_type: 'all',
          target_id: null,
          sent_by: SENT_BY,
          tokens_sent: 10,
          tokens_failed: 0,
          created_at: new Date(),
          users: {
            user_id: SENT_BY,
            name: 'Admin',
            paternal_last_name: null,
            email: 'a@b.com',
          },
        },
      ];
      mockPrismaService.notification_logs.findMany.mockResolvedValue(mockLogs);
      mockPrismaService.notification_logs.count.mockResolvedValue(1);

      const result = await service.getNotificationHistory(SENT_BY, 1, 20);

      expect(mockPrismaService.notification_logs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          include: expect.objectContaining({ users: expect.any(Object) }),
        }),
      );
      // Admin path should NOT touch notification_deliveries
      expect(mockPrismaService.notification_deliveries.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: mockLogs,
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // sendToSectionRole — delivery creation
  // ---------------------------------------------------------------------------
  describe('sendToSectionRole delivery creation', () => {
    const clubSectionId = 10;
    const roleNames = ['director'];
    const title = 'Alerta';
    const body = 'Reunión de directores';

    it('should create deliveries for each resolved user', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        { user_id: 'user-1' },
        { user_id: 'user-2' },
      ]);
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
        { token: 'tok-1' },
      ]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      });

      await service.sendToSectionRole(clubSectionId, roleNames, title, body);

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.notification_deliveries.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ user_id: 'user-1' }),
            expect.objectContaining({ user_id: 'user-2' }),
          ]),
          skipDuplicates: true,
        }),
      );
    });

    it('should not create deliveries when no users match the role', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([]);

      await service.sendToSectionRole(clubSectionId, roleNames, title, body);

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(mockPrismaService.notification_deliveries.createMany).not.toHaveBeenCalled();
    });

    it('should create deliveries even when resolved users have no FCM tokens', async () => {
      // Regression: role-based notification to users without registered devices
      // must still populate the inbox.
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        { user_id: 'user-1' },
        { user_id: 'user-2' },
      ]);
      mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);

      await service.sendToSectionRole(clubSectionId, roleNames, title, body);

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.notification_deliveries.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ user_id: 'user-1' }),
            expect.objectContaining({ user_id: 'user-2' }),
          ]),
          skipDuplicates: true,
        }),
      );
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getUnreadCount
  // ---------------------------------------------------------------------------
  describe('getUnreadCount', () => {
    it('should return count of unread deliveries', async () => {
      mockPrismaService.notification_deliveries.count.mockResolvedValue(7);

      const result = await service.getUnreadCount('user-1');

      expect(mockPrismaService.notification_deliveries.count).toHaveBeenCalledWith({
        where: { user_id: 'user-1', read_at: null },
      });
      expect(result).toEqual({ count: 7 });
    });
  });

  // ---------------------------------------------------------------------------
  // markDeliveryRead
  // ---------------------------------------------------------------------------
  describe('markDeliveryRead', () => {
    const deliveryId = '00000000-0000-0000-0000-000000000001';
    const callerId = '00000000-0000-0000-0000-000000000002';

    it('should update read_at when delivery belongs to caller', async () => {
      const existingDelivery = { delivery_id: deliveryId, user_id: callerId, read_at: null };
      mockPrismaService.notification_deliveries.findFirst.mockResolvedValue(existingDelivery);
      mockPrismaService.notification_deliveries.update.mockResolvedValue({
        ...existingDelivery,
        read_at: new Date(),
      });

      const result = await service.markDeliveryRead(deliveryId, callerId);

      expect(mockPrismaService.notification_deliveries.findFirst).toHaveBeenCalledWith({
        where: { delivery_id: deliveryId, user_id: callerId },
      });
      expect(mockPrismaService.notification_deliveries.update).toHaveBeenCalledWith({
        where: { delivery_id: deliveryId },
        data: { read_at: expect.any(Date) },
      });
      expect(result.read_at).toBeTruthy();
    });

    it('should throw NotFoundException when delivery not found or belongs to another user', async () => {
      mockPrismaService.notification_deliveries.findFirst.mockResolvedValue(null);

      await expect(
        service.markDeliveryRead(deliveryId, 'other-user'),
      ).rejects.toThrow('not found');
    });
  });

  // ---------------------------------------------------------------------------
  // markAllDeliveriesRead
  // ---------------------------------------------------------------------------
  describe('markAllDeliveriesRead', () => {
    it('should bulk update all unread deliveries and return count', async () => {
      mockPrismaService.notification_deliveries.updateMany.mockResolvedValue({ count: 4 });

      const result = await service.markAllDeliveriesRead('user-1');

      expect(mockPrismaService.notification_deliveries.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1', read_at: null },
        data: { read_at: expect.any(Date) },
      });
      expect(result).toEqual({ updated: 4 });
    });
  });
});
