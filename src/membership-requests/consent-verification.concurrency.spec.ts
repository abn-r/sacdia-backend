import { ErrorCode } from '../common/errors/error-codes';
import { GuardianshipLifecycleService } from '../guardianships/guardianship-lifecycle.service';
import { ConsentVerificationService } from './consent-verification.service';

/**
 * E9: a director verifies the consent while the only guardian leaves.
 *
 * Whatever the interleaving, the outcome must be consistent: a verification
 * that reports success leaves an active verified holder (the custody row
 * inherits it when the leave came second), a verification that ran after the
 * hand-over meets the custody row and is rejected without writing, the child
 * always has a holder (custody or a freeze) and no row is half revoked.
 *
 * The double models READ COMMITTED + `pg_advisory_xact_lock` like the
 * lifecycle concurrency spec: with the lock disabled the lost verification is
 * reproduced, which proves the scenarios can fail.
 */

const DEP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const G1 = '11111111-1111-4111-8111-111111111111';
const DIRECTOR = '66666666-6666-4666-8666-666666666666';
const CREATOR = G1;
const SECTION = 5;
const ASSIGNMENT = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0';

interface Row {
  guardianship_id: string;
  dependent_user_id: string;
  guardian_user_id: string | null;
  is_custodian: boolean;
  custodian_club_id: number | null;
  is_primary: boolean;
  consent_status: string;
  is_test_data: boolean;
  verification_method: string | null;
  verified_at: Date | null;
  verified_by_user_id: string | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
  invited_by_guardianship_id: string | null;
  seq: number;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (condition !== null && typeof condition === 'object') {
      if ('not' in condition) return value !== condition.not;
      if ('in' in condition) {
        return (condition.in as unknown[]).includes(value);
      }
      throw new Error(`unsupported condition on ${key}`);
    }
    return value === condition;
  });
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const ticks = async (count: number) => {
  for (let i = 0; i < count; i += 1) await tick();
};

class FakeDb {
  committed: Row[] = [];
  frozen = new Set<string>();
  audits: unknown[] = [];
  evidences = new Map<
    string,
    Array<{ evidence_id: string; uploaded_by_user_id: string }>
  >();
  hasClub = true;
  private seq = 0;
  private owners = new Map<string, Promise<void>>();

  constructor(private readonly lockingEnabled: boolean) {}

  addPrimary(withEvidence: boolean): string {
    const row = this.newRow({
      dependent_user_id: DEP,
      guardian_user_id: G1,
      is_primary: true,
    });
    this.committed.push(row);
    if (withEvidence) {
      this.evidences.set(row.guardianship_id, [
        { evidence_id: 'ev-1', uploaded_by_user_id: G1 },
      ]);
    }
    return row.guardianship_id;
  }

  newRow(overrides: Partial<Row>): Row {
    this.seq += 1;
    return {
      guardianship_id: `gs-${this.seq}`,
      dependent_user_id: DEP,
      guardian_user_id: null,
      is_custodian: false,
      custodian_club_id: null,
      is_primary: false,
      consent_status: 'pending',
      is_test_data: false,
      verification_method: null,
      verified_at: null,
      verified_by_user_id: null,
      revoked_at: null,
      revoked_reason: null,
      invited_by_guardianship_id: null,
      seq: this.seq,
      ...overrides,
    };
  }

  /**
   * The invariants of a consistent state: status and revoked_at agree, a
   * verified row has its date, and there is at most ONE active primary
   * (`uq_guardianships_active_primary`).
   */
  corruptRows(): Row[] {
    const activePrimaries = this.committed.filter(
      (r) => r.is_primary && r.consent_status !== 'revoked',
    );
    return [
      ...this.committed.filter(
        (r) =>
          (r.consent_status === 'revoked') !== (r.revoked_at !== null) ||
          (r.consent_status === 'verified' && r.verified_at === null),
      ),
      ...(activePrimaries.length > 1 ? activePrimaries : []),
    ];
  }

  hasHolder(): boolean {
    return (
      this.frozen.has(DEP) ||
      this.committed.some(
        (r) =>
          r.consent_status !== 'revoked' &&
          (r.is_custodian || r.guardian_user_id !== null),
      )
    );
  }

  active(): Row[] {
    return this.committed.filter((r) => r.consent_status !== 'revoked');
  }

  private async acquire(key: string, held: Map<string, () => void>) {
    if (!this.lockingEnabled || held.has(key)) return;
    while (this.owners.has(key)) {
      await this.owners.get(key);
    }
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.owners.set(key, promise);
    held.set(key, () => {
      this.owners.delete(key);
      release();
    });
  }

  readonly $transaction = async <T>(callback: (tx: any) => Promise<T>) => {
    const local = new Map<string, Row>();
    const localFrozen = new Set<string>();
    const localAudits: unknown[] = [];
    const held = new Map<string, () => void>();
    const view = (): Row[] => {
      const merged = new Map(this.committed.map((r) => [r.guardianship_id, r]));
      for (const [id, row] of local) merged.set(id, row);
      return [...merged.values()].sort((a, b) => a.seq - b.seq);
    };
    const withRelations = (row: Row | undefined) =>
      row
        ? {
            ...row,
            consent_evidences: this.evidences.get(row.guardianship_id) ?? [],
            dependent: { dependent_profile: { created_by_user_id: CREATOR } },
          }
        : null;

    const assignment = {
      assignment_id: ASSIGNMENT,
      club_section_id: SECTION,
      user_id: DEP,
      status: 'pending',
      active: true,
    };

    const tx = {
      $executeRaw: async (_strings: TemplateStringsArray, key: string) => {
        await tick();
        await this.acquire(key, held);
        return 1;
      },
      club_role_assignments: {
        findFirst: async () => {
          await tick();
          return assignment;
        },
        findUnique: async () => {
          await tick();
          return assignment;
        },
        findMany: async () => {
          await tick();
          return this.hasClub
            ? [
                {
                  assignment_id: ASSIGNMENT,
                  status: 'pending',
                  club_section_id: SECTION,
                  club_sections: { main_club_id: 9 },
                },
              ]
            : [];
        },
      },
      // The dependent holds no account here (a guardian-managed child).
      account: {
        count: async () => {
          await tick();
          return 0;
        },
      },
      dependent_profiles: {
        findUnique: async () => {
          await tick();
          return { user_id: DEP };
        },
        updateMany: async () => {
          await tick();
          localFrozen.add(DEP);
          return { count: 1 };
        },
      },
      guardianships: {
        findUnique: async ({ where }: any) => {
          await tick();
          return (
            view().find((r) => r.guardianship_id === where.guardianship_id) ??
            null
          );
        },
        findFirst: async ({ where }: any) => {
          await tick();
          return withRelations(view().find((r) => matches(r, where)));
        },
        findMany: async ({ where }: any) => {
          await tick();
          return view().filter((r) => matches(r, where));
        },
        count: async ({ where }: any) => {
          await tick();
          return view().filter((r) => matches(r, where)).length;
        },
        update: async ({ where, data }: any) => {
          await tick();
          const current = view().find(
            (r) => r.guardianship_id === where.guardianship_id,
          );
          if (!current) throw new Error('row not found');
          const next = { ...current, ...data };
          local.set(next.guardianship_id, next);
          return next;
        },
        updateMany: async ({ where, data }: any) => {
          await tick();
          const targets = view().filter((r) => matches(r, where));
          for (const target of targets) {
            local.set(target.guardianship_id, { ...target, ...data });
          }
          return { count: targets.length };
        },
        create: async ({ data }: any) => {
          await tick();
          const row = this.newRow(data);
          local.set(row.guardianship_id, row);
          return row;
        },
      },
      guardianship_link_codes: {
        updateMany: async () => {
          await tick();
          return { count: 0 };
        },
      },
      users: {
        findUnique: async () => {
          await tick();
          return { name: 'Ana', paternal_last_name: 'Pérez' };
        },
      },
      audit_logs: {
        create: async ({ data }: any) => {
          await tick();
          localAudits.push(data);
          return {};
        },
      },
    };

    try {
      const result = await callback(tx);
      for (const [id, row] of local) {
        const index = this.committed.findIndex((r) => r.guardianship_id === id);
        if (index >= 0) this.committed[index] = row;
        else this.committed.push(row);
      }
      for (const id of localFrozen) this.frozen.add(id);
      this.audits.push(...localAudits);
      return result;
    } finally {
      for (const release of held.values()) release();
    }
  };
}

function build(lockingEnabled: boolean) {
  const db = new FakeDb(lockingEnabled);
  const actingCache = { bump: jest.fn().mockResolvedValue(undefined) };
  const notificationsService = {
    sendToSectionRole: jest.fn().mockResolvedValue(undefined),
  };
  const lifecycle = new GuardianshipLifecycleService(
    db as any,
    actingCache as any,
    notificationsService as any,
  );
  const membershipRequests = { approve: jest.fn().mockResolvedValue({}) };
  const guardianNotifications = {
    onConsentVerified: jest.fn().mockResolvedValue(undefined),
  };
  const verification = new ConsentVerificationService(
    db as any,
    actingCache as any,
    membershipRequests as any,
    guardianNotifications as any,
  );
  const verify = () =>
    verification.verify(SECTION, ASSIGNMENT, DIRECTOR, {
      confirm_paper_form_reviewed: true,
      approve: false,
    });
  const leave = (guardianshipId: string) =>
    lifecycle.revoke(G1, guardianshipId, 'guardian_left');
  return { db, verify, leave, actingCache };
}

describe('verify-consent vs the only guardian leaving (E9)', () => {
  describe('without the per-dependent lock (the double must reproduce the corruption)', () => {
    it('the verification reports success but is lost: it committed on a row the leave had already revoked', async () => {
      const { db, verify, leave } = build(false);
      const rowId = db.addPrimary(true);

      const [verification] = await Promise.allSettled([verify(), leave(rowId)]);

      expect(verification.status).toBe('fulfilled');
      expect(db.audits).toHaveLength(1); // "consent_verified" was audited...
      expect(
        db.active().filter((r) => r.consent_status === 'verified'),
      ).toEqual([]); // ...but nobody is verified.
    });
  });

  describe('with the lock', () => {
    it('the leave lands first: the verification meets the custody row (no form yet) and writes nothing', async () => {
      const { db, verify, leave, actingCache } = build(true);
      const rowId = db.addPrimary(true);

      const [verification, leaving] = await Promise.allSettled([
        verify(),
        leave(rowId),
      ]);

      expect(leaving.status).toBe('fulfilled');
      expect(verification.status).toBe('rejected');
      expect((verification as PromiseRejectedResult).reason).toMatchObject({
        code: ErrorCode.GUARDIANSHIP_EVIDENCE_REQUIRED,
      });
      expect(db.corruptRows()).toEqual([]);
      expect(db.active()).toHaveLength(1);
      expect(db.active()[0]).toMatchObject({
        is_custodian: true,
        is_primary: true,
        consent_status: 'pending',
      });
      expect(db.hasHolder()).toBe(true);
      expect(db.audits).toHaveLength(0);
      // The only epoch bump is the leave's.
      expect(actingCache.bump).toHaveBeenCalledTimes(1);
    });

    it('the verification lands first: the custody row inherits the verified consent', async () => {
      const { db, verify, leave } = build(true);
      const rowId = db.addPrimary(true);

      const verifying = verify();
      await ticks(12); // let the verification take the lock before the leave starts
      const [verification, leaving] = await Promise.allSettled([
        verifying,
        leave(rowId),
      ]);

      expect(verification.status).toBe('fulfilled');
      expect(leaving.status).toBe('fulfilled');
      expect(db.corruptRows()).toEqual([]);
      expect(db.active()).toHaveLength(1);
      expect(db.active()[0]).toMatchObject({
        is_custodian: true,
        consent_status: 'verified',
        verification_method: 'director_paper_form',
        verified_by_user_id: DIRECTOR,
      });
      expect(db.audits).toHaveLength(1);
      expect(db.hasHolder()).toBe(true);
    });

    it('with no club the leave freezes the child: a verification afterwards finds no holder and writes nothing', async () => {
      const { db, verify, leave } = build(true);
      db.hasClub = false;
      const rowId = db.addPrimary(true);

      const leaving = leave(rowId);
      await ticks(1);
      const [verification] = await Promise.allSettled([verify(), leaving]);

      expect(verification.status).toBe('rejected');
      expect((verification as PromiseRejectedResult).reason).toMatchObject({
        code: ErrorCode.GUARDIANSHIP_NOT_FOUND,
      });
      expect(db.corruptRows()).toEqual([]);
      expect(db.frozen.has(DEP)).toBe(true);
      expect(db.hasHolder()).toBe(true);
      expect(
        db.committed.filter((r) => r.consent_status === 'verified'),
      ).toEqual([]);
    });
  });
});
