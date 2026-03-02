import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { createHmac } from 'crypto';
import { AppModule } from '../src/app.module';
import { SupabaseService } from '../src/common/supabase.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const mockSupabaseService = {
    admin: {
      auth: {
        admin: {
          createUser: jest.fn().mockResolvedValue({
            data: { user: { id: 'test-user-id' } },
            error: null,
          }),
          deleteUser: jest.fn().mockResolvedValue({ error: null }),
          signOut: jest.fn().mockResolvedValue({ error: null }),
        },
        signInWithPassword: jest.fn().mockResolvedValue({
          data: {
            user: { id: 'test-user-id' },
            session: {
              access_token: 'fake-jwt',
              refresh_token: 'fake-refresh',
            },
          },
          error: null,
        }),
      },
    },
    anon: {
      auth: {
        refreshSession: jest.fn().mockResolvedValue({
          data: {
            session: {
              access_token: 'fake-refreshed-jwt',
              refresh_token: 'fake-refreshed-refresh',
              expires_at: 1900000000,
              token_type: 'bearer',
            },
          },
          error: null,
        }),
      },
    },
  };

  const bootstrapApp = async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseService)
      .useValue(mockSupabaseService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    prisma = app.get(PrismaService);
    await app.init();
  };

  const createSignedJwt = (payload: Record<string, unknown>): string => {
    const secret = process.env.SUPABASE_JWT_SECRET || 'test-secret';
    const header = { alg: 'HS256', typ: 'JWT' };
    const encode = (value: Record<string, unknown>) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    const encodedHeader = encode(header);
    const encodedPayload = encode(payload);
    const signature = createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  };

  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET =
      process.env.SUPABASE_JWT_SECRET || 'test-secret';
    process.env.AUTH_REJECT_SNAKE_CASE = 'true';
    await bootstrapApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/v1/auth/login (POST)', () => {
    it('should login successfully', async () => {
      jest.spyOn(prisma.users, 'findUnique').mockResolvedValue({
        user_id: 'test-user-id',
        email: 'test@example.com',
        user_image: null,
        name: 'Test',
        paternal_last_name: 'User',
        maternal_last_name: 'E2E',
        users_pr: [],
        users_roles: [
          { roles: { role_name: 'user', role_category: 'GLOBAL' } },
        ],
      } as any);

      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('success');
          expect(res.body.data).toHaveProperty('accessToken');
          expect(res.body.data).toHaveProperty('refreshToken');
        });
    });

    it('should fail with invalid credentials', async () => {
      mockSupabaseService.admin.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'wrong@example.com', password: 'wrong' })
        .expect(401);
    });
  });

  describe('/api/v1/auth/refresh (POST)', () => {
    it('should reject legacy snake_case payload by default', async () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: 'legacy-refresh' })
        .expect(400)
        .expect((res) => {
          const code =
            res.body.details?.code ??
            res.body.code ??
            res.body.details?.message?.code;
          expect(code).toBe('LEGACY_SNAKE_CASE_REMOVED');
        });
    });

    it('should refresh and allow /auth/me after server restart', async () => {
      await app.close();
      await bootstrapApp();

      const refreshedAccessToken = createSignedJwt({
        sub: 'test-user-id',
        email: 'test@example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      mockSupabaseService.anon.auth.refreshSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: refreshedAccessToken,
            refresh_token: 'new-refresh-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'bearer',
          },
        },
        error: null,
      });

      jest.spyOn(prisma.users, 'findUnique').mockResolvedValue({
        user_id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test',
        paternal_last_name: 'User',
        maternal_last_name: 'E2E',
        gender: null,
        birthday: null,
        baptism: false,
        baptism_date: null,
        user_image: null,
        country_id: null,
        union_id: null,
        local_field_id: null,
        created_at: new Date(),
        users_pr: [{ complete: true }],
        users_roles: [
          {
            roles: {
              role_name: 'user',
              role_category: 'GLOBAL',
              role_permissions: [],
            },
          },
        ],
        club_role_assignments: [],
      } as any);

      const refreshRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'persisted-refresh-token' })
        .expect(200);

      const newAccessToken = refreshRes.body.data.accessToken;
      expect(newAccessToken).toBeTruthy();

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('success');
          expect(res.body.data.user_id).toBe('test-user-id');
        });
    });
  });
});
