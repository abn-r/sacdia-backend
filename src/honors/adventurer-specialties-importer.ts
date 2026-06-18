import fs from 'node:fs/promises';
import path from 'node:path';
import { class_honor_relation_type_enum } from '@prisma/client';

export interface AdventurerSpecialtyCsvRow {
  slug: string;
  title: string;
  adventurer_level: string;
  level_order: string;
  source_scope: string;
  source_kind: string;
  requirements_detected: string;
  pdf: string;
  md: string;
  raw_txt: string;
  image: string;
  image_width: string;
  image_height: string;
  source_page: string;
  source_url: string;
  image_url: string;
  error: string;
}

export interface AdventurerSpecialtyImportIssue {
  rowNumber?: number;
  code?: string;
  field?: keyof AdventurerSpecialtyCsvRow | 'code' | 'markdown';
  message: string;
}

export interface AdventurerSpecialtyDisplayNameCollision {
  name: string;
  codes: string[];
}

export interface AdventurerSpecialtyRequirement {
  requirement_number: number;
  requirement_text: string;
}

export interface AdventurerSpecialtiesDatasetValidation {
  errors: AdventurerSpecialtyImportIssue[];
  warnings: AdventurerSpecialtyImportIssue[];
  duplicateCodes: string[];
  displayNameCollisions: AdventurerSpecialtyDisplayNameCollision[];
  missingAssets: number;
}

export interface AdventurerSpecialtyAssetManifestEntry {
  imageUrl: string;
  materialUrl: string;
}

export type AdventurerSpecialtyAssetManifest = Record<
  string,
  AdventurerSpecialtyAssetManifestEntry
>;

export interface AdventurerSpecialtyAllowedAssetBaseUrls {
  imageBaseUrls: string[];
  materialBaseUrls: string[];
}

export interface PreparedAdventurerSpecialty {
  row: AdventurerSpecialtyCsvRow;
  rowNumber: number;
  code: string;
  markdownPath: string;
  requirements: AdventurerSpecialtyRequirement[];
}

export interface PreparedAdventurerSpecialtiesDataset {
  datasetPath: string;
  datasetRoot: string;
  rows: AdventurerSpecialtyCsvRow[];
  specialties: PreparedAdventurerSpecialty[];
  validation: AdventurerSpecialtiesDatasetValidation;
}

export interface AdventurerSpecialtiesPrismaReader {
  $queryRawUnsafe?<T = unknown>(query: string): Promise<T>;
  club_types: {
    findFirst(args: {
      where: { name: string };
      select?: { club_type_id?: boolean; name?: boolean };
    }): Promise<{ club_type_id: number; name: string } | null>;
  };
  classes: {
    findMany(args: {
      where: { club_types: { name: string } };
      select: { class_id: boolean; name: boolean };
    }): Promise<Array<{ class_id: number; name: string }>>;
  };
  honors: {
    findMany(args: {
      where: { code: { in: string[] } };
      select: { honor_id: boolean; code: boolean; name: boolean };
    }): Promise<Array<{ honor_id: number; code: string | null; name: string }>>;
  };
}

export type AdventurerSpecialtiesPrismaClient = AdventurerSpecialtiesPrismaReader & {
  $transaction<T>(
    fn: (tx: AdventurerSpecialtiesPrismaTransaction) => Promise<T>,
  ): Promise<T>;
  honors_categories: {
    upsert(args: {
      where: { name: string };
      create: {
        name: string;
        description: string;
        active: boolean;
      };
      update: {
        description?: string;
        active?: boolean;
      };
      select: { honor_category_id: boolean; name: boolean };
    }): Promise<{ honor_category_id: number; name: string }>;
  };
};

export interface AdventurerSpecialtiesPrismaTransaction {
  honors: {
    upsert(args: unknown): Promise<{ honor_id: number; code: string | null }>;
  };
  honor_club_types: {
    upsert(args: unknown): Promise<unknown>;
  };
  class_honors: {
    upsert(args: unknown): Promise<unknown>;
  };
  honor_requirements: {
    upsert(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export interface AdventurerSpecialtiesImportAnalysis {
  rowsRead: number;
  newHonors: number;
  existingHonorsByCode: number;
  displayNameCollisions: number;
  classLinksToCreate: number;
  requirementsToCreateOrUpdate: number;
  missingAssets: number;
  warnings: AdventurerSpecialtyImportIssue[];
  errors: AdventurerSpecialtyImportIssue[];
}

export interface AdventurerSpecialtiesDryRunResult
  extends AdventurerSpecialtiesImportAnalysis {
  mode: 'dry-run';
}

export interface AdventurerSpecialtiesApplyResult
  extends AdventurerSpecialtiesImportAnalysis {
  mode: 'apply';
  honorsCreated: number;
  honorsUpdated: number;
  honorClubTypesUpserted: number;
  classLinksUpserted: number;
  requirementsUpserted: number;
  requirementsDeactivated: number;
  honorCategoryId: number;
  adventurerClubTypeId: number;
}

export interface AnalyzeAdventurerSpecialtiesImportOptions {
  datasetPath: string;
  assetManifest?: AdventurerSpecialtyAssetManifest;
  requireAssetManifest?: boolean;
  allowedAssetBaseUrls?: AdventurerSpecialtyAllowedAssetBaseUrls;
}

const REQUIRED_CSV_HEADERS: Array<keyof AdventurerSpecialtyCsvRow> = [
  'slug',
  'title',
  'adventurer_level',
  'level_order',
  'source_scope',
  'source_kind',
  'requirements_detected',
  'pdf',
  'md',
  'raw_txt',
  'image',
  'image_width',
  'image_height',
  'source_page',
  'source_url',
  'image_url',
  'error',
];

const ADVENTURER_CLASS_ALIASES: Record<string, string[]> = {
  corderitos: ['corderito', 'corderitos'],
  castorcitos: [
    'castorcito',
    'castorcitos',
    'ave-madrugadora',
    'aves-madrugadoras',
  ],
  'abejita-industriosa': ['abejita-industriosa', 'abejitas-industriosas'],
  'rayito-de-sol': [
    'rayito-de-sol',
    'rayitos-de-sol',
    'rayo-de-sol',
    'rayos-de-sol',
  ],
  constructor: ['constructor', 'constructores'],
  'manos-ayudadoras': [
    'manos-ayudadoras',
    'mano-ayudadora',
    'manitas-ayudadoras',
    'manita-ayudadora',
  ],
};

const ADVENTURER_LEVEL_ORDER_TO_CLASS_KEY: Record<string, string | null> = {
  preescolar: 'corderitos',
  jardin: 'castorcitos',
  'grado-1': 'abejita-industriosa',
  'grado-2': 'rayito-de-sol',
  'grado-3': 'constructor',
  'grado-4': 'manos-ayudadoras',
  multinivel: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(
  value: unknown,
  pathName: string,
  errors: string[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${pathName} must be a non-empty string`);
    return undefined;
  }

  return value.trim();
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function normalizeCodeToken(value: string): string {
  return normalizeToken(value).toUpperCase();
}

function canonicalClassKey(value: string): string | null {
  const normalized = normalizeToken(value);

  if (normalized === 'multinivel') {
    return null;
  }

  for (const [canonical, aliases] of Object.entries(ADVENTURER_CLASS_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(alias))) {
      return canonical;
    }
  }

  return normalized;
}

function classKeyForSpecialty(row: AdventurerSpecialtyCsvRow): string | null {
  const levelOrder = normalizeToken(row.level_order);
  if (Object.prototype.hasOwnProperty.call(ADVENTURER_LEVEL_ORDER_TO_CLASS_KEY, levelOrder)) {
    return ADVENTURER_LEVEL_ORDER_TO_CLASS_KEY[levelOrder] ?? null;
  }

  return canonicalClassKey(row.adventurer_level);
}

function parseCsvRecords(content: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }
      row.push(field);
      field = '';

      if (row.some((value) => value.length > 0)) {
        records.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.length > 0)) {
    records.push(row);
  }

  return records;
}

export function parseAdventurerSpecialtiesCsv(
  content: string,
): AdventurerSpecialtyCsvRow[] {
  const records = parseCsvRecords(content);
  if (!records.length) {
    return [];
  }

  const headers = records[0].map((header, index) =>
    index === 0 ? header.replace(/^\uFEFF/, '').trim() : header.trim(),
  );
  const missingHeaders = REQUIRED_CSV_HEADERS.filter(
    (header) => !headers.includes(header),
  );

  if (missingHeaders.length > 0) {
    throw new Error(`CSV missing required headers: ${missingHeaders.join(', ')}`);
  }

  return records.slice(1).map((record) => {
    const row = {} as AdventurerSpecialtyCsvRow;

    for (const header of REQUIRED_CSV_HEADERS) {
      const index = headers.indexOf(header);
      row[header] = (record[index] ?? '').trim();
    }

    return row;
  });
}

export async function readAdventurerSpecialtiesCsvFile(
  datasetPath: string,
): Promise<AdventurerSpecialtyCsvRow[]> {
  const content = await fs.readFile(datasetPath, 'utf8');
  return parseAdventurerSpecialtiesCsv(content);
}

export function buildHonorCode(row: Pick<AdventurerSpecialtyCsvRow, 'slug'>): string {
  const slugCode = normalizeCodeToken(row.slug);

  if (!slugCode) {
    throw new Error('Cannot build honor code without row.slug');
  }

  return `ADV-${slugCode}`;
}

export function buildAdventurerSpecialtyAssetKeys(code: string): {
  imageKey: string;
  materialKey: string;
} {
  return {
    imageKey: `adventurers/images/${code}.png`,
    materialKey: `adventurers/materials/${code}.pdf`,
  };
}

export function parseAdventurerSpecialtyAssetManifest(
  value: unknown,
): AdventurerSpecialtyAssetManifest {
  if (!isRecord(value)) {
    throw new Error('Asset manifest must be a JSON object keyed by honor code');
  }

  const manifest: AdventurerSpecialtyAssetManifest = {};
  const errors: string[] = [];

  for (const [code, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      errors.push(`${code} must be an object`);
      continue;
    }

    const imageUrl = optionalString(entry.imageUrl, `${code}.imageUrl`, errors);
    const materialUrl = optionalString(
      entry.materialUrl,
      `${code}.materialUrl`,
      errors,
    );

    if (imageUrl && materialUrl) {
      manifest[code] = { imageUrl, materialUrl };
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid asset manifest: ${errors.join('; ')}`);
  }

  return manifest;
}

export function parseRequirementsFromMarkdown(
  markdown: string,
): AdventurerSpecialtyRequirement[] {
  const lines = markdown.split(/\r?\n/);
  const requirements: AdventurerSpecialtyRequirement[] = [];
  let insideRequirements = false;
  let current: AdventurerSpecialtyRequirement | null = null;

  for (const line of lines) {
    if (/^##\s+Requisitos detectados\s*$/i.test(line.trim())) {
      insideRequirements = true;
      continue;
    }

    if (insideRequirements && /^##\s+/.test(line.trim())) {
      break;
    }

    if (!insideRequirements) {
      continue;
    }

    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      if (current) {
        requirements.push(current);
      }

      current = {
        requirement_number: Number(numberedMatch[1]),
        requirement_text: numberedMatch[2].trim(),
      };
      continue;
    }

    const continuation = line.trim();
    if (current && continuation && !continuation.startsWith('>')) {
      current.requirement_text = `${current.requirement_text} ${continuation}`;
    }
  }

  if (current) {
    requirements.push(current);
  }

  return requirements;
}

export function resolveDatasetFilePath(
  filePath: string,
  datasetRoot: string,
): string {
  const trimmedPath = filePath.trim();
  const normalizedPath = trimmedPath.replaceAll('\\', path.sep);
  const marker = `${path.sep}aventureros-especialidades${path.sep}`;
  const markerIndex = normalizedPath.indexOf(marker);

  if (markerIndex >= 0) {
    const relativePath = normalizedPath.slice(markerIndex + marker.length);
    return path.join(datasetRoot, relativePath);
  }

  if (path.isAbsolute(trimmedPath)) {
    return trimmedPath;
  }

  return path.resolve(datasetRoot, trimmedPath);
}

export function validateAdventurerSpecialtyRows(
  rows: AdventurerSpecialtyCsvRow[],
  options: { datasetRoot?: string; existingMarkdownPaths?: Set<string> } = {},
): AdventurerSpecialtiesDatasetValidation {
  const errors: AdventurerSpecialtyImportIssue[] = [];
  const warnings: AdventurerSpecialtyImportIssue[] = [];
  const codesByCode = new Map<string, number[]>();
  const codesByName = new Map<string, string[]>();
  let missingAssets = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    let code = '';

    try {
      code = buildHonorCode(row);
      codesByCode.set(code, [...(codesByCode.get(code) ?? []), rowNumber]);
    } catch (error) {
      errors.push({
        rowNumber,
        field: 'code',
        message: error instanceof Error ? error.message : 'Invalid honor code',
      });
    }

    if (row.title.trim()) {
      const displayNameKey = normalizeToken(row.title);
      codesByName.set(displayNameKey, [
        ...(codesByName.get(displayNameKey) ?? []),
        code,
      ]);
    } else {
      errors.push({
        rowNumber,
        code,
        field: 'title',
        message: 'Missing display title',
      });
    }

    const hasMissingAsset = !row.image_url.trim() || !row.source_url.trim();
    if (hasMissingAsset) {
      missingAssets += 1;
    }

    if (!row.image_url.trim()) {
      errors.push({
        rowNumber,
        code,
        field: 'image_url',
        message: 'Missing image_url asset placeholder',
      });
    }

    if (!row.source_url.trim()) {
      errors.push({
        rowNumber,
        code,
        field: 'source_url',
        message: 'Missing source_url material placeholder',
      });
    }

    if (!row.md.trim()) {
      errors.push({
        rowNumber,
        code,
        field: 'md',
        message: 'Missing markdown path',
      });
    } else if (options.datasetRoot && options.existingMarkdownPaths) {
      const markdownPath = resolveDatasetFilePath(row.md, options.datasetRoot);
      if (!options.existingMarkdownPaths.has(markdownPath)) {
        errors.push({
          rowNumber,
          code,
          field: 'markdown',
          message: `Markdown file not found: ${markdownPath}`,
        });
      }
    }
  });

  const duplicateCodes = Array.from(codesByCode.entries())
    .filter(([, rowNumbers]) => rowNumbers.length > 1)
    .map(([code, rowNumbers]) => {
      errors.push({
        code,
        field: 'code',
        message: `Duplicate generated code ${code} in CSV rows ${rowNumbers.join(', ')}`,
      });
      return code;
    });

  const displayNameCollisions = Array.from(codesByName.entries())
    .filter(([, codes]) => new Set(codes).size > 1)
    .map(([nameKey, codes]) => ({
      name: rows.find((row) => normalizeToken(row.title) === nameKey)?.title ?? nameKey,
      codes: Array.from(new Set(codes)).sort(),
    }));

  return {
    errors,
    warnings,
    duplicateCodes,
    displayNameCollisions,
    missingAssets,
  };
}

export function validateAdventurerSpecialtyAssetManifest(
  rows: AdventurerSpecialtyCsvRow[],
  manifest: AdventurerSpecialtyAssetManifest | undefined,
  options: {
    required: boolean;
    allowedAssetBaseUrls?: AdventurerSpecialtyAllowedAssetBaseUrls;
  },
): AdventurerSpecialtyImportIssue[] {
  if (!manifest) {
    return options.required
      ? [
          {
            field: 'markdown',
            message:
              'Asset manifest is required for apply mode. Pass --manifest with SACDIA-controlled imageUrl/materialUrl values.',
          },
        ]
      : [];
  }

  const errors: AdventurerSpecialtyImportIssue[] = [];
  const expectedCodes = new Set<string>();

  rows.forEach((row, index) => {
    const code = buildHonorCode(row);
    expectedCodes.add(code);
    const rowNumber = index + 2;
    const entry = manifest[code];

    if (!entry) {
      errors.push({
        rowNumber,
        code,
        message: `Missing manifest entry for ${code}`,
      });
      return;
    }

    validateManifestUrl({
      url: entry.imageUrl,
      code,
      rowNumber,
      fieldName: 'imageUrl',
      allowedBaseUrls: options.allowedAssetBaseUrls?.imageBaseUrls,
      errors,
    });
    validateManifestUrl({
      url: entry.materialUrl,
      code,
      rowNumber,
      fieldName: 'materialUrl',
      allowedBaseUrls: options.allowedAssetBaseUrls?.materialBaseUrls,
      errors,
    });
  });

  for (const manifestCode of Object.keys(manifest)) {
    if (!expectedCodes.has(manifestCode)) {
      errors.push({
        code: manifestCode,
        message: `Manifest contains unknown honor code ${manifestCode}`,
      });
    }
  }

  return errors;
}

function validateManifestUrl(args: {
  url: string;
  code: string;
  rowNumber: number;
  fieldName: 'imageUrl' | 'materialUrl';
  allowedBaseUrls?: string[];
  errors: AdventurerSpecialtyImportIssue[];
}): void {
  const { url, code, rowNumber, fieldName, allowedBaseUrls, errors } = args;

  if (!url.trim()) {
    errors.push({
      rowNumber,
      code,
      message: `Manifest ${fieldName} is required for ${code}`,
    });
    return;
  }

  if (!isHttpUrl(url)) {
    errors.push({
      rowNumber,
      code,
      message: `Manifest ${fieldName} must be a valid HTTP(S) URL for ${code}`,
    });
    return;
  }

  if (
    allowedBaseUrls &&
    allowedBaseUrls.length > 0 &&
    !isUrlUnderAllowedBaseUrl(url, allowedBaseUrls)
  ) {
    errors.push({
      rowNumber,
      code,
      message: `Manifest ${fieldName} for ${code} must use a configured SACDIA R2 public URL`,
    });
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isUrlUnderAllowedBaseUrl(value: string, allowedBaseUrls: string[]) {
  const normalizedValue = normalizeComparableUrl(value);

  return allowedBaseUrls.some((baseUrl) => {
    const normalizedBase = normalizeComparableUrl(baseUrl);
    return (
      normalizedValue === normalizedBase ||
      normalizedValue.startsWith(`${normalizedBase}/`)
    );
  });
}

function normalizeComparableUrl(value: string): string {
  const parsed = new URL(value);
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

export async function prepareAdventurerSpecialtiesDataset(
  datasetPath: string,
): Promise<PreparedAdventurerSpecialtiesDataset> {
  const datasetRoot = path.dirname(datasetPath);
  const rows = await readAdventurerSpecialtiesCsvFile(datasetPath);
  const existingMarkdownPaths = new Set<string>();

  await Promise.all(
    rows
      .filter((row) => row.md.trim())
      .map(async (row) => {
        const markdownPath = resolveDatasetFilePath(row.md, datasetRoot);
        try {
          await fs.access(markdownPath);
          existingMarkdownPaths.add(markdownPath);
        } catch {
          // Reported during validation below with row context.
        }
      }),
  );

  const validation = validateAdventurerSpecialtyRows(rows, {
    datasetRoot,
    existingMarkdownPaths,
  });

  const specialties = await Promise.all(
    rows.map(async (row, index): Promise<PreparedAdventurerSpecialty | null> => {
      const code = buildHonorCode(row);
      const markdownPath = resolveDatasetFilePath(row.md, datasetRoot);

      if (!existingMarkdownPaths.has(markdownPath)) {
        return null;
      }

      const markdown = await fs.readFile(markdownPath, 'utf8');
      return {
        row,
        rowNumber: index + 2,
        code,
        markdownPath,
        requirements: parseRequirementsFromMarkdown(markdown),
      };
    }),
  );

  return {
    datasetPath,
    datasetRoot,
    rows,
    specialties: specialties.filter(
      (specialty): specialty is PreparedAdventurerSpecialty =>
        specialty !== null,
    ),
    validation,
  };
}

export async function analyzeAdventurerSpecialtiesImport(
  prisma: AdventurerSpecialtiesPrismaReader,
  options: AnalyzeAdventurerSpecialtiesImportOptions,
): Promise<AdventurerSpecialtiesDryRunResult> {
  const prepared = await prepareAdventurerSpecialtiesDataset(options.datasetPath);

  const result: AdventurerSpecialtiesDryRunResult = {
    mode: 'dry-run',
    rowsRead: prepared.rows.length,
    newHonors: 0,
    existingHonorsByCode: 0,
    displayNameCollisions: prepared.validation.displayNameCollisions.length,
    classLinksToCreate: 0,
    requirementsToCreateOrUpdate: prepared.specialties.reduce(
      (total, specialty) => total + specialty.requirements.length,
      0,
    ),
    missingAssets: prepared.validation.missingAssets,
    warnings: [...prepared.validation.warnings],
    errors: [...prepared.validation.errors],
  };

  if (result.errors.length > 0) {
    return result;
  }

  result.errors.push(
    ...validateAdventurerSpecialtyAssetManifest(
      prepared.rows,
      options.assetManifest,
      {
        required: options.requireAssetManifest ?? false,
        allowedAssetBaseUrls: options.allowedAssetBaseUrls,
      },
    ),
  );

  if (result.errors.length > 0) {
    return result;
  }

  const hasHonorCodeColumn = await databaseHasHonorCodeColumn(prisma);
  if (!hasHonorCodeColumn) {
    result.errors.push({
      field: 'code',
      message:
        'Database schema is missing honors.code. Apply the honor applicability migration to a temporal/migrated database before running this dry-run.',
    });
    return result;
  }

  const adventurersClubType = await prisma.club_types.findFirst({
    where: { name: 'Aventureros' },
    select: { club_type_id: true, name: true },
  });

  if (!adventurersClubType) {
    result.errors.push({
      message: 'Aventureros club type not found',
    });
    return result;
  }

  const adventurerClasses = await prisma.classes.findMany({
    where: { club_types: { name: 'Aventureros' } },
    select: { class_id: true, name: true },
  });
  const classByKey = new Map(
    adventurerClasses
      .map((adventurerClass) => [
        canonicalClassKey(adventurerClass.name),
        adventurerClass,
      ] as const)
      .filter(
        (entry): entry is readonly [string, { class_id: number; name: string }] =>
          entry[0] !== null,
      ),
  );
  const missingClassNames = new Set<string>();

  result.classLinksToCreate = prepared.specialties.filter((specialty) => {
    const classKey = classKeyForSpecialty(specialty.row);
    if (classKey === null) {
      return false;
    }

    const classExists = classByKey.has(classKey);
    if (!classExists) {
      missingClassNames.add(specialty.row.adventurer_level);
    }
    return classExists;
  }).length;

  for (const className of Array.from(missingClassNames).sort()) {
    result.warnings.push({
      message: `No Adventurer class found for source level "${className}"`,
    });
  }

  const codes = prepared.specialties.map((specialty) => specialty.code);
  const existingHonors = await prisma.honors.findMany({
    where: { code: { in: codes } },
    select: { honor_id: true, code: true, name: true },
  });
  const existingCodes = new Set(
    existingHonors
      .map((honor) => honor.code)
      .filter((code): code is string => Boolean(code)),
  );

  result.existingHonorsByCode = existingCodes.size;
  result.newHonors = codes.filter((code) => !existingCodes.has(code)).length;

  return result;
}

export async function applyAdventurerSpecialtiesImport(
  prisma: AdventurerSpecialtiesPrismaClient,
  options: AnalyzeAdventurerSpecialtiesImportOptions & {
    assetManifest: AdventurerSpecialtyAssetManifest;
  },
): Promise<AdventurerSpecialtiesApplyResult> {
  const analysis = await analyzeAdventurerSpecialtiesImport(prisma, {
    ...options,
    requireAssetManifest: true,
  });

  if (analysis.errors.length > 0) {
    throw new Error(
      `Cannot apply Adventurer specialties import with dry-run errors: ${analysis.errors.map((error) => error.message).join('; ')}`,
    );
  }

  const prepared = await prepareAdventurerSpecialtiesDataset(options.datasetPath);
  const adventurersClubType = await prisma.club_types.findFirst({
    where: { name: 'Aventureros' },
    select: { club_type_id: true, name: true },
  });

  if (!adventurersClubType) {
    throw new Error('Aventureros club type not found');
  }

  const honorCategory = await prisma.honors_categories.upsert({
    where: { name: 'Aventureros' },
    create: {
      name: 'Aventureros',
      description:
        'Especialidades del club de Aventureros importadas desde Asociación General.',
      active: true,
    },
    update: {
      description:
        'Especialidades del club de Aventureros importadas desde Asociación General.',
      active: true,
    },
    select: { honor_category_id: true, name: true },
  });

  const adventurerClasses = await prisma.classes.findMany({
    where: { club_types: { name: 'Aventureros' } },
    select: { class_id: true, name: true },
  });
  const classByKey = new Map(
    adventurerClasses
      .map((adventurerClass) => [
        canonicalClassKey(adventurerClass.name),
        adventurerClass,
      ] as const)
      .filter(
        (entry): entry is readonly [string, { class_id: number; name: string }] =>
          entry[0] !== null,
      ),
  );

  const existingHonorsByCode = new Map(
    (
      await prisma.honors.findMany({
        where: {
          code: { in: prepared.specialties.map((specialty) => specialty.code) },
        },
        select: { honor_id: true, code: true, name: true },
      })
    )
      .filter((honor) => honor.code)
      .map((honor) => [honor.code as string, honor]),
  );

  const result: AdventurerSpecialtiesApplyResult = {
    ...analysis,
    mode: 'apply',
    honorsCreated: 0,
    honorsUpdated: 0,
    honorClubTypesUpserted: 0,
    classLinksUpserted: 0,
    requirementsUpserted: 0,
    requirementsDeactivated: 0,
    honorCategoryId: honorCategory.honor_category_id,
    adventurerClubTypeId: adventurersClubType.club_type_id,
  };

  for (const specialty of prepared.specialties) {
    const manifestEntry = options.assetManifest[specialty.code];
    if (!manifestEntry) {
      throw new Error(`Missing manifest entry for ${specialty.code}`);
    }

    const existingHonor = existingHonorsByCode.get(specialty.code);
    if (existingHonor) {
      result.honorsUpdated += 1;
    } else {
      result.honorsCreated += 1;
    }

    const classKey = classKeyForSpecialty(specialty.row);
    const classRecord = classKey ? classByKey.get(classKey) : undefined;

    const transactionResult = await prisma.$transaction(async (tx) => {
      const honor = await tx.honors.upsert({
        where: { code: specialty.code },
        create: {
          code: specialty.code,
          name: specialty.row.title,
          description: buildHonorDescription(specialty.row),
          honor_image: manifestEntry.imageUrl,
          material_url: manifestEntry.materialUrl,
          honors_category_id: honorCategory.honor_category_id,
          club_type_id: adventurersClubType.club_type_id,
          active: true,
          approval: 1,
          skill_level: 1,
        },
        update: {
          name: specialty.row.title,
          description: buildHonorDescription(specialty.row),
          honor_image: manifestEntry.imageUrl,
          material_url: manifestEntry.materialUrl,
          honors_category_id: honorCategory.honor_category_id,
          club_type_id: adventurersClubType.club_type_id,
          active: true,
          approval: 1,
          skill_level: 1,
          modified_at: new Date(),
        },
        select: { honor_id: true, code: true },
      });

      await tx.honor_club_types.upsert({
        where: {
          honor_id_club_type_id: {
            honor_id: honor.honor_id,
            club_type_id: adventurersClubType.club_type_id,
          },
        },
        create: {
          honor_id: honor.honor_id,
          club_type_id: adventurersClubType.club_type_id,
          active: true,
        },
        update: {
          active: true,
          modified_at: new Date(),
        },
      });

      let classLinkUpserted = 0;
      if (classRecord) {
        await tx.class_honors.upsert({
          where: {
            class_id_honor_id_relation_type: {
              class_id: classRecord.class_id,
              honor_id: honor.honor_id,
              relation_type: class_honor_relation_type_enum.RECOMMENDED,
            },
          },
          create: {
            class_id: classRecord.class_id,
            honor_id: honor.honor_id,
            relation_type: class_honor_relation_type_enum.RECOMMENDED,
            active: true,
          },
          update: {
            active: true,
            modified_at: new Date(),
          },
        });
        classLinkUpserted = 1;
      }

      for (const requirement of specialty.requirements) {
        await tx.honor_requirements.upsert({
          where: {
            honor_id_requirement_number: {
              honor_id: honor.honor_id,
              requirement_number: requirement.requirement_number,
            },
          },
          create: {
            honor_id: honor.honor_id,
            requirement_number: requirement.requirement_number,
            display_label: String(requirement.requirement_number),
            requirement_text: requirement.requirement_text,
            needs_review: true,
            active: true,
          },
          update: {
            display_label: String(requirement.requirement_number),
            requirement_text: requirement.requirement_text,
            needs_review: true,
            active: true,
            modified_at: new Date(),
          },
        });
      }

      const deactivated = await tx.honor_requirements.updateMany({
        where: {
          honor_id: honor.honor_id,
          requirement_number: {
            notIn: specialty.requirements.map(
              (requirement) => requirement.requirement_number,
            ),
          },
          active: true,
        },
        data: {
          active: false,
          modified_at: new Date(),
        },
      });

      return {
        classLinkUpserted,
        requirementsUpserted: specialty.requirements.length,
        requirementsDeactivated: deactivated.count,
      };
    });

    result.honorClubTypesUpserted += 1;
    result.classLinksUpserted += transactionResult.classLinkUpserted;
    result.requirementsUpserted += transactionResult.requirementsUpserted;
    result.requirementsDeactivated +=
      transactionResult.requirementsDeactivated;
  }

  return result;
}

function buildHonorDescription(row: AdventurerSpecialtyCsvRow): string {
  return [
    `Especialidad de Aventureros.`,
    `Nivel/clase fuente: ${row.adventurer_level}.`,
    `Fuente: ${row.source_url}.`,
  ].join(' ');
}

async function databaseHasHonorCodeColumn(
  prisma: AdventurerSpecialtiesPrismaReader,
): Promise<boolean> {
  if (!prisma.$queryRawUnsafe) {
    return true;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'honors'
        AND column_name = 'code'
    ) AS "exists"
  `);

  return Boolean(rows[0]?.exists);
}

export function formatAdventurerSpecialtiesDryRunSummary(
  result: AdventurerSpecialtiesDryRunResult,
): string {
  return [
    'Adventurer specialties import dry-run',
    `- rows read: ${result.rowsRead}`,
    `- new honors: ${result.newHonors}`,
    `- existing honors by code: ${result.existingHonorsByCode}`,
    `- display-name collisions: ${result.displayNameCollisions}`,
    `- class links to create: ${result.classLinksToCreate}`,
    `- requirements to create/update: ${result.requirementsToCreateOrUpdate}`,
    `- missing assets: ${result.missingAssets}`,
    `- warnings: ${result.warnings.length}`,
    `- errors: ${result.errors.length}`,
  ].join('\n');
}
