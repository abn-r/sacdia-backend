import {
  GoneException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { DataExportService } from './data-export.service';
import { StorageBucketAlias } from '../common/services/file-storage.service';

const mockPrisma = {
  data_export_requests: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
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
  legal_acceptances: { findMany: jest.fn() },
  guardianships: { findMany: jest.fn() },
  dependent_profiles: { findUnique: jest.fn() },
};

const mockFileStorage = {
  getSignedDownloadUrl: jest.fn(),
  deleteMany: jest.fn(),
  upload: jest.fn(),
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
  // cleanupExpiredExports
  // -------------------------------------------------------------------------

  describe('cleanupExpiredExports', () => {
    it('deletes expired R2 objects and marks rows as expired in batches', async () => {
      mockCronLogger.track.mockImplementationOnce(async (_key, callback) =>
        callback(),
      );
      mockPrisma.data_export_requests.findMany.mockResolvedValueOnce([
        { export_id: 'exp-1', r2_key: 'user/exp-1.json' },
        { export_id: 'exp-2', r2_key: 'user/exp-2.json' },
        { export_id: 'exp-3', r2_key: null },
      ]);
      mockFileStorage.deleteMany.mockResolvedValueOnce(undefined);
      mockPrisma.data_export_requests.updateMany.mockResolvedValueOnce({
        count: 3,
      });
      mockPrisma.data_export_requests.deleteMany.mockResolvedValueOnce({
        count: 0,
      });

      await service.cleanupExpiredExports();

      expect(mockFileStorage.deleteMany).toHaveBeenCalledWith('DATA_EXPORTS', [
        'user/exp-1.json',
        'user/exp-2.json',
      ]);
      expect(mockPrisma.data_export_requests.updateMany).toHaveBeenCalledWith({
        where: {
          export_id: { in: ['exp-1', 'exp-2', 'exp-3'] },
          status: 'ready',
        },
        data: { status: 'expired' },
      });
      expect(mockPrisma.data_export_requests.deleteMany).toHaveBeenCalledWith({
        where: {
          status: 'expired',
          completed_at: { lt: expect.any(Date) },
        },
      });
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

  // -------------------------------------------------------------------------
  // runExport — payload
  // -------------------------------------------------------------------------

  describe('runExport payload', () => {
    const exportId = 'exp-1';
    const userId = 'user-1';

    function arrangeExport(legalRows: unknown[]) {
      mockPrisma.data_export_requests.findUnique.mockResolvedValueOnce({
        export_id: exportId,
        user_id: userId,
        status: 'pending',
      });
      mockPrisma.data_export_requests.update.mockResolvedValue({});
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: userId,
        email: null,
      });
      for (const model of [
        mockPrisma.users_honors,
        mockPrisma.class_section_progress,
        mockPrisma.club_role_assignments,
        mockPrisma.user_fcm_tokens,
        mockPrisma.notification_deliveries,
        mockPrisma.session,
        mockPrisma.notification_preferences,
        mockPrisma.evidence_files,
      ]) {
        model.findMany.mockResolvedValue([]);
      }
      mockPrisma.legal_acceptances.findMany.mockResolvedValue(legalRows);
      mockPrisma.guardianships.findMany.mockResolvedValue([]);
      mockPrisma.dependent_profiles.findUnique.mockResolvedValue(null);
      mockFileStorage.upload.mockResolvedValue({
        key: `${userId}/${exportId}.json`,
      });
    }

    function uploadedPayload() {
      const [bucket, , buffer] = mockFileStorage.upload.mock.calls[0];
      expect(bucket).toBe(StorageBucketAlias.DATA_EXPORTS);
      return JSON.parse((buffer as Buffer).toString('utf-8'));
    }

    it('includes legal_acceptances and bumps schema_version to 1.2.0', async () => {
      const rows = [
        {
          document_type: 'terms',
          document_version: '1.0.0-store',
          accepted_at: new Date('2026-10-15T22:01:00.000Z'),
          method: 'register_checkbox',
          ip_address: '203.0.113.45',
          user_agent: 'SACDIA/1.0',
        },
      ];
      arrangeExport(rows);

      const result = await service.runExport(exportId, userId);

      expect(result.failed).toBeUndefined();
      expect(mockPrisma.legal_acceptances.findMany).toHaveBeenCalledWith({
        where: { user_id: userId },
        select: {
          document_type: true,
          document_version: true,
          accepted_at: true,
          method: true,
          ip_address: true,
          user_agent: true,
        },
        orderBy: { accepted_at: 'desc' },
      });
      const payload = uploadedPayload();
      expect(payload.export_metadata.schema_version).toBe('1.2.0');
      expect(payload.legal_acceptances).toEqual([
        { ...rows[0], accepted_at: '2026-10-15T22:01:00.000Z' },
      ]);
    });

    it('exports guardianships as dependent and as guardian without tokens or evidence keys', async () => {
      arrangeExport([]);
      const base = {
        custodian_club_id: null,
        is_custodian: false,
        consent_status: 'verified',
        sworn_declaration_at: null,
        verification_method: 'director_paper_form',
        verified_at: new Date('2026-10-16T10:00:00.000Z'),
        revoked_at: null,
        revoked_reason: null,
        created_at: new Date('2026-10-15T10:00:00.000Z'),
        relationship_type: { name: 'Madre' },
      };
      mockPrisma.guardianships.findMany.mockResolvedValue([
        {
          ...base,
          guardianship_id: 'g-1',
          dependent_user_id: userId,
          guardian_user_id: 'guardian-1',
          is_primary: true,
        },
        {
          ...base,
          guardianship_id: 'g-2',
          dependent_user_id: 'child-1',
          guardian_user_id: userId,
          is_primary: false,
        },
      ]);
      mockPrisma.dependent_profiles.findUnique.mockResolvedValue({
        created_by_user_id: 'guardian-1',
        created_at: new Date('2026-10-15T10:00:00.000Z'),
        frozen_at: null,
        purge_after: null,
      });

      await service.runExport(exportId, userId);

      const select = mockPrisma.guardianships.findMany.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('external_name');
      expect(select).not.toHaveProperty('external_phone');
      expect(select).not.toHaveProperty('consent_evidences');
      const payload = uploadedPayload();
      expect(payload.family.as_dependent).toHaveLength(1);
      expect(payload.family.as_dependent[0]).toMatchObject({
        guardianship_id: 'g-1',
        relationship_type: 'Madre',
      });
      expect(payload.family.as_guardian).toHaveLength(1);
      expect(payload.family.as_guardian[0].guardianship_id).toBe('g-2');
      expect(payload.family.dependent_profile.created_by_user_id).toBe(
        'guardian-1',
      );
    });

    it('exports an empty family block for a user without guardianships', async () => {
      arrangeExport([]);

      await service.runExport(exportId, userId);

      expect(uploadedPayload().family).toEqual({
        dependent_profile: null,
        as_dependent: [],
        as_guardian: [],
      });
    });

    it('exports an empty legal_acceptances list for a user with none', async () => {
      arrangeExport([]);

      await service.runExport(exportId, userId);

      expect(uploadedPayload().legal_acceptances).toEqual([]);
    });

    it('skips the ready email, without a failure, when the user has no email', async () => {
      arrangeExport([]);

      const result = await service.runExport(exportId, userId);

      expect(result.failed).toBeUndefined();
      expect(mockEmailService.sendDataExportReady).not.toHaveBeenCalled();
    });
  });
});
