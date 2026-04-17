import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BetterAuthService } from '../src/better-auth/better-auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PermissionsGuard } from '../src/common/guards';
import {
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

describe('Users E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const mockBetterAuthService = {
    signInWithPassword: jest.fn(),
    refreshSession: jest.fn(),
    signOut: jest.fn(),
    createUser: jest.fn(),
    signJwt: jest.fn().mockReturnValue('fake-jwt'),
    resetPasswordForEmail: jest.fn(),
    updatePasswordById: jest.fn(),
    getOAuthUrl: jest.fn(),
    handleOAuthCallback: jest.fn(),
    enrollTotp: jest.fn(),
    verifyTotp: jest.fn(),
    disableTotp: jest.fn(),
    hasTotpEnabled: jest.fn().mockResolvedValue({ enabled: false }),
  };

  const mockPermissionsGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeAll(async () => {
    jwtService = createTestJwtService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BetterAuthService)
      .useValue(mockBetterAuthService)
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

  const authHeaders = () => ({
    Authorization: `Bearer ${createBearerToken(
      jwtService,
      'test-user-id',
      'test@example.com',
    )}`,
  });

  describe('/api/v1/users/:userId (GET)', () => {
    it('should return user info', async () => {
      jest.spyOn(prisma.users, 'findUnique').mockResolvedValue({
        user_id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test',
        paternal_last_name: 'User',
      } as any);

      return request(app.getHttpServer())
        .get('/api/v1/users/test-user-id')
        .set(authHeaders())
        .expect(200)
        .expect((res) => {
          const body = res.body as {
            status: string;
            data: { email: string };
          };

          expect(body.status).toBe('success');
          expect(body.data.email).toBe('test@example.com');
        });
    });
  });

  describe('/api/v1/users/:userId/allergies (GET)', () => {
    it('should return active allergies as a flat success envelope', async () => {
      jest
        .spyOn(prisma.users, 'findUnique')
        .mockResolvedValueOnce({ user_id: 'test-user-id' } as any);
      jest.spyOn(prisma.users_allergies, 'findMany').mockResolvedValue([
        {
          allergy_id: 1,
          allergies: { name: 'Polen' },
        },
        {
          allergy_id: 3,
          allergies: { name: 'Mariscos' },
        },
      ] as any);

      return request(app.getHttpServer())
        .get('/api/v1/users/test-user-id/allergies')
        .set(authHeaders())
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({
            status: 'success',
            data: [
              { allergy_id: 1, name: 'Polen' },
              { allergy_id: 3, name: 'Mariscos' },
            ],
          });
        });
    });

    it('should return an empty list for an existing user without active allergies', async () => {
      jest
        .spyOn(prisma.users, 'findUnique')
        .mockResolvedValueOnce({ user_id: 'test-user-id' } as any);
      jest
        .spyOn(prisma.users_allergies, 'findMany')
        .mockResolvedValue([] as any);

      return request(app.getHttpServer())
        .get('/api/v1/users/test-user-id/allergies')
        .set(authHeaders())
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({
            status: 'success',
            data: [],
          });
        });
    });

    it('should return 404 when the user does not exist', async () => {
      jest.spyOn(prisma.users, 'findUnique').mockResolvedValueOnce(null as any);

      return request(app.getHttpServer())
        .get('/api/v1/users/missing-user/allergies')
        .set(authHeaders())
        .expect(404);
    });
  });

  describe('/api/v1/users/:userId/diseases (GET)', () => {
    it('should return active diseases as a flat success envelope', async () => {
      jest
        .spyOn(prisma.users, 'findUnique')
        .mockResolvedValueOnce({ user_id: 'test-user-id' } as any);
      jest.spyOn(prisma.users_diseases, 'findMany').mockResolvedValue([
        {
          disease_id: 2,
          diseases: { name: 'Asma' },
        },
      ] as any);

      return request(app.getHttpServer())
        .get('/api/v1/users/test-user-id/diseases')
        .set(authHeaders())
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({
            status: 'success',
            data: [{ disease_id: 2, name: 'Asma' }],
          });
        });
    });
  });

  describe('/api/v1/users/:userId/medicines (GET)', () => {
    it('should return active medicines as a flat success envelope', async () => {
      jest
        .spyOn(prisma.users, 'findUnique')
        .mockResolvedValueOnce({ user_id: 'test-user-id' } as any);
      jest.spyOn(prisma.users_medicines, 'findMany').mockResolvedValue([
        {
          medicine_id: 3,
          medicines: { name: 'Ibuprofeno' },
        },
      ] as any);

      return request(app.getHttpServer())
        .get('/api/v1/users/test-user-id/medicines')
        .set(authHeaders())
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({
            status: 'success',
            data: [{ medicine_id: 3, name: 'Ibuprofeno' }],
          });
        });
    });
  });
});
