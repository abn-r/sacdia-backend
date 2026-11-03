import { GLOBAL_ROLES_KEY } from '../common/decorators/global-roles.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { ExactSuperAdminWritePolicy } from './exact-super-admin-write.policy';
import { GlobalUserRoleWriteService } from './global-user-role-write.service';
import { RbacController } from './rbac.controller';

const SUPER_ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** In-memory tx: only SUPER_ADMIN holds the exact super-admin role. */
function harness() {
  const audit: any[] = [];
  let targetActive: boolean | null = null;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    users: { findUnique: jest.fn().mockResolvedValue({ user_id: TARGET }) },
    roles: {
      findUnique: jest.fn().mockResolvedValue({
        role_name: 'coordinator',
        role_category: 'GLOBAL',
        active: true,
      }),
    },
    users_roles: {
      findFirst: jest.fn(async (args: any) => {
        if (args.where.roles) {
          return args.where.user_id === SUPER_ADMIN
            ? { user_role_id: 'sa' }
            : null;
        }
        return targetActive === null
          ? null
          : { user_role_id: 'ur', active: targetActive };
      }),
      create: jest.fn(async () => {
        targetActive = true;
      }),
      update: jest.fn(async (args: any) => {
        targetActive = args.data.active;
      }),
    },
    audit_logs: {
      findUnique: jest.fn(async ({ where }: any) => {
        const event = audit.find((e) => e.eventKey === where.event_key);
        return event
          ? {
              entity_type: event.entityType,
              entity_id: event.entityId,
              action: event.action,
              actor_user_id: event.actor.userId,
              actor_scope: event.actor.scope,
              target_user_id: event.target.userId,
              target_scope: event.target.scope,
              result: event.result,
              changes: { before: event.before, after: event.after },
              idempotency_key: event.idempotencyKey,
            }
          : null;
      }),
    },
  };
  const db = { tx, $transaction: jest.fn((cb: any) => cb(tx)) };
  const writer = {
    write: jest.fn(async (_tx: unknown, event: any) => {
      audit.push(event);
      return { auditLogId: 1n, replayed: false };
    }),
  };
  const policy = new ExactSuperAdminWritePolicy(tx as never);
  const write = new GlobalUserRoleWriteService(
    db as never,
    policy,
    writer as never,
  );
  const authorizationContext = {
    invalidateUserAuthorizationCache: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new RbacController(
    {} as never,
    write,
    authorizationContext as never,
  );
  return { controller, tx, writer, authorizationContext };
}

describe('RbacController global user roles', () => {
  it.each(['assignRoleToUser', 'removeRoleFromUser'] as const)(
    '%s is restricted to super-admin at the route',
    (handler) => {
      expect(
        Reflect.getMetadata(
          GLOBAL_ROLES_KEY,
          RbacController.prototype[handler],
        ),
      ).toEqual(['super-admin']);
    },
  );

  it('rejects an admin actor with SUPER_ADMIN_WRITE_REQUIRED and writes nothing', async () => {
    const h = harness();
    await expect(
      h.controller.assignRoleToUser({ userId: ADMIN }, TARGET, {
        role_id: ROLE,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.SUPER_ADMIN_WRITE_REQUIRED,
      status: 403,
    });
    await expect(
      h.controller.removeRoleFromUser({ userId: ADMIN }, TARGET, ROLE),
    ).rejects.toMatchObject({ code: ErrorCode.SUPER_ADMIN_WRITE_REQUIRED });
    expect(h.tx.users_roles.create).not.toHaveBeenCalled();
    expect(h.writer.write).not.toHaveBeenCalled();
    expect(
      h.authorizationContext.invalidateUserAuthorizationCache,
    ).not.toHaveBeenCalled();
  });

  it('super-admin assigns: changed true, audited with the actor, cache invalidated', async () => {
    const h = harness();
    const res = await h.controller.assignRoleToUser(
      { userId: SUPER_ADMIN },
      TARGET,
      { role_id: ROLE },
      'key-1',
    );
    expect(res).toEqual({
      status: 'success',
      data: { active: true, changed: true, replayed: false },
    });
    expect(h.writer.write.mock.calls[0][1]).toMatchObject({
      action: 'RBAC_GLOBAL_ROLE_ASSIGNED',
      actor: { userId: SUPER_ADMIN },
      target: { userId: TARGET },
      idempotencyKey: 'key-1',
    });
    expect(
      h.authorizationContext.invalidateUserAuthorizationCache,
    ).toHaveBeenCalledWith(TARGET);
  });

  it('replays with the same Idempotency-Key without writing again', async () => {
    const h = harness();
    const call = () =>
      h.controller.assignRoleToUser(
        { userId: SUPER_ADMIN },
        TARGET,
        { role_id: ROLE },
        'same-key',
      );
    await call();
    const replay = await call();
    expect(replay.data).toEqual({
      active: true,
      changed: true,
      replayed: true,
    });
    expect(h.tx.users_roles.create).toHaveBeenCalledTimes(1);
    expect(h.writer.write).toHaveBeenCalledTimes(1);
  });

  it('generates a key per request when the header is absent (no replay)', async () => {
    const h = harness();
    const call = () =>
      h.controller.assignRoleToUser({ userId: SUPER_ADMIN }, TARGET, {
        role_id: ROLE,
      });
    await call();
    const second = await call();
    expect(second.data).toEqual({
      active: true,
      changed: false,
      replayed: false,
    });
  });

  it('super-admin revokes through the same writer', async () => {
    const h = harness();
    await h.controller.assignRoleToUser(
      { userId: SUPER_ADMIN },
      TARGET,
      { role_id: ROLE },
      'k-assign',
    );
    const res = await h.controller.removeRoleFromUser(
      { userId: SUPER_ADMIN },
      TARGET,
      ROLE,
      'k-revoke',
    );
    expect(res.data).toEqual({ active: false, changed: true, replayed: false });
  });
});
