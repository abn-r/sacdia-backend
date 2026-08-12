/**
 * Fixture test for the "Capacitación básica para el personal del Club de
 * Conquistadores" certification seed.
 *
 * NOTE on location: Jest's `rootDir` is `src` (see package.json `jest` config),
 * so a spec placed under `prisma/seeds/` would never be discovered by the test
 * runner. This spec lives under `src/certifications/seeds/` and imports the
 * seed module directly from `prisma/seeds/certifications/` via a relative
 * path so it still executes with `pnpm test -- --runInBand`.
 *
 * This test never touches a real database: it exercises the seed against a
 * small in-memory fake that implements the same minimal structural surface
 * (`SeedExecutionClient`) the seed depends on.
 */
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  CERTIFICATION_NAME,
  seedBasicPathfinderStaffTraining,
  type SeedExecutionClient,
} from '../../../prisma/seeds/certifications/basic-pathfinder-staff-training.seed';

// ============================================================================
// Minimal in-memory fake DB — just enough querying to satisfy the seed's
// find/create/update usage patterns (equality + `{ contains }` on strings).
// ============================================================================

type Row = Record<string, unknown>;

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (
      condition !== null &&
      typeof condition === 'object' &&
      !Array.isArray(condition)
    ) {
      const operators = condition as Record<string, unknown>;
      if ('contains' in operators) {
        const value = row[key];
        return (
          typeof value === 'string' &&
          typeof operators.contains === 'string' &&
          value.includes(operators.contains)
        );
      }
      throw new Error(`Unsupported where operator on "${key}" in fake DB`);
    }
    return row[key] === condition;
  });
}

function createFakeTable<T extends Row>(idField: keyof T, startId = 1) {
  const rows: T[] = [];
  let nextId = startId;

  return {
    rows,
    async findFirst(args: { where?: Row } = {}): Promise<T | null> {
      const where = args.where ?? {};
      return rows.find((row) => matchesWhere(row, where)) ?? null;
    },
    async create(args: { data: Row }): Promise<T> {
      const row = { [idField]: nextId, ...args.data } as T;
      nextId += 1;
      rows.push(row);
      return row;
    },
    async update(args: { where: Row; data: Row }): Promise<T> {
      const row = rows.find((candidate) => matchesWhere(candidate, args.where));
      if (!row) {
        throw new Error('Fake DB: row not found for update');
      }
      Object.assign(row, args.data);
      return row;
    },
  };
}

type FakeTables = {
  classes: ReturnType<typeof createFakeTable>;
  honors: ReturnType<typeof createFakeTable>;
  activity_types: ReturnType<typeof createFakeTable>;
  certifications: ReturnType<typeof createFakeTable>;
  certification_versions: ReturnType<typeof createFakeTable>;
  certification_eligibility_rules: ReturnType<typeof createFakeTable>;
  certification_modules: ReturnType<typeof createFakeTable>;
  certification_sections: ReturnType<typeof createFakeTable>;
  certification_requirement_components: ReturnType<typeof createFakeTable>;
};

type FakeDb = SeedExecutionClient & FakeTables;

function createFakeDb(): FakeDb {
  return {
    classes: createFakeTable('class_id'),
    honors: createFakeTable('honor_id'),
    activity_types: createFakeTable('activity_type_id'),
    certifications: createFakeTable('certification_id'),
    certification_versions: createFakeTable('certification_version_id'),
    certification_eligibility_rules: createFakeTable('eligibility_rule_id'),
    certification_modules: createFakeTable('module_id'),
    certification_sections: createFakeTable('section_id'),
    certification_requirement_components: createFakeTable('component_id'),
  } as unknown as FakeDb;
}

async function seedGuiaMayorClass(db: FakeDb) {
  return db.classes.create({
    data: { name: 'Guía Mayor', active: true },
  });
}

async function seedHonorsCatalog(db: FakeDb) {
  await db.honors.create({ data: { name: 'Contabilidad', active: true } });
  await db.honors.create({ data: { name: 'Anti-bullying I', active: true } });
}

async function seedActivityTypesCatalog(db: FakeDb) {
  await db.activity_types.create({
    data: { name: 'Actividad espiritual', active: true },
  });
}

const EXPECTED_MODULE_NAMES = [
  'Estilos de enseñanza',
  'Estilos de aprendizaje',
  'Necesidades especiales',
  'Valores cristianos',
  'Objetivos de investidura',
  'Aplicaciones prácticas',
  'Enseñanza de honores',
  'Disciplina',
];

const EXPECTED_SECTIONS_PER_MODULE = [2, 1, 3, 2, 2, 3, 2, 4];

describe('seedBasicPathfinderStaffTraining', () => {
  describe('with a fully populated catalog (classes + honors + activity_types)', () => {
    let db: FakeDb;

    beforeAll(async () => {
      db = createFakeDb();
      await seedGuiaMayorClass(db);
      await seedHonorsCatalog(db);
      await seedActivityTypesCatalog(db);
      await seedBasicPathfinderStaffTraining(db);
    });

    it('creates exactly one certification', () => {
      expect(db.certifications.rows).toHaveLength(1);
      expect(db.certifications.rows[0]).toMatchObject({
        name: CERTIFICATION_NAME,
      });
    });

    it('creates exactly one PUBLISHED version with the configured duration', () => {
      expect(db.certification_versions.rows).toHaveLength(1);
      expect(db.certification_versions.rows[0]).toMatchObject({
        version_number: 1,
        status: 'PUBLISHED',
        min_duration_months: 12,
        max_duration_months: 24,
      });
      expect(db.certification_versions.rows[0].published_at).toBeInstanceOf(
        Date,
      );
    });

    it('seeds the three eligibility rules (18 years, baptized, invested Guía Mayor)', () => {
      const rules = db.certification_eligibility_rules.rows;
      expect(rules).toHaveLength(3);

      const byType = Object.fromEntries(
        rules.map((rule) => [rule.rule_type, rule]),
      );
      expect(byType.MIN_AGE.configuration).toEqual({ min_age: 18 });
      expect(byType.BAPTIZED).toBeDefined();
      expect(byType.INVESTED_CLASS.class_id).toBe(db.classes.rows[0].class_id);
    });

    it('creates the 8 modules in order', () => {
      const modules = [...db.certification_modules.rows].sort(
        (a, b) => (a.sort_order as number) - (b.sort_order as number),
      );
      expect(modules).toHaveLength(8);
      expect(modules.map((module) => module.name)).toEqual(
        EXPECTED_MODULE_NAMES,
      );
    });

    it('creates exactly 19 requirements (sections) distributed as expected across modules', () => {
      expect(db.certification_sections.rows).toHaveLength(19);

      const modules = [...db.certification_modules.rows].sort(
        (a, b) => (a.sort_order as number) - (b.sort_order as number),
      );
      const sectionCountsByModule = modules.map(
        (module) =>
          db.certification_sections.rows.filter(
            (section) => section.module_id === module.module_id,
          ).length,
      );
      expect(sectionCountsByModule).toEqual(EXPECTED_SECTIONS_PER_MODULE);
    });

    it('uses every required component type at least once', () => {
      const componentTypes = new Set(
        db.certification_requirement_components.rows.map(
          (row) => row.component_type,
        ),
      );
      expect(componentTypes).toEqual(
        new Set([
          'TEXT_RESPONSE',
          'FILE_EVIDENCE',
          'LINKED_HONOR',
          'LINKED_ACTIVITY',
          'ATTESTATION',
        ]),
      );
    });

    it('restricts FILE_EVIDENCE components to image/pdf MIME types', () => {
      const fileEvidenceComponents =
        db.certification_requirement_components.rows.filter(
          (row) => row.component_type === 'FILE_EVIDENCE',
        );
      expect(fileEvidenceComponents.length).toBeGreaterThan(0);

      for (const component of fileEvidenceComponents) {
        const config = component.configuration as {
          allowed_mime_types: string[];
        };
        expect(config.allowed_mime_types).toEqual([
          ...ALLOWED_EVIDENCE_MIME_TYPES,
        ]);
        for (const mime of config.allowed_mime_types) {
          expect(mime === 'application/pdf' || mime.startsWith('image/')).toBe(
            true,
          );
        }
      }
    });

    it('links the Contabilidad and Anti-bullying I honors by FK when present in the catalog', () => {
      const linkedHonorComponents =
        db.certification_requirement_components.rows.filter(
          (row) => row.component_type === 'LINKED_HONOR',
        );
      expect(linkedHonorComponents).toHaveLength(2);
      const linkedHonorIds = linkedHonorComponents
        .map((c) => c.honor_id)
        .sort();
      const catalogHonorIds = db.honors.rows.map((h) => h.honor_id).sort();
      expect(linkedHonorIds).toEqual(catalogHonorIds);
    });

    it('does not duplicate rows when run a second time (idempotent)', async () => {
      const before = {
        certifications: db.certifications.rows.length,
        versions: db.certification_versions.rows.length,
        rules: db.certification_eligibility_rules.rows.length,
        modules: db.certification_modules.rows.length,
        sections: db.certification_sections.rows.length,
        components: db.certification_requirement_components.rows.length,
      };

      const secondReport = await seedBasicPathfinderStaffTraining(db);

      expect({
        certifications: db.certifications.rows.length,
        versions: db.certification_versions.rows.length,
        rules: db.certification_eligibility_rules.rows.length,
        modules: db.certification_modules.rows.length,
        sections: db.certification_sections.rows.length,
        components: db.certification_requirement_components.rows.length,
      }).toEqual(before);

      expect(secondReport.wasNewlyPublished).toBe(false);
      expect(secondReport.versionStatus).toBe('PUBLISHED');
      expect(secondReport.skippedHonors).toEqual([]);
    });
  });

  describe('when the Guía Mayor class is missing', () => {
    it('throws instead of seeding a broken eligibility rule', async () => {
      const db = createFakeDb();
      await seedHonorsCatalog(db);

      await expect(seedBasicPathfinderStaffTraining(db)).rejects.toThrow(
        /required class "Guía Mayor"/,
      );
    });
  });

  describe('when the Contabilidad / Anti-bullying I honors are missing from the catalog', () => {
    let db: FakeDb;
    let report: Awaited<ReturnType<typeof seedBasicPathfinderStaffTraining>>;

    beforeAll(async () => {
      db = createFakeDb();
      await seedGuiaMayorClass(db);
      // Intentionally no honors, no activity_types.
      report = await seedBasicPathfinderStaffTraining(db);
    });

    it('does not crash and reports both skipped honors', () => {
      expect(report.skippedHonors).toHaveLength(2);
      expect(
        report.skippedHonors.some((entry) => entry.includes('Contabilidad')),
      ).toBe(true);
      expect(
        report.skippedHonors.some((entry) => entry.includes('Anti-bullying I')),
      ).toBe(true);
    });

    it('falls back to TEXT_RESPONSE components instead of omitting the requirement entirely', () => {
      const linkedHonorComponents =
        db.certification_requirement_components.rows.filter(
          (row) => row.component_type === 'LINKED_HONOR',
        );
      expect(linkedHonorComponents).toHaveLength(0);

      // Every section still has at least one component (tree stays publishable).
      for (const section of db.certification_sections.rows) {
        const componentsForSection =
          db.certification_requirement_components.rows.filter(
            (row) => row.section_id === section.section_id,
          );
        expect(componentsForSection.length).toBeGreaterThan(0);
      }
    });

    it('still publishes the version', () => {
      expect(db.certification_versions.rows[0].status).toBe('PUBLISHED');
    });
  });

  describe('when no activity_types exist in the catalog', () => {
    it('reports both skipped activities and falls back to TEXT_RESPONSE', async () => {
      const db = createFakeDb();
      await seedGuiaMayorClass(db);
      await seedHonorsCatalog(db);

      const report = await seedBasicPathfinderStaffTraining(db);

      expect(report.skippedActivityTypes).toHaveLength(2);
      const linkedActivityComponents =
        db.certification_requirement_components.rows.filter(
          (row) => row.component_type === 'LINKED_ACTIVITY',
        );
      expect(linkedActivityComponents).toHaveLength(0);
    });
  });
});
