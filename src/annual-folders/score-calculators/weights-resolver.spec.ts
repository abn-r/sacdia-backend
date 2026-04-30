import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { WeightsResolverService } from './weights-resolver';

describe('WeightsResolverService.resolve', () => {
  let svc: WeightsResolverService;
  let prisma: { ranking_weight_configs: { findUnique: jest.Mock; findFirst: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      ranking_weight_configs: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    const m = await Test.createTestingModule({
      providers: [
        WeightsResolverService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = m.get(WeightsResolverService);
  });

  it('returns club_type override when present', async () => {
    prisma.ranking_weight_configs.findUnique.mockResolvedValueOnce({
      folder_weight: 50, finance_weight: 20, camporee_weight: 20, evidence_weight: 10,
    });
    const result = await svc.resolve(1);
    expect(result).toEqual({ folder: 50, finance: 20, camporee: 20, evidence: 10, source: 'club_type_override' });
  });

  it('falls back to default global when no override', async () => {
    prisma.ranking_weight_configs.findUnique.mockResolvedValueOnce(null);
    prisma.ranking_weight_configs.findFirst.mockResolvedValueOnce({
      folder_weight: 60, finance_weight: 15, camporee_weight: 15, evidence_weight: 10,
    });
    const result = await svc.resolve(1);
    expect(result).toEqual({ folder: 60, finance: 15, camporee: 15, evidence: 10, source: 'default' });
    expect(prisma.ranking_weight_configs.findFirst).toHaveBeenCalledWith({
      where: { club_type_id: null },
    });
  });

  it('throws when default global missing (config invariant)', async () => {
    prisma.ranking_weight_configs.findUnique.mockResolvedValueOnce(null);
    prisma.ranking_weight_configs.findFirst.mockResolvedValueOnce(null);
    await expect(svc.resolve(1)).rejects.toThrow('Default global weights configuration missing');
  });
});
