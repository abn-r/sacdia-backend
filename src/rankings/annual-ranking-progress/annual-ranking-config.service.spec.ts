import { Test } from '@nestjs/testing';
import { AnnualRankingConfigService } from './annual-ranking-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

const USER_ID = '104a2549-2056-4b9b-aaeb-51d8fd43191d';
const CONFIG_ID = 'f0000000-0000-4000-8000-000000000001';
const ADMIN_AXIS_ID = 'f0000000-0000-4000-8000-000000000101';
const OPERATIONAL_AXIS_ID = 'f0000000-0000-4000-8000-000000000102';

const axisDto = {
  local_field_id: 4,
  ecclesiastical_year_id: 1,
  club_type_id: 2,
  max_points: 10000,
  axes: [
    {
      axis_key: 'administrative',
      label: 'Cumplimiento Administrativo',
      max_points: 5000,
      sort_order: 1,
      components: [
        {
          component_key: 'annual_folder',
          label: 'Carpeta Anual de Evidencias',
          max_points: 3000,
          sort_order: 1,
        },
        {
          component_key: 'finance',
          label: 'Finanzas',
          max_points: 2000,
          sort_order: 2,
        },
      ],
    },
    {
      axis_key: 'operational',
      label: 'Vida Operativa del Club',
      max_points: 5000,
      sort_order: 2,
      components: [
        {
          component_key: 'camporee',
          label: 'Camporee',
          max_points: 5000,
          sort_order: 1,
        },
      ],
    },
  ],
};

const legacyFlatDto = {
  local_field_id: 4,
  ecclesiastical_year_id: 1,
  club_type_id: 2,
  max_points: 10000,
  components: [
    {
      component_key: 'annual_folder',
      label: 'Carpeta Anual de Evidencias',
      max_points: 6000,
      sort_order: 1,
    },
    {
      component_key: 'finance',
      label: 'Finanzas',
      max_points: 2000,
      sort_order: 2,
    },
    {
      component_key: 'camporee',
      label: 'Camporee',
      max_points: 2000,
      sort_order: 3,
    },
  ],
};

const configRow = {
  annual_ranking_config_id: CONFIG_ID,
  local_field_id: 4,
  ecclesiastical_year_id: 1,
  club_type_id: 2,
  max_points: 10000,
  active: true,
  created_by: USER_ID,
  updated_by: USER_ID,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
  axes: [],
  components: [],
};

const createdConfigWithAxes = {
  ...configRow,
  axes: [
    {
      annual_ranking_axis_config_id: ADMIN_AXIS_ID,
      annual_ranking_config_id: CONFIG_ID,
      axis_key: 'administrative',
      label: 'Cumplimiento Administrativo',
      max_points: 5000,
      sort_order: 1,
      active: true,
      components: [],
    },
    {
      annual_ranking_axis_config_id: OPERATIONAL_AXIS_ID,
      annual_ranking_config_id: CONFIG_ID,
      axis_key: 'operational',
      label: 'Vida Operativa del Club',
      max_points: 5000,
      sort_order: 2,
      active: true,
      components: [],
    },
  ],
};

describe('AnnualRankingConfigService', () => {
  let service: AnnualRankingConfigService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      annual_ranking_configs: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      annual_ranking_axis_configs: {
        deleteMany: jest.fn(),
      },
      annual_ranking_component_configs: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (callback) => callback(prisma)),
    };

    const module = await Test.createTestingModule({
      providers: [
        AnnualRankingConfigService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AnnualRankingConfigService);
  });

  afterEach(() => jest.clearAllMocks());

  it('rejects duplicate config for local field + year + club type', async () => {
    prisma.annual_ranking_configs.findFirst.mockResolvedValueOnce(configRow);

    await expect(
      service.create(axisDto as any, USER_ID),
    ).rejects.toBeInstanceOf(AppConflictException);

    expect(prisma.annual_ranking_configs.create).not.toHaveBeenCalled();
  });

  it('accepts equal administrative and operational axis budgets', async () => {
    prisma.annual_ranking_configs.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdConfigWithAxes);
    prisma.annual_ranking_configs.create.mockResolvedValueOnce(
      createdConfigWithAxes,
    );
    prisma.annual_ranking_component_configs.createMany.mockResolvedValueOnce({
      count: 3,
    });

    const result = await service.create(axisDto as any, USER_ID);

    expect(result).toBe(createdConfigWithAxes);
    expect(prisma.annual_ranking_configs.create).toHaveBeenCalledWith({
      data: {
        local_field_id: 4,
        ecclesiastical_year_id: 1,
        club_type_id: 2,
        max_points: 10000,
        created_by: USER_ID,
        updated_by: USER_ID,
        axes: {
          create: [
            {
              axis_key: 'administrative',
              label: 'Cumplimiento Administrativo',
              max_points: 5000,
              sort_order: 1,
            },
            {
              axis_key: 'operational',
              label: 'Vida Operativa del Club',
              max_points: 5000,
              sort_order: 2,
            },
          ],
        },
      },
      include: expect.any(Object),
    });
    expect(
      prisma.annual_ranking_component_configs.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          annual_ranking_config_id: CONFIG_ID,
          annual_ranking_axis_config_id: ADMIN_AXIS_ID,
          component_key: 'annual_evidence_folder',
          label: 'Carpeta Anual de Evidencias',
          max_points: 3000,
          sort_order: 1,
        },
        {
          annual_ranking_config_id: CONFIG_ID,
          annual_ranking_axis_config_id: ADMIN_AXIS_ID,
          component_key: 'finance_compliance',
          label: 'Finanzas',
          max_points: 2000,
          sort_order: 2,
        },
        {
          annual_ranking_config_id: CONFIG_ID,
          annual_ranking_axis_config_id: OPERATIONAL_AXIS_ID,
          component_key: 'camporee_events',
          label: 'Camporee',
          max_points: 5000,
          sort_order: 1,
        },
      ],
    });
  });

  it('rejects axis sum different from config max points', async () => {
    await expect(
      service.create(
        {
          ...axisDto,
          axes: axisDto.axes.map((axis) =>
            axis.axis_key === 'operational'
              ? { ...axis, max_points: 4000 }
              : axis,
          ),
        } as any,
        USER_ID,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_RANKING_AXIS_SUM_INVALID,
    });

    expect(prisma.annual_ranking_configs.create).not.toHaveBeenCalled();
  });

  it('rejects component sum different from axis max points', async () => {
    await expect(
      service.create(
        {
          ...axisDto,
          axes: axisDto.axes.map((axis) =>
            axis.axis_key === 'administrative'
              ? {
                  ...axis,
                  components: axis.components.map((component) =>
                    component.component_key === 'finance'
                      ? { ...component, max_points: 1000 }
                      : component,
                  ),
                }
              : axis,
          ),
        } as any,
        USER_ID,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_RANKING_AXIS_COMPONENT_SUM_INVALID,
    });

    expect(prisma.annual_ranking_configs.create).not.toHaveBeenCalled();
  });

  it('rejects unknown component keys', async () => {
    await expect(
      service.create(
        {
          ...axisDto,
          axes: [
            {
              ...axisDto.axes[0],
              components: [
                ...axisDto.axes[0].components,
                {
                  component_key: 'unknown_component',
                  label: 'Desconocido',
                  max_points: 1,
                },
              ],
            },
            axisDto.axes[1],
          ],
        } as any,
        USER_ID,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_RANKING_COMPONENT_UNKNOWN,
    });

    expect(prisma.annual_ranking_configs.create).not.toHaveBeenCalled();
  });

  it('accepts legacy flat components and persists canonical keys', async () => {
    prisma.annual_ranking_configs.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(configRow);
    prisma.annual_ranking_configs.create.mockResolvedValueOnce({
      ...configRow,
      axes: [
        { ...createdConfigWithAxes.axes[0], max_points: 8000 },
        { ...createdConfigWithAxes.axes[1], max_points: 2000 },
      ],
    });
    prisma.annual_ranking_component_configs.createMany.mockResolvedValueOnce({
      count: 3,
    });

    await service.create(legacyFlatDto as any, USER_ID);

    expect(
      prisma.annual_ranking_component_configs.createMany,
    ).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ component_key: 'annual_evidence_folder' }),
        expect.objectContaining({ component_key: 'finance_compliance' }),
        expect.objectContaining({ component_key: 'camporee_events' }),
      ]),
    });
  });

  it('rejects duplicate canonical component keys across axes', async () => {
    await expect(
      service.create(
        {
          ...axisDto,
          axes: [
            axisDto.axes[0],
            {
              ...axisDto.axes[1],
              components: [
                ...axisDto.axes[1].components,
                {
                  component_key: 'annual_evidence_folder',
                  label: 'Duplicado',
                  max_points: 1,
                },
              ],
            },
          ],
        } as any,
        USER_ID,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_RANKING_COMPONENT_DUPLICATE,
    });

    expect(prisma.annual_ranking_configs.create).not.toHaveBeenCalled();
  });

  it('resolves config by local field, year, and club type with active axes and components', async () => {
    prisma.annual_ranking_configs.findFirst.mockResolvedValueOnce(configRow);

    const result = await service.getByScope({
      localFieldId: 4,
      ecclesiasticalYearId: 1,
      clubTypeId: 2,
    });

    expect(result).toBe(configRow);
    expect(prisma.annual_ranking_configs.findFirst).toHaveBeenCalledWith({
      where: {
        local_field_id: 4,
        ecclesiastical_year_id: 1,
        club_type_id: 2,
        active: true,
      },
      include: expect.objectContaining({
        axes: expect.any(Object),
        components: expect.any(Object),
      }),
    });
  });

  it('throws not found when scoped config is missing', async () => {
    prisma.annual_ranking_configs.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.getByScope({
        localFieldId: 4,
        ecclesiasticalYearId: 1,
        clubTypeId: 2,
      }),
    ).rejects.toBeInstanceOf(AppNotFoundException);
  });

  it('lists configs with optional scope filters', async () => {
    prisma.annual_ranking_configs.findMany.mockResolvedValueOnce([configRow]);

    const result = await service.list({
      localFieldId: 4,
      ecclesiasticalYearId: 1,
      clubTypeId: 2,
    });

    expect(result).toEqual([configRow]);
    expect(prisma.annual_ranking_configs.findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        local_field_id: 4,
        ecclesiastical_year_id: 1,
        club_type_id: 2,
      },
      include: expect.objectContaining({
        axes: expect.any(Object),
        components: expect.any(Object),
      }),
      orderBy: [
        { local_field_id: 'asc' },
        { ecclesiastical_year_id: 'desc' },
        { club_type_id: 'asc' },
      ],
    });
  });

  it('updates max points and replaces axis/component budget atomically', async () => {
    prisma.annual_ranking_configs.findFirst
      .mockResolvedValueOnce(configRow)
      .mockResolvedValueOnce({ ...createdConfigWithAxes, max_points: 12000 });
    prisma.annual_ranking_configs.update.mockResolvedValueOnce({
      ...createdConfigWithAxes,
      max_points: 12000,
    });
    prisma.annual_ranking_component_configs.createMany.mockResolvedValueOnce({
      count: 3,
    });

    const updateDto = {
      max_points: 12000,
      axes: axisDto.axes.map((axis) => ({
        ...axis,
        max_points: 6000,
        components: axis.components.map((component) => ({
          ...component,
          max_points:
            axis.axis_key === 'administrative'
              ? component.component_key === 'annual_folder'
                ? 4000
                : 2000
              : 6000,
        })),
      })),
    };

    const result = await service.update(CONFIG_ID, updateDto as any, USER_ID);

    expect(result.max_points).toBe(12000);
    expect(
      prisma.annual_ranking_component_configs.deleteMany,
    ).toHaveBeenCalledWith({
      where: { annual_ranking_config_id: CONFIG_ID },
    });
    expect(prisma.annual_ranking_axis_configs.deleteMany).toHaveBeenCalledWith({
      where: { annual_ranking_config_id: CONFIG_ID },
    });
    expect(prisma.annual_ranking_configs.update).toHaveBeenCalledWith({
      where: { annual_ranking_config_id: CONFIG_ID },
      data: {
        max_points: 12000,
        updated_by: USER_ID,
        axes: {
          create: [
            {
              axis_key: 'administrative',
              label: 'Cumplimiento Administrativo',
              max_points: 6000,
              sort_order: 1,
            },
            {
              axis_key: 'operational',
              label: 'Vida Operativa del Club',
              max_points: 6000,
              sort_order: 2,
            },
          ],
        },
      },
      include: expect.any(Object),
    });
  });
});
