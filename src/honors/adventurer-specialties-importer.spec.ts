import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  analyzeAdventurerSpecialtiesImport,
  applyAdventurerSpecialtiesImport,
  buildAdventurerSpecialtyAssetKeys,
  buildHonorCode,
  parseAdventurerSpecialtiesCsv,
  parseAdventurerSpecialtyAssetManifest,
  parseRequirementsFromMarkdown,
  validateAdventurerSpecialtyAssetManifest,
  validateAdventurerSpecialtyRows,
  type AdventurerSpecialtiesPrismaClient,
  type AdventurerSpecialtiesPrismaReader,
  type AdventurerSpecialtyCsvRow,
} from './adventurer-specialties-importer';

const DATASET_PATH = path.resolve(
  __dirname,
  '../../../docs/working/aventureros-especialidades/index.csv',
);

const CSV_HEADERS = [
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
].join(',');

function validRow(
  overrides: Partial<AdventurerSpecialtyCsvRow> = {},
): AdventurerSpecialtyCsvRow {
  return {
    slug: 'corderitos-alimentos-sanos',
    title: 'Alimentos sanos',
    adventurer_level: 'Corderito (preescolar)',
    level_order: 'preescolar',
    source_scope: 'Asociación General',
    source_kind: 'pdf',
    requirements_detected: '4',
    pdf: '/tmp/aventureros-especialidades/pdf/corderitos-alimentos-sanos.pdf',
    md: '/tmp/aventureros-especialidades/md/corderitos-alimentos-sanos.md',
    raw_txt: '/tmp/aventureros-especialidades/raw/corderitos-alimentos-sanos.txt',
    image: '/tmp/aventureros-especialidades/images/corderitos-alimentos-sanos.png',
    image_width: '962',
    image_height: '952',
    source_page: 'https://www.guiasmayores.com/especialidades-de-corderitos.html',
    source_url:
      'https://www.guiasmayores.com/uploads/1/1/3/1/1131412/aventureros_alimentos_sanos.pdf',
    image_url:
      'https://www.guiasmayores.com/uploads/1/1/3/1/1131412/alimentos-sanos_orig.png',
    error: '',
    ...overrides,
  };
}

function toCsv(rows: AdventurerSpecialtyCsvRow[]): string {
  return [
    CSV_HEADERS,
    ...rows.map((row) =>
      CSV_HEADERS.split(',')
        .map((header) => row[header as keyof AdventurerSpecialtyCsvRow])
        .join(','),
    ),
  ].join('\n');
}

describe('Adventurer specialties importer', () => {
  it('parses the scraped CSV with 175 Asociación General rows', async () => {
    const content = await fs.readFile(DATASET_PATH, 'utf8');
    const rows = parseAdventurerSpecialtiesCsv(content);

    expect(rows).toHaveLength(175);
    expect(rows[0]).toMatchObject({
      slug: 'corderitos-alimentos-sanos',
      title: 'Alimentos sanos',
      source_scope: 'Asociación General',
    });
  });

  it('builds stable Adventurer honor codes from source slugs', async () => {
    const content = await fs.readFile(DATASET_PATH, 'utf8');
    const rows = parseAdventurerSpecialtiesCsv(content);

    expect(
      buildHonorCode(
        rows.find((row) => row.slug === 'corderitos-alimentos-sanos')!,
      ),
    ).toBe('ADV-CORDERITOS-ALIMENTOS-SANOS');
    expect(
      buildHonorCode(
        rows.find((row) => row.slug === 'castorcitos-amigos-de-la-biblia')!,
      ),
    ).toBe('ADV-CASTORCITOS-AMIGOS-DE-LA-BIBLIA');
    expect(
      buildHonorCode(
        rows.find((row) => row.slug === 'abejita-industriosa-lectura-i')!,
      ),
    ).toBe('ADV-ABEJITA-INDUSTRIOSA-LECTURA-I');
  });

  it('allows duplicate display names when generated codes differ', () => {
    const validation = validateAdventurerSpecialtyRows([
      validRow({
        slug: 'corderitos-amigos-de-la-biblia',
        title: 'Amigos de la Biblia',
      }),
      validRow({
        slug: 'castorcitos-amigos-de-la-biblia',
        title: 'Amigos de la Biblia',
        adventurer_level: 'Castorcito (jardín de infantes)',
      }),
    ]);

    expect(validation.errors).toEqual([]);
    expect(validation.displayNameCollisions).toEqual([
      {
        name: 'Amigos de la Biblia',
        codes: [
          'ADV-CASTORCITOS-AMIGOS-DE-LA-BIBLIA',
          'ADV-CORDERITOS-AMIGOS-DE-LA-BIBLIA',
        ],
      },
    ]);
  });

  it('reports missing image_url, source_url and markdown path as dry-run errors', () => {
    const validation = validateAdventurerSpecialtyRows([
      validRow({
        image_url: '',
        source_url: '',
        md: '',
      }),
    ]);

    expect(validation.missingAssets).toBe(1);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'image_url' }),
        expect.objectContaining({ field: 'source_url' }),
        expect.objectContaining({ field: 'md' }),
      ]),
    );
  });

  it('builds dedicated Adventurer asset keys under existing honors buckets', () => {
    expect(
      buildAdventurerSpecialtyAssetKeys('ADV-CORDERITOS-ALIMENTOS-SANOS'),
    ).toEqual({
      imageKey: 'adventurers/images/ADV-CORDERITOS-ALIMENTOS-SANOS.png',
      materialKey: 'adventurers/materials/ADV-CORDERITOS-ALIMENTOS-SANOS.pdf',
    });
  });

  it('parses and validates a complete SACDIA-controlled asset manifest', () => {
    const manifest = parseAdventurerSpecialtyAssetManifest({
      'ADV-CORDERITOS-ALIMENTOS-SANOS': {
        imageUrl:
          'https://assets.sacdia.test/honors/adventurers/images/ADV-CORDERITOS-ALIMENTOS-SANOS.png',
        materialUrl:
          'https://materials.sacdia.test/honors/adventurers/materials/ADV-CORDERITOS-ALIMENTOS-SANOS.pdf',
      },
    });

    const errors = validateAdventurerSpecialtyAssetManifest(
      [validRow()],
      manifest,
      {
        required: true,
        allowedAssetBaseUrls: {
          imageBaseUrls: ['https://assets.sacdia.test'],
          materialBaseUrls: ['https://materials.sacdia.test'],
        },
      },
    );

    expect(errors).toEqual([]);
  });

  it('requires a complete asset manifest in apply mode', () => {
    const missingManifestErrors = validateAdventurerSpecialtyAssetManifest(
      [validRow()],
      undefined,
      { required: true },
    );
    const incompleteManifestErrors = validateAdventurerSpecialtyAssetManifest(
      [validRow()],
      {
        'ADV-CORDERITOS-ALIMENTOS-SANOS': {
          imageUrl: 'https://assets.sacdia.test/image.png',
          materialUrl: '',
        },
      },
      { required: true },
    );

    expect(missingManifestErrors).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('Asset manifest is required'),
      }),
    ]);
    expect(incompleteManifestErrors).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('materialUrl is required'),
      }),
    ]);
  });

  it('rejects source-domain manifest URLs when SACDIA R2 bases are required', () => {
    const errors = validateAdventurerSpecialtyAssetManifest(
      [validRow()],
      {
        'ADV-CORDERITOS-ALIMENTOS-SANOS': {
          imageUrl:
            'https://www.guiasmayores.com/uploads/1/1/3/1/1131412/alimentos-sanos_orig.png',
          materialUrl:
            'https://www.guiasmayores.com/uploads/1/1/3/1/1131412/aventureros_alimentos_sanos.pdf',
        },
      },
      {
        required: true,
        allowedAssetBaseUrls: {
          imageBaseUrls: ['https://assets.sacdia.test'],
          materialBaseUrls: ['https://materials.sacdia.test'],
        },
      },
    );

    expect(errors).toHaveLength(2);
    expect(errors[0].message).toContain('configured SACDIA R2 public URL');
    expect(errors[1].message).toContain('configured SACDIA R2 public URL');
  });

  it('parses numbered requirements under the detected requirements heading', () => {
    const requirements = parseRequirementsFromMarkdown(`
# Especialidad de Aventureros — Demo

## Requisitos detectados

1. Leer el material base.
2. Completar una actividad.
   Continuación de la actividad.

## Observaciones

- No debe leerse como requisito.
`);

    expect(requirements).toEqual([
      {
        requirement_number: 1,
        requirement_text: 'Leer el material base.',
      },
      {
        requirement_number: 2,
        requirement_text: 'Completar una actividad. Continuación de la actividad.',
      },
    ]);
  });

  it('runs dry-run analysis with DB reads only', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'adventurer-importer-'),
    );
    const mdDir = path.join(tempDir, 'md');
    await fs.mkdir(mdDir, { recursive: true });
    await fs.writeFile(
      path.join(mdDir, 'corderitos-alimentos-sanos.md'),
      `
## Requisitos detectados

1. Comer frutas.
2. Tomar agua.
`,
    );

    const datasetPath = path.join(tempDir, 'index.csv');
    await fs.writeFile(
      datasetPath,
      toCsv([
        validRow({
          md: path.join(tempDir, 'md', 'corderitos-alimentos-sanos.md'),
        }),
      ]),
    );

    const forbiddenWrite = jest.fn(() => {
      throw new Error('Dry-run must not write to DB');
    });
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
      club_types: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ club_type_id: 1, name: 'Aventureros' }),
        create: forbiddenWrite,
        update: forbiddenWrite,
        upsert: forbiddenWrite,
      },
      classes: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ class_id: 10, name: 'Corderitos' }]),
        create: forbiddenWrite,
        update: forbiddenWrite,
        upsert: forbiddenWrite,
      },
      honors: {
        findMany: jest.fn().mockResolvedValue([]),
        create: forbiddenWrite,
        update: forbiddenWrite,
        upsert: forbiddenWrite,
      },
    } as unknown as AdventurerSpecialtiesPrismaReader;

    const result = await analyzeAdventurerSpecialtiesImport(prisma, {
      datasetPath,
    });

    expect(result).toMatchObject({
      rowsRead: 1,
      newHonors: 1,
      existingHonorsByCode: 0,
      classLinksToCreate: 1,
      requirementsToCreateOrUpdate: 2,
      errors: [],
    });
    expect(forbiddenWrite).not.toHaveBeenCalled();
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('information_schema.columns'),
    );
    expect(prisma.club_types.findFirst).toHaveBeenCalledWith({
      where: { name: 'Aventureros' },
      select: { club_type_id: true, name: true },
    });
    expect(prisma.classes.findMany).toHaveBeenCalledWith({
      where: { club_types: { name: 'Aventureros' } },
      select: { class_id: true, name: true },
    });
    expect(prisma.honors.findMany).toHaveBeenCalledWith({
      where: { code: { in: ['ADV-CORDERITOS-ALIMENTOS-SANOS'] } },
      select: { honor_id: true, code: true, name: true },
    });

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('fails dry-run preflight when the database has not applied honors.code migration', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'adventurer-importer-'),
    );
    const mdDir = path.join(tempDir, 'md');
    await fs.mkdir(mdDir, { recursive: true });
    await fs.writeFile(
      path.join(mdDir, 'corderitos-alimentos-sanos.md'),
      `
## Requisitos detectados

1. Comer frutas.
`,
    );

    const datasetPath = path.join(tempDir, 'index.csv');
    await fs.writeFile(
      datasetPath,
      toCsv([
        validRow({
          md: path.join(tempDir, 'md', 'corderitos-alimentos-sanos.md'),
        }),
      ]),
    );

    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: false }]),
      club_types: {
        findFirst: jest.fn(),
      },
      classes: {
        findMany: jest.fn(),
      },
      honors: {
        findMany: jest.fn(),
      },
    } as unknown as AdventurerSpecialtiesPrismaReader;

    const result = await analyzeAdventurerSpecialtiesImport(prisma, {
      datasetPath,
    });

    expect(result.errors).toEqual([
      expect.objectContaining({
        field: 'code',
        message: expect.stringContaining('honors.code'),
      }),
    ]);
    expect(prisma.club_types.findFirst).not.toHaveBeenCalled();
    expect(prisma.honors.findMany).not.toHaveBeenCalled();

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('maps Manitas Ayudadoras as Manos Ayudadoras and skips Multinivel class links', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'adventurer-importer-'),
    );
    const mdDir = path.join(tempDir, 'md');
    await fs.mkdir(mdDir, { recursive: true });
    await fs.writeFile(
      path.join(mdDir, 'manitas-ayudadoras-demo.md'),
      '## Requisitos detectados\n\n1. Ayudar en casa.\n',
    );
    await fs.writeFile(
      path.join(mdDir, 'multinivel-demo.md'),
      '## Requisitos detectados\n\n1. Participar.\n',
    );

    const datasetPath = path.join(tempDir, 'index.csv');
    await fs.writeFile(
      datasetPath,
      toCsv([
        validRow({
          slug: 'manitas-ayudadoras-demo',
          title: 'Demo Manitas',
          adventurer_level: 'Manitas Ayudadoras',
          level_order: 'grado-4',
          md: path.join(tempDir, 'md', 'manitas-ayudadoras-demo.md'),
        }),
        validRow({
          slug: 'multinivel-demo',
          title: 'Demo Multinivel',
          adventurer_level: 'Multinivel',
          level_order: 'multinivel',
          md: path.join(tempDir, 'md', 'multinivel-demo.md'),
        }),
      ]),
    );

    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
      club_types: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ club_type_id: 1, name: 'Aventureros' }),
      },
      classes: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ class_id: 60, name: 'Manos Ayudadoras' }]),
      },
      honors: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as AdventurerSpecialtiesPrismaReader;

    const result = await analyzeAdventurerSpecialtiesImport(prisma, {
      datasetPath,
    });

    expect(result.classLinksToCreate).toBe(1);
    expect(result.warnings).toEqual([]);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('maps source Castorcitos and Rayito de Sol labels to existing SACDIA class names', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'adventurer-importer-'),
    );
    const mdDir = path.join(tempDir, 'md');
    await fs.mkdir(mdDir, { recursive: true });
    await fs.writeFile(
      path.join(mdDir, 'castorcitos-demo.md'),
      '## Requisitos detectados\n\n1. Participar con alegría.\n',
    );
    await fs.writeFile(
      path.join(mdDir, 'rayito-de-sol-demo.md'),
      '## Requisitos detectados\n\n1. Ayudar a un amigo.\n',
    );

    const datasetPath = path.join(tempDir, 'index.csv');
    await fs.writeFile(
      datasetPath,
      toCsv([
        validRow({
          slug: 'castorcitos-demo',
          title: 'Demo Castorcitos',
          adventurer_level: 'Castorcito (jardín de infantes)',
          level_order: 'jardin',
          md: path.join(tempDir, 'md', 'castorcitos-demo.md'),
        }),
        validRow({
          slug: 'rayito-de-sol-demo',
          title: 'Demo Rayito',
          adventurer_level: 'Rayito de Sol',
          level_order: 'grado-2',
          md: path.join(tempDir, 'md', 'rayito-de-sol-demo.md'),
        }),
      ]),
    );

    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
      club_types: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ club_type_id: 1, name: 'Aventureros' }),
      },
      classes: {
        findMany: jest.fn().mockResolvedValue([
          { class_id: 20, name: 'Aves Madrugadoras' },
          { class_id: 40, name: 'Rayos de Sol' },
        ]),
      },
      honors: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as AdventurerSpecialtiesPrismaReader;

    const result = await analyzeAdventurerSpecialtiesImport(prisma, {
      datasetPath,
    });

    expect(result.classLinksToCreate).toBe(2);
    expect(result.warnings).toEqual([]);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('applies one Adventurer specialty idempotently through transactional upserts', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'adventurer-importer-'),
    );
    const mdDir = path.join(tempDir, 'md');
    await fs.mkdir(mdDir, { recursive: true });
    await fs.writeFile(
      path.join(mdDir, 'corderitos-alimentos-sanos.md'),
      `
## Requisitos detectados

1. Comer frutas.
2. Tomar agua.
`,
    );

    const datasetPath = path.join(tempDir, 'index.csv');
    await fs.writeFile(
      datasetPath,
      toCsv([
        validRow({
          md: path.join(tempDir, 'md', 'corderitos-alimentos-sanos.md'),
        }),
      ]),
    );

    const tx = {
      honors: {
        upsert: jest
          .fn()
          .mockResolvedValue({ honor_id: 100, code: 'ADV-CORDERITOS-ALIMENTOS-SANOS' }),
      },
      honor_club_types: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      class_honors: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      honor_requirements: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
      $transaction: jest.fn(async (callback) => callback(tx)),
      club_types: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ club_type_id: 1, name: 'Aventureros' }),
      },
      classes: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ class_id: 10, name: 'Corderitos' }]),
      },
      honors: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      honors_categories: {
        upsert: jest
          .fn()
          .mockResolvedValue({ honor_category_id: 20, name: 'Aventureros' }),
      },
    } as unknown as AdventurerSpecialtiesPrismaClient;

    const result = await applyAdventurerSpecialtiesImport(prisma, {
      datasetPath,
      assetManifest: {
        'ADV-CORDERITOS-ALIMENTOS-SANOS': {
          imageUrl:
            'https://assets.sacdia.test/honors/adventurers/images/ADV-CORDERITOS-ALIMENTOS-SANOS.png',
          materialUrl:
            'https://materials.sacdia.test/honors/adventurers/materials/ADV-CORDERITOS-ALIMENTOS-SANOS.pdf',
        },
      },
    });

    expect(result).toMatchObject({
      mode: 'apply',
      honorsCreated: 1,
      honorsUpdated: 0,
      honorClubTypesUpserted: 1,
      classLinksUpserted: 1,
      requirementsUpserted: 2,
      requirementsDeactivated: 0,
    });
    expect(prisma.honors_categories.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: 'Aventureros' },
      }),
    );
    expect(tx.honors.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'ADV-CORDERITOS-ALIMENTOS-SANOS' },
      }),
    );
    expect(tx.honor_requirements.upsert).toHaveBeenCalledTimes(2);
    expect(tx.honor_requirements.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          honor_id: 100,
          requirement_number: { notIn: [1, 2] },
        }),
      }),
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
