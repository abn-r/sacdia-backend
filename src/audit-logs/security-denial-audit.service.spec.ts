import { Logger } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { CriticalAuditWriterService } from './critical-audit-writer.service';
import {
  SecurityDenialAuditEvent,
  SecurityDenialAuditService,
} from './security-denial-audit.service';

const event = (): SecurityDenialAuditEvent => ({
  entityType: 'club_section',
  entityId: '20',
  eventKey: 'authorization-denied:request-1',
  denialCode: ErrorCode.GUARD_PERMISSION_DENIED,
  actor: {
    kind: 'user',
    userId: 'actor-1',
    roleName: 'director',
    scope: { local_field_id: 10, club_section_id: 20 },
  },
  target: {
    userId: 'target-1',
    scope: { local_field_id: 10, club_section_id: 20 },
  },
  correlationId: '00000000-0000-0000-0000-000000000010',
});

const setup = () => {
  const prisma = { $transaction: jest.fn() };
  const writer = { write: jest.fn() } as unknown as CriticalAuditWriterService;
  const service = new SecurityDenialAuditService(prisma as never, writer);
  return { prisma, writer, service };
};

describe('SecurityDenialAuditService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('writes a denied event with the supplied actor, target, scope and stable code', async () => {
    const { prisma, writer, service } = setup();
    prisma.$transaction.mockImplementation((callback) =>
      callback({ tx: true }),
    );
    (writer.write as jest.Mock).mockResolvedValue({
      auditLogId: 1n,
      replayed: false,
    });

    await service.record(event());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({
        action: 'AUTHORIZATION_DENIED',
        result: 'denied',
        actor: event().actor,
        target: event().target,
        after: { denial_code: ErrorCode.GUARD_PERMISSION_DENIED },
      }),
    );
  });

  it('preserves the original denial when the durable writer fails', async () => {
    const { prisma, service } = setup();
    const original = new Error('original denial');
    prisma.$transaction.mockRejectedValue(new Error('audit unavailable'));

    await expect(service.preserveDenial(original, event())).rejects.toBe(
      original,
    );
  });

  it('preserves the original denial even if fallback logging fails', async () => {
    const { prisma, service } = setup();
    const original = new Error('original denial');
    prisma.$transaction.mockRejectedValue(new Error('audit unavailable'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {
      throw new Error('logger unavailable');
    });

    await expect(service.preserveDenial(original, event())).rejects.toBe(
      original,
    );
  });
});
