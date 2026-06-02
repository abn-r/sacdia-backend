import { Test } from '@nestjs/testing';
import { RankingTiersController } from './ranking-tiers.controller';
import { RankingTiersService } from './ranking-tiers.service';

const tierRow = {
  ranking_tier_id: '90000000-0000-4000-8000-000000000001',
  name: 'Diamante',
  slug: 'diamante',
  band_percentage: 5,
  color: '#94a3b8',
  icon: 'diamond',
  sort_order: 1,
  active: true,
};

describe('RankingTiersController', () => {
  let controller: RankingTiersController;
  let service: jest.Mocked<Pick<RankingTiersService, 'listActive' | 'update'>>;

  beforeEach(async () => {
    service = {
      listActive: jest.fn(),
      update: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [RankingTiersController],
      providers: [{ provide: RankingTiersService, useValue: service }],
    })
      .overrideGuard(require('../../common/guards').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/guards').PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(RankingTiersController);
  });

  afterEach(() => jest.clearAllMocks());

  it('lists active tiers in a success envelope', async () => {
    service.listActive.mockResolvedValueOnce([tierRow] as never);

    const result = await controller.list();

    expect(result).toEqual({ status: 'success', data: [tierRow] });
    expect(service.listActive).toHaveBeenCalled();
  });

  it('updates a tier in a success envelope', async () => {
    service.update.mockResolvedValueOnce(tierRow as never);

    const result = await controller.update(tierRow.ranking_tier_id, {
      band_percentage: 7,
      active: true,
    });

    expect(result).toEqual({ status: 'success', data: tierRow });
    expect(service.update).toHaveBeenCalledWith(tierRow.ranking_tier_id, {
      band_percentage: 7,
      active: true,
    });
  });
});
