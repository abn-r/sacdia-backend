import { GuardianshipLifecycleService } from './guardianship-lifecycle.service';

/**
 * Simultaneous leave / revoke / account deletion of the guardians of ONE
 * dependent must always end with exactly one holder (custody or a freeze),
 * never with an orphan: every guardian row revoked and nobody responsible.
 *
 * The double below models what the bug needs and nothing more:
 *  - READ COMMITTED: a transaction sees committed rows plus its own writes,
 *    never another transaction's uncommitted ones;
 *  - `pg_advisory_xact_lock`: a lock keyed by the SQL parameter, held until the
 *    transaction ends, re-entrant inside one transaction;
 *  - every statement yields to the event loop, so concurrent transactions
 *    interleave statement by statement.
 * With the lock disabled the double reproduces the orphan, which proves the
 * scenarios can fail; with it enabled they must pass.
 */

const DEP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DEP_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const G3 = '33333333-3333-4333-8333-333333333333';

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
  seq: number;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (condition !== null && typeof condition === 'object') {
      if ('not' in condition) {
        return value !== condition.not;
      }
      throw new Error(`unsupported condition on ${key}`);
    }
    return value === condition;
  });
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

class FakeDb {
  committed: Row[] = [];
  frozen = new Map<string, Date>();
  clubOfDependent = new Map<string, number>();
  private seq = 0;
  private owners = new Map<string, Promise<void>>();

  constructor(private readonly lockingEnabled: boolean) {}

  addGuardian(
    dependentId: string,
    guardianId: string,
    isPrimary: boolean,
  ): void {
    this.committed.push(
      this.newRow({
        dependent_user_id: dependentId,
        guardian_user_id: guardianId,
        is_primary: isPrimary,
      }),
    );
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
      seq: this.seq,
      ...overrides,
    };
  }

  idOf(dependentId: string, guardianId: string): string {
    const row = this.committed.find(
      (r) =>
        r.dependent_user_id === dependentId &&
        r.guardian_user_id === guardianId,
    );
    if (!row) throw new Error('no such guardianship');
    return row.guardianship_id;
  }

  /** The invariant: somebody is responsible for the dependent. */
  hasHolder(dependentId: string): boolean {
    return (
      this.frozen.has(dependentId) ||
      this.committed.some(
        (r) =>
          r.dependent_user_id === dependentId &&
          r.consent_status !== 'revoked' &&
          !r.is_test_data &&
          (r.is_custodian || r.guardian_user_id !== null),
      )
    );
  }

  custodyRows(dependentId: string): Row[] {
    return this.committed.filter(
      (r) =>
        r.dependent_user_id === dependentId &&
        r.is_custodian &&
        r.consent_status !== 'revoked',
    );
  }

  activeGuardians(dependentId: string): Row[] {
    return this.committed.filter(
      (r) =>
        r.dependent_user_id === dependentId &&
        !r.is_custodian &&
        r.guardian_user_id !== null &&
        r.consent_status !== 'revoked',
    );
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

  /** `prisma.$transaction(cb)` with READ COMMITTED + advisory locks. */
  readonly $transaction = async <T>(callback: (tx: any) => Promise<T>) => {
    const local = new Map<string, Row>();
    const localFrozen = new Map<string, Date>();
    const held = new Map<string, () => void>();
    const view = (): Row[] => {
      const merged = new Map(this.committed.map((r) => [r.guardianship_id, r]));
      for (const [id, row] of local) merged.set(id, row);
      return [...merged.values()].sort((a, b) => a.seq - b.seq);
    };

    const tx = {
      $executeRaw: async (_strings: TemplateStringsArray, key: string) => {
        await tick();
        await this.acquire(key, held);
        return 1;
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
          return view().find((r) => matches(r, where)) ?? null;
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
      club_role_assignments: {
        findMany: async ({ where }: any) => {
          await tick();
          const clubId = this.clubOfDependent.get(where.user_id);
          return clubId === undefined
            ? []
            : [
                {
                  assignment_id: 'a-1',
                  status: 'active',
                  club_section_id: 5,
                  club_sections: { main_club_id: clubId },
                },
              ];
        },
      },
      dependent_profiles: {
        updateMany: async ({ where }: any) => {
          await tick();
          localFrozen.set(where.user_id, new Date());
          return { count: 1 };
        },
      },
      // The dependents here hold no account (guardian-managed children).
      account: {
        count: async () => {
          await tick();
          return 0;
        },
      },
      users: {
        findUnique: async () => {
          await tick();
          return { name: 'Ana', paternal_last_name: 'Pérez' };
        },
      },
    };

    try {
      const result = await callback(tx);
      // COMMIT: row-level last writer wins, like two committed updates.
      for (const [id, row] of local) {
        const index = this.committed.findIndex((r) => r.guardianship_id === id);
        if (index >= 0) this.committed[index] = row;
        else this.committed.push(row);
      }
      for (const [id, at] of localFrozen) this.frozen.set(id, at);
      return result;
    } finally {
      for (const release of held.values()) release();
    }
  };
}

function build(lockingEnabled: boolean) {
  const db = new FakeDb(lockingEnabled);
  const cache = { bump: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    sendToSectionRole: jest.fn().mockResolvedValue(undefined),
  };
  const service = new GuardianshipLifecycleService(
    db as any,
    cache as any,
    notifications as any,
    {
      revokeAllForDependent: jest.fn().mockResolvedValue(0),
      revokeByGuardianship: jest.fn().mockResolvedValue(0),
    } as any,
  );
  return { db, service };
}

describe('GuardianshipLifecycleService: simultaneous guardians leaving', () => {
  describe('without the per-dependent lock (the double must reproduce the bug)', () => {
    it('two guardians leaving at once orphan the dependent', async () => {
      const { db, service } = build(false);
      db.addGuardian(DEP, G1, true);
      db.addGuardian(DEP, G2, false);
      db.clubOfDependent.set(DEP, 9);

      await Promise.all([
        service.revoke(G1, db.idOf(DEP, G1), 'guardian_left'),
        service.revoke(G2, db.idOf(DEP, G2), 'guardian_left'),
      ]);

      expect(db.activeGuardians(DEP)).toHaveLength(0);
      expect(db.hasHolder(DEP)).toBe(false);
    });
  });

  describe('with the per-dependent lock', () => {
    it('two leaves at once with a club: exactly one custody row, never an orphan', async () => {
      const { db, service } = build(true);
      db.addGuardian(DEP, G1, true);
      db.addGuardian(DEP, G2, false);
      db.clubOfDependent.set(DEP, 9);

      const results = await Promise.all([
        service.revoke(G1, db.idOf(DEP, G1), 'guardian_left'),
        service.revoke(G2, db.idOf(DEP, G2), 'guardian_left'),
      ]);

      expect(db.activeGuardians(DEP)).toHaveLength(0);
      expect(db.custodyRows(DEP)).toHaveLength(1);
      expect(db.custodyRows(DEP)[0]).toMatchObject({
        custodian_club_id: 9,
        is_primary: true,
      });
      expect(db.hasHolder(DEP)).toBe(true);
      // Exactly one survivor path: one of them handed over, the other closed it.
      expect(results.map((r) => r.dependent_outcome).sort()).toEqual([
        'club_custody',
        'other_guardian',
      ]);
    });

    it('two leaves at once without a club: frozen exactly once, never an orphan', async () => {
      const { db, service } = build(true);
      db.addGuardian(DEP, G1, true);
      db.addGuardian(DEP, G2, false);

      const results = await Promise.all([
        service.revoke(G2, db.idOf(DEP, G2), 'guardian_left'),
        service.revoke(G1, db.idOf(DEP, G1), 'guardian_left'),
      ]);

      expect(db.activeGuardians(DEP)).toHaveLength(0);
      expect(db.custodyRows(DEP)).toHaveLength(0);
      expect(db.frozen.has(DEP)).toBe(true);
      expect(db.hasHolder(DEP)).toBe(true);
      expect(results.map((r) => r.dependent_outcome).sort()).toEqual([
        'frozen',
        'other_guardian',
      ]);
    });

    it('the primary removing a secondary while that secondary leaves: one row revoked, the primary stays', async () => {
      const { db, service } = build(true);
      db.addGuardian(DEP, G1, true);
      db.addGuardian(DEP, G2, false);
      const secondaryId = db.idOf(DEP, G2);

      const settled = await Promise.allSettled([
        service.revoke(G1, secondaryId, 'removed_by_primary'),
        service.revoke(G2, secondaryId, 'guardian_left'),
      ]);

      // The loser finds the row already revoked (404): never a double revoke.
      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(db.activeGuardians(DEP).map((r) => r.guardian_user_id)).toEqual([
        G1,
      ]);
      expect(db.custodyRows(DEP)).toHaveLength(0);
      expect(db.frozen.has(DEP)).toBe(false);
    });

    it('three guardians leaving at once: the last one out hands over exactly once', async () => {
      const { db, service } = build(true);
      db.addGuardian(DEP, G1, true);
      db.addGuardian(DEP, G2, false);
      db.addGuardian(DEP, G3, false);
      db.clubOfDependent.set(DEP, 9);

      await Promise.all([
        service.revoke(G1, db.idOf(DEP, G1), 'guardian_left'),
        service.revoke(G2, db.idOf(DEP, G2), 'guardian_left'),
        service.revoke(G3, db.idOf(DEP, G3), 'guardian_left'),
      ]);

      expect(db.activeGuardians(DEP)).toHaveLength(0);
      expect(db.custodyRows(DEP)).toHaveLength(1);
      expect(db.hasHolder(DEP)).toBe(true);
    });

    it('two guardians deleting their accounts at once (detachGuardian): one survivor path', async () => {
      const { db, service } = build(true);
      db.addGuardian(DEP, G1, true);
      db.addGuardian(DEP, G2, false);
      db.clubOfDependent.set(DEP, 9);

      const detach = (guardianId: string) =>
        db.$transaction((tx) =>
          service.detachGuardian(tx, guardianId, 'guardian_account_closed'),
        );
      const [first, second] = await Promise.all([detach(G1), detach(G2)]);

      expect(db.activeGuardians(DEP)).toHaveLength(0);
      expect(db.custodyRows(DEP)).toHaveLength(1);
      expect(db.hasHolder(DEP)).toBe(true);
      expect(
        [...first, ...second].map((result) => result.outcome).sort(),
      ).toEqual(['club_custody', 'other_guardian']);
    });

    it('two guardians sharing two dependents delete their accounts at once without deadlocking', async () => {
      const { db, service } = build(true);
      for (const dependent of [DEP, DEP_B]) {
        db.addGuardian(dependent, G1, true);
        db.addGuardian(dependent, G2, false);
        db.clubOfDependent.set(dependent, 9);
      }

      const detach = (guardianId: string) =>
        db.$transaction((tx) =>
          service.detachGuardian(tx, guardianId, 'guardian_account_closed'),
        );
      // A deadlock would leave this promise pending forever (jest times out).
      await Promise.all([detach(G1), detach(G2)]);

      for (const dependent of [DEP, DEP_B]) {
        expect(db.activeGuardians(dependent)).toHaveLength(0);
        expect(db.custodyRows(dependent)).toHaveLength(1);
        expect(db.hasHolder(dependent)).toBe(true);
      }
    });

    it('locks dependents in ascending id order inside detachGuardian', async () => {
      const { db, service } = build(true);
      // Created in the opposite order of their ids.
      db.addGuardian(DEP_B, G1, true);
      db.addGuardian(DEP, G1, true);
      const locked: string[] = [];
      const original = db.$transaction;
      const spy = jest.fn(async (callback: (tx: any) => Promise<unknown>) =>
        original(async (tx) => {
          const raw = tx.$executeRaw;
          tx.$executeRaw = (strings: TemplateStringsArray, key: string) => {
            locked.push(key);
            return raw(strings, key);
          };
          return callback(tx);
        }),
      );

      await spy((tx) =>
        service.detachGuardian(tx, G1, 'guardian_account_closed'),
      );

      const firstTwo = locked.slice(0, 2);
      expect(firstTwo).toEqual([
        `guardianships:dependent:${DEP}`,
        `guardianships:dependent:${DEP_B}`,
      ]);
    });
  });
});
