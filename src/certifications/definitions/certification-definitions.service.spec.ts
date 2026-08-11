import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CertificationDefinitionsService } from './certification-definitions.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

const ACTOR_ID = 'actor-uuid';

const makePrismaMock = () => {
  const mock = {
    certifications: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    certification_versions: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    certification_eligibility_rules: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    certification_modules: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    certification_sections: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    certification_requirement_components: {
      create: jest.fn(),
    },
    $transaction: jest.fn((input: unknown) =>
      typeof input === 'function'
        ? (input as (tx: unknown) => unknown)(mock)
        : Promise.all(input as Promise<unknown>[]),
    ),
  };
  return mock;
};

type PrismaMock = ReturnType<typeof makePrismaMock>;

describe('CertificationDefinitionsService', () => {
  let service: CertificationDefinitionsService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificationDefinitionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CertificationDefinitionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // 1. create draft
  // ==========================================================================
  describe('createCertification', () => {
    it('creates the certification identity and an initial DRAFT version', async () => {
      prisma.certifications.create.mockResolvedValue({
        certification_id: 1,
        name: 'Guía Mayor',
        description: null,
        active: true,
      });
      prisma.certification_versions.findFirst.mockResolvedValue(null);
      prisma.certification_versions.create.mockResolvedValue({
        certification_version_id: 10,
        certification_id: 1,
        version_number: 1,
        status: 'DRAFT',
      });

      const result = await service.createCertification('Guía Mayor');

      expect(prisma.certifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Guía Mayor' }),
        }),
      );
      expect(prisma.certification_versions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            certification_id: 1,
            version_number: 1,
            status: 'DRAFT',
          }),
        }),
      );
      expect(result.version.status).toBe('DRAFT');
    });
  });

  describe('createDraftVersion', () => {
    it('creates a new DRAFT with the next version number', async () => {
      prisma.certifications.findUnique.mockResolvedValue({
        certification_id: 1,
      });
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 5,
        version_number: 2,
      });
      prisma.certification_versions.create.mockResolvedValue({
        certification_version_id: 6,
        certification_id: 1,
        version_number: 3,
        status: 'DRAFT',
      });

      const result = await service.createDraftVersion(1);

      expect(prisma.certification_versions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            certification_id: 1,
            version_number: 3,
            status: 'DRAFT',
          }),
        }),
      );
      expect(result.version_number).toBe(3);
    });

    it('throws AppNotFoundException when the certification does not exist', async () => {
      prisma.certifications.findUnique.mockResolvedValue(null);

      await expect(service.createDraftVersion(999)).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
    });
  });

  // ==========================================================================
  // 2. edit tree on draft
  // ==========================================================================
  describe('replaceModulesTree', () => {
    it('replaces the modules/sections/components tree for a DRAFT version', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 10,
        certification_id: 1,
        status: 'DRAFT',
      });
      prisma.certification_modules.findMany
        .mockResolvedValueOnce([{ module_id: 1 }])
        .mockResolvedValueOnce([
          {
            module_id: 2,
            certification_sections: [
              { section_id: 3, certification_requirement_components: [] },
            ],
          },
        ]);
      prisma.certification_modules.create.mockResolvedValue({ module_id: 2 });
      prisma.certification_sections.create.mockResolvedValue({
        section_id: 3,
      });
      prisma.certification_requirement_components.create.mockResolvedValue({
        component_id: 4,
      });

      const modules = [
        {
          name: 'Módulo 1',
          sections: [
            {
              name: 'Sección 1',
              components: [
                {
                  component_type: 'TEXT_RESPONSE' as const,
                  label: 'Describe tu experiencia',
                  configuration: { min_length: 10 },
                },
              ],
            },
          ],
        },
      ];

      await service.replaceModulesTree(1, 10, modules);

      expect(prisma.certification_sections.deleteMany).toHaveBeenCalledWith({
        where: { module_id: { in: [1] } },
      });
      expect(prisma.certification_modules.deleteMany).toHaveBeenCalledWith({
        where: { certification_version_id: 10 },
      });
      expect(prisma.certification_modules.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            certification_id: 1,
            certification_version_id: 10,
            name: 'Módulo 1',
          }),
        }),
      );
      expect(
        prisma.certification_requirement_components.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            section_id: 3,
            component_type: 'TEXT_RESPONSE',
            label: 'Describe tu experiencia',
          }),
        }),
      );
    });

    it('rejects unknown configuration keys via the parser', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 10,
        certification_id: 1,
        status: 'DRAFT',
      });

      const modules = [
        {
          name: 'Módulo 1',
          sections: [
            {
              name: 'Sección 1',
              components: [
                {
                  component_type: 'TEXT_RESPONSE' as const,
                  label: 'Describe tu experiencia',
                  configuration: { unexpected_key: true },
                },
              ],
            },
          ],
        },
      ];

      await expect(
        service.replaceModulesTree(1, 10, modules),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ==========================================================================
  // 3. clone published → new draft with copied structure
  // ==========================================================================
  describe('cloneVersion', () => {
    it('clones a PUBLISHED version tree into a new DRAFT version', async () => {
      const source = {
        certification_version_id: 5,
        certification_id: 1,
        status: 'PUBLISHED',
        title: 'v1',
        description: 'desc',
        min_duration_months: 6,
        max_duration_months: 24,
        certification_eligibility_rules: [
          {
            rule_type: 'MIN_AGE',
            configuration: { min_age: 16 },
            class_id: null,
            club_type_id: null,
            role_id: null,
            sort_order: 0,
          },
        ],
        certification_modules: [
          {
            name: 'Módulo 1',
            description: null,
            sort_order: 0,
            certification_sections: [
              {
                name: 'Sección 1',
                description: null,
                instructions: null,
                sort_order: 0,
                required: true,
                certification_requirement_components: [
                  {
                    component_type: 'TEXT_RESPONSE',
                    label: 'Label',
                    instructions: null,
                    configuration: {},
                    sort_order: 0,
                    required: true,
                    honor_id: null,
                    activity_type_id: null,
                  },
                ],
              },
            ],
          },
        ],
      };

      prisma.certification_versions.findFirst
        .mockResolvedValueOnce(source) // initial lookup
        .mockResolvedValueOnce({ version_number: 1 }); // getNextVersionNumber inside tx

      prisma.certification_versions.create.mockResolvedValue({
        certification_version_id: 20,
        certification_id: 1,
        version_number: 2,
        status: 'DRAFT',
      });
      prisma.certification_modules.create.mockResolvedValue({ module_id: 30 });
      prisma.certification_sections.create.mockResolvedValue({
        section_id: 40,
      });

      const result = await service.cloneVersion(1, 5);

      expect(prisma.certification_versions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            certification_id: 1,
            version_number: 2,
            status: 'DRAFT',
            title: 'v1',
          }),
        }),
      );
      expect(
        prisma.certification_eligibility_rules.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            certification_version_id: 20,
            rule_type: 'MIN_AGE',
          }),
        }),
      );
      expect(prisma.certification_modules.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            certification_version_id: 20,
            name: 'Módulo 1',
          }),
        }),
      );
      expect(
        prisma.certification_requirement_components.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            section_id: 40,
            component_type: 'TEXT_RESPONSE',
          }),
        }),
      );
      expect(result.status).toBe('DRAFT');
    });

    it('rejects cloning a DRAFT version', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 5,
        certification_id: 1,
        status: 'DRAFT',
        certification_eligibility_rules: [],
        certification_modules: [],
      });

      await expect(service.cloneVersion(1, 5)).rejects.toBeInstanceOf(
        AppBadRequestException,
      );
    });
  });

  // ==========================================================================
  // 4. cannot mutate published (CERT_VERSION_IMMUTABLE)
  // ==========================================================================
  describe('immutability', () => {
    it('throws AppConflictException when updating metadata on a PUBLISHED version', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 5,
        certification_id: 1,
        status: 'PUBLISHED',
      });

      await expect(
        service.updateVersionMetadata(1, 5, { title: 'New title' }),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_VERSION_IMMUTABLE });
    });

    it('throws AppConflictException when replacing eligibility rules on a RETIRED version', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 5,
        certification_id: 1,
        status: 'RETIRED',
      });

      await expect(
        service.replaceEligibilityRules(1, 5, [
          { rule_type: 'BAPTIZED', configuration: {} },
        ]),
      ).rejects.toBeInstanceOf(AppConflictException);
    });

    it('throws AppConflictException when replacing the tree on a PUBLISHED version', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 5,
        certification_id: 1,
        status: 'PUBLISHED',
      });

      await expect(service.replaceModulesTree(1, 5, [])).rejects.toBeInstanceOf(
        AppConflictException,
      );
    });
  });

  // ==========================================================================
  // 5. cannot publish without rules/modules/requirements/components
  // ==========================================================================
  describe('publishVersion validation', () => {
    it('rejects publishing without eligibility rules', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 5,
        certification_id: 1,
        status: 'DRAFT',
        certification_eligibility_rules: [],
        certification_modules: [{ module_id: 1, certification_sections: [] }],
      });

      await expect(
        service.publishVersion(1, 5, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_INCOMPLETE });
    });

    it('rejects publishing without modules', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 5,
        certification_id: 1,
        status: 'DRAFT',
        certification_eligibility_rules: [{ rule_type: 'BAPTIZED' }],
        certification_modules: [],
      });

      await expect(
        service.publishVersion(1, 5, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_INCOMPLETE });
    });

    it('rejects publishing when a module has no sections', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 5,
        certification_id: 1,
        status: 'DRAFT',
        certification_eligibility_rules: [{ rule_type: 'BAPTIZED' }],
        certification_modules: [{ module_id: 1, certification_sections: [] }],
      });

      await expect(
        service.publishVersion(1, 5, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_INCOMPLETE });
    });

    it('rejects publishing when a section has no components', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 5,
        certification_id: 1,
        status: 'DRAFT',
        certification_eligibility_rules: [{ rule_type: 'BAPTIZED' }],
        certification_modules: [
          {
            module_id: 1,
            certification_sections: [
              {
                section_id: 2,
                certification_requirement_components: [],
              },
            ],
          },
        ],
      });

      await expect(
        service.publishVersion(1, 5, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CERT_REQUIREMENT_INCOMPLETE });
    });

    it('throws AppNotFoundException when the version does not exist', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue(null);

      await expect(
        service.publishVersion(1, 999, ACTOR_ID),
      ).rejects.toBeInstanceOf(AppNotFoundException);
    });
  });

  // ==========================================================================
  // 6. publish succeeds in one transactional flow when complete
  // ==========================================================================
  describe('publishVersion success', () => {
    it('publishes a complete DRAFT and retires the previous PUBLISHED version', async () => {
      const completeVersion = {
        certification_version_id: 6,
        certification_id: 1,
        status: 'DRAFT',
        certification_eligibility_rules: [{ rule_type: 'BAPTIZED' }],
        certification_modules: [
          {
            module_id: 1,
            certification_sections: [
              {
                section_id: 2,
                certification_requirement_components: [{ component_id: 3 }],
              },
            ],
          },
        ],
      };

      prisma.certification_versions.findFirst
        .mockResolvedValueOnce(completeVersion)
        .mockResolvedValueOnce({
          certification_version_id: 5,
          certification_id: 1,
          status: 'PUBLISHED',
        });

      prisma.certification_versions.update.mockImplementation(
        ({
          where,
          data,
        }: {
          where: { certification_version_id: number };
          data: unknown;
        }) => ({
          certification_version_id: where.certification_version_id,
          ...(data as object),
        }),
      );

      const result = await service.publishVersion(1, 6, ACTOR_ID);

      expect(prisma.certification_versions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { certification_version_id: 5 },
          data: expect.objectContaining({ status: 'RETIRED' }),
        }),
      );
      expect(prisma.certification_versions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { certification_version_id: 6 },
          data: expect.objectContaining({
            status: 'PUBLISHED',
            published_by_id: ACTOR_ID,
          }),
        }),
      );
      expect(result.status).toBe('PUBLISHED');
    });

    it('publishes without retiring when there is no previous PUBLISHED version', async () => {
      const completeVersion = {
        certification_version_id: 6,
        certification_id: 1,
        status: 'DRAFT',
        certification_eligibility_rules: [{ rule_type: 'BAPTIZED' }],
        certification_modules: [
          {
            module_id: 1,
            certification_sections: [
              {
                section_id: 2,
                certification_requirement_components: [{ component_id: 3 }],
              },
            ],
          },
        ],
      };

      prisma.certification_versions.findFirst
        .mockResolvedValueOnce(completeVersion)
        .mockResolvedValueOnce(null);

      prisma.certification_versions.update.mockResolvedValue({
        certification_version_id: 6,
        status: 'PUBLISHED',
      });

      await service.publishVersion(1, 6, ACTOR_ID);

      expect(prisma.certification_versions.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('retireVersion', () => {
    it('retires a PUBLISHED version', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 6,
        certification_id: 1,
        status: 'PUBLISHED',
      });
      prisma.certification_versions.update.mockResolvedValue({
        certification_version_id: 6,
        status: 'RETIRED',
      });

      const result = await service.retireVersion(1, 6);

      expect(prisma.certification_versions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { certification_version_id: 6 },
          data: expect.objectContaining({ status: 'RETIRED' }),
        }),
      );
      expect(result.status).toBe('RETIRED');
    });

    it('rejects retiring a version that is not PUBLISHED', async () => {
      prisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: 6,
        certification_id: 1,
        status: 'DRAFT',
      });

      await expect(service.retireVersion(1, 6)).rejects.toBeInstanceOf(
        AppBadRequestException,
      );
    });
  });
});
