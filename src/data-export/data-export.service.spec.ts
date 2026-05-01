import {
  GoneException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { DataExportService } from './data-export.service';

const mockPrisma = {
  data_export_requests: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockFileStorage = {
  getSignedDownloadUrl: jest.fn(),
  deleteMany: jest.fn(),
};

const mockQueue = {
  add: jest.fn(),
};

const mockCronLogger = {
  log: jest.fn(),
  track: jest.fn(),
};

const mockEmailService = {
  sendDataExportReady: jest.fn(),
};

function makeService(): DataExportService {
  return new DataExportService(
    mockPrisma as any,
    mockFileStorage as any,
    mockQueue as any,
    mockCronLogger as any,
    mockEmailService as any,
  );
}

describe('DataExportService', () => {
  let service: DataExportService;

  beforeEach(() => {
    service = makeService();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // requestExport
  // -------------------------------------------------------------------------

  describe('requestExport', () => {
    const userId = 'user-uuid';

    it('throws 429 when a ready export exists within 24h', async () => {
      const expires = new Date(Date.now() + 3600 * 1000);
      mockPrisma.data_export_requests.findFirst.mockResolvedValueOnce({
        export_id: 'exp-ready',
        status: 'ready',
        expires_at: expires,
        created_at: new Date(),
      });

      await expect(service.requestExport(userId)).rejects.toThrow(
        HttpException,
      );
    });

    it('throws 429 with retry_after_seconds in body', async () => {
      const expires = new Date(Date.now() + 7200 * 1000); // 2h from now
      mockPrisma.data_export_requests.findFirst.mockResolvedValueOnce({
        export_id: 'exp-ready',
        status: 'ready',
        expires_at: expires,
        created_at: new Date(),
      });

      try {
        await service.requestExport(userId);
        fail('should have thrown');
      } catch (e: any) {
        expect(e.getStatus()).toBe(429);
        const body = e.getResponse();
        expect(body.retry_after_seconds).toBeGreaterThan(0);
        expect(body.export_id).toBe('exp-ready');
      }
    });

    it('returns 200 with existing export when pending', async () => {
      mockPrisma.data_export_requests.findFirst
        .mockResolvedValueOnce(null) // no recent ready
        .mockResolvedValueOnce({
          export_id: 'exp-pending',
          status: 'pending',
          created_at: new Date(),
        });

      const result = await service.requestExport(userId);
      expect(result.status).toBe(200);
      expect(result.data.export_id).toBe('exp-pending');
    });

    it('returns 200 with existing export when processing', async () => {
      mockPrisma.data_export_requests.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          export_id: 'exp-proc',
          status: 'processing',
          created_at: new Date(),
        });

      const result = await service.requestExport(userId);
      expect(result.status).toBe(200);
      expect(result.data.status).toBe('processing');
    });

    it('creates new export and enqueues job when no existing', async () => {
      mockPrisma.data_export_requests.findFirst
        .mockResolvedValueOnce(null) // no recent ready
        .mockResolvedValueOnce(null); // no in-progress
      mockPrisma.data_export_requests.create.mockResolvedValueOnce({
        export_id: 'new-exp',
        status: 'pending',
        created_at: new Date(),
      });
      mockQueue.add.mockResolvedValueOnce({});

      const result = await service.requestExport(userId);
      expect(result.status).toBe(201);
      expect(result.data.export_id).toBe('new-exp');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'data-export.generate',
        { exportId: 'new-exp', userId },
        expect.objectContaining({ attempts: 1 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // listExports
  // -------------------------------------------------------------------------

  describe('listExports', () => {
    it('returns mapped list of exports with BigInt converted to number', async () => {
      const now = new Date();
      mockPrisma.data_export_requests.findMany.mockResolvedValueOnce([
        {
          export_id: 'exp-1',
          status: 'ready',
          format: 'json',
          file_size_bytes: BigInt(12345),
          created_at: now,
          completed_at: now,
          expires_at: new Date(now.getTime() + 48 * 3600 * 1000),
          failure_reason: null,
        },
      ]);

      const result = await service.listExports('user-uuid');
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].file_size_bytes).toBe(12345);
      expect(typeof result.exports[0].file_size_bytes).toBe('number');
      expect(result.exports[0].status).toBe('ready');
    });

    it('returns empty list when no exports', async () => {
      mockPrisma.data_export_requests.findMany.mockResolvedValueOnce([]);
      const result = await service.listExports('user-uuid');
      expect(result.exports).toHaveLength(0);
    });

    it('handles null file_size_bytes', async () => {
      const now = new Date();
      mockPrisma.data_export_requests.findMany.mockResolvedValueOnce([
        {
          export_id: 'exp-1',
          status: 'pending',
          format: 'json',
          file_size_bytes: null,
          created_at: now,
          completed_at: null,
          expires_at: null,
          failure_reason: null,
        },
      ]);

      const result = await service.listExports('user-uuid');
      expect(result.exports[0].file_size_bytes).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getDownloadUrl
  // -------------------------------------------------------------------------

  describe('getDownloadUrl', () => {
    const userId = 'user-uuid';
    const exportId = 'exp-ready';

    it('throws NotFoundException when export not found', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.getDownloadUrl(userId, exportId),
      ).rejects.toMatchObject({
        code: ErrorCode.EXPORT_NOT_FOUND,
      });
    });

    it('throws NotFoundException on cross-user access', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
        export_id: exportId,
        user_id: 'other-user',
        status: 'ready',
        r2_key: 'some/key',
        expires_at: new Date(Date.now() + 3600 * 1000),
      });
      await expect(
        service.getDownloadUrl(userId, exportId),
      ).rejects.toMatchObject({
        code: ErrorCode.EXPORT_NOT_FOUND,
      });
    });

    it('throws ConflictException when status is pending', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
        export_id: exportId,
        user_id: userId,
        status: 'pending',
        r2_key: null,
        expires_at: null,
      });
      await expect(
        service.getDownloadUrl(userId, exportId),
      ).rejects.toMatchObject({
        code: ErrorCode.EXPORT_ALREADY_PROCESSING,
      });
    });

    it('throws ConflictException when status is processing', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
        export_id: exportId,
        user_id: userId,
        status: 'processing',
        r2_key: null,
        expires_at: null,
      });
      await expect(
        service.getDownloadUrl(userId, exportId),
      ).rejects.toMatchObject({
        code: ErrorCode.EXPORT_ALREADY_PROCESSING,
      });
    });

    it('throws GoneException when status is expired', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
        export_id: exportId,
        user_id: userId,
        status: 'expired',
        r2_key: 'some/key',
        expires_at: new Date(Date.now() - 1000),
      });
      await expect(service.getDownloadUrl(userId, exportId)).rejects.toThrow(
        GoneException,
      );
    });

    it('throws UnprocessableEntityException when status is failed', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
        export_id: exportId,
        user_id: userId,
        status: 'failed',
        r2_key: null,
        failure_reason: 'DB timeout',
        expires_at: null,
      });
      await expect(service.getDownloadUrl(userId, exportId)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('returns presigned URL for ready export', async () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
        export_id: exportId,
        user_id: userId,
        status: 'ready',
        r2_key: 'user-uuid/exp-ready.json',
        expires_at: expiresAt,
        failure_reason: null,
      });
      mockFileStorage.getSignedDownloadUrl.mockResolvedValueOnce(
        'https://r2.example.com/signed-url?X-Amz=sig',
      );
      // update for download count — fire-and-forget, can resolve or reject
      mockPrisma.data_export_requests.update.mockResolvedValueOnce({});

      const result = await service.getDownloadUrl(userId, exportId, '1.2.3.4');
      expect(result.url).toBe('https://r2.example.com/signed-url?X-Amz=sig');
      expect(result.expires_at).toBeDefined();
      expect(mockFileStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
        'DATA_EXPORTS',
        'user-uuid/exp-ready.json',
        { expiresInSeconds: 900 },
      );
    });

    it('still returns URL even if download-count update fails (fire-and-forget)', async () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
        export_id: exportId,
        user_id: userId,
        status: 'ready',
        r2_key: 'user-uuid/exp-ready.json',
        expires_at: expiresAt,
        failure_reason: null,
      });
      mockFileStorage.getSignedDownloadUrl.mockResolvedValueOnce(
        'https://signed-url',
      );
      // Simulate update failure — should not propagate
      mockPrisma.data_export_requests.update.mockRejectedValueOnce(
        new Error('DB error'),
      );

      const result = await service.getDownloadUrl(userId, exportId);
      expect(result.url).toBe('https://signed-url');
    });
  });
});
