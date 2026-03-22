import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FcmTokensService } from '../src/notifications/fcm-tokens.service';
import { PermissionsGuard } from '../src/common/guards';
import { createTestJwtService } from './helpers/rbac-test-helpers';

describe('Notifications Security E2E', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const mockNotificationsService = {
    sendToUser: jest.fn().mockResolvedValue({ success: true }),
    broadcast: jest.fn().mockResolvedValue({
      success: true,
      successCount: 1,
      failureCount: 0,
    }),
    sendToClubMembers: jest.fn().mockResolvedValue({
      success: true,
      successCount: 1,
      failureCount: 0,
    }),
  };

  const mockFcmTokensService = {
    registerToken: jest.fn().mockResolvedValue({ success: true }),
    unregisterToken: jest.fn().mockResolvedValue({ success: true }),
    getUserTokens: jest.fn().mockResolvedValue([]),
  };

  const makeToken = (sub: string, email: string) =>
    jwtService.sign({ sub, email });
  const mockPermissionsGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;

    process.env.SUPABASE_JWT_SECRET =
      process.env.SUPABASE_JWT_SECRET || 'test-secret';

    jwtService = createTestJwtService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NotificationsService)
      .useValue(mockNotificationsService)
      .overrideProvider(FcmTokensService)
      .useValue(mockFcmTokensService)
      .overrideGuard(PermissionsGuard)
      .useValue(mockPermissionsGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockPermissionsGuard.canActivate.mockReturnValue(true);
  });

  it('should return 401 on protected notifications endpoint without token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/notifications/send')
      .send({ userId: 'user-1', title: 'hello', body: 'world' })
      .expect(401);
  });

  it('should return 401 on fcm token registration without token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/fcm-tokens')
      .send({ token: 'fcm-token' })
      .expect(401);
  });

  it('should allow authenticated user to register and list own tokens', async () => {
    const token = makeToken('user-1', 'user1@test.com');

    await request(app.getHttpServer())
      .post('/api/v1/fcm-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'fcm-token', device_type: 'ios' })
      .expect(201);

    expect(mockFcmTokensService.registerToken).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ token: 'fcm-token' }),
    );

    await request(app.getHttpServer())
      .get('/api/v1/fcm-tokens')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(mockFcmTokensService.getUserTokens).toHaveBeenCalledWith('user-1');
  });

  it('should return 403 for non-admin user on broadcast', async () => {
    const token = makeToken('user-2', 'user2@test.com');
    mockPermissionsGuard.canActivate.mockReturnValueOnce(false);

    await request(app.getHttpServer())
      .post('/api/v1/notifications/broadcast')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'hello', body: 'world' })
      .expect(403);
  });

  it('should allow admin user on broadcast and club notifications', async () => {
    const token = makeToken('admin-1', 'admin@test.com');

    await request(app.getHttpServer())
      .post('/api/v1/notifications/broadcast')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'hello', body: 'world' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/notifications/club/adventurers/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'club', body: 'message' })
      .expect(201);
  });
});
