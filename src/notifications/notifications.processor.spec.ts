// =============================================================================
// notifications.processor.spec.ts
// Tests for NotificationsProcessor — focused on the realtime.invalidate path.
// T1.6 unit tests + T1.7 integration test (mock Firebase Admin).
// =============================================================================

// ---------------------------------------------------------------------------
// Mock firebase-admin module BEFORE any import that references it.
// ---------------------------------------------------------------------------
jest.mock('../config/firebase-admin.module', () => ({
  firebaseAdmin: {
    getApps: jest.fn(() => ['mock-app']),
    getMessaging: jest.fn(() => ({
      sendEachForMulticast: jest.fn(),
    })),
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import {
  NotificationsProcessor,
  BROADCAST_CHUNK_JOB,
  REALTIME_INVALIDATE_JOB,
  RealtimeInvalidatePayload,
  SendToClubMembersJobData,
  BroadcastChunkJobData,
} from './notifications.processor';
import { PrismaService } from '../prisma/prisma.service';
import { FcmTokensService } from './fcm-tokens.service';
import { NotificationPreferencesService } from './notification-preferences.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR_ID = '00000000-0000-0000-0000-000000000001';
const MEMBER_ID_A = '00000000-0000-0000-0000-000000000002';
const MEMBER_ID_B = '00000000-0000-0000-0000-000000000003';

function makeJob(
  data: RealtimeInvalidatePayload,
  id = 'job-test-1',
): Job<RealtimeInvalidatePayload> {
  return {
    id,
    name: REALTIME_INVALIDATE_JOB,
    data,
  } as unknown as Job<RealtimeInvalidatePayload>;
}

function makePayload(
  overrides: Partial<RealtimeInvalidatePayload> = {},
): RealtimeInvalidatePayload {
  return {
    sectionId: 10,
    resource: 'activities',
    action: 'CREATED',
    entityId: 42,
    actorId: ACTOR_ID,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
    update: jest.fn(),
  },
  notification_deliveries: {
    createMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockFcmTokensService = {
  updateLastUsed: jest.fn().mockResolvedValue(undefined),
};

const mockPreferencesService = {
  filterAllowedUsers: jest.fn(),
};

describe('NotificationsProcessor — realtime.invalidate', () => {
  let processor: NotificationsProcessor;
  let mockSendEachForMulticast: jest.Mock;
  let firebaseAdminMock: any;

  beforeEach(async () => {
    firebaseAdminMock = jest.requireMock(
      '../config/firebase-admin.module',
    ).firebaseAdmin;
    mockSendEachForMulticast = jest.fn();
    (firebaseAdminMock.getMessaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsProcessor,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FcmTokensService, useValue: mockFcmTokensService },
        {
          provide: NotificationPreferencesService,
          useValue: mockPreferencesService,
        },
      ],
    }).compile();

    processor = module.get<NotificationsProcessor>(NotificationsProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
    (firebaseAdminMock.getApps as jest.Mock).mockReturnValue(['mock-app']);
  });

  // ---------------------------------------------------------------------------
  // T1.6 — unit: actor excluded
  // ---------------------------------------------------------------------------
  it('should query FCM tokens excluding the actor via user filter', async () => {
    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
      { token: 'token-member-a' },
      { token: 'token-member-b' },
    ]);
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      responses: [{ success: true }, { success: true }],
    });

    const job = makeJob(makePayload({ actorId: ACTOR_ID }));
    await processor.process(job as any);

    expect(mockPrismaService.user_fcm_tokens.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          users: expect.objectContaining({
            user_id: { not: ACTOR_ID },
          }),
        }),
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // T1.6 — unit: empty recipient list short-circuits (no FCM call)
  // ---------------------------------------------------------------------------
  it('should not call sendEachForMulticast when there are no recipients', async () => {
    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);

    const job = makeJob(makePayload());
    const result = await processor.process(job as any);

    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    expect(result).toMatchObject({ recipientCount: 0, skipped: true });
  });

  // ---------------------------------------------------------------------------
  // T1.6 — unit: expired tokens are revoked in DB
  // ---------------------------------------------------------------------------
  it('should revoke permanently invalid tokens when FCM returns registration-token-not-registered', async () => {
    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
      { token: 'token-good' },
      { token: 'token-dead' },
    ]);
    mockPrismaService.user_fcm_tokens.updateMany.mockResolvedValue({
      count: 1,
    });
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

    const job = makeJob(makePayload());
    await processor.process(job as any);

    expect(mockPrismaService.user_fcm_tokens.updateMany).toHaveBeenCalledWith({
      where: { token: { in: ['token-dead'] } },
      data: { active: false },
    });
  });

  // ---------------------------------------------------------------------------
  // T1.6 — unit: transient errors do NOT revoke tokens
  // ---------------------------------------------------------------------------
  it('should NOT revoke tokens on transient FCM errors', async () => {
    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
      { token: 'token-a' },
    ]);
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [
        { success: false, error: { code: 'messaging/quota-exceeded' } },
      ],
    });

    const job = makeJob(makePayload());
    await processor.process(job as any);

    expect(mockPrismaService.user_fcm_tokens.updateMany).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // T1.7 — integration: FCM payload must NOT contain a notification key
  // ---------------------------------------------------------------------------
  it('T1.7 — sendEachForMulticast is called with data-only payload (no notification key)', async () => {
    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
      { token: 'token-peer' },
    ]);
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    });

    const payload = makePayload({
      sectionId: 7,
      resource: 'activities',
      action: 'UPDATED',
      entityId: 99,
    });
    const job = makeJob(payload);
    await processor.process(job as any);

    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
    const callArg = mockSendEachForMulticast.mock.calls[0][0];

    // CRITICAL: no notification key — this is what makes it a silent push
    expect(callArg).not.toHaveProperty('notification');

    // Must have data key with stringified values
    expect(callArg).toHaveProperty('data');
    expect(callArg.data).toMatchObject({
      type: 'cache_invalidate',
      sectionId: '7',
      resource: 'activities',
      action: 'UPDATED',
      entityId: '99',
    });

    // APNS content-available for iOS background wake-up
    expect(callArg).toHaveProperty('apns');
    expect(callArg.apns.payload.aps['content-available']).toBe(1);

    // Android high priority
    expect(callArg.android.priority).toBe('high');
  });

  // ---------------------------------------------------------------------------
  // T1.7 — integration: correct structured log output
  // ---------------------------------------------------------------------------
  it('should log structured outcome with job_id, counts, and action', async () => {
    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
      { token: 'tok-1' },
      { token: 'tok-2' },
    ]);
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      responses: [{ success: true }, { success: true }],
    });

    const logSpy = jest.spyOn((processor as any).logger, 'log');
    const job = makeJob(
      makePayload({ action: 'DELETED', entityId: 55 }),
      'job-42',
    );
    const result = await processor.process(job as any);

    expect(result).toMatchObject({
      recipientCount: 2,
      successCount: 2,
      failureCount: 0,
    });

    // Verify at least one log call contained the structured data
    const loggedWithJobId = logSpy.mock.calls.some((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('job-42') && msg.includes('DELETED');
    });
    expect(loggedWithJobId).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // process() dispatch — unknown job type still handled gracefully
  // ---------------------------------------------------------------------------
  it('should warn and not throw for unknown job names', async () => {
    const warnSpy = jest.spyOn((processor as any).logger, 'warn');
    const unknownJob = {
      id: 'job-x',
      name: 'unknown.job',
      data: {},
    } as unknown as Job;
    await expect(processor.process(unknownJob as any)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

// =============================================================================
// send-to-club-members job — producer + worker unit tests
// =============================================================================

function makeClubMembersJob(
  data: Partial<SendToClubMembersJobData> = {},
  id = 'job-club-1',
): Job<SendToClubMembersJobData> {
  return {
    id,
    name: 'send-to-club-members',
    data: {
      clubSectionId: 5,
      title: 'Test title',
      body: 'Test body',
      sentBy: ACTOR_ID,
      source: 'activities:created',
      ...data,
    },
  } as unknown as Job<SendToClubMembersJobData>;
}

describe('NotificationsProcessor — send-to-club-members', () => {
  let processor: NotificationsProcessor;
  let mockSendEachForMulticast: jest.Mock;
  let firebaseAdminMock: any;

  beforeEach(async () => {
    firebaseAdminMock = jest.requireMock(
      '../config/firebase-admin.module',
    ).firebaseAdmin;
    mockSendEachForMulticast = jest.fn();
    (firebaseAdminMock.getMessaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    });

    // Reset all mocks
    jest.clearAllMocks();
    (firebaseAdminMock.getApps as jest.Mock).mockReturnValue(['mock-app']);

    // Setup $transaction to invoke the callback immediately
    mockPrismaService.$transaction.mockImplementation(
      (fn: (tx: any) => Promise<any>) => fn(mockPrismaService),
    );
    mockPrismaService.notification_logs.create.mockResolvedValue({
      log_id: 99,
    });
    mockPrismaService.notification_logs.update.mockResolvedValue({});
    mockPrismaService.notification_deliveries.createMany.mockResolvedValue({
      count: 1,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsProcessor,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FcmTokensService, useValue: mockFcmTokensService },
        {
          provide: NotificationPreferencesService,
          useValue: mockPreferencesService,
        },
      ],
    }).compile();

    processor = module.get<NotificationsProcessor>(NotificationsProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
    (firebaseAdminMock.getApps as jest.Mock).mockReturnValue(['mock-app']);
  });

  it('skips when section has no active members', async () => {
    mockPrismaService.club_role_assignments.findMany.mockResolvedValue([]);

    const job = makeClubMembersJob({ clubSectionId: 99 });
    const result = await processor.process(job as any);

    expect(result).toMatchObject({ skipped: true, reason: 'no-members' });
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  it('skips when all members have opted out', async () => {
    mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
      { user_id: MEMBER_ID_A },
    ]);
    mockPreferencesService.filterAllowedUsers.mockResolvedValue(new Set()); // all opted out

    const job = makeClubMembersJob();
    const result = await processor.process(job as any);

    expect(result).toMatchObject({ skipped: true, reason: 'all-opted-out' });
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  it('creates log + deliveries before FCM push', async () => {
    mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
      { user_id: MEMBER_ID_A },
    ]);
    mockPreferencesService.filterAllowedUsers.mockResolvedValue(
      new Set([MEMBER_ID_A]),
    );
    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
      { token: 'token-a' },
    ]);
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    });

    const job = makeClubMembersJob({ clubSectionId: 5 });
    await processor.process(job as any);

    expect(mockPrismaService.$transaction).toHaveBeenCalled();
    expect(mockPrismaService.notification_logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'CLUB',
          target_type: 'club_section',
          target_id: '5',
        }),
      }),
    );
    expect(
      mockPrismaService.notification_deliveries.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ log_id: 99, user_id: MEMBER_ID_A }],
        skipDuplicates: true,
      }),
    );
  });

  it('sends FCM push to member tokens and returns counts', async () => {
    mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
      { user_id: MEMBER_ID_A },
      { user_id: MEMBER_ID_B },
    ]);
    mockPreferencesService.filterAllowedUsers.mockResolvedValue(
      new Set([MEMBER_ID_A, MEMBER_ID_B]),
    );
    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
      { token: 'token-a' },
      { token: 'token-b' },
    ]);
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      responses: [{ success: true }, { success: true }],
    });

    const job = makeClubMembersJob();
    const result = await processor.process(job as any);

    expect(result).toMatchObject({
      successCount: 2,
      failureCount: 0,
      memberCount: 2,
      skippedPush: false,
    });
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['token-a', 'token-b'],
        notification: { title: 'Test title', body: 'Test body' },
      }),
    );
  });

  it('creates deliveries even when no FCM tokens exist (inbox-first)', async () => {
    mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
      { user_id: MEMBER_ID_A },
    ]);
    mockPreferencesService.filterAllowedUsers.mockResolvedValue(
      new Set([MEMBER_ID_A]),
    );
    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]); // no tokens

    const job = makeClubMembersJob();
    const result = await processor.process(job as any);

    expect(result).toMatchObject({
      successCount: 0,
      failureCount: 0,
      skippedPush: true,
    });
    // Inbox delivery still created
    expect(mockPrismaService.$transaction).toHaveBeenCalled();
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  it('deduplicates user_ids from role assignments before processing', async () => {
    // Same user appears twice (multiple role assignments)
    mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
      { user_id: MEMBER_ID_A },
      { user_id: MEMBER_ID_A },
    ]);
    mockPreferencesService.filterAllowedUsers.mockResolvedValue(
      new Set([MEMBER_ID_A]),
    );
    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);

    const job = makeClubMembersJob();
    const result = await processor.process(job as any);

    // memberCount must be 1 after dedup
    expect(result).toMatchObject({ memberCount: 1 });
    // filterAllowedUsers should receive deduped list
    expect(mockPreferencesService.filterAllowedUsers).toHaveBeenCalledWith(
      [MEMBER_ID_A],
      'activities:created',
    );
  });
});

// =============================================================================
// broadcast-chunk job — worker-level fan-out
// =============================================================================

function makeBroadcastChunkJob(
  data: BroadcastChunkJobData,
  id = 'job-broadcast-chunk-1',
): Job<BroadcastChunkJobData> {
  return {
    id,
    name: BROADCAST_CHUNK_JOB,
    data,
  } as unknown as Job<BroadcastChunkJobData>;
}

describe('NotificationsProcessor — broadcast-chunk', () => {
  let processor: NotificationsProcessor;
  let mockSendEachForMulticast: jest.Mock;
  let firebaseAdminMock: any;

  beforeEach(async () => {
    firebaseAdminMock = jest.requireMock(
      '../config/firebase-admin.module',
    ).firebaseAdmin;
    mockSendEachForMulticast = jest.fn();
    (firebaseAdminMock.getMessaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    });

    jest.clearAllMocks();
    (firebaseAdminMock.getApps as jest.Mock).mockReturnValue(['mock-app']);

    mockPrismaService.notification_logs.update.mockResolvedValue({});
    mockPrismaService.notification_deliveries.createMany.mockResolvedValue({
      count: 1,
    });
    mockPrismaService.user_fcm_tokens.updateMany.mockResolvedValue({
      count: 0,
    });
    mockPreferencesService.filterAllowedUsers.mockImplementation(
      async (userIds: string[]) => new Set(userIds),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsProcessor,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FcmTokensService, useValue: mockFcmTokensService },
        {
          provide: NotificationPreferencesService,
          useValue: mockPreferencesService,
        },
      ],
    }).compile();

    processor = module.get<NotificationsProcessor>(NotificationsProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
    (firebaseAdminMock.getApps as jest.Mock).mockReturnValue(['mock-app']);
  });

  it('creates inbox deliveries for the chunk and sends tokens in FCM batches of 500', async () => {
    const userIds = Array.from({ length: 600 }, (_, idx) => `u-${idx}`);
    const tokens = Array.from({ length: 600 }, (_, idx) => `t-${idx}`);

    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue(
      tokens.map((token) => ({ token })),
    );
    mockSendEachForMulticast
      .mockResolvedValueOnce({
        successCount: 500,
        failureCount: 0,
        responses: tokens.slice(0, 500).map(() => ({ success: true })),
      })
      .mockResolvedValueOnce({
        successCount: 100,
        failureCount: 0,
        responses: tokens.slice(500).map(() => ({ success: true })),
      });

    const job = makeBroadcastChunkJob({
      logId: 123,
      userIds,
      title: 'Broadcast',
      body: 'Bulk',
    });

    const result = await processor.process(job as any);

    expect(
      mockPrismaService.notification_deliveries.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          { log_id: 123, user_id: 'u-0' },
          { log_id: 123, user_id: 'u-599' },
        ]),
        skipDuplicates: true,
      }),
    );

    // 600 tokens should be sent in 500 + 100 batches
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      successCount: 600,
      failureCount: 0,
      skippedPush: false,
      deliveriesCreated: 600,
    });

    expect(mockPrismaService.notification_logs.update).toHaveBeenCalledWith({
      where: { log_id: 123 },
      data: {
        tokens_sent: { increment: 600 },
        tokens_failed: { increment: 0 },
      },
    });
  });

  it('deduplicates user ids before creating deliveries and resolving tokens', async () => {
    const userIds = ['u-1', 'u-1', 'u-2'];

    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([
      { token: 'tok-1' },
    ]);
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    });

    const job = makeBroadcastChunkJob({
      logId: 456,
      userIds,
      title: 'Broadcast',
      body: 'Bulk',
    });

    await processor.process(job as any);

    expect(
      mockPrismaService.notification_deliveries.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          { log_id: 456, user_id: 'u-1' },
          { log_id: 456, user_id: 'u-2' },
        ]),
      }),
    );
    expect(mockPrismaService.user_fcm_tokens.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: { in: ['u-1', 'u-2'] }, active: true },
      }),
    );
  });

  it('revalidates category policy before creating delayed chunk deliveries', async () => {
    mockPreferencesService.filterAllowedUsers.mockResolvedValue(new Set());
    mockPrismaService.user_fcm_tokens.findMany.mockResolvedValue([]);

    const job = makeBroadcastChunkJob({
      logId: 789,
      userIds: ['u-1', 'u-2'],
      title: 'Broadcast',
      body: 'Bulk',
      source: 'activities:created',
      sentBy: 'system',
    });

    const result = await processor.process(job as any);

    expect(mockPreferencesService.filterAllowedUsers).toHaveBeenCalledWith(
      ['u-1', 'u-2'],
      'activities:created',
    );
    expect(result).toEqual({ skipped: true, reason: 'all-opted-out' });
    expect(
      mockPrismaService.notification_deliveries.createMany,
    ).not.toHaveBeenCalled();
    expect(mockPrismaService.user_fcm_tokens.findMany).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });
});
