import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceScoreService } from './finance-score';

describe('FinanceScoreService.calc', () => {
  let svc: FinanceScoreService;
  let prisma: {
    $queryRaw: jest.Mock;
    system_config: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      system_config: { findUnique: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        FinanceScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(FinanceScoreService);
  });

  it('returns 100 when 12 months closed on time with default deadline (5)', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'ranking.finance_closing_deadline_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([{ count: 12n }]);
    const result = await svc.calc(42, 2026);
    expect(result).toBe(100);
  });

  it('returns 0 when no months closed', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'ranking.finance_closing_deadline_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([{ count: 0n }]);
    const result = await svc.calc(42, 2026);
    expect(result).toBe(0);
  });

  it('returns 50 when 6 months closed on time', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'ranking.finance_closing_deadline_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([{ count: 6n }]);
    const result = await svc.calc(42, 2026);
    expect(result).toBe(50);
  });

  it('caps at 100 if count somehow exceeds 12 (defensive)', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'ranking.finance_closing_deadline_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([{ count: 15n }]);
    const result = await svc.calc(42, 2026);
    expect(result).toBe(100);
  });

  it('falls back to deadline_day=5 when system_config key missing', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce(null);
    prisma.$queryRaw.mockResolvedValueOnce([{ count: 12n }]);
    const result = await svc.calc(42, 2026);
    expect(result).toBe(100);
    expect(prisma.system_config.findUnique).toHaveBeenCalledWith({
      where: { config_key: 'ranking.finance_closing_deadline_day' },
    });
  });

  it('falls back to deadline_day=5 when system_config value is not numeric', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'ranking.finance_closing_deadline_day',
      config_value: 'not-a-number',
    });
    prisma.$queryRaw.mockResolvedValueOnce([{ count: 12n }]);
    const result = await svc.calc(42, 2026);
    expect(result).toBe(100);
  });
});
