import { Test, TestingModule } from '@nestjs/testing';
import {
  DataExportProcessor,
  DATA_EXPORTS_QUEUE,
  DATA_EXPORT_GENERATE_JOB,
} from './data-export.processor';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { EmailService } from './email.service';

const MOCK_USER_ID = 'user-uuid-123';
const MOCK_EXPORT_ID = 'export-uuid-456';

const mockPrisma = {
  data_export_requests: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  users: { findUnique: jest.fn() },
  users_honors: { findMany: jest.fn() },
  class_section_progress: { findMany: jest.fn() },
  club_role_assignments: { findMany: jest.fn() },
  user_fcm_tokens: { findMany: jest.fn() },
  notification_deliveries: { findMany: jest.fn() },
  session: { findMany: jest.fn() },
  notification_preferences: { findMany: jest.fn() },
  evidence_files: { findMany: jest.fn() },
};

const mockFileStorage = {
  upload: jest.fn(),
};

const mockEmailService = {
  sendDataExportReady: jest.fn(),
};

const makeJob = (data: object) =>
  ({
    data,
    id: 'job-1',
    name: DATA_EXPORT_GENERATE_JOB,
  } as any);

describe('DataExportProcessor', () => {
  let processor: DataExportProcessor;

  beforeEach(async () => {
    processor = new DataExportProcessor(
      mockPrisma as any,
      mockFileStorage as any,
      mockEmailService as any,
    );

    // WorkerHost.worker is a getter — define it on the instance via defineProperty
    Object.defineProperty(processor, 'worker', {
      value: { on: jest.fn() },
      writable: true,
      configurable: true,
    });

    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('processes a pending export end-to-end', async () => {
    mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
      export_id: MOCK_EXPORT_ID,
      user_id: MOCK_USER_ID,
      status: 'pending',
    });
    mockPrisma.data_export_requests.update.mockResolvedValue({});
    mockPrisma.users.findUnique.mockResolvedValueOnce({
      user_id: MOCK_USER_ID,
      name: 'Test',
      email: 'test@example.com',
    });
    // All other tables return empty
    const emptyArr = () => Promise.resolve([]);
    mockPrisma.users_honors.findMany.mockImplementation(emptyArr);
    mockPrisma.class_section_progress.findMany.mockImplementation(emptyArr);
    mockPrisma.club_role_assignments.findMany.mockImplementation(emptyArr);
    mockPrisma.user_fcm_tokens.findMany.mockImplementation(emptyArr);
    mockPrisma.notification_deliveries.findMany.mockImplementation(emptyArr);
    mockPrisma.session.findMany.mockImplementation(emptyArr);
    mockPrisma.notification_preferences.findMany.mockImplementation(emptyArr);
    mockPrisma.evidence_files.findMany.mockImplementation(emptyArr);

    mockFileStorage.upload.mockResolvedValueOnce({
      key: `${MOCK_USER_ID}/${MOCK_EXPORT_ID}.json`,
      url: 'https://r2.example.com/key',
    });
    mockEmailService.sendDataExportReady.mockResolvedValueOnce(undefined);

    const result = await processor.process(
      makeJob({ exportId: MOCK_EXPORT_ID, userId: MOCK_USER_ID }),
    );

    expect(result).toMatchObject({ exportId: MOCK_EXPORT_ID });
    // Should have called update twice: processing + ready
    expect(mockPrisma.data_export_requests.update).toHaveBeenCalledTimes(2);
    expect(mockPrisma.data_export_requests.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'processing' }),
      }),
    );
    expect(mockPrisma.data_export_requests.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ready' }),
      }),
    );
    expect(mockFileStorage.upload).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendDataExportReady).toHaveBeenCalledWith(
      expect.objectContaining({ userId: MOCK_USER_ID, exportId: MOCK_EXPORT_ID }),
    );
  });

  // -------------------------------------------------------------------------
  // Idempotency / guard checks
  // -------------------------------------------------------------------------

  it('skips if export row not found', async () => {
    mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce(null);
    const result = await processor.process(
      makeJob({ exportId: MOCK_EXPORT_ID, userId: MOCK_USER_ID }),
    );
    expect(result).toEqual({ skipped: true, reason: 'not_found' });
  });

  it('skips on ownership mismatch (cross-user defense)', async () => {
    mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
      export_id: MOCK_EXPORT_ID,
      user_id: 'other-user',
      status: 'pending',
    });
    const result = await processor.process(
      makeJob({ exportId: MOCK_EXPORT_ID, userId: MOCK_USER_ID }),
    );
    expect(result).toEqual({ skipped: true, reason: 'ownership_mismatch' });
  });

  it('skips if already processing (idempotent)', async () => {
    mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
      export_id: MOCK_EXPORT_ID,
      user_id: MOCK_USER_ID,
      status: 'processing',
    });
    const result = await processor.process(
      makeJob({ exportId: MOCK_EXPORT_ID, userId: MOCK_USER_ID }),
    );
    expect(result).toEqual({ skipped: true, reason: 'not_pending' });
  });

  // -------------------------------------------------------------------------
  // Failure handling
  // -------------------------------------------------------------------------

  it('marks export as failed on R2 upload error without rethrowing', async () => {
    mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
      export_id: MOCK_EXPORT_ID,
      user_id: MOCK_USER_ID,
      status: 'pending',
    });
    mockPrisma.data_export_requests.update.mockResolvedValue({});
    mockPrisma.users.findUnique.mockResolvedValueOnce({
      user_id: MOCK_USER_ID,
      email: 'test@example.com',
    });
    const emptyArr = () => Promise.resolve([]);
    mockPrisma.users_honors.findMany.mockImplementation(emptyArr);
    mockPrisma.class_section_progress.findMany.mockImplementation(emptyArr);
    mockPrisma.club_role_assignments.findMany.mockImplementation(emptyArr);
    mockPrisma.user_fcm_tokens.findMany.mockImplementation(emptyArr);
    mockPrisma.notification_deliveries.findMany.mockImplementation(emptyArr);
    mockPrisma.session.findMany.mockImplementation(emptyArr);
    mockPrisma.notification_preferences.findMany.mockImplementation(emptyArr);
    mockPrisma.evidence_files.findMany.mockImplementation(emptyArr);

    mockFileStorage.upload.mockRejectedValueOnce(new Error('R2 connection refused'));

    const result = await processor.process(
      makeJob({ exportId: MOCK_EXPORT_ID, userId: MOCK_USER_ID }),
    );

    expect(result).toMatchObject({ exportId: MOCK_EXPORT_ID, failed: true });
    // Last update call should set status=failed
    const updateCalls = mockPrisma.data_export_requests.update.mock.calls;
    const lastCall = updateCalls[updateCalls.length - 1];
    expect(lastCall[0].data.status).toBe('failed');
    expect(lastCall[0].data.failure_reason).toContain('R2 connection refused');
  });

  // -------------------------------------------------------------------------
  // FCM token masking
  // -------------------------------------------------------------------------

  it('masks FCM token first 10 characters', async () => {
    mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
      export_id: MOCK_EXPORT_ID,
      user_id: MOCK_USER_ID,
      status: 'pending',
    });
    mockPrisma.data_export_requests.update.mockResolvedValue({});
    mockPrisma.users.findUnique.mockResolvedValueOnce({
      user_id: MOCK_USER_ID,
      email: 'test@example.com',
    });
    mockPrisma.users_honors.findMany.mockResolvedValueOnce([]);
    mockPrisma.class_section_progress.findMany.mockResolvedValueOnce([]);
    mockPrisma.club_role_assignments.findMany.mockResolvedValueOnce([]);
    mockPrisma.user_fcm_tokens.findMany.mockResolvedValueOnce([
      {
        fcm_token_id: 'tok-1',
        token: 'ABCDEFGHIJ_plaintext_rest',
        device_type: 'ios',
        device_name: 'iPhone',
        active: true,
        last_used: new Date(),
        created_at: new Date(),
      },
    ]);
    mockPrisma.notification_deliveries.findMany.mockResolvedValueOnce([]);
    mockPrisma.session.findMany.mockResolvedValueOnce([]);
    mockPrisma.notification_preferences.findMany.mockResolvedValueOnce([]);
    mockPrisma.evidence_files.findMany.mockResolvedValueOnce([]);

    let capturedPayload: any;
    mockFileStorage.upload.mockImplementation(
      (_alias: any, _key: any, buffer: Buffer) => {
        capturedPayload = JSON.parse(buffer.toString('utf-8'));
        return Promise.resolve({ key: 'key', url: 'url' });
      },
    );
    mockEmailService.sendDataExportReady.mockResolvedValueOnce(undefined);

    await processor.process(
      makeJob({ exportId: MOCK_EXPORT_ID, userId: MOCK_USER_ID }),
    );

    const device = capturedPayload.devices[0];
    expect(device.token.startsWith('**********')).toBe(true);
    expect(device.token).toContain('_plaintext_rest');
    expect(device.token).not.toContain('ABCDEFGHIJ');
  });
});
