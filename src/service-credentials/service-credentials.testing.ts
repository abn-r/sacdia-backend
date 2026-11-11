/**
 * In-memory stand-in for the slice of Prisma the service-credential code uses.
 * `matches` evaluates the real `where` objects the services build, so a spec
 * exercises the actual scope predicate instead of re-asserting a mock call.
 * Test helper only; never imported by production code.
 */
type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !(value instanceof Date);

function matchesOperator(actual: unknown, filter: Json): boolean {
  return Object.entries(filter).every(([operator, expected]) => {
    switch (operator) {
      case 'in':
        return (expected as unknown[]).includes(actual);
      case 'not':
        return isObject(expected)
          ? !matchesOperator(actual, expected)
          : actual !== expected;
      case 'equals':
        return actual === expected;
      case 'contains':
        return (
          typeof actual === 'string' &&
          actual.toLowerCase().includes(String(expected).toLowerCase())
        );
      case 'mode':
        return true;
      case 'lte':
      case 'gte':
      case 'gt':
      case 'lt':
        return true;
      default:
        throw new Error(`Unsupported operator in fake: ${operator}`);
    }
  });
}

const OPERATORS = new Set([
  'in',
  'not',
  'equals',
  'contains',
  'mode',
  'lte',
  'gte',
  'gt',
  'lt',
]);

export function matches(record: Json, where: Json | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (key === 'AND') {
      return (condition as Json[]).every((clause) => matches(record, clause));
    }
    if (key === 'OR') {
      return (condition as Json[]).some((clause) => matches(record, clause));
    }
    if (key === 'NOT') {
      return !matches(record, condition as Json);
    }
    const actual = record[key];
    if (!isObject(condition)) return actual === condition;
    if ('some' in condition) {
      return (
        Array.isArray(actual) &&
        actual.some((item) => matches(item as Json, condition.some as Json))
      );
    }
    if ('is' in condition) {
      return isObject(actual) && matches(actual, condition.is as Json);
    }
    const keys = Object.keys(condition);
    if (keys.length > 0 && keys.every((k) => OPERATORS.has(k))) {
      return matchesOperator(actual, condition);
    }
    return isObject(actual) && matches(actual, condition);
  });
}

export type FakeAssignment = {
  user_id: string;
  active: boolean;
  status: string;
  ecclesiastical_year_id: number;
  start_date: Date;
  club_section_id: number;
  club_sections: {
    club_section_id: number;
    clubs: {
      club_id: number;
      name: string;
      local_field_id: number;
      districlub_type_id: number;
    };
  };
};

export type FakeUser = {
  user_id: string;
  name: string | null;
  paternal_last_name: string | null;
  maternal_last_name: string | null;
  user_image: string | null;
};

export type FakeCredential = {
  credential_id: string;
  user_id: string;
  credential_type: 'COUNSELOR_TRAINING';
  completed_at: Date | null;
  object_key: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: bigint | null;
  upload_status: 'PENDING_UPLOAD' | 'CONFIRMED';
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  reviewed_by_id: string | null;
  reviewer_role: string | null;
  reviewed_at: Date | null;
  decision_reason: string | null;
  expires_at: Date | null;
  active: boolean;
  created_at: Date;
  modified_at: Date;
};

export type FakeDb = {
  users: FakeUser[];
  assignments: FakeAssignment[];
  credentials: FakeCredential[];
  /** user_id -> district ids */
  pastorDistricts: Map<string, number[]>;
  /** users that hold an active pastor role and an active account */
  eligiblePastors: Set<string>;
};

export function newFakeDb(): FakeDb {
  return {
    users: [],
    assignments: [],
    credentials: [],
    pastorDistricts: new Map(),
    eligiblePastors: new Set(),
  };
}

/** A credential as the services see it: owner + the owner's assignments joined in. */
function hydrate(db: FakeDb, credential: FakeCredential): Json {
  const owner = db.users.find((u) => u.user_id === credential.user_id);
  return {
    ...credential,
    owner: owner
      ? {
          ...owner,
          club_role_assignments: db.assignments.filter(
            (a) => a.user_id === owner.user_id,
          ),
        }
      : null,
  };
}

let sequence = 0;

export function makeCredential(
  overrides: Partial<FakeCredential> & { user_id: string },
): FakeCredential {
  sequence += 1;
  return {
    credential_id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    credential_type: 'COUNSELOR_TRAINING',
    completed_at: new Date('2026-05-20T00:00:00.000Z'),
    object_key: 'certifications/evidence/service-credentials/u/c/sealed.pdf',
    original_filename: 'constancia.pdf',
    mime_type: 'application/pdf',
    size_bytes: BigInt(2048),
    upload_status: 'CONFIRMED',
    status: 'PENDING_REVIEW',
    reviewed_by_id: null,
    reviewer_role: null,
    reviewed_at: null,
    decision_reason: null,
    expires_at: null,
    active: true,
    created_at: new Date(
      `2026-06-${String(10 + (sequence % 15)).padStart(2, '0')}T00:00:00.000Z`,
    ),
    modified_at: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function newFakePrisma(db: FakeDb) {
  const project = (row: Json, select?: Json): Json => {
    if (!select) return row;
    const out: Json = {};
    for (const [key, value] of Object.entries(select)) {
      if (value === true) out[key] = row[key];
      else if (
        isObject(value) &&
        isObject(value.select) &&
        isObject(row[key])
      ) {
        out[key] = project(row[key], value.select);
      }
    }
    return out;
  };

  const prisma = {
    service_credentials: {
      findMany: jest.fn(async (args: Json = {}) => {
        let rows = db.credentials
          .map((c) => hydrate(db, c))
          .filter((row) => matches(row, args.where as Json));
        const order = (args.orderBy as Json[] | undefined)?.[0];
        if (order) {
          const [field, dir] = Object.entries(order)[0] as [string, string];
          rows = [...rows].sort((a, b) => {
            const av = (a[field] as Date | null)?.getTime() ?? 0;
            const bv = (b[field] as Date | null)?.getTime() ?? 0;
            return dir === 'asc' ? av - bv : bv - av;
          });
        }
        const skip = (args.skip as number | undefined) ?? 0;
        const take = args.take as number | undefined;
        rows = rows.slice(skip, take === undefined ? undefined : skip + take);
        return rows.map((row) => project(row, args.select as Json));
      }),
      findFirst: jest.fn(async (args: Json = {}) => {
        const row = db.credentials
          .map((c) => hydrate(db, c))
          .find((r) => matches(r, args.where as Json));
        return row ? project(row, args.select as Json) : null;
      }),
      count: jest.fn(
        async (args: Json = {}) =>
          db.credentials
            .map((c) => hydrate(db, c))
            .filter((row) => matches(row, args.where as Json)).length,
      ),
      groupBy: jest.fn(async (args: Json) => {
        const rows = db.credentials
          .map((c) => hydrate(db, c))
          .filter((row) => matches(row, args.where as Json));
        const groups = new Map<unknown, number>();
        for (const row of rows) {
          groups.set(row.status, (groups.get(row.status) ?? 0) + 1);
        }
        return [...groups.entries()].map(([status, count]) => ({
          status,
          _count: { _all: count },
        }));
      }),
      create: jest.fn(async (args: { data: Json; select?: Json }) => {
        const row = makeCredential({
          ...(args.data as Partial<FakeCredential>),
          user_id: args.data.user_id as string,
        });
        db.credentials.push(row);
        return project(row, args.select);
      }),
      update: jest.fn(async (args: { where: Json; data: Json }) => {
        const row = db.credentials.find(
          (c) => c.credential_id === args.where.credential_id,
        );
        if (!row) throw new Error('not found');
        Object.assign(row, args.data);
        return row;
      }),
      updateMany: jest.fn(async (args: { where: Json; data: Json }) => {
        const rows = db.credentials.filter((c) =>
          matches(c as unknown as Json, args.where),
        );
        rows.forEach((row) => Object.assign(row, args.data));
        return { count: rows.length };
      }),
    },
    club_role_assignments: {
      findMany: jest.fn(async (args: Json) =>
        db.assignments
          .filter((a) => matches(a as unknown as Json, args.where as Json))
          .sort((a, b) => b.start_date.getTime() - a.start_date.getTime()),
      ),
      count: jest.fn(
        async (args: Json) =>
          db.assignments.filter((a) =>
            matches(a as unknown as Json, args.where as Json),
          ).length,
      ),
    },
    district_investiture_pastors: {
      findMany: jest.fn(async (args: { where: { user_id: string } }) =>
        (db.pastorDistricts.get(args.where.user_id) ?? []).map((id) => ({
          districlub_type_id: id,
        })),
      ),
    },
    users: {
      findMany: jest.fn(
        async (args: { where: { user_id: { in: string[] } } }) =>
          args.where.user_id.in.map((id) => ({
            user_id: id,
            active: db.eligiblePastors.has(id),
            users_roles: db.eligiblePastors.has(id)
              ? [{ user_role_id: 'r' }]
              : [],
          })),
      ),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return prisma;
}
