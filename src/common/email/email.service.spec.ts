import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { EmailQueueProducer } from './email.queue';
import {
  EMAIL_JOB_DATA_EXPORT_READY,
  EMAIL_JOB_EMAIL_VERIFICATION,
  EMAIL_JOB_PASSWORD_RESET,
  EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED,
} from './email.queue';

const mockEnqueue = jest.fn().mockResolvedValue(undefined);

const mockEmailQueueProducer = {
  enqueue: mockEnqueue,
};

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: EmailQueueProducer,
          useValue: mockEmailQueueProducer,
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // sendDataExportReady
  // ---------------------------------------------------------------------------
  describe('sendDataExportReady', () => {
    const expiresAt = new Date('2026-05-01T00:00:00.000Z');

    it('enqueues correct job type', async () => {
      await service.sendDataExportReady({
        userId: 'user-123',
        email: 'user@example.com',
        exportId: 'export-abc',
        deepLink: 'sacdia://data-export/export-abc',
        expiresAt,
      });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledWith(
        EMAIL_JOB_DATA_EXPORT_READY,
        expect.objectContaining({
          to: 'user@example.com',
          userId: 'user-123',
          exportId: 'export-abc',
          deepLink: 'sacdia://data-export/export-abc',
          expiresAt: expiresAt.toISOString(),
        }),
      );
    });

    it('serializes expiresAt as ISO string', async () => {
      await service.sendDataExportReady({
        userId: 'u',
        email: 'u@e.com',
        exportId: 'x',
        deepLink: 'd',
        expiresAt,
      });

      const payload = mockEnqueue.mock.calls[0][1];
      expect(typeof payload.expiresAt).toBe('string');
      expect(payload.expiresAt).toBe('2026-05-01T00:00:00.000Z');
    });
  });

  // ---------------------------------------------------------------------------
  // sendEmailVerification
  // ---------------------------------------------------------------------------
  describe('sendEmailVerification', () => {
    it('enqueues correct job type with verificationUrl', async () => {
      await service.sendEmailVerification({
        email: 'new@example.com',
        verificationUrl: 'https://api.sacdia.app/auth/verify?token=opaque',
        userName: 'Juan',
      });

      expect(mockEnqueue).toHaveBeenCalledWith(
        EMAIL_JOB_EMAIL_VERIFICATION,
        expect.objectContaining({
          to: 'new@example.com',
          verificationUrl: 'https://api.sacdia.app/auth/verify?token=opaque',
          userName: 'Juan',
        }),
      );
    });

    it('works without optional userName', async () => {
      await service.sendEmailVerification({
        email: 'x@y.com',
        verificationUrl: 'https://api.sacdia.app/auth/verify?token=t',
      });

      expect(mockEnqueue).toHaveBeenCalledWith(
        EMAIL_JOB_EMAIL_VERIFICATION,
        expect.objectContaining({
          to: 'x@y.com',
          userName: undefined,
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // sendPasswordReset
  // ---------------------------------------------------------------------------
  describe('sendPasswordReset', () => {
    it('enqueues correct job type with resetUrl', async () => {
      await service.sendPasswordReset({
        email: 'reset@example.com',
        resetUrl: 'https://api.sacdia.app/auth/reset-password?token=opaque',
      });

      expect(mockEnqueue).toHaveBeenCalledWith(
        EMAIL_JOB_PASSWORD_RESET,
        expect.objectContaining({
          to: 'reset@example.com',
          resetUrl: 'https://api.sacdia.app/auth/reset-password?token=opaque',
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // sendAccountDeletionConfirmed
  // ---------------------------------------------------------------------------
  describe('sendAccountDeletionConfirmed', () => {
    it('enqueues correct job type', async () => {
      await service.sendAccountDeletionConfirmed({
        email: 'bye@example.com',
      });

      expect(mockEnqueue).toHaveBeenCalledWith(
        EMAIL_JOB_ACCOUNT_DELETION_CONFIRMED,
        expect.objectContaining({
          to: 'bye@example.com',
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Error propagation
  // ---------------------------------------------------------------------------
  describe('error propagation', () => {
    it('propagates queue errors to caller', async () => {
      mockEnqueue.mockRejectedValueOnce(new Error('Redis connection lost'));

      await expect(
        service.sendPasswordReset({
          email: 'x@y.com',
          resetUrl: 'https://example.com',
        }),
      ).rejects.toThrow('Redis connection lost');
    });
  });
});
