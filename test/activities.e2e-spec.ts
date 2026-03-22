import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/common/guards';
import {
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

describe('Activities E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: ReturnType<typeof createTestJwtService>;

  const mockJwtAuthGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };
  const mockPermissionsGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeAll(async () => {
    jwtService = createTestJwtService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
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

  describe('/api/v1/clubs/:clubId/activities (GET)', () => {
    it('should return paginated list of activities', async () => {
      jest.spyOn(prisma.clubs, 'findUnique').mockResolvedValue({
        club_id: 1,
        club_sections: [],
      } as any);

      jest.spyOn(prisma.activities, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.activities, 'count').mockResolvedValue(0);

      const token = createBearerToken(jwtService, crypto.randomUUID());
      const response = await request(app.getHttpServer())
        .get('/api/v1/clubs/1/activities')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
    });
  });
});
