import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';
import { ConfigService } from '@nestjs/config';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const values: Record<string, unknown> = {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      PRISMA_POOL_MAX: 8,
    };
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        Object.prototype.hasOwnProperty.call(values, key)
          ? values[key]
          : defaultValue,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reports pool capacity without exposing connection credentials', () => {
    expect(service.getPoolMetrics()).toEqual({
      max: 8,
      total: 0,
      idle: 0,
      active: 0,
      waiting: 0,
      utilization: 0,
    });
  });

  it('closes the pg pool even when Prisma disconnect fails', async () => {
    const disconnectError = new Error('Prisma disconnect failed');
    jest.spyOn(service, '$disconnect').mockRejectedValue(disconnectError);

    const pool = (service as unknown as { pool: { end: () => Promise<void> } })
      .pool;
    const endSpy = jest.spyOn(pool, 'end').mockResolvedValue(undefined);

    await expect(service.onModuleDestroy()).rejects.toThrow(disconnectError);
    expect(endSpy).toHaveBeenCalledTimes(1);
  });
});
