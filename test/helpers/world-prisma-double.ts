import { randomUUID } from 'node:crypto';

/**
 * A tiny STATE-DRIVEN table for e2e suites that boot the real AppModule on a
 * dummy database. Unlike a per-call `jest.fn` seed, rows are written by one
 * request and read by the next one, so a whole journey (create -> verify ->
 * approve -> claim ...) runs through the REAL services.
 *
 * What it models (enough for the family-profiles journeys):
 *  - `where` with equality, `null`, `{ not }`, `{ in }`, `{ notIn }`, `gt/gte/lt/lte`,
 *    `AND` / `OR` / `NOT`.
 *  - A RELATION filter (a nested object that is not an operator set, such as
 *    `account: { none: {} }` or `dependent_profile: { is: ... }`) is NOT
 *    evaluated: it counts as a match. Journeys that depend on such a filter
 *    must express it in the decorated row instead (see `decorate`). A column
 *    the row does not carry reads as NULL.
 *  - `select` is IGNORED: a row always comes back whole, plus whatever
 *    `decorate` adds (nested relations that the services read). Services only
 *    read the columns they asked for, so a superset is safe.
 *  - `orderBy` (one or several keys) and `take`.
 *
 * What it does NOT model: constraints, defaults other than the ones given,
 * transactions (a rollback restores nothing), cascades.
 */

export type Row = Record<string, any>;

const isPlainObject = (value: unknown): value is Row =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const comparable = (value: unknown): unknown =>
  value instanceof Date ? value.getTime() : value;

const OPERATORS = new Set([
  'equals',
  'not',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
  'mode',
]);

function isOperatorObject(condition: Row): boolean {
  const keys = Object.keys(condition);
  return keys.length > 0 && keys.every((key) => OPERATORS.has(key));
}

function fieldMatches(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition === undefined) return true;
  if (!isPlainObject(condition)) {
    return comparable(value) === comparable(condition);
  }
  // A nested relation filter (`is`, `some`, `none`, a sub-where): not modeled.
  if (!isOperatorObject(condition)) return true;

  for (const [operator, operand] of Object.entries(condition)) {
    const left = comparable(value);
    switch (operator) {
      case 'equals':
        if (!fieldMatches(value, operand)) return false;
        break;
      case 'not':
        if (fieldMatches(value, operand)) return false;
        break;
      case 'in':
        if (!(operand as unknown[]).some((item) => comparable(item) === left)) {
          return false;
        }
        break;
      case 'notIn':
        if ((operand as unknown[]).some((item) => comparable(item) === left)) {
          return false;
        }
        break;
      case 'gt':
        if (value == null || !(left! > (comparable(operand) as never))) {
          return false;
        }
        break;
      case 'gte':
        if (value == null || !(left! >= (comparable(operand) as never))) {
          return false;
        }
        break;
      case 'lt':
        if (value == null || !(left! < (comparable(operand) as never))) {
          return false;
        }
        break;
      case 'lte':
        if (value == null || !(left! <= (comparable(operand) as never))) {
          return false;
        }
        break;
      default:
        break;
    }
  }
  return true;
}

export function matches(where: Row | undefined, row: Row): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'AND') {
      const list = Array.isArray(condition) ? condition : [condition];
      if (!list.every((entry) => matches(entry as Row, row))) return false;
      continue;
    }
    if (key === 'OR') {
      const list = condition as Row[];
      if (list.length > 0 && !list.some((entry) => matches(entry, row))) {
        return false;
      }
      continue;
    }
    if (key === 'NOT') {
      const list = Array.isArray(condition) ? condition : [condition];
      if (list.some((entry) => matches(entry as Row, row))) return false;
      continue;
    }
    // A column the row does not carry reads as NULL; a nested object that is not
    // an operator set (a relation filter) is not evaluated: it matches.
    if (!fieldMatches(row[key], condition)) return false;
  }
  return true;
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  if (!orderBy) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Array<
    Record<string, 'asc' | 'desc'>
  >;
  return [...rows].sort((a, b) => {
    for (const entry of keys) {
      const [field, direction] = Object.entries(entry)[0];
      const left = comparable(a[field]) as never;
      const right = comparable(b[field]) as never;
      if (left === right) continue;
      const order = left < right ? -1 : 1;
      return direction === 'desc' ? -order : order;
    }
    return 0;
  });
}

export interface TableOptions {
  /** Primary key column; generated (uuid) on create when absent. */
  idField: string;
  /** Defaults applied on create (a function runs per row). */
  defaults?: () => Row;
  /** Adds nested relations / computed fields to a row that is READ. */
  decorate?: (row: Row) => Row;
}

export interface Table {
  rows: Row[];
  /** Direct access for assertions (the BASE row, undecorated). */
  find: (where: Row) => Row | undefined;
  filter: (where: Row) => Row[];
  model: any;
}

export function createTable(options: TableOptions, initial: Row[] = []): Table {
  const rows: Row[] = [...initial];
  const read = (row: Row | undefined): Row | null =>
    row ? (options.decorate ? options.decorate({ ...row }) : { ...row }) : null;

  const select = (where: Row | undefined) =>
    rows.filter((row) => matches(where, row));

  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      if (isPlainObject(value) && 'increment' in value) {
        row[key] = (row[key] ?? 0) + (value.increment as number);
      } else {
        row[key] = value;
      }
    }
  };

  const create = (data: Row): Row => {
    const row: Row = { ...(options.defaults?.() ?? {}), ...data };
    if (row[options.idField] === undefined) row[options.idField] = randomUUID();
    rows.push(row);
    return row;
  };

  const model = {
    findFirst: jest.fn(async (args: Row = {}) => {
      const found = sortRows(select(args.where), args.orderBy)[0];
      return read(found);
    }),
    findUnique: jest.fn(async (args: Row = {}) => read(select(args.where)[0])),
    findUniqueOrThrow: jest.fn(async (args: Row = {}) => {
      const found = select(args.where)[0];
      if (!found) throw new Error('Record not found');
      return read(found);
    }),
    findMany: jest.fn(async (args: Row = {}) => {
      let list = sortRows(select(args.where), args.orderBy);
      if (typeof args.take === 'number') list = list.slice(0, args.take);
      return list.map((row) => read(row));
    }),
    count: jest.fn(async (args: Row = {}) => select(args.where).length),
    create: jest.fn(async (args: Row) => read(create(args.data))),
    createMany: jest.fn(async (args: Row) => {
      const data = Array.isArray(args.data) ? args.data : [args.data];
      for (const entry of data) create(entry);
      return { count: data.length };
    }),
    update: jest.fn(async (args: Row) => {
      const found = select(args.where)[0];
      if (!found) throw new Error('Record to update not found');
      apply(found, args.data);
      return read(found);
    }),
    updateMany: jest.fn(async (args: Row) => {
      const targets = select(args.where);
      for (const row of targets) apply(row, args.data);
      return { count: targets.length };
    }),
    upsert: jest.fn(async (args: Row) => {
      const found = select(args.where)[0];
      if (found) {
        apply(found, args.update ?? {});
        return read(found);
      }
      return read(create(args.create));
    }),
    delete: jest.fn(async (args: Row) => {
      const index = rows.findIndex((row) => matches(args.where, row));
      if (index < 0) throw new Error('Record to delete not found');
      return read(rows.splice(index, 1)[0]);
    }),
    deleteMany: jest.fn(async (args: Row = {}) => {
      const targets = select(args.where);
      for (const row of targets) {
        rows.splice(rows.indexOf(row), 1);
      }
      return { count: targets.length };
    }),
    groupBy: jest.fn(async () => []),
  };

  return {
    rows,
    find: (where) => select(where)[0],
    filter: (where) => select(where),
    model,
  };
}
