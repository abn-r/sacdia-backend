/**
 * In-memory stand-in for the `quarterly_reports` / `annual_reports` Prisma
 * delegates, with just the semantics the lifecycle code relies on: unique
 * (club, period) rows, `updateMany` conditional on `where` and its count.
 */
export type ReportRow = Record<string, any> & { status: string };

export interface FakeReportStoreOptions {
  idField: string;
  /** Unique-key fields besides the id, e.g. ['club_id','year','quarter']. */
  keyFields: string[];
  /** Name of the compound unique selector, e.g. 'club_id_year_quarter'. */
  compoundName: string;
}

export function createFakeReportStore(options: FakeReportStoreOptions) {
  const rows: ReportRow[] = [];
  let nextId = 1;
  const matches = (row: ReportRow, where: Record<string, any>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'OR') {
        return (value as Record<string, any>[]).some((w) => matches(row, w));
      }
      if (value && typeof value === 'object' && 'in' in value) {
        return (value.in as unknown[]).includes(row[key]);
      }
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        return true; // relation filters (club visibility) are not modelled
      }
      return row[key] === value;
    });

  const delegate = {
    findUnique: jest.fn(async ({ where }: any) => {
      const compound = where[options.compoundName];
      return (
        rows.find((r) =>
          compound
            ? Object.entries(compound).every(([k, v]) => r[k] === v)
            : r[options.idField] === where[options.idField],
        ) ?? null
      );
    }),
    findUniqueOrThrow: jest.fn(async (args: any) => {
      const row = await delegate.findUnique(args);
      if (!row) throw new Error('not found');
      return row;
    }),
    findFirst: jest.fn(
      async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    ),
    findMany: jest.fn(async ({ where }: any = {}) =>
      rows.filter((r) => matches(r, where ?? {})),
    ),
    create: jest.fn(async ({ data }: any) => {
      const dup = rows.find((r) =>
        options.keyFields.every((k) => r[k] === data[k]),
      );
      if (dup) throw Object.assign(new Error('unique'), { code: 'P2002' });
      const row: ReportRow = {
        [options.idField]: nextId++,
        computed_data: null,
        finalized_by: null,
        finalized_at: null,
        auto_generated_at: null,
        ...data,
      };
      rows.push(row);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const targets = rows.filter((r) => matches(r, where));
      targets.forEach((r) => Object.assign(r, data));
      return { count: targets.length };
    }),
  };

  return { rows, delegate };
}
