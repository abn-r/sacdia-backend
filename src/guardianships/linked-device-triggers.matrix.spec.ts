import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { LinkedDeviceRevocation } from '../auth/device/linked-device-revocation';
import {
  COMMIT_POLL_DELAYS_MS,
  LinkedDevicesService,
} from './linked-devices.service';
import type { LinkedDeviceRevokeReason } from './linked-device-revoker.port';

/**
 * FP3-50, the auto-revoke matrix, run through the REAL LinkedDevicesService and
 * the REAL LinkedDeviceRevocation over a small stateful in-memory database:
 * which devices a trigger selects, which reason lands on the row, and that the
 * reason is one the DB CHECK would accept.
 */

const MIGRATION = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261021120000_family_linked_devices/migration.sql',
  ),
  'utf8',
);
const CHECK_REASONS = [
  ...(
    /linked_devices_revoked_reason_ck CHECK \(revoked_reason IS NULL OR revoked_reason IN \(([^)]*)\)\)/.exec(
      MIGRATION,
    )?.[1] ?? ''
  ).matchAll(/'([^']+)'/g),
].map((m) => m[1]);

const D1_CHILD = 'child-1';
const D2_CHILD = 'child-2';
const GS_G1 = 'gs-g1';
const GS_G2 = 'gs-g2';

interface DeviceRow {
  linked_device_id: string;
  dependent_user_id: string;
  guardianship_id: string;
  paired_by_user_id: string;
  session_id: string;
  label: string;
  platform: string;
  fcm_token_id: string | null;
  paired_at: Date;
  revoked_at: Date | null;
  revoked_by_user_id: string | null;
  revoked_reason: string | null;
}

function world() {
  const devices: DeviceRow[] = [
    // child 1: D1 paired through G1, D2 paired through G2
    device('D1', D1_CHILD, GS_G1),
    device('D2', D1_CHILD, GS_G2),
    // another family: never touched
    device('D3', D2_CHILD, 'gs-other'),
  ];
  const sessions = new Set(devices.map((d) => d.session_id));
  const tokens = new Map(
    devices.map((d) => [
      d.fcm_token_id as string,
      { active: true, user: d.dependent_user_id },
    ]),
  );
  const audits: Array<Record<string, any>> = [];

  const matches = (row: DeviceRow, where: Record<string, any>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'revoked_at')
        return value === null ? row.revoked_at === null : true;
      const actual = (row as any)[key];
      if (value && typeof value === 'object' && 'in' in value) {
        return (value.in as unknown[]).includes(actual);
      }
      return actual === value;
    });

  const tx: any = {
    linked_devices: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(devices.filter((d) => matches(d, where))),
      ),
      updateMany: jest.fn(({ where, data }: any) => {
        const hit = devices.filter((d) => matches(d, where));
        hit.forEach((d) => Object.assign(d, data));
        return Promise.resolve({ count: hit.length });
      }),
      count: jest.fn(({ where }: any) =>
        Promise.resolve(devices.filter((d) => matches(d, where)).length),
      ),
    },
    session: {
      deleteMany: jest.fn(({ where }: any) => {
        sessions.delete(where.id);
        return Promise.resolve({ count: 1 });
      }),
    },
    user_fcm_tokens: {
      updateMany: jest.fn(({ where }: any) => {
        for (const [id, token] of tokens) {
          const byId =
            where.fcm_token_id === undefined || where.fcm_token_id === id;
          if (byId && token.user === where.user_id) token.active = false;
        }
        return Promise.resolve({ count: 1 });
      }),
    },
    audit_logs: {
      create: jest.fn(({ data }: any) => {
        audits.push(data);
        return Promise.resolve({});
      }),
    },
  };
  const prisma: any = {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    linked_devices: { findMany: tx.linked_devices.findMany },
    session: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          (where.id.in as string[])
            .filter((id) => sessions.has(id))
            .map((id) => ({ id })),
        ),
      ),
    },
  };
  const cache = { bump: jest.fn().mockResolvedValue(undefined) };
  const revocation = new LinkedDeviceRevocation(prisma, cache as never);
  const security = { onDeviceRevoked: jest.fn().mockResolvedValue(undefined) };
  const service = new LinkedDevicesService(
    prisma,
    revocation,
    {} as never,
    security as never,
  );
  const byId = (id: string) => devices.find((d) => d.linked_device_id === id)!;
  return {
    service,
    revocation,
    tx,
    devices,
    byId,
    audits,
    sessions,
    tokens,
    cache,
    security,
  };
}

function device(id: string, child: string, guardianship: string): DeviceRow {
  return {
    linked_device_id: id,
    dependent_user_id: child,
    guardianship_id: guardianship,
    paired_by_user_id: `paired-${guardianship}`,
    session_id: `sid-${id}`,
    label: `Tablet ${id}`,
    platform: 'android',
    fcm_token_id: `fcm-${id}`,
    paired_at: new Date('2026-10-01T00:00:00Z'),
    revoked_at: null,
    revoked_by_user_id: null,
    revoked_reason: null,
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 20));

describe('linked device auto-revoke matrix (FP3-50)', () => {
  const originalDelays = [...COMMIT_POLL_DELAYS_MS];

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    COMMIT_POLL_DELAYS_MS.splice(0, COMMIT_POLL_DELAYS_MS.length, 0);
  });
  afterEach(() => {
    COMMIT_POLL_DELAYS_MS.splice(
      0,
      COMMIT_POLL_DELAYS_MS.length,
      ...originalDelays,
    );
    jest.restoreAllMocks();
  });

  it('reads the reason vocabulary from the migration CHECK', () => {
    expect(CHECK_REASONS).toEqual(
      expect.arrayContaining([
        'guardian',
        'guardianship_revoked',
        'guardian_account_closed',
        'teen_login_enabled',
        'majority',
        'dependent_frozen',
        'device_logout',
        'session_revoked',
        'admin',
        'expired',
      ]),
    );
    expect(CHECK_REASONS).toHaveLength(10);
  });

  type Trigger = {
    name: string;
    reason: LinkedDeviceRevokeReason;
    run: (w: ReturnType<typeof world>) => Promise<unknown>;
    revoked: string[];
    stays: string[];
  };

  const triggers: Trigger[] = [
    {
      name: 'the pairing guardian leaves / is removed / is removed by admin (G1 leaves, G2 stays)',
      reason: 'guardianship_revoked',
      run: (w) =>
        w.service.revokeByGuardianship(w.tx, GS_G1, 'guardianship_revoked'),
      revoked: ['D1'],
      stays: ['D2', 'D3'],
    },
    {
      name: 'the OTHER guardian leaves (G2 leaves: D2 goes, D1 stays)',
      reason: 'guardianship_revoked',
      run: (w) =>
        w.service.revokeByGuardianship(w.tx, GS_G2, 'guardianship_revoked'),
      revoked: ['D2'],
      stays: ['D1', 'D3'],
    },
    {
      name: 'the pairing guardian deletes the account',
      reason: 'guardian_account_closed',
      run: (w) =>
        w.service.revokeByGuardianship(w.tx, GS_G1, 'guardian_account_closed'),
      revoked: ['D1'],
      stays: ['D2', 'D3'],
    },
    {
      name: 'the last guardian leaves / custody transfer: every device of the child',
      reason: 'guardianship_revoked',
      run: (w) =>
        w.service.revokeAllForDependent(w.tx, D1_CHILD, 'guardianship_revoked'),
      revoked: ['D1', 'D2'],
      stays: ['D3'],
    },
    {
      name: 'the child is frozen or purged',
      reason: 'dependent_frozen',
      run: (w) =>
        w.service.revokeAllForDependent(w.tx, D1_CHILD, 'dependent_frozen'),
      revoked: ['D1', 'D2'],
      stays: ['D3'],
    },
    {
      name: 'a supervised login is enabled for the child',
      reason: 'teen_login_enabled',
      run: (w) =>
        w.service.revokeAllForDependent(w.tx, D1_CHILD, 'teen_login_enabled'),
      revoked: ['D1', 'D2'],
      stays: ['D3'],
    },
    {
      name: 'the age of majority (the request check or the cron sweep)',
      reason: 'majority',
      run: (w) =>
        w.revocation.revokeStandalone(
          { dependent_user_id: D1_CHILD },
          { by: null, reason: 'majority' },
        ),
      revoked: ['D1', 'D2'],
      stays: ['D3'],
    },
    {
      name: 'the absolute lifetime cap',
      reason: 'expired',
      run: (w) =>
        w.revocation.revokeStandalone(
          { linked_device_id: 'D2' },
          { by: null, reason: 'expired' },
        ),
      revoked: ['D2'],
      stays: ['D1', 'D3'],
    },
    {
      name: 'a session revoked by a user or an admin',
      reason: 'session_revoked',
      run: (w) => {
        w.sessions.delete('sid-D1');
        return w.revocation.markMissingSessionsRevoked(D1_CHILD, 'admin-1');
      },
      revoked: ['D1'],
      stays: ['D2', 'D3'],
    },
    {
      name: 'an explicit revoke by a guardian',
      reason: 'guardian',
      run: (w) =>
        w.revocation.revokeStandalone(
          { linked_device_id: 'D1' },
          { by: 'guardian-1', reason: 'guardian' },
        ),
      revoked: ['D1'],
      stays: ['D2', 'D3'],
    },
    {
      name: 'an admin revoke',
      reason: 'admin',
      run: (w) =>
        w.revocation.revokeStandalone(
          { linked_device_id: 'D2' },
          { by: 'admin-1', reason: 'admin' },
        ),
      revoked: ['D2'],
      stays: ['D1', 'D3'],
    },
    {
      name: 'the device logs itself out',
      reason: 'device_logout',
      run: (w) => w.service.revokeByLogout('D1'),
      revoked: ['D1'],
      stays: ['D2', 'D3'],
    },
  ];

  it.each(triggers)('$name', async ({ reason, run, revoked, stays }) => {
    const w = world();

    await run(w);
    await flush();

    for (const id of revoked) {
      const row = w.byId(id);
      expect({ id, reason: row.revoked_reason }).toEqual({ id, reason });
      expect(row.revoked_at).toBeInstanceOf(Date);
      expect(CHECK_REASONS).toContain(row.revoked_reason);
      // the session is gone with the device and the audit row says why
      expect(w.sessions.has(`sid-${id}`)).toBe(false);
      expect(w.audits.find((a) => a.entity_id === id)?.changes.reason).toBe(
        reason,
      );
    }
    for (const id of stays) {
      const row = w.byId(id);
      expect({ id, revoked_at: row.revoked_at }).toEqual({
        id,
        revoked_at: null,
      });
      expect(w.sessions.has(`sid-${id}`)).toBe(true);
    }
    // The epoch of the affected child moved, so the next request reads the DB.
    expect(w.cache.bump).toHaveBeenCalledWith(D1_CHILD);
    expect(w.cache.bump).not.toHaveBeenCalledWith(D2_CHILD);
  });

  it('the FCM token of each revoked device is deactivated, the others stay active', async () => {
    const w = world();

    await w.service.revokeByGuardianship(w.tx, GS_G1, 'guardianship_revoked');

    expect(w.tokens.get('fcm-D1')?.active).toBe(false);
    expect(w.tokens.get('fcm-D2')?.active).toBe(true);
    expect(w.tokens.get('fcm-D3')?.active).toBe(true);
  });

  it('when the last device of the child goes, every remaining token of the child goes too', async () => {
    const w = world();
    w.tokens.set('fcm-rotated', { active: true, user: D1_CHILD });

    await w.service.revokeAllForDependent(w.tx, D1_CHILD, 'dependent_frozen');

    expect(w.tokens.get('fcm-rotated')?.active).toBe(false);
    expect(w.tokens.get('fcm-D3')?.active).toBe(true); // other family untouched
  });

  it('a token that moved to another user is NOT deactivated by the revoke', async () => {
    const w = world();
    w.tokens.set('fcm-D1', { active: true, user: 'guardian-phone-owner' });

    await w.service.revokeByGuardianship(w.tx, GS_G1, 'guardianship_revoked');

    expect(w.tokens.get('fcm-D1')?.active).toBe(true);
  });

  it('turning 13 revokes nothing (only new pairings stop)', async () => {
    const w = world();

    // There is no trigger for it: the gate lets the device through and the
    // nudge cron never touches devices. Nothing in the matrix may run.
    await flush();

    expect(w.devices.every((d) => d.revoked_at === null)).toBe(true);
  });

  it('revoking twice writes ONE audit row per device', async () => {
    const w = world();

    await w.service.revokeAllForDependent(w.tx, D1_CHILD, 'dependent_frozen');
    await w.service.revokeAllForDependent(w.tx, D1_CHILD, 'dependent_frozen');

    expect(w.audits.filter((a) => a.entity_id === 'D1')).toHaveLength(1);
  });

  it('the guardians are told for guardian-originated reasons only', async () => {
    const guardianLeaves = world();
    await guardianLeaves.service.revokeByGuardianship(
      guardianLeaves.tx,
      GS_G1,
      'guardianship_revoked',
    );
    await flush();
    expect(guardianLeaves.security.onDeviceRevoked).toHaveBeenCalledTimes(1);

    const frozen = world();
    await frozen.service.revokeAllForDependent(
      frozen.tx,
      D1_CHILD,
      'dependent_frozen',
    );
    await flush();
    expect(frozen.security.onDeviceRevoked).not.toHaveBeenCalled();

    const teenLogin = world();
    await teenLogin.service.revokeAllForDependent(
      teenLogin.tx,
      D1_CHILD,
      'teen_login_enabled',
    );
    await flush();
    expect(teenLogin.security.onDeviceRevoked).not.toHaveBeenCalled();
  });
});
