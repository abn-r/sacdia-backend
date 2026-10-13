jest.mock('../config/firebase-admin.module', () => ({
  firebaseAdmin: { getApps: jest.fn(() => []), getMessaging: jest.fn() },
}));

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, Get, INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';
import { CatalogCacheService } from '../catalogs/catalog-cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { THROTTLER_TIERS } from '../config/throttler.config';
import { RedisThrottlerStorage } from '../config/redis-throttler.storage';
import { UserAwareThrottlerGuard } from '../config/user-aware-throttler.guard';
import { HealthController } from './health.controller';

const mockCreateClient = jest.fn();
jest.mock('redis', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const quotaError = Object.assign(
  new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500002'),
  { name: 'ReplyError' },
);

@Controller('probe')
class ProbeController {
  @Get()
  hit() {
    return { ok: true };
  }
}

async function createApp(storage: ThrottlerStorage): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      JwtModule.register({ secret: 'test-secret' }),
      ThrottlerModule.forRoot({
        throttlers: [...THROTTLER_TIERS],
        storage,
      }),
    ],
    controllers: [HealthController, ProbeController],
    providers: [
      { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
      { provide: ConfigService, useValue: { get: jest.fn() } },
      { provide: PrismaService, useValue: {} },
      { provide: CACHE_MANAGER, useValue: {} },
      { provide: CatalogCacheService, useValue: {} },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(GlobalRolesGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('GET /health under a failing Redis throttler', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('answers 200 and never calls the throttler storage', async () => {
    const increment = jest.fn().mockRejectedValue(quotaError);
    app = await createApp({ increment } as unknown as ThrottlerStorage);

    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(increment).not.toHaveBeenCalled();
  });

  it('control: a non-exempt route is a 500 when the storage throws and fail-open is not in place', async () => {
    const increment = jest.fn().mockRejectedValue(quotaError);
    app = await createApp({ increment } as unknown as ThrottlerStorage);

    const res = await request(app.getHttpServer()).get('/probe');

    expect(res.status).toBe(500);
    expect(increment).toHaveBeenCalled();
  });

  it('answers 200 for other routes too when the Redis storage fails open', async () => {
    const client = {
      isOpen: true,
      isReady: true,
      eval: jest.fn().mockRejectedValue(quotaError),
      on: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      quit: jest.fn(),
    };
    mockCreateClient.mockReturnValue(client);
    const storage = new RedisThrottlerStorage('redis://localhost:6379');
    app = await createApp(storage as unknown as ThrottlerStorage);

    const probe = await request(app.getHttpServer()).get('/probe');
    const health = await request(app.getHttpServer()).get('/health');

    expect(probe.status).toBe(200);
    expect(health.status).toBe(200);
    // 3 tiers on the first request fail once, then the cooldown short-circuits.
    expect(client.eval).toHaveBeenCalledTimes(1);
  });

  it('still rate limits (429) when Redis answers that the caller is over the limit', async () => {
    const client = {
      isOpen: true,
      isReady: true,
      eval: jest.fn().mockResolvedValue([4, 1000, 1, 60000]),
      on: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      quit: jest.fn(),
    };
    mockCreateClient.mockReturnValue(client);
    const storage = new RedisThrottlerStorage('redis://localhost:6379');
    app = await createApp(storage as unknown as ThrottlerStorage);

    const res = await request(app.getHttpServer()).get('/probe');

    expect(res.status).toBe(429);
  });
});
