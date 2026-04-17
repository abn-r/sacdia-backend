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
    apps: ['mock-app'],
    messaging: jest.fn(() => ({
      sendEachForMulticast: jest.fn(),
    })),
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import {
  NotificationsProcessor,
  REALTIME_INVALIDATE_JOB,
  RealtimeInvalidatePayload,
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
  return { id, name: REALTIME_INVALIDATE_JOB, data } as unknown as Job<RealtimeInvalidatePayload>;
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
};

const mockFcmTokensService = {
  updateLastUsed: jest.fn().mockResolvedValue(undefined),
};

const mockPreferencesService = {};

describe('NotificationsProcessor — realtime.invalidate', () => {
  let processor: NotificationsProcessor;
  let mockSendEachForMulticast: jest.Mock;
  let firebaseAdminMock: any;

  beforeEach(async () => {
    firebaseAdminMock = jest.requireMock(
      '../config/firebase-admin.module',
    ).firebaseAdmin;
    mockSendEachForMulticast = jest.fn();
    (firebaseAdminMock.messaging as jest.Mock).mockReturnValue({
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
    firebaseAdminMock.apps = ['mock-app'];
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
    mockPrismaService.user_fcm_tokens.updateMany.mockResolvedValue({ count: 1 });
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
    const job = makeJob(makePayload({ action: 'DELETED', entityId: 55 }), 'job-42');
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
    const unknownJob = { id: 'job-x', name: 'unknown.job', data: {} } as unknown as Job;
    await expect(processor.process(unknownJob as any)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
