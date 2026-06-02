import { Test } from '@nestjs/testing';
import { RankingTiersService } from './ranking-tiers.service';
import { PrismaService } from '../../prisma/prisma.service';

const tierRow = {
  ranking_tier_id: '90000000-0000-4000-8000-000000000001',
  name: 'Diamante',
  slug: 'diamante',
  band_percentage: 5,
  color: '#94a3b8',
  icon: 'diamond',
  sort_order: 1,
  active: true,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

describe('RankingTiersService', () => {
  let service: RankingTiersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      ranking_tiers: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        RankingTiersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(RankingTiersService);
  });

  afterEach(() => jest.clearAllMocks());

  it('lists active ranking tiers ordered by sort order', async () => {
    prisma.ranking_tiers.findMany.mockResolvedValueOnce([tierRow]);

    const result = await service.listActive();

    expect(result).toEqual([tierRow]);
    expect(prisma.ranking_tiers.findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
  });

  it('updates a tier band percentage and keeps the tier active state explicit', async () => {
    prisma.ranking_tiers.update.mockResolvedValueOnce({
      ...tierRow,
      band_percentage: 7,
    });

    const result = await service.update(tierRow.ranking_tier_id, {
      band_percentage: 7,
      active: true,
    });

    expect(result.band_percentage).toBe(7);
    expect(prisma.ranking_tiers.update).toHaveBeenCalledWith({
      where: { ranking_tier_id: tierRow.ranking_tier_id },
      data: { band_percentage: 7, active: true },
    });
  });
});
