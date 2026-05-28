import { Test } from '@nestjs/testing';
import { AnnualRankingConfigService } from './annual-ranking-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../../common/errors/app.exception';

const USER_ID = '104a2549-2056-4b9b-aaeb-51d8fd43191d';

const validDto = {
  local_field_id: 4,
  ecclesiastical_year_id: 1,
  club_type_id: 2,
  max_points: 10000,
  components: [
    {
      component_key: 'annual_folder',
      label: 'Carpeta anual',
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
  annual_ranking_config_id: 'f0000000-0000-4000-8000-000000000001',
  local_field_id: 4,
  ecclesiastical_year_id: 1,
  club_type_id: 2,
  max_points: 10000,
  active: true,
  created_by: USER_ID,
  updated_by: USER_ID,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
  components: [],
};

describe('AnnualRankingConfigService', () => {
  let service: AnnualRankingConfigService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      annual_ranking_configs: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      annual_ranking_component_configs: {
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

    await expect(service.create(validDto, USER_ID)).rejects.toBeInstanceOf(
      AppConflictException,
    );

    expect(prisma.annual_ranking_configs.create).not.toHaveBeenCalled();
  });

  it('rejects component sum different from max_points', async () => {
    prisma.annual_ranking_configs.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.create(
        {
          ...validDto,
          components: [
            {
              component_key: 'annual_folder',
              label: 'Carpeta anual',
              max_points: 5000,
            },
          ],
        },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(AppBadRequestException);

    expect(prisma.annual_ranking_configs.create).not.toHaveBeenCalled();
  });

  it('creates config and nested components when validations pass', async () => {
    prisma.annual_ranking_configs.findFirst.mockResolvedValueOnce(null);
    prisma.annual_ranking_configs.create.mockResolvedValueOnce(configRow);

    const result = await service.create(validDto, USER_ID);

    expect(result).toBe(configRow);
    expect(prisma.annual_ranking_configs.create).toHaveBeenCalledWith({
      data: {
        local_field_id: 4,
        ecclesiastical_year_id: 1,
        club_type_id: 2,
        max_points: 10000,
        created_by: USER_ID,
        updated_by: USER_ID,
        components: {
          create: [
            {
              component_key: 'annual_folder',
              label: 'Carpeta anual',
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
        },
      },
      include: {
        components: {
          orderBy: [{ sort_order: 'asc' }, { component_key: 'asc' }],
        },
      },
    });
  });

  it('resolves config by local field, year, and club type with active components', async () => {
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
      include: {
        components: {
          where: { active: true },
          orderBy: [{ sort_order: 'asc' }, { component_key: 'asc' }],
        },
      },
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
});
