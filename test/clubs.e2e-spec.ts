import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PermissionsGuard } from '../src/common/guards';
import {
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

describe('Clubs E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const TEST_USER_ID = 'clubs-e2e-user';

  const mockPermissionsGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeAll(async () => {
    jwtService = createTestJwtService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
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
      TEST_USER_ID,
      'clubs@test.com',
    )}`,
  });

  describe('/api/v1/clubs (GET)', () => {
    it('should return paginated list of clubs', async () => {
      jest.spyOn(prisma.clubs, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.clubs, 'count').mockResolvedValue(0);

      const response = await request(app.getHttpServer())
        .get('/api/v1/clubs')
        .set(authHeaders())
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
    });
  });

  describe('/api/v1/clubs (POST)', () => {
    it('should create a new club', async () => {
      const mockClub = {
        club_id: 1,
        name: 'Test Club',
        district_id: 1,
        active: true,
      };

      jest.spyOn(prisma.club_types, 'findMany').mockResolvedValue([
        { club_type_id: 1 },
        { club_type_id: 2 },
        { club_type_id: 3 },
      ] as never);
      jest.spyOn(prisma, '$transaction').mockImplementation(async (fn) => {
        const tx = {
          clubs: {
            create: jest.fn().mockResolvedValue(mockClub),
          },
          club_sections: {
            createMany: jest.fn().mockResolvedValue({ count: 3 }),
          },
        };
        return (fn as (client: typeof tx) => Promise<typeof mockClub>)(tx);
      });

      return request(app.getHttpServer())
        .post('/api/v1/clubs')
        .set(authHeaders())
        .send({
          name: 'Test Club',
          local_field_id: 1,
          districlub_type_id: 1,
          church_id: 1,
          enabled_club_type_ids: [1, 2],
        })
        .expect(201);
    });
  });
});
