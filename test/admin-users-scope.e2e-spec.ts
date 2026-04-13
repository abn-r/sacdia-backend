import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PermissionsGuard } from '../src/common/guards';
import { createTestJwtService } from './helpers/rbac-test-helpers';

describe('Admin Users Scope E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const makeToken = (sub: string, email: string) =>
    jwtService.sign({ sub, email });
  const mockThrottlerGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };
  const mockPermissionsGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;

    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET || 'test-secret';

    jwtService = createTestJwtService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_GUARD)
      .useValue(mockThrottlerGuard)
      .overrideGuard(ThrottlerGuard)
      .useValue(mockThrottlerGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(mockPermissionsGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    prisma = app.get(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await new Promise((resolve) => setTimeout(resolve, 450));
  });

  it('should return 401 when no token is provided', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/users').expect(401);
  });

  it('should allow super_admin with ALL scope', async () => {
    const token = makeToken('super-1', 'super@test.com');

    jest
      .spyOn(prisma.users_roles, 'findMany')
      .mockResolvedValue([
        { roles: { role_name: 'super_admin', active: true } } as any,
      ]);
    jest.spyOn(prisma.users, 'findUnique').mockResolvedValue({
      user_id: 'super-1',
      union_id: null,
      local_field_id: null,
      users_roles: [{ roles: { role_name: 'super_admin' } }],
    } as any);
    jest.spyOn(prisma.users, 'findMany').mockResolvedValue([] as any);
    jest.spyOn(prisma.users, 'count').mockResolvedValue(0 as any);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.status).toBe('success');
    expect(response.body.data.meta.scope.type).toBe('ALL');
    expect(prisma.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('should enforce UNION scope for admin even when filters are provided', async () => {
    const token = makeToken('admin-1', 'admin@test.com');

    jest
      .spyOn(prisma.users_roles, 'findMany')
      .mockResolvedValue([
        { roles: { role_name: 'admin', active: true } } as any,
      ]);
    jest.spyOn(prisma.users, 'findUnique').mockResolvedValue({
      user_id: 'admin-1',
      union_id: 7,
      local_field_id: 99,
      users_roles: [{ roles: { role_name: 'admin' } }],
    } as any);
    jest.spyOn(prisma.users, 'findMany').mockResolvedValue([] as any);
    jest.spyOn(prisma.users, 'count').mockResolvedValue(0 as any);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users?localFieldId=123')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data.meta.scope.type).toBe('UNION');
    expect(prisma.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ union_id: 7 }, { local_field_id: 123 }],
        },
      }),
    );
  });

  it('should enforce LOCAL_FIELD scope for coordinator', async () => {
    const token = makeToken('coord-1', 'coord@test.com');

    jest
      .spyOn(prisma.users_roles, 'findMany')
      .mockResolvedValue([
        { roles: { role_name: 'coordinator', active: true } } as any,
      ]);
    jest.spyOn(prisma.users, 'findUnique').mockResolvedValue({
      user_id: 'coord-1',
      union_id: 5,
      local_field_id: 11,
      users_roles: [{ roles: { role_name: 'coordinator' } }],
    } as any);
    jest.spyOn(prisma.users, 'findMany').mockResolvedValue([] as any);
    jest.spyOn(prisma.users, 'count').mockResolvedValue(0 as any);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data.meta.scope.type).toBe('LOCAL_FIELD');
    expect(prisma.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { local_field_id: 11 },
      }),
    );
  });

  it('should return 403 for coordinator without local_field_id configured', async () => {
    const token = makeToken('coord-bad', 'coordbad@test.com');

    jest
      .spyOn(prisma.users_roles, 'findMany')
      .mockResolvedValue([
        { roles: { role_name: 'coordinator', active: true } } as any,
      ]);
    jest.spyOn(prisma.users, 'findUnique').mockResolvedValue({
      user_id: 'coord-bad',
      union_id: 5,
      local_field_id: null,
      users_roles: [{ roles: { role_name: 'coordinator' } }],
    } as any);

    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('should return 404 when requested user is outside actor scope', async () => {
    const token = makeToken('admin-2', 'admin2@test.com');

    jest
      .spyOn(prisma.users_roles, 'findMany')
      .mockResolvedValue([
        { roles: { role_name: 'admin', active: true } } as any,
      ]);
    jest.spyOn(prisma.users, 'findUnique').mockResolvedValue({
      user_id: 'admin-2',
      union_id: 4,
      local_field_id: null,
      users_roles: [{ roles: { role_name: 'admin' } }],
    } as any);
    jest.spyOn(prisma.users, 'findFirst').mockResolvedValue(null as any);

    await request(app.getHttpServer())
      .get('/api/v1/admin/users/user-outside')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(prisma.users.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ user_id: 'user-outside' }, { union_id: 4 }],
        },
      }),
    );
  });
});
