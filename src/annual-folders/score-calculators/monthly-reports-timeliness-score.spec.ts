import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MonthlyReportsTimelinessScoreService } from './monthly-reports-timeliness-score';

describe('MonthlyReportsTimelinessScoreService.calc', () => {
  let svc: MonthlyReportsTimelinessScoreService;
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
        MonthlyReportsTimelinessScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(MonthlyReportsTimelinessScoreService);
  });

  it('returns submitted_on_time / expected_months as percentage', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'ranking.monthly_report_deadline_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { submitted_on_time: 9n, expected_months: 12n },
    ]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(75);
  });

  it('returns 0 when the ecclesiastical year has no expected months', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce(null);
    prisma.$queryRaw.mockResolvedValueOnce([
      { submitted_on_time: 0n, expected_months: 0n },
    ]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(0);
  });

  it('caps at 100 defensively', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'ranking.monthly_report_deadline_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { submitted_on_time: 14n, expected_months: 12n },
    ]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(100);
  });

  it('falls back to deadline_day=5 when system_config is invalid', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'ranking.monthly_report_deadline_day',
      config_value: 'bad',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { submitted_on_time: 12n, expected_months: 12n },
    ]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(100);
    expect(prisma.system_config.findUnique).toHaveBeenCalledWith({
      where: { config_key: 'ranking.monthly_report_deadline_day' },
    });
  });
});
