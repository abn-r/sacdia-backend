import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivitiesRegisteredScoreService } from './activities-registered-score';

describe('ActivitiesRegisteredScoreService.calc', () => {
  let svc: ActivitiesRegisteredScoreService;
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
        ActivitiesRegisteredScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(ActivitiesRegisteredScoreService);
  });

  it('returns registered activities divided by configurable target', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'ranking.activities_registered_target',
      config_value: '12',
    });
    prisma.$queryRaw.mockResolvedValueOnce([{ registered: 8n }]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(66.67);
  });

  it('caps at 100 when activity count exceeds target', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'ranking.activities_registered_target',
      config_value: '12',
    });
    prisma.$queryRaw.mockResolvedValueOnce([{ registered: 15n }]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(100);
  });

  it('falls back to target=12 when system_config is missing or invalid', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce(null);
    prisma.$queryRaw.mockResolvedValueOnce([{ registered: 6n }]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(50);
    expect(prisma.system_config.findUnique).toHaveBeenCalledWith({
      where: { config_key: 'ranking.activities_registered_target' },
    });
  });
});
