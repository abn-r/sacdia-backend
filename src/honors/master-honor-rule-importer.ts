import {
  master_honor_applicability_scope_enum,
  master_honor_requirement_group_type_enum,
  PrismaClient,
} from '@prisma/client';

type UnknownRecord = Record<string, unknown>;

export interface MasterHonorRulesImportDocument {
  version: string;
  master_honors: MasterHonorRulesImportEntry[];
}

export interface MasterHonorRulesImportEntry {
  master_honor_id?: number;
  external_key?: string;
  name: string;
  master_image?: string | null;
  active: boolean;
  philosophy?: string | null;
  notes?: string | null;
  applicability_scope: master_honor_applicability_scope_enum;
  division_ids: number[];
  groups: MasterHonorRulesImportGroup[];
}

export interface MasterHonorRulesImportGroup {
  group_type: master_honor_requirement_group_type_enum;
  title?: string | null;
  description?: string | null;
  minimum_required: number;
  honors_category_id?: number | null;
  display_order: number;
  active: boolean;
  options: MasterHonorRulesImportOption[];
}

export interface MasterHonorRulesImportOption {
  label: string;
  display_order: number;
  active: boolean;
  honor_ids: number[];
}

export interface MasterHonorRulesImportSummary {
  masterHonorCount: number;
  groupCount: number;
  optionCount: number;
  equivalentHonorCount: number;
  selectedDivisionCount: number;
}

export interface MasterHonorRulesImportApplyOptions {
  apply: boolean;
  allowCreate: boolean;
}

export interface MasterHonorRulesImportApplyResult extends MasterHonorRulesImportSummary {
  mode: 'dry-run' | 'apply';
  createCount: number;
  updateCount: number;
  affectedMasterHonorIds: number[];
}

type MasterHonorTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(
  value: unknown,
  path: string,
  errors: string[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return undefined;
  }
  return value.trim();
}

function requiredString(
  value: unknown,
  path: string,
  errors: string[],
): string | undefined {
  if (value === undefined) {
    errors.push(`${path} is required`);
    return undefined;
  }
  return optionalString(value, path, errors);
}

function nullableString(
  value: unknown,
  path: string,
  errors: string[],
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return optionalString(value, path, errors);
}

function positiveInt(
  value: unknown,
  path: string,
  errors: string[],
): number | undefined {
  if (!Number.isInteger(value) || Number(value) < 1) {
    errors.push(`${path} must be a positive integer`);
    return undefined;
  }
  return Number(value);
}

function intArray(
  value: unknown,
  path: string,
  errors: string[],
  duplicateLabel = 'id',
): number[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }

  const values: number[] = [];
  const seen = new Set<number>();
  value.forEach((item, index) => {
    const parsed = positiveInt(item, `${path}[${index}]`, errors);
    if (parsed === undefined) {
      return;
    }
    if (seen.has(parsed)) {
      errors.push(`${path} contains duplicate ${duplicateLabel} ${parsed}`);
      return;
    }
    seen.add(parsed);
    values.push(parsed);
  });
  return values;
}

function enumValue<T extends Record<string, string>>(
  value: unknown,
  allowed: T,
  path: string,
  errors: string[],
  fallback?: T[keyof T],
): T[keyof T] | undefined {
  if (value === undefined && fallback !== undefined) {
    return fallback;
  }

  if (
    typeof value === 'string' &&
    Object.values(allowed).includes(value as T[keyof T])
  ) {
    return value as T[keyof T];
  }

  errors.push(`${path} must be one of ${Object.values(allowed).join(', ')}`);
  return fallback;
}

function parseOption(
  value: unknown,
  path: string,
  index: number,
  errors: string[],
): MasterHonorRulesImportOption | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }

  const label = requiredString(value.label, `${path}.label`, errors);
  const honorIds = intArray(
    value.honor_ids,
    `${path}.honor_ids`,
    errors,
    'honor_id',
  );
  const honorIdSet = new Set<number>();
  for (const honorId of honorIds) {
    if (honorIdSet.has(honorId)) {
      errors.push(`${path}.honor_ids contains duplicate honor_id ${honorId}`);
    }
    honorIdSet.add(honorId);
  }

  if (!honorIds.length) {
    errors.push(`${path}.honor_ids must contain at least one honor_id`);
  }

  return {
    label: label ?? '',
    display_order:
      value.display_order === undefined
        ? index
        : (positiveInt(value.display_order, `${path}.display_order`, errors) ??
          index),
    active: typeof value.active === 'boolean' ? value.active : true,
    honor_ids: honorIds,
  };
}

function parseGroup(
  value: unknown,
  path: string,
  index: number,
  errors: string[],
): MasterHonorRulesImportGroup | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }

  const groupType = enumValue(
    value.group_type,
    master_honor_requirement_group_type_enum,
    `${path}.group_type`,
    errors,
  );
  const minimumRequired = positiveInt(
    value.minimum_required,
    `${path}.minimum_required`,
    errors,
  );
  const optionsValue = value.options;
  const options =
    optionsValue === undefined
      ? []
      : Array.isArray(optionsValue)
        ? optionsValue
            .map((option, optionIndex) =>
              parseOption(
                option,
                `${path}.options[${optionIndex}]`,
                optionIndex,
                errors,
              ),
            )
            .filter((option): option is MasterHonorRulesImportOption =>
              Boolean(option),
            )
        : (errors.push(`${path}.options must be an array`), []);

  const honorsCategoryId =
    value.honors_category_id === undefined || value.honors_category_id === null
      ? undefined
      : positiveInt(
          value.honors_category_id,
          `${path}.honors_category_id`,
          errors,
        );

  if (
    groupType === master_honor_requirement_group_type_enum.CATEGORY_COUNT &&
    !honorsCategoryId
  ) {
    errors.push('CATEGORY_COUNT groups require honors_category_id');
  }
  if (
    groupType === master_honor_requirement_group_type_enum.CATEGORY_COUNT &&
    options.length > 0
  ) {
    errors.push('CATEGORY_COUNT groups must not include options');
  }
  if (
    groupType === master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS &&
    options.length === 0
  ) {
    errors.push('EXPLICIT_OPTIONS groups require at least one option');
  }
  if (
    groupType === master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS &&
    minimumRequired !== undefined
  ) {
    const activeOptionCount = options.filter((option) => option.active).length;
    if (minimumRequired > activeOptionCount) {
      errors.push(
        `${path}.minimum_required cannot exceed active option count (${activeOptionCount}) for EXPLICIT_OPTIONS`,
      );
    }
  }

  return {
    group_type:
      groupType ?? master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
    title: nullableString(value.title, `${path}.title`, errors) ?? null,
    description:
      nullableString(value.description, `${path}.description`, errors) ?? null,
    minimum_required: minimumRequired ?? 1,
    honors_category_id: honorsCategoryId ?? null,
    display_order:
      value.display_order === undefined
        ? index
        : (positiveInt(value.display_order, `${path}.display_order`, errors) ??
          index),
    active: typeof value.active === 'boolean' ? value.active : true,
    options,
  };
}

function parseMasterHonor(
  value: unknown,
  path: string,
  errors: string[],
): MasterHonorRulesImportEntry | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }

  const masterHonorId =
    value.master_honor_id === undefined
      ? undefined
      : positiveInt(value.master_honor_id, `${path}.master_honor_id`, errors);
  const name = requiredString(value.name, `${path}.name`, errors);
  const applicabilityScope = enumValue(
    value.applicability_scope,
    master_honor_applicability_scope_enum,
    `${path}.applicability_scope`,
    errors,
  );
  const divisionIds =
    value.division_ids === undefined
      ? []
      : intArray(value.division_ids, `${path}.division_ids`, errors);

  if (
    applicabilityScope ===
      master_honor_applicability_scope_enum.SELECTED_DIVISIONS &&
    divisionIds.length === 0
  ) {
    errors.push(
      `${path}.division_ids must contain at least one division for SELECTED_DIVISIONS`,
    );
  }

  if (!Array.isArray(value.groups) || value.groups.length === 0) {
    errors.push(`${path}.groups must contain at least one group`);
  }
  const groups = Array.isArray(value.groups)
    ? value.groups
        .map((group, index) =>
          parseGroup(group, `${path}.groups[${index}]`, index, errors),
        )
        .filter((group): group is MasterHonorRulesImportGroup => Boolean(group))
    : [];

  return {
    ...(masterHonorId !== undefined ? { master_honor_id: masterHonorId } : {}),
    external_key:
      optionalString(value.external_key, `${path}.external_key`, errors) ??
      undefined,
    name: name ?? '',
    master_image:
      nullableString(value.master_image, `${path}.master_image`, errors) ??
      null,
    active: typeof value.active === 'boolean' ? value.active : true,
    philosophy:
      nullableString(value.philosophy, `${path}.philosophy`, errors) ?? null,
    notes: nullableString(value.notes, `${path}.notes`, errors) ?? null,
    applicability_scope:
      applicabilityScope ?? master_honor_applicability_scope_enum.ALL,
    division_ids: divisionIds,
    groups,
  };
}

function assertNoDuplicateMasterHonors(
  entries: MasterHonorRulesImportEntry[],
  errors: string[],
): void {
  const ids = new Set<number>();
  const names = new Set<string>();

  for (const entry of entries) {
    if (entry.master_honor_id !== undefined) {
      if (ids.has(entry.master_honor_id)) {
        errors.push(`Duplicate master_honor_id: ${entry.master_honor_id}`);
      }
      ids.add(entry.master_honor_id);
    }

    const normalizedName = entry.name.trim().toLocaleLowerCase();
    if (normalizedName) {
      if (names.has(normalizedName)) {
        errors.push(`Duplicate master honor name: ${entry.name}`);
      }
      names.add(normalizedName);
    }
  }
}

export function parseMasterHonorRulesImportDocument(
  value: unknown,
): MasterHonorRulesImportDocument {
  const errors: string[] = [];

  if (!isRecord(value)) {
    throw new Error('Import document must be an object');
  }

  const version = requiredString(value.version, 'version', errors);
  if (!Array.isArray(value.master_honors) || value.master_honors.length === 0) {
    errors.push('master_honors must contain at least one master honor');
  }

  const masterHonors = Array.isArray(value.master_honors)
    ? value.master_honors
        .map((entry, index) =>
          parseMasterHonor(entry, `master_honors[${index}]`, errors),
        )
        .filter((entry): entry is MasterHonorRulesImportEntry => Boolean(entry))
    : [];

  assertNoDuplicateMasterHonors(masterHonors, errors);

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return {
    version: version ?? '',
    master_honors: masterHonors,
  };
}

export function summarizeMasterHonorRulesImport(
  document: MasterHonorRulesImportDocument,
): MasterHonorRulesImportSummary {
  const groups = document.master_honors.flatMap((entry) => entry.groups);
  const options = groups.flatMap((group) => group.options);

  return {
    masterHonorCount: document.master_honors.length,
    groupCount: groups.length,
    optionCount: options.length,
    equivalentHonorCount: options.reduce(
      (total, option) => total + option.honor_ids.length,
      0,
    ),
    selectedDivisionCount: document.master_honors.reduce(
      (total, entry) => total + entry.division_ids.length,
      0,
    ),
  };
}

async function findExistingMasterHonor(
  tx: MasterHonorTx,
  entry: MasterHonorRulesImportEntry,
) {
  if (entry.master_honor_id !== undefined) {
    return tx.master_honors.findUnique({
      where: { master_honor_id: entry.master_honor_id },
      select: { master_honor_id: true },
    });
  }

  return tx.master_honors.findFirst({
    where: { name: { equals: entry.name, mode: 'insensitive' } },
    select: { master_honor_id: true },
  });
}

async function syncMasterHonorRules(
  tx: MasterHonorTx,
  masterHonorId: number,
  entry: MasterHonorRulesImportEntry,
): Promise<void> {
  await tx.master_honor_divisions.deleteMany({
    where: { master_honor_id: masterHonorId },
  });

  if (
    entry.applicability_scope ===
    master_honor_applicability_scope_enum.SELECTED_DIVISIONS
  ) {
    await tx.master_honor_divisions.createMany({
      data: entry.division_ids.map((division_id) => ({
        master_honor_id: masterHonorId,
        division_id,
      })),
    });
  }

  await tx.master_honor_requirement_groups.deleteMany({
    where: { master_honor_id: masterHonorId },
  });

  for (const group of entry.groups) {
    await tx.master_honor_requirement_groups.create({
      data: {
        master_honor_id: masterHonorId,
        group_type: group.group_type,
        title: group.title,
        description: group.description,
        minimum_required: group.minimum_required,
        honors_category_id:
          group.group_type ===
          master_honor_requirement_group_type_enum.CATEGORY_COUNT
            ? group.honors_category_id
            : null,
        display_order: group.display_order,
        active: group.active,
        options: {
          create: group.options.map((option) => ({
            label: option.label,
            display_order: option.display_order,
            active: option.active,
            honors: {
              create: option.honor_ids.map((honor_id) => ({
                honor_id,
                active: true,
              })),
            },
          })),
        },
      },
    });
  }
}

async function assertReferencesExist(
  tx: MasterHonorTx,
  document: MasterHonorRulesImportDocument,
): Promise<void> {
  const divisionIds = [
    ...new Set(document.master_honors.flatMap((entry) => entry.division_ids)),
  ];
  const categoryIds = [
    ...new Set(
      document.master_honors.flatMap((entry) =>
        entry.groups
          .map((group) => group.honors_category_id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ),
  ];
  const honorIds = [
    ...new Set(
      document.master_honors.flatMap((entry) =>
        entry.groups.flatMap((group) =>
          group.options.flatMap((option) => option.honor_ids),
        ),
      ),
    ),
  ];

  const [divisions, categories, honors] = await Promise.all([
    divisionIds.length
      ? tx.divisions.findMany({
          where: { division_id: { in: divisionIds } },
          select: { division_id: true },
        })
      : Promise.resolve([]),
    categoryIds.length
      ? tx.honors_categories.findMany({
          where: { honor_category_id: { in: categoryIds } },
          select: { honor_category_id: true },
        })
      : Promise.resolve([]),
    honorIds.length
      ? tx.honors.findMany({
          where: { honor_id: { in: honorIds } },
          select: { honor_id: true },
        })
      : Promise.resolve([]),
  ]);

  const existingDivisionIds = new Set(divisions.map((row) => row.division_id));
  const existingCategoryIds = new Set(
    categories.map((row) => row.honor_category_id),
  );
  const existingHonorIds = new Set(honors.map((row) => row.honor_id));

  const missingDivisionIds = divisionIds.filter(
    (id) => !existingDivisionIds.has(id),
  );
  const missingCategoryIds = categoryIds.filter(
    (id) => !existingCategoryIds.has(id),
  );
  const missingHonorIds = honorIds.filter((id) => !existingHonorIds.has(id));

  const errors = [
    missingDivisionIds.length
      ? `Missing division_id values: ${missingDivisionIds.join(', ')}`
      : null,
    missingCategoryIds.length
      ? `Missing honors_category_id values: ${missingCategoryIds.join(', ')}`
      : null,
    missingHonorIds.length
      ? `Missing honor_id values: ${missingHonorIds.join(', ')}`
      : null,
  ].filter(Boolean);

  if (!errors.length && categoryIds.length) {
    const categoryHonorCounts = new Map<number, number>();
    await Promise.all(
      categoryIds.map(async (categoryId) => {
        const count = await tx.honors.count({
          where: { honors_category_id: categoryId, active: true },
        });
        categoryHonorCounts.set(categoryId, count);
      }),
    );

    for (const entry of document.master_honors) {
      for (const group of entry.groups) {
        if (
          group.group_type !==
            master_honor_requirement_group_type_enum.CATEGORY_COUNT ||
          typeof group.honors_category_id !== 'number'
        ) {
          continue;
        }

        const activeHonorCount =
          categoryHonorCounts.get(group.honors_category_id) ?? 0;
        if (group.minimum_required > activeHonorCount) {
          errors.push(
            `Master honor "${entry.name}" requires ${group.minimum_required} active honors from honors_category_id ${group.honors_category_id}, but only ${activeHonorCount} exist`,
          );
        }
      }
    }
  }

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
}

export async function applyMasterHonorRulesImport(
  prisma: PrismaClient,
  document: MasterHonorRulesImportDocument,
  options: MasterHonorRulesImportApplyOptions,
): Promise<MasterHonorRulesImportApplyResult> {
  const summary = summarizeMasterHonorRulesImport(document);
  let createCount = 0;
  let updateCount = 0;
  const affectedMasterHonorIds: number[] = [];

  await prisma.$transaction(async (tx) => {
    await assertReferencesExist(tx, document);

    for (const entry of document.master_honors) {
      const existing = await findExistingMasterHonor(tx, entry);
      if (!existing && !options.allowCreate) {
        throw new Error(
          `Master honor not found for "${entry.name}". Re-run with --allow-create only after confirming the official source.`,
        );
      }

      if (existing) {
        updateCount += 1;
        affectedMasterHonorIds.push(existing.master_honor_id);
      } else {
        createCount += 1;
        if (entry.master_honor_id !== undefined) {
          affectedMasterHonorIds.push(entry.master_honor_id);
        }
      }

      if (!options.apply) {
        continue;
      }

      const masterHonorId = existing
        ? existing.master_honor_id
        : (
            await tx.master_honors.create({
              data: {
                ...(entry.master_honor_id !== undefined
                  ? { master_honor_id: entry.master_honor_id }
                  : {}),
                name: entry.name,
                master_image: entry.master_image,
                active: entry.active,
                applicability_scope: entry.applicability_scope,
                philosophy: entry.philosophy,
                notes: entry.notes,
              },
              select: { master_honor_id: true },
            })
          ).master_honor_id;
      if (!existing && !affectedMasterHonorIds.includes(masterHonorId)) {
        affectedMasterHonorIds.push(masterHonorId);
      }

      if (existing) {
        await tx.master_honors.update({
          where: { master_honor_id: masterHonorId },
          data: {
            name: entry.name,
            master_image: entry.master_image,
            active: entry.active,
            applicability_scope: entry.applicability_scope,
            philosophy: entry.philosophy,
            notes: entry.notes,
            modified_at: new Date(),
          },
        });
      }

      await syncMasterHonorRules(tx, masterHonorId, entry);
    }
  });

  return {
    ...summary,
    mode: options.apply ? 'apply' : 'dry-run',
    createCount,
    updateCount,
    affectedMasterHonorIds,
  };
}
