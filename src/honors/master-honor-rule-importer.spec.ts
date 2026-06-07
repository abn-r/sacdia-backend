import {
  master_honor_applicability_scope_enum,
  master_honor_requirement_group_type_enum,
} from '@prisma/client';

import {
  applyMasterHonorRulesImport,
  parseMasterHonorRulesImportDocument,
  summarizeMasterHonorRulesImport,
} from './master-honor-rule-importer';

describe('master honor rule importer', () => {
  it('accepts explicit options and category count groups in the official source document', () => {
    const document = parseMasterHonorRulesImportDocument({
      version: '2026.official-draft',
      master_honors: [
        {
          master_honor_id: 2,
          name: 'Maestría en Acuática',
          philosophy:
            'Las especialidades de esta maestría enfatizan la recreación acuática.',
          notes: 'No incluye cursos introductorios de natación.',
          applicability_scope:
            master_honor_applicability_scope_enum.SELECTED_DIVISIONS,
          division_ids: [1],
          groups: [
            {
              group_type:
                master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
              title: 'Lista oficial',
              minimum_required: 2,
              options: [
                {
                  label: 'Natación III',
                  honor_ids: [10, 11],
                },
                {
                  label: 'Kayaks',
                  honor_ids: [12],
                },
              ],
            },
            {
              group_type:
                master_honor_requirement_group_type_enum.CATEGORY_COUNT,
              title: 'Categoría complementaria',
              minimum_required: 2,
              honors_category_id: 4,
            },
          ],
        },
      ],
    });

    expect(document.master_honors).toHaveLength(1);
    expect(document.master_honors[0].groups).toHaveLength(2);
    expect(summarizeMasterHonorRulesImport(document)).toEqual({
      masterHonorCount: 1,
      groupCount: 2,
      optionCount: 2,
      equivalentHonorCount: 3,
      selectedDivisionCount: 1,
    });
  });

  it('rejects unsafe documents that could wipe rules or infer requirements implicitly', () => {
    expect(() =>
      parseMasterHonorRulesImportDocument({
        version: '2026.official-draft',
        master_honors: [
          {
            groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
                minimum_required: 1,
                options: [{ honor_ids: [12] }],
              },
            ],
          },
        ],
      }),
    ).toThrow('master_honors[0].name is required');

    expect(() =>
      parseMasterHonorRulesImportDocument({
        version: '2026.official-draft',
        master_honors: [
          {
            name: 'Maestría sin alcance',
            groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
                minimum_required: 1,
                options: [{ label: 'Kayaks', honor_ids: [12] }],
              },
            ],
          },
        ],
      }),
    ).toThrow('master_honors[0].applicability_scope must be one of');

    expect(() =>
      parseMasterHonorRulesImportDocument({
        version: '2026.official-draft',
        master_honors: [
          {
            name: 'Maestría con opción inválida',
            applicability_scope: master_honor_applicability_scope_enum.ALL,
            groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
                minimum_required: 1,
                options: [{ honor_ids: [12] }],
              },
            ],
          },
        ],
      }),
    ).toThrow('master_honors[0].groups[0].options[0].label is required');

    expect(() =>
      parseMasterHonorRulesImportDocument({
        version: '2026.official-draft',
        master_honors: [
          {
            name: 'Maestría sin reglas',
            applicability_scope: master_honor_applicability_scope_enum.ALL,
            groups: [],
          },
        ],
      }),
    ).toThrow('master_honors[0].groups must contain at least one group');

    expect(() =>
      parseMasterHonorRulesImportDocument({
        version: '2026.official-draft',
        master_honors: [
          {
            name: 'Maestría con categoría inválida',
            applicability_scope: master_honor_applicability_scope_enum.ALL,
            groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.CATEGORY_COUNT,
                minimum_required: 1,
                options: [{ label: 'No permitido', honor_ids: [1] }],
              },
            ],
          },
        ],
      }),
    ).toThrow('CATEGORY_COUNT groups require honors_category_id');

    expect(() =>
      parseMasterHonorRulesImportDocument({
        version: '2026.official-draft',
        master_honors: [
          {
            name: 'Maestría con mínimo imposible',
            applicability_scope: master_honor_applicability_scope_enum.ALL,
            groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
                minimum_required: 2,
                options: [{ label: 'Kayaks', honor_ids: [12] }],
              },
            ],
          },
        ],
      }),
    ).toThrow(
      'minimum_required cannot exceed active option count (1) for EXPLICIT_OPTIONS',
    );
  });

  it('rejects duplicate master honors and duplicate equivalent honors', () => {
    expect(() =>
      parseMasterHonorRulesImportDocument({
        version: '2026.official-draft',
        master_honors: [
          {
            master_honor_id: 2,
            name: 'Maestría en Acuática',
            applicability_scope: master_honor_applicability_scope_enum.ALL,
            groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
                minimum_required: 1,
                options: [{ label: 'Kayaks', honor_ids: [12] }],
              },
            ],
          },
          {
            master_honor_id: 2,
            name: 'Maestría duplicada',
            applicability_scope: master_honor_applicability_scope_enum.ALL,
            groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
                minimum_required: 1,
                options: [{ label: 'Remo', honor_ids: [13] }],
              },
            ],
          },
        ],
      }),
    ).toThrow('Duplicate master_honor_id: 2');

    expect(() =>
      parseMasterHonorRulesImportDocument({
        version: '2026.official-draft',
        master_honors: [
          {
            name: 'Maestría en Acuática',
            applicability_scope: master_honor_applicability_scope_enum.ALL,
            groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
                minimum_required: 1,
                options: [{ label: 'Natación III', honor_ids: [10, 10] }],
              },
            ],
          },
        ],
      }),
    ).toThrow('duplicate honor_id 10');
  });

  it('dry-run validates references without mutating master honor rules', async () => {
    const document = parseMasterHonorRulesImportDocument({
      version: '2026.official-draft',
      master_honors: [
        {
          master_honor_id: 2,
          name: 'Maestría en Acuática',
          applicability_scope: master_honor_applicability_scope_enum.ALL,
          groups: [
            {
              group_type:
                master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
              minimum_required: 1,
              options: [{ label: 'Kayaks', honor_ids: [12] }],
            },
          ],
        },
      ],
    });
    const tx = {
      divisions: { findMany: jest.fn().mockResolvedValue([]) },
      honors_categories: { findMany: jest.fn().mockResolvedValue([]) },
      honors: { findMany: jest.fn().mockResolvedValue([{ honor_id: 12 }]) },
      master_honors: {
        findUnique: jest.fn().mockResolvedValue({ master_honor_id: 2 }),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      master_honor_divisions: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      master_honor_requirement_groups: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    } as any;

    const result = await applyMasterHonorRulesImport(prisma, document, {
      apply: false,
      allowCreate: false,
    });

    expect(result).toMatchObject({
      mode: 'dry-run',
      createCount: 0,
      updateCount: 1,
      affectedMasterHonorIds: [2],
    });
    expect(tx.master_honors.update).not.toHaveBeenCalled();
    expect(tx.master_honor_divisions.deleteMany).not.toHaveBeenCalled();
    expect(
      tx.master_honor_requirement_groups.deleteMany,
    ).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxWait: 15_000,
        timeout: 60_000,
      }),
    );
  });

  it('dry-run rejects category count groups that require more active honors than the catalog has', async () => {
    const document = parseMasterHonorRulesImportDocument({
      version: '2026.official-draft',
      master_honors: [
        {
          master_honor_id: 3,
          name: 'Maestría de Actividades agrícolas',
          applicability_scope: master_honor_applicability_scope_enum.ALL,
          groups: [
            {
              group_type:
                master_honor_requirement_group_type_enum.CATEGORY_COUNT,
              minimum_required: 7,
              honors_category_id: 4,
            },
          ],
        },
      ],
    });
    const tx = {
      divisions: { findMany: jest.fn().mockResolvedValue([]) },
      honors_categories: {
        findMany: jest.fn().mockResolvedValue([{ honor_category_id: 4 }]),
      },
      honors: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(6),
      },
      master_honors: {
        findUnique: jest.fn().mockResolvedValue({ master_honor_id: 3 }),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      master_honor_divisions: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      master_honor_requirement_groups: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    } as any;

    await expect(
      applyMasterHonorRulesImport(prisma, document, {
        apply: false,
        allowCreate: false,
      }),
    ).rejects.toThrow(
      'requires 7 active honors from honors_category_id 4, but only 6 exist',
    );
    expect(tx.master_honors.update).not.toHaveBeenCalled();
    expect(
      tx.master_honor_requirement_groups.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('apply reports generated ids when creating master honors without source ids', async () => {
    const document = parseMasterHonorRulesImportDocument({
      version: '2026.official-draft',
      master_honors: [
        {
          name: 'Maestría nueva',
          applicability_scope: master_honor_applicability_scope_enum.ALL,
          groups: [
            {
              group_type:
                master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
              minimum_required: 1,
              options: [{ label: 'Kayaks', honor_ids: [12] }],
            },
          ],
        },
      ],
    });
    const tx = {
      divisions: { findMany: jest.fn().mockResolvedValue([]) },
      honors_categories: { findMany: jest.fn().mockResolvedValue([]) },
      honors: { findMany: jest.fn().mockResolvedValue([{ honor_id: 12 }]) },
      master_honors: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ master_honor_id: 9 }),
        update: jest.fn(),
      },
      master_honor_divisions: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      master_honor_requirement_groups: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    } as any;

    const result = await applyMasterHonorRulesImport(prisma, document, {
      apply: true,
      allowCreate: true,
    });

    expect(result).toMatchObject({
      mode: 'apply',
      createCount: 1,
      updateCount: 0,
      affectedMasterHonorIds: [9],
    });
    expect(tx.master_honors.create).toHaveBeenCalled();
    expect(tx.master_honor_requirement_groups.create).toHaveBeenCalled();
  });
});
