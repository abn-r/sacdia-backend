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
import { SeverityLevel } from '../src/users/dto/update-user-medical.dto';

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
    it('should return active allergies with severity as a flat success envelope', async () => {
      jest
        .spyOn(prisma.users, 'findUnique')
        .mockResolvedValueOnce({ user_id: 'test-user-id' } as any);
      jest.spyOn(prisma.users_allergies, 'findMany').mockResolvedValue([
        {
          allergy_id: 1,
          severity: SeverityLevel.leve,
          allergies: { name: 'Polen' },
        },
        {
          allergy_id: 3,
          severity: SeverityLevel.alta,
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
              { allergy_id: 1, name: 'Polen', severity: SeverityLevel.leve },
              { allergy_id: 3, name: 'Mariscos', severity: SeverityLevel.alta },
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
    it('should return active diseases with since_year as a flat success envelope', async () => {
      jest
        .spyOn(prisma.users, 'findUnique')
        .mockResolvedValueOnce({ user_id: 'test-user-id' } as any);
      jest.spyOn(prisma.users_diseases, 'findMany').mockResolvedValue([
        {
          disease_id: 2,
          since_year: 2015,
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
            data: [{ disease_id: 2, name: 'Asma', since_year: 2015 }],
          });
        });
    });
  });

  describe('/api/v1/users/:userId/medicines (GET)', () => {
    it('should return active medicines with dose as a flat success envelope', async () => {
      jest
        .spyOn(prisma.users, 'findUnique')
        .mockResolvedValueOnce({ user_id: 'test-user-id' } as any);
      jest.spyOn(prisma.users_medicines, 'findMany').mockResolvedValue([
        {
          medicine_id: 3,
          dose: '5 mg cada 8 hs',
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
            data: [
              { medicine_id: 3, name: 'Ibuprofeno', dose: '5 mg cada 8 hs' },
            ],
          });
        });
    });
  });

  // ── PUT /allergies — new shape accepted; legacy shape rejected ──────────────

  describe('/api/v1/users/:userId/allergies (PUT)', () => {
    it('should accept new shape and return updated list with severity', async () => {
      jest
        .spyOn(prisma.users, 'findUnique')
        .mockResolvedValueOnce({ user_id: 'test-user-id' } as any);
      jest
        .spyOn(prisma.allergies, 'findMany')
        .mockResolvedValue([{ allergy_id: 1 }] as any);
      jest.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) =>
        cb({
          users_allergies: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([
              {
                allergy_id: 1,
                severity: SeverityLevel.alta,
                allergies: { name: 'Polen' },
              },
            ]),
          },
        }),
      );

      return request(app.getHttpServer())
        .put('/api/v1/users/test-user-id/allergies')
        .set(authHeaders())
        .send({ allergies: [{ id: 1, severity: SeverityLevel.alta }] })
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('success');
          expect(res.body.data[0]).toMatchObject({
            allergy_id: 1,
            severity: SeverityLevel.alta,
          });
        });
    });

    it('should reject legacy { allergy_ids } shape with 400 (S8)', async () => {
      return request(app.getHttpServer())
        .put('/api/v1/users/test-user-id/allergies')
        .set(authHeaders())
        .send({ allergy_ids: [1, 2] })
        .expect(400);
    });
  });

  // ── PUT /diseases — new shape accepted; legacy shape rejected ───────────────

  describe('/api/v1/users/:userId/diseases (PUT)', () => {
    it('should accept new shape with since_year', async () => {
      jest
        .spyOn(prisma.users, 'findUnique')
        .mockResolvedValueOnce({ user_id: 'test-user-id' } as any);
      jest
        .spyOn(prisma.diseases, 'findMany')
        .mockResolvedValue([{ disease_id: 5 }] as any);
      jest.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) =>
        cb({
          users_diseases: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([
              {
                disease_id: 5,
                since_year: 2018,
                diseases: { name: 'Asma' },
              },
            ]),
          },
        }),
      );

      return request(app.getHttpServer())
        .put('/api/v1/users/test-user-id/diseases')
        .set(authHeaders())
        .send({ diseases: [{ id: 5, since_year: 2018 }] })
        .expect(200)
        .expect((res) => {
          expect(res.body.data[0]).toMatchObject({
            disease_id: 5,
            since_year: 2018,
          });
        });
    });

    it('should reject legacy { disease_ids } shape with 400', async () => {
      return request(app.getHttpServer())
        .put('/api/v1/users/test-user-id/diseases')
        .set(authHeaders())
        .send({ disease_ids: [5] })
        .expect(400);
    });
  });

  // ── PUT /medicines — new shape accepted; legacy shape rejected ──────────────

  describe('/api/v1/users/:userId/medicines (PUT)', () => {
    it('should accept new shape with dose', async () => {
      jest
        .spyOn(prisma.users, 'findUnique')
        .mockResolvedValueOnce({ user_id: 'test-user-id' } as any);
      jest
        .spyOn(prisma.medicines, 'findMany')
        .mockResolvedValue([{ medicine_id: 7 }] as any);
      jest.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) =>
        cb({
          users_medicines: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([
              {
                medicine_id: 7,
                dose: '5 mg cada 8 hs',
                medicines: { name: 'Ibuprofeno' },
              },
            ]),
          },
        }),
      );

      return request(app.getHttpServer())
        .put('/api/v1/users/test-user-id/medicines')
        .set(authHeaders())
        .send({ medicines: [{ id: 7, dose: '5 mg cada 8 hs' }] })
        .expect(200)
        .expect((res) => {
          expect(res.body.data[0]).toMatchObject({
            medicine_id: 7,
            dose: '5 mg cada 8 hs',
          });
        });
    });

    it('should reject legacy { medicine_ids } shape with 400', async () => {
      return request(app.getHttpServer())
        .put('/api/v1/users/test-user-id/medicines')
        .set(authHeaders())
        .send({ medicine_ids: [7] })
        .expect(400);
    });
  });
});
