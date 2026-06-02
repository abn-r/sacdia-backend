import { Test } from '@nestjs/testing';
import { AnnualRankingConfigController } from './annual-ranking-config.controller';
import { AnnualRankingConfigService } from './annual-ranking-config.service';

const USER_ID = '104a2549-2056-4b9b-aaeb-51d8fd43191d';

const configRow = {
  annual_ranking_config_id: 'f0000000-0000-4000-8000-000000000001',
  local_field_id: 4,
  ecclesiastical_year_id: 1,
  club_type_id: 2,
  max_points: 10000,
  active: true,
  components: [],
};

const dto = {
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

describe('AnnualRankingConfigController', () => {
  let controller: AnnualRankingConfigController;
  let service: jest.Mocked<
    Pick<AnnualRankingConfigService, 'list' | 'create' | 'update'>
  >;

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [AnnualRankingConfigController],
      providers: [{ provide: AnnualRankingConfigService, useValue: service }],
    })
      .overrideGuard(require('../../common/guards').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/guards').PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AnnualRankingConfigController);
  });

  afterEach(() => jest.clearAllMocks());

  it('lists configs using optional scope query filters', async () => {
    service.list.mockResolvedValueOnce([configRow] as never);

    const result = await controller.list(4, 1, 2);

    expect(result).toEqual({ status: 'success', data: [configRow], total: 1 });
    expect(service.list).toHaveBeenCalledWith({
      localFieldId: 4,
      ecclesiasticalYearId: 1,
      clubTypeId: 2,
    });
  });

  it('creates an annual ranking config using the authenticated user id', async () => {
    service.create.mockResolvedValueOnce(configRow as never);

    const result = await controller.create(dto, { user: { userId: USER_ID } });

    expect(result).toEqual({ status: 'success', data: configRow });
    expect(service.create).toHaveBeenCalledWith(dto, USER_ID);
  });

  it('updates an annual ranking config using the authenticated user id', async () => {
    service.update.mockResolvedValueOnce(configRow as never);

    const result = await controller.update(
      configRow.annual_ranking_config_id,
      { max_points: 10000, components: dto.components },
      { user: { userId: USER_ID } },
    );

    expect(result).toEqual({ status: 'success', data: configRow });
    expect(service.update).toHaveBeenCalledWith(
      configRow.annual_ranking_config_id,
      { max_points: 10000, components: dto.components },
      USER_ID,
    );
  });
});
