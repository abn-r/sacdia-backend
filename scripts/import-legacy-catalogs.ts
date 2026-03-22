import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

type Scalar = string | number | boolean | null;

interface LegacyInsert {
  sourceFile: string;
  sourceTable: string;
  targetTable: string;
  columns: string[];
  rows: Scalar[][];
}

interface TransformRule {
  targetTable?: string;
  renameColumns?: Record<string, string>;
  dropColumns?: string[];
  appendColumns?: Array<{ name: string; value: Scalar }>;
}

interface TableResult {
  file: string;
  sourceTable: string;
  targetTable: string;
  parsedRows: number;
  insertedRows: number;
  failedRows: number;
  sampleErrors: string[];
}

interface LegacyIdMaps {
  countries: Map<string, number>;
  unions: Map<string, number>;
  localFields: Map<string, number>;
  districts: Map<string, number>;
}

const DEFAULT_SOURCE_DIR = '/Users/abner/Downloads/Sacdia/Respaldos';

const FILE_ORDER = [
  'club_types_rows.sql',
  'countries_rows.sql',
  'unions_rows.sql',
  'local_fields_rows.sql',
  'districts_rows.sql',
  'churches_rows.sql',
  'classes_rows.sql',
  'club_ideals_rows.sql',
  'master_honors_rows.sql',
  'honors_rows.sql',
  'finances_categories_rows.sql',
  'diseases_rows.sql',
  'allergies_rows.sql',
  'permissions_rows-2.sql',
  'role_permissions_rows.sql',
  'relationship_type_rows.sql',
] as const;

const EXCLUDED_FILES = new Set<string>([
  'role_permissions_rows.sql',
  'relationship_type_rows.sql',
]);

const TRANSFORMS: Record<string, TransformRule> = {
  club_types: {
    renameColumns: { ct_id: 'club_type_id' },
  },
  districts: {
    renameColumns: { district_id: 'districlub_type_id' },
  },
  churches: {
    renameColumns: { district_id: 'districlub_type_id' },
  },
  relationship_type: {
    targetTable: 'relationship_types',
    dropColumns: ['relationship_type_id'],
    appendColumns: [{ name: 'description', value: null }],
  },
};

const SERIAL_PK_COLUMNS: Record<string, string> = {
  allergies: 'allergy_id',
  churches: 'church_id',
  classes: 'class_id',
  club_ideals: 'club_ideal_id',
  club_types: 'club_type_id',
  countries: 'country_id',
  diseases: 'disease_id',
  districts: 'districlub_type_id',
  finances_categories: 'finance_category_id',
  honors: 'honor_id',
  honors_categories: 'honor_category_id',
  local_fields: 'local_field_id',
  master_honors: 'master_honor_id',
  unions: 'union_id',
};

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function stripQuotes(value: string): string {
  return value.replace(/^"(.*)"$/, '$1');
}

function parseInsertSql(sql: string, sourceFile: string): LegacyInsert {
  const cleanSql = sql.trim();
  const match = cleanSql.match(
    /^INSERT INTO\s+"public"\."([^"]+)"\s+\(([\s\S]*?)\)\s+VALUES\s+([\s\S]*);\s*$/i,
  );
  if (!match) {
    throw new Error(`Unsupported SQL format in ${sourceFile}`);
  }

  const sourceTable = match[1];
  const rawColumns = match[2];
  const rawValuesSection = match[3];

  const columns = rawColumns
    .split(',')
    .map((column) => stripQuotes(column.trim()))
    .filter(Boolean);

  const rows = splitTuples(rawValuesSection).map(parseTupleValues);
  const transformed = applyTransform(sourceFile, sourceTable, columns, rows);
  return transformed;
}

function splitTuples(rawValuesSection: string): string[] {
  const tuples: string[] = [];
  let inString = false;
  let depth = 0;
  let current = '';

  for (let index = 0; index < rawValuesSection.length; index += 1) {
    const char = rawValuesSection[index];
    const nextChar = rawValuesSection[index + 1];

    if (char === "'") {
      current += char;
      if (inString && nextChar === "'") {
        current += nextChar;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (!inString) {
      if (char === '(') {
        depth += 1;
        if (depth === 1) {
          current = '';
          continue;
        }
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          tuples.push(current.trim());
          current = '';
          continue;
        }
      }
    }

    if (depth >= 1) {
      current += char;
    }
  }

  return tuples;
}

function parseTupleValues(tuple: string): Scalar[] {
  const values: Scalar[] = [];
  let inString = false;
  let current = '';

  for (let index = 0; index < tuple.length; index += 1) {
    const char = tuple[index];
    const nextChar = tuple[index + 1];

    if (char === "'") {
      current += char;
      if (inString && nextChar === "'") {
        current += nextChar;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (!inString && char === ',') {
      values.push(parseToken(current.trim()));
      current = '';
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    values.push(parseToken(current.trim()));
  }

  return values;
}

function parseToken(token: string): Scalar {
  if (/^null$/i.test(token)) {
    return null;
  }

  if (token.startsWith("'") && token.endsWith("'")) {
    const inner = token.slice(1, -1).replace(/''/g, "'");
    if (inner === 'true') return true;
    if (inner === 'false') return false;
    return inner;
  }

  if (/^true$/i.test(token)) return true;
  if (/^false$/i.test(token)) return false;
  if (/^-?\d+$/.test(token)) return Number.parseInt(token, 10);
  if (/^-?\d+\.\d+$/.test(token)) return Number.parseFloat(token);

  return token;
}

function applyTransform(
  sourceFile: string,
  sourceTable: string,
  columns: string[],
  rows: Scalar[][],
): LegacyInsert {
  const rule = TRANSFORMS[sourceTable] ?? {};
  const targetTable = rule.targetTable ?? sourceTable;
  const drop = new Set(rule.dropColumns ?? []);

  const mappedColumns = columns
    .filter((column) => !drop.has(column))
    .map((column) => rule.renameColumns?.[column] ?? column);

  const appendColumns = rule.appendColumns ?? [];
  const targetColumns = [...mappedColumns, ...appendColumns.map((extra) => extra.name)];

  const keptIndexes = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !drop.has(column))
    .map(({ index }) => index);

  const targetRows = rows.map((row) => {
    const base = keptIndexes.map((index) => row[index]);
    const extraValues = appendColumns.map((extra) => extra.value);
    return [...base, ...extraValues];
  });

  return {
    sourceFile,
    sourceTable,
    targetTable,
    columns: targetColumns,
    rows: targetRows,
  };
}

function buildInsertSql(targetTable: string, columns: string[]): string {
  const columnList = columns.map((column) => `"${column}"`).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  return `INSERT INTO "public"."${targetTable}" (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
}

function getColumnIndex(columns: string[], columnName: string): number {
  return columns.indexOf(columnName);
}

function getIdKey(value: Scalar): string | null {
  if (value === null) return null;
  return String(value);
}

function remapColumnValues(
  insert: LegacyInsert,
  columnName: string,
  idMap: Map<string, number>,
): void {
  const index = getColumnIndex(insert.columns, columnName);
  if (index === -1 || idMap.size === 0) {
    return;
  }

  for (const row of insert.rows) {
    const legacyKey = getIdKey(row[index]);
    if (!legacyKey) continue;
    const mappedId = idMap.get(legacyKey);
    if (mappedId !== undefined) {
      row[index] = mappedId;
    }
  }
}

async function findIdByColumn(
  pool: Pool,
  table: string,
  idColumn: string,
  lookupColumn: string,
  value: Scalar,
): Promise<number | null> {
  if (value === null) return null;

  const sql = `SELECT "${idColumn}" AS id FROM "public"."${table}" WHERE "${lookupColumn}" = $1 LIMIT 1`;
  const result = await pool.query<{ id: number }>(sql, [value]);
  if (result.rows.length === 0) return null;
  return Number(result.rows[0].id);
}

async function buildCountryIdMap(
  pool: Pool,
  insert: LegacyInsert,
): Promise<Map<string, number>> {
  const idIndex = getColumnIndex(insert.columns, 'country_id');
  const nameIndex = getColumnIndex(insert.columns, 'name');
  const abbreviationIndex = getColumnIndex(insert.columns, 'abbreviation');
  const map = new Map<string, number>();

  if (idIndex === -1 || nameIndex === -1 || abbreviationIndex === -1) {
    return map;
  }

  for (const row of insert.rows) {
    const legacyKey = getIdKey(row[idIndex]);
    if (!legacyKey) continue;

    const byName = await findIdByColumn(
      pool,
      'countries',
      'country_id',
      'name',
      row[nameIndex],
    );
    const resolvedId =
      byName ??
      (await findIdByColumn(
        pool,
        'countries',
        'country_id',
        'abbreviation',
        row[abbreviationIndex],
      ));

    if (resolvedId !== null) {
      map.set(legacyKey, resolvedId);
    }
  }

  return map;
}

async function buildUnionIdMap(pool: Pool, insert: LegacyInsert): Promise<Map<string, number>> {
  const idIndex = getColumnIndex(insert.columns, 'union_id');
  const nameIndex = getColumnIndex(insert.columns, 'name');
  const abbreviationIndex = getColumnIndex(insert.columns, 'abbreviation');
  const map = new Map<string, number>();

  if (idIndex === -1 || nameIndex === -1 || abbreviationIndex === -1) {
    return map;
  }

  for (const row of insert.rows) {
    const legacyKey = getIdKey(row[idIndex]);
    if (!legacyKey) continue;

    const byAbbreviation = await findIdByColumn(
      pool,
      'unions',
      'union_id',
      'abbreviation',
      row[abbreviationIndex],
    );
    const resolvedId =
      byAbbreviation ??
      (await findIdByColumn(pool, 'unions', 'union_id', 'name', row[nameIndex]));

    if (resolvedId !== null) {
      map.set(legacyKey, resolvedId);
    }
  }

  return map;
}

async function buildLocalFieldIdMap(
  pool: Pool,
  insert: LegacyInsert,
): Promise<Map<string, number>> {
  const idIndex = getColumnIndex(insert.columns, 'local_field_id');
  const nameIndex = getColumnIndex(insert.columns, 'name');
  const abbreviationIndex = getColumnIndex(insert.columns, 'abbreviation');
  const map = new Map<string, number>();

  if (idIndex === -1 || nameIndex === -1 || abbreviationIndex === -1) {
    return map;
  }

  for (const row of insert.rows) {
    const legacyKey = getIdKey(row[idIndex]);
    if (!legacyKey) continue;

    const byAbbreviation = await findIdByColumn(
      pool,
      'local_fields',
      'local_field_id',
      'abbreviation',
      row[abbreviationIndex],
    );
    const resolvedId =
      byAbbreviation ??
      (await findIdByColumn(pool, 'local_fields', 'local_field_id', 'name', row[nameIndex]));

    if (resolvedId !== null) {
      map.set(legacyKey, resolvedId);
    }
  }

  return map;
}

async function buildDistrictIdMap(
  pool: Pool,
  insert: LegacyInsert,
): Promise<Map<string, number>> {
  const idIndex = getColumnIndex(insert.columns, 'districlub_type_id');
  const nameIndex = getColumnIndex(insert.columns, 'name');
  const localFieldIdIndex = getColumnIndex(insert.columns, 'local_field_id');
  const map = new Map<string, number>();

  if (idIndex === -1 || nameIndex === -1 || localFieldIdIndex === -1) {
    return map;
  }

  const sql = `
    SELECT "districlub_type_id" AS id
    FROM "public"."districts"
    WHERE "name" = $1 AND "local_field_id" = $2
    LIMIT 1
  `;

  for (const row of insert.rows) {
    const legacyKey = getIdKey(row[idIndex]);
    if (!legacyKey) continue;

    const localFieldId = Number(row[localFieldIdIndex]);
    if (!Number.isFinite(localFieldId)) continue;

    const result = await pool.query<{ id: number }>(sql, [row[nameIndex], localFieldId]);
    if (result.rows.length > 0) {
      map.set(legacyKey, Number(result.rows[0].id));
    }
  }

  return map;
}

function applyForeignKeyRemaps(insert: LegacyInsert, maps: LegacyIdMaps): void {
  if (insert.targetTable === 'unions') {
    remapColumnValues(insert, 'country_id', maps.countries);
    return;
  }

  if (insert.targetTable === 'local_fields') {
    remapColumnValues(insert, 'union_id', maps.unions);
    return;
  }

  if (insert.targetTable === 'districts') {
    remapColumnValues(insert, 'local_field_id', maps.localFields);
    return;
  }

  if (insert.targetTable === 'churches') {
    remapColumnValues(insert, 'districlub_type_id', maps.districts);
  }
}

async function refreshLegacyMapForTable(
  pool: Pool,
  insert: LegacyInsert,
  maps: LegacyIdMaps,
): Promise<void> {
  if (insert.targetTable === 'countries') {
    maps.countries = await buildCountryIdMap(pool, insert);
    return;
  }

  if (insert.targetTable === 'unions') {
    maps.unions = await buildUnionIdMap(pool, insert);
    return;
  }

  if (insert.targetTable === 'local_fields') {
    maps.localFields = await buildLocalFieldIdMap(pool, insert);
    return;
  }

  if (insert.targetTable === 'districts') {
    maps.districts = await buildDistrictIdMap(pool, insert);
  }
}

async function ensureHonorsCategories(
  pool: Pool,
  insert: LegacyInsert,
): Promise<void> {
  const index = getColumnIndex(insert.columns, 'honors_category_id');
  if (index === -1) return;

  const ids = Array.from(
    new Set(
      insert.rows
        .map((row) => Number(row[index]))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );

  if (ids.length === 0) return;

  const existingResult = await pool.query<{ honor_category_id: number }>(
    'SELECT "honor_category_id" FROM "public"."honors_categories" WHERE "honor_category_id" = ANY($1::int[])',
    [ids],
  );
  const existingIds = new Set(existingResult.rows.map((row) => Number(row.honor_category_id)));
  const missingIds = ids.filter((id) => !existingIds.has(id));

  if (missingIds.length === 0) return;

  const insertSql = `
    INSERT INTO "public"."honors_categories"
      ("honor_category_id", "name", "description", "icon", "active")
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT DO NOTHING
  `;

  for (const id of missingIds) {
    await pool.query(insertSql, [
      id,
      `Legacy Category ${id}`,
      'Categoria creada automaticamente por importador legacy',
      0,
      true,
    ]);
  }

  await syncSequence(pool, 'honors_categories', 'honor_category_id');
}

async function syncSequence(pool: Pool, table: string, idColumn: string): Promise<void> {
  const serialQuery = `
    SELECT pg_get_serial_sequence($1, $2) AS sequence_name
  `;
  const serialResult = await pool.query<{ sequence_name: string | null }>(serialQuery, [
    `public.${table}`,
    idColumn,
  ]);

  const sequenceName = serialResult.rows[0]?.sequence_name;
  if (!sequenceName) return;

  const setvalSql = `
    SELECT setval(
      $1,
      COALESCE((SELECT MAX("${idColumn}") FROM "public"."${table}"), 1),
      true
    )
  `;
  await pool.query(setvalSql, [sequenceName]);
}

async function loadParsedInserts(sourceDir: string): Promise<LegacyInsert[]> {
  const inserts: LegacyInsert[] = [];
  for (const fileName of FILE_ORDER) {
    if (EXCLUDED_FILES.has(fileName)) {
      continue;
    }
    const fullPath = path.join(sourceDir, fileName);
    const rawSql = await fs.readFile(fullPath, 'utf-8');
    inserts.push(parseInsertSql(rawSql, fileName));
  }
  return inserts;
}

async function run(): Promise<void> {
  const sourceDir = getArg('--source') ?? DEFAULT_SOURCE_DIR;
  const dryRun = hasFlag('--dry-run');

  console.log(`Source dir: ${sourceDir}`);
  console.log(`Mode: ${dryRun ? 'dry-run' : 'import'}`);

  const parsedInserts = await loadParsedInserts(sourceDir);
  const results: TableResult[] = [];

  let pool: Pool | null = null;
  const legacyMaps: LegacyIdMaps = {
    countries: new Map<string, number>(),
    unions: new Map<string, number>(),
    localFields: new Map<string, number>(),
    districts: new Map<string, number>(),
  };

  if (!dryRun) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required when --dry-run is not used');
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }

  try {
    for (const insert of parsedInserts) {
      if (dryRun) {
        results.push({
          file: insert.sourceFile,
          sourceTable: insert.sourceTable,
          targetTable: insert.targetTable,
          parsedRows: insert.rows.length,
          insertedRows: 0,
          failedRows: 0,
          sampleErrors: [],
        });
        continue;
      }

      applyForeignKeyRemaps(insert, legacyMaps);
      if (insert.targetTable === 'honors') {
        await ensureHonorsCategories(pool!, insert);
      }

      const sql = buildInsertSql(insert.targetTable, insert.columns);
      let insertedRows = 0;
      let failedRows = 0;
      const sampleErrors: string[] = [];

      for (const rowValues of insert.rows) {
        try {
          await pool!.query(sql, rowValues);
          insertedRows += 1;
        } catch (error: unknown) {
          failedRows += 1;
          const message =
            error instanceof Error ? error.message.split('\n')[0] : 'Unknown import error';
          if (sampleErrors.length < 5) {
            sampleErrors.push(message);
          }
        }
      }

      const serialColumn = SERIAL_PK_COLUMNS[insert.targetTable];
      if (serialColumn) {
        await syncSequence(pool!, insert.targetTable, serialColumn);
      }
      await refreshLegacyMapForTable(pool!, insert, legacyMaps);

      results.push({
        file: insert.sourceFile,
        sourceTable: insert.sourceTable,
        targetTable: insert.targetTable,
        parsedRows: insert.rows.length,
        insertedRows,
        failedRows,
        sampleErrors,
      });
    }
  } finally {
    await pool?.end();
  }

  console.log('');
  console.log('Import summary');
  console.log('--------------');

  for (const result of results) {
    if (dryRun) {
      console.log(
        `${result.file}: ${result.parsedRows} rows parsed (${result.sourceTable} -> ${result.targetTable})`,
      );
      continue;
    }

    const status =
      result.failedRows === 0
        ? 'ok'
        : result.insertedRows === 0
          ? 'failed'
          : 'partial';
    console.log(
      `${result.file}: ${status}; parsed=${result.parsedRows}, inserted=${result.insertedRows}, failed=${result.failedRows}`,
    );
    for (const sampleError of result.sampleErrors) {
      console.log(`  - ${sampleError}`);
    }
  }

  if (dryRun) {
    const totalRows = results.reduce((sum, result) => sum + result.parsedRows, 0);
    console.log('');
    console.log(`Total parsed rows: ${totalRows}`);
    return;
  }

  const totalParsed = results.reduce((sum, result) => sum + result.parsedRows, 0);
  const totalInserted = results.reduce((sum, result) => sum + result.insertedRows, 0);
  const totalFailed = results.reduce((sum, result) => sum + result.failedRows, 0);
  console.log('');
  console.log(`Total parsed: ${totalParsed}`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total failed: ${totalFailed}`);

  if (totalFailed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('Legacy import failed');
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
