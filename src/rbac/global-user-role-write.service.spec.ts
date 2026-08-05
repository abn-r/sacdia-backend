import { CriticalAuditWriterService } from '../audit-logs/critical-audit-writer.service';
import { ErrorCode } from '../common/errors/error-codes';
import { ExactSuperAdminWritePolicy } from './exact-super-admin-write.policy';
import { GlobalUserRoleWriteService } from './global-user-role-write.service';
const actor = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const target = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
const role = 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC';
const canonical = (value: string) => value.toLowerCase();
const input = (overrides = {}) => ({
  actorUserId: actor,
  targetUserId: target,
  roleId: role,
  correlationId: '44444444-4444-4444-8444-444444444444',
  idempotencyKey: 'request-1',
  ...overrides,
});
const database = () => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    users: {
      findUnique: jest.fn().mockResolvedValue({ user_id: canonical(target) }),
    },
    roles: {
      findUnique: jest.fn().mockResolvedValue({
        role_id: canonical(role),
        role_name: 'admin',
        role_category: 'GLOBAL',
        active: true,
      }),
    },
    users_roles: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ user_role_id: 'assignment-1' }),
      update: jest.fn().mockResolvedValue({ user_role_id: 'assignment-1' }),
    },
    audit_logs: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  return { tx, $transaction: jest.fn((callback) => callback(tx)) };
};
const policy = { assert: jest.fn().mockResolvedValue(undefined) };
const writer = { write: jest.fn().mockResolvedValue({ replayed: false }) };
const service = (db: ReturnType<typeof database>) =>
  new GlobalUserRoleWriteService(
    db as never,
    policy as unknown as ExactSuperAdminWritePolicy,
    writer as unknown as CriticalAuditWriterService,
  );
const row = (event: any) => ({
  entity_type: event.entityType,
  entity_id: event.entityId,
  action: event.action,
  actor_user_id: event.actor.userId,
  actor_scope: event.actor.scope,
  target_user_id: event.target.userId,
  target_scope: event.target.scope,
  result: event.result ?? 'succeeded',
  changes: { before: event.before, after: event.after },
  idempotency_key: event.idempotencyKey,
});
describe('GlobalUserRoleWriteService', () => {
  beforeEach(() => jest.clearAllMocks());
  it('canonicalizes UUIDs and locks actor/target before authority, then idempotency', async () => {
    const db = database();
    const result = await service(db).assign(input());
    const locks = db.tx.$queryRaw.mock.calls.map((call) => call[0].values[0]);
    expect(locks).toEqual([
      `rbac-user:${canonical(actor)}`,
      `rbac-user:${canonical(target)}`,
      'critical-audit:rbac-global-users-role:request-1',
    ]);
    expect(db.tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      policy.assert.mock.invocationCallOrder[0],
    );
    expect(policy.assert.mock.invocationCallOrder[0]).toBeLessThan(
      db.tx.$queryRaw.mock.invocationCallOrder[2],
    );
    expect(policy.assert).toHaveBeenCalledWith(canonical(actor), db.tx);
    expect(writer.write.mock.calls[0][1]).toMatchObject({
      entityId: expect.stringMatching(/^[a-f0-9]{64}$/),
      action: 'RBAC_GLOBAL_ROLE_ASSIGNED',
      actor: { userId: canonical(actor) },
      target: { userId: canonical(target) },
    });
    expect(result).toEqual({ active: true, changed: true, replayed: false });
  });
  it('makes missing revoke a no-op and never replays assign-noop as revoke', async () => {
    const missing = database();
    await expect(service(missing).revoke(input())).resolves.toEqual({
      active: false,
      changed: false,
      replayed: false,
    });
    expect(missing.tx.users_roles.create).not.toHaveBeenCalled();
    expect(writer.write.mock.calls[0][1].action).toBe(
      'RBAC_GLOBAL_ROLE_REVOCATION_NOOP',
    );
    const assigned = database();
    assigned.tx.users_roles.findFirst.mockResolvedValue({
      user_role_id: 'assignment-1',
      active: true,
    });
    await service(assigned).assign(input());
    assigned.tx.audit_logs.findUnique.mockResolvedValue(
      row(writer.write.mock.calls[1][1]),
    );
    await expect(service(assigned).revoke(input())).rejects.toMatchObject({
      code: ErrorCode.IDEMPOTENCY_KEY_REUSED,
    });
  });
  it('replays the same request across correlation IDs and rejects audit tampering', async () => {
    const initial = database();
    await service(initial).assign(input());
    const valid = row(writer.write.mock.calls[0][1]);
    const replay = database();
    replay.tx.audit_logs.findUnique.mockResolvedValue(valid);
    await expect(
      service(replay).assign(
        input({ correlationId: '55555555-5555-4555-8555-555555555555' }),
      ),
    ).resolves.toEqual({ active: true, changed: true, replayed: true });
    for (const patch of [
      { actor_scope: {} },
      { target_scope: {} },
      { changes: { before: { active: true }, after: { active: true } } },
      { result: 'denied' },
    ]) {
      const tampered = database();
      tampered.tx.audit_logs.findUnique.mockResolvedValue({
        ...valid,
        ...patch,
      });
      await expect(service(tampered).assign(input())).rejects.toMatchObject({
        code: ErrorCode.IDEMPOTENCY_KEY_REUSED,
      });
    }
  });
  it.each(['P2002', 'P2034'])(
    'retries %s and maps exhaustion to a stable conflict',
    async (code) => {
      const retry = database();
      retry.$transaction
        .mockRejectedValueOnce({ code })
        .mockImplementation((callback) => callback(retry.tx));
      await expect(service(retry).assign(input())).resolves.toMatchObject({
        active: true,
      });
      expect(retry.$transaction).toHaveBeenCalledTimes(2);
      const exhausted = database();
      exhausted.$transaction.mockRejectedValue({ code });
      await expect(service(exhausted).assign(input())).rejects.toMatchObject({
        code: ErrorCode.RECORD_CONFLICT,
      });
      expect(exhausted.$transaction).toHaveBeenCalledTimes(3);
    },
  );
});
