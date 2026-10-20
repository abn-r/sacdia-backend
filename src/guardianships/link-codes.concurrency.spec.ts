import { ErrorCode } from '../common/errors/error-codes';
import { LinkCodeFailureCounter } from './link-code-failure-counter';
import { LinkCodesService } from './link-codes.service';

/**
 * Two adults redeem the SAME teen link code at the same moment. The double
 * models READ COMMITTED + `pg_advisory_xact_lock`: a transaction sees only
 * committed rows, writes become visible at commit, and the per-teen lock
 * serializes the two. With the lock disabled the double reproduces the
 * corruption (two primary guardians), which proves the scenario can fail.
 */

const TEEN = '33333333-3333-4333-8333-333333333333';
const ADULT_A = '55555555-5555-4555-8555-555555555551';
const ADULT_B = '55555555-5555-4555-8555-555555555552';
const REL = '77777777-7777-4777-8777-777777777777';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

interface GuardianshipRow {
  guardianship_id: string;
  dependent_user_id: string;
  guardian_user_id: string | null;
  is_primary: boolean;
  consent_status: string;
}

class FakeDb {
  codeConsumedBy: string | null = null;
  guardianships: GuardianshipRow[] = [];
  profiles = new Set<string>();
  private owners = new Map<string, Promise<void>>();
  private seq = 0;

  constructor(private readonly lockingEnabled: boolean) {}

  private async acquire(key: string, held: Map<string, () => void>) {
    if (!this.lockingEnabled || held.has(key)) return;
    while (this.owners.has(key)) {
      await this.owners.get(key);
    }
    let release!: () => void;
    this.owners.set(
      key,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    held.set(key, () => {
      this.owners.delete(key);
      release();
    });
  }

  readonly $transaction = async <T>(callback: (tx: any) => Promise<T>) => {
    const held = new Map<string, () => void>();
    let consumedBy: string | null = null;
    const created: GuardianshipRow[] = [];
    const profiles = new Set<string>();
    const view = () => [...this.guardianships];

    const tx = {
      $executeRaw: async (_s: TemplateStringsArray, key: string) => {
        await tick();
        await this.acquire(key, held);
        return 1;
      },
      guardianship_link_codes: {
        findFirst: async () => {
          await tick();
          return this.codeConsumedBy === null
            ? {
                link_code_id: 'lc-1',
                dependent_user_id: TEEN,
                purpose: 'teen_guardian_link',
                issued_by_user_id: TEEN,
                issued_for_club_section_id: null,
              }
            : null;
        },
        updateMany: async ({ data }: any) => {
          await tick();
          if (this.codeConsumedBy !== null) return { count: 0 };
          consumedBy = data.consumed_by_user_id;
          return { count: 1 };
        },
      },
      users: {
        findFirst: async () => {
          await tick();
          return {
            birthday: new Date('2011-01-01T00:00:00.000Z'),
            country_id: null,
            dependent_profile: null,
          };
        },
      },
      dependent_profiles: {
        upsert: async ({ where }: any) => {
          await tick();
          profiles.add(where.user_id);
          return {};
        },
      },
      supervised_logins: { upsert: async () => ({}) },
      guardianships: {
        findFirst: async ({ where }: any) => {
          await tick();
          return (
            view().find(
              (row) =>
                row.dependent_user_id === where.dependent_user_id &&
                row.guardian_user_id === where.guardian_user_id &&
                row.consent_status !== 'revoked',
            ) ?? null
          );
        },
        count: async ({ where }: any) => {
          await tick();
          return view().filter(
            (row) =>
              row.consent_status !== 'revoked' &&
              (where.dependent_user_id
                ? row.dependent_user_id === where.dependent_user_id &&
                  row.guardian_user_id !== null
                : row.guardian_user_id === where.guardian_user_id),
          ).length;
        },
        updateMany: async () => {
          await tick();
          return { count: 0 };
        },
        create: async ({ data }: any) => {
          await tick();
          this.seq += 1;
          const row: GuardianshipRow = {
            guardianship_id: `gs-${this.seq}`,
            dependent_user_id: data.dependent_user_id,
            guardian_user_id: data.guardian_user_id,
            is_primary: data.is_primary,
            consent_status: data.consent_status,
          };
          created.push(row);
          return { guardianship_id: row.guardianship_id };
        },
      },
    };

    try {
      const result = await callback(tx);
      // COMMIT: the writes become visible, then the locks are released.
      if (consumedBy !== null) this.codeConsumedBy = consumedBy;
      this.guardianships.push(...created);
      profiles.forEach((id) => this.profiles.add(id));
      return result;
    } finally {
      held.forEach((release) => release());
    }
  };
}

function build(db: FakeDb) {
  const prisma: any = { $transaction: db.$transaction };
  const guardianships: any = {
    assertAdult: jest.fn().mockResolvedValue({}),
    assertRelationshipType: jest.fn().mockResolvedValue(undefined),
    getSummaryForGuardian: jest.fn(async (guardianId: string) => ({
      guardianId,
    })),
  };
  return new LinkCodesService(
    prisma,
    { get: () => 's'.repeat(32) } as any,
    new LinkCodeFailureCounter({ stores: [] } as any),
    { bump: jest.fn().mockResolvedValue(undefined) } as any,
    guardianships,
    {
      getPolicy: jest.fn().mockResolvedValue({
        minSelfLoginAge: 13,
        ageOfMajority: 18,
        timeZone: 'America/Mexico_City',
      }),
    } as any,
    {
      revokeAllForDependent: jest.fn().mockResolvedValue(0),
      revokeByGuardianship: jest.fn().mockResolvedValue(0),
    } as any,
  );
}

const dto = { code: '7KQ4-M9TX', relationship_type_id: REL } as any;

async function settle(promise: Promise<unknown>) {
  try {
    return { ok: true as const, value: await promise };
  } catch (error) {
    return { ok: false as const, code: (error as { code?: string }).code };
  }
}

describe('teen link code redeemed twice at the same time', () => {
  it('with the per-teen lock exactly one adult wins, the other gets the uniform invalid code', async () => {
    const db = new FakeDb(true);
    const service = build(db);

    const [a, b] = await Promise.all([
      settle(service.redeem(ADULT_A, dto)),
      settle(service.redeem(ADULT_B, dto)),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.ok).toBe(false);
    expect(!loser.ok && loser.code).toBe(
      ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID,
    );
    // One pending primary, no orphan.
    const rows = db.guardianships.filter((r) => r.consent_status !== 'revoked');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dependent_user_id: TEEN,
      is_primary: true,
      consent_status: 'pending',
    });
    expect(db.codeConsumedBy).toBe(rows[0].guardian_user_id);
  });

  it('the loser leaves no profile, row or consumption behind', async () => {
    const db = new FakeDb(true);
    const service = build(db);

    await Promise.all([
      settle(service.redeem(ADULT_A, dto)),
      settle(service.redeem(ADULT_B, dto)),
    ]);

    expect(db.guardianships).toHaveLength(1);
    expect(db.profiles.size).toBe(1);
  });

  it('without the lock the double reproduces the corruption (two guardians), so the scenario can fail', async () => {
    const db = new FakeDb(false);
    const service = build(db);

    const results = await Promise.all([
      settle(service.redeem(ADULT_A, dto)),
      settle(service.redeem(ADULT_B, dto)),
    ]);

    // Both read the code as unconsumed and both linked: the lock is what stops it.
    expect(results.filter((r) => r.ok).length).toBeGreaterThan(1);
  });
});
