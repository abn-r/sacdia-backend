import { Prisma } from '@prisma/client';
import { ErrorCode } from '../common/errors/error-codes';
import { classifyLocalFieldTimezone } from '../common/validators/iana-timezone.validator';
import {
  CriticalAuditEvent,
  CriticalAuditWriterService,
} from './critical-audit-writer.service';

const classifiedTimezone = classifyLocalFieldTimezone('America/Mexico_City');
if (!classifiedTimezone.ok) throw new Error('test timezone must be canonical');

const event = (): CriticalAuditEvent => ({
  entityType: 'club_role_assignment',
  entityId: 'assignment-1',
  action: 'CLUB_ROLE_ASSIGNED',
  eventKey: 'club-role-assignment:assignment-1:request-1',
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
  before: { role: null },
  after: { role: 'secretary' },
  effectiveAt: new Date('2026-10-01T05:00:00.000Z'),
  temporal: {
    businessDate: '2026-10-01',
    businessTimezone: classifiedTimezone.value,
  },
  correlationId: '00000000-0000-0000-0000-000000000010',
  idempotencyKey: 'request-1',
});

const stored = (source = event(), overrides: Record<string, unknown> = {}) => ({
  audit_log_id: 8n,
  entity_type: source.entityType,
  entity_id: source.entityId,
  action: source.action,
  event_key: source.eventKey,
  club_id: null,
  summary: null,
  actor_user_id: source.actor.userId,
  actor_kind: source.actor.kind,
  actor_role_name: source.actor.roleName,
  actor_scope: source.actor.scope,
  target_user_id: source.target.userId,
  target_scope: source.target.scope,
  effective_at: source.effectiveAt,
  correlation_id: source.correlationId,
  idempotency_key: source.idempotencyKey,
  result: 'succeeded',
  changes: {
    before: source.before,
    after: source.after,
    temporal: {
      business_date: source.temporal?.businessDate,
      business_timezone: source.temporal?.businessTimezone,
    },
  },
  ...overrides,
});

const auditTx = () => ({
  $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
  audit_logs: { findUnique: jest.fn(), create: jest.fn() },
});

describe('CriticalAuditWriterService', () => {
  const writer = new CriticalAuditWriterService();

  it('writes separate actor/target and territorial-temporal before/after snapshots using the supplied transaction', async () => {
    const tx = auditTx();
    tx.audit_logs.findUnique.mockResolvedValue(null);
    tx.audit_logs.create.mockResolvedValue({ audit_log_id: 7n });

    await expect(writer.write(tx, event())).resolves.toEqual({
      auditLogId: 7n,
      replayed: false,
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.audit_logs.findUnique.mock.invocationCallOrder[0],
    );
    const data = tx.audit_logs.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      actor_user_id: 'actor-1',
      target_user_id: 'target-1',
      effective_at: event().effectiveAt,
      correlation_id: event().correlationId,
      idempotency_key: 'request-1',
      actor_scope: { local_field_id: 10, club_section_id: 20 },
      target_scope: { local_field_id: 10, club_section_id: 20 },
    });
    expect(data.changes).toEqual(
      expect.objectContaining({
        before: { role: null },
        after: { role: 'secretary' },
        temporal: {
          business_date: '2026-10-01',
          business_timezone: 'America/Mexico_City',
        },
      }),
    );
    expect(data).not.toHaveProperty('created_at');
  });

  it('fails closed with AUDIT_WRITE_FAILED so its caller transaction can roll back the business change', async () => {
    const tx = auditTx();
    tx.audit_logs.findUnique.mockResolvedValue(null);
    tx.audit_logs.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('audit unavailable', {
        code: 'P1001',
        clientVersion: '7.8.0',
      }),
    );
    let committed = false;
    await expect(
      (async () => {
        await writer.write(tx, event());
        committed = true;
      })(),
    ).rejects.toMatchObject({ code: ErrorCode.AUDIT_WRITE_FAILED });
    expect(committed).toBe(false);
  });

  it('rejects sparse arrays before they can canonicalize as []', async () => {
    const tx = auditTx();
    await expect(
      writer.write(tx, { ...event(), before: { values: Array<never>(1) } }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns only the original event for an exact event-key replay', async () => {
    const tx = auditTx();
    const expected = event();
    tx.audit_logs.findUnique.mockResolvedValue(stored(expected));

    await expect(writer.write(tx, expected)).resolves.toEqual({
      auditLogId: 8n,
      replayed: true,
    });
    expect(tx.audit_logs.create).not.toHaveBeenCalled();
  });

  it('serializes nested Date values before replay comparison', async () => {
    const tx = auditTx();
    const stamped = new Date('2026-10-01T05:00:00.000Z');
    const base = {
      ...event(),
      actor: {
        ...event().actor,
        scope: { ...event().actor.scope, stamped_at: stamped },
      },
    };
    tx.audit_logs.findUnique.mockResolvedValue(stored(base));

    await expect(writer.write(tx, base)).resolves.toMatchObject({
      replayed: true,
    });
    await expect(
      writer.write(tx, {
        ...base,
        actor: {
          ...base.actor,
          scope: {
            ...base.actor.scope,
            stamped_at: new Date('2026-10-01T05:00:00.001Z'),
          },
        },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.AUDIT_WRITE_FAILED });
  });

  it('treats exact first-write P2002 races as replayed', async () => {
    const tx = auditTx();
    const expected = event();
    tx.audit_logs.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(stored(expected));
    tx.audit_logs.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: '7.8.0',
      }),
    );

    await expect(writer.write(tx, expected)).resolves.toEqual({
      auditLogId: 8n,
      replayed: true,
    });
  });

  it('serializes concurrent writers into exact replay or stable mismatch', async () => {
    const race = (second: CriticalAuditEvent) => {
      let durable: ReturnType<typeof stored> | null = null;
      let tail = Promise.resolve();
      const run = async (input: CriticalAuditEvent) => {
        const acquired = tail;
        let release: () => void = () => undefined;
        tail = new Promise<void>((resolve) => (release = resolve));
        const tx = auditTx();
        tx.$queryRaw.mockImplementation(() => acquired);
        tx.audit_logs.findUnique.mockImplementation(() =>
          Promise.resolve(durable),
        );
        tx.audit_logs.create.mockImplementation(() => {
          durable = stored(input);
          return Promise.resolve({ audit_log_id: 8n });
        });
        try {
          return await writer.write(tx, input);
        } finally {
          release();
        }
      };
      return Promise.allSettled([run(event()), run(second)]);
    };

    await expect(race(event())).resolves.toMatchObject([
      { status: 'fulfilled', value: { replayed: false } },
      { status: 'fulfilled', value: { replayed: true } },
    ]);
    await expect(
      race({ ...event(), effectiveAt: new Date('2026-10-01T05:00:00.001Z') }),
    ).resolves.toMatchObject([
      { status: 'fulfilled', value: { replayed: false } },
      { status: 'rejected', reason: { code: ErrorCode.AUDIT_WRITE_FAILED } },
    ]);
  });
});
