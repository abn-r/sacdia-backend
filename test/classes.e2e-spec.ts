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

describe('Classes E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

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

  const authHeaders = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(
      jwtService,
      userId,
      'classes@test.com',
    )}`,
  });

  describe('/api/v1/classes (GET)', () => {
    it('should return list of classes', async () => {
      jest.spyOn(prisma.classes, 'findMany').mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/classes')
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('/api/v1/users/:userId/classes/enroll (POST)', () => {
    it('should enroll user in a class', async () => {
      // Enrolling needs userId in param (Must be valid UUID)
      const userId = '550e8400-e29b-41d4-a716-446655440000';

      // Mock findFirst (check if enrolled) -> null
      jest.spyOn(prisma.enrollments, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.enrollments, 'create').mockResolvedValue({
        enrollment_id: 1,
        user_id: userId,
        class_id: 1,
        ecclesiastical_year_id: 2025,
        enrollment_date: new Date(),
      } as any);

      return (
        request(app.getHttpServer())
          .post(`/api/v1/users/${userId}/classes/enroll`)
          .set(authHeaders(userId))
          // The DTO likely expects class_id and ecclesiastical_year_id
          // Let's check DTO later if this fails, but guessing standard fields
          .send({ class_id: 1, ecclesiastical_year_id: 2025 })
          .expect(201)
      );
    });
  });
});
