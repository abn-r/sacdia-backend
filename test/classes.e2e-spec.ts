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

  interface ClassesListResponse {
    data: unknown[];
  }

  interface ProgressResponse {
    enrollment_id: number;
  }

  type ProgressTransactionMock = {
    class_section_progress: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    class_module_progress: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
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

  beforeEach(() => {
    jest.restoreAllMocks();
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

      const body = response.body as ClassesListResponse;

      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
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

  describe('/api/v1/users/:userId/classes/:classId/progress', () => {
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    const progressPath = `/api/v1/users/${userId}/classes/1/progress`;

    const mockClassDetail = () => {
      jest.spyOn(prisma.classes, 'findUnique').mockResolvedValue({
        class_id: 1,
        name: 'Amigo',
        class_modules: [
          {
            module_id: 10,
            name: 'Modulo 1',
            class_sections: [
              { section_id: 100, name: 'Seccion 1' },
              { section_id: 101, name: 'Seccion 2' },
            ],
          },
        ],
      } as any);
    };

    it('returns enrollment-owned progress for a single active enrollment', async () => {
      mockClassDetail();
      jest
        .spyOn(prisma.ecclesiastical_years, 'findFirst')
        .mockResolvedValue({ year_id: 2026 } as any);
      jest.spyOn(prisma.enrollments, 'findMany').mockResolvedValue([
        {
          enrollment_id: 2001,
          user_id: userId,
          class_id: 1,
          ecclesiastical_year_id: 2026,
        },
      ] as any);
      jest.spyOn(prisma.class_section_progress, 'findMany').mockResolvedValue([
        {
          enrollment_id: 2001,
          module_id: 10,
          section_id: 100,
          score: 90,
          evidences: null,
        },
      ] as any);

      const response = await request(app.getHttpServer())
        .get(progressPath)
        .set(authHeaders(userId))
        .expect(200);

      const body = response.body as ProgressResponse;

      expect(body.enrollment_id).toBe(2001);
    });

    it('returns 404 when no active enrollment exists for the active year', async () => {
      mockClassDetail();
      jest
        .spyOn(prisma.ecclesiastical_years, 'findFirst')
        .mockResolvedValue({ year_id: 2026 } as any);
      jest.spyOn(prisma.enrollments, 'findMany').mockResolvedValue([] as any);

      await request(app.getHttpServer())
        .get(progressPath)
        .set(authHeaders(userId))
        .expect(404);
    });

    it('returns 409 when class-scoped resolution is ambiguous', async () => {
      mockClassDetail();
      jest
        .spyOn(prisma.ecclesiastical_years, 'findFirst')
        .mockResolvedValue({ year_id: 2026 } as any);
      jest
        .spyOn(prisma.enrollments, 'findMany')
        .mockResolvedValue([
          { enrollment_id: 2001 },
          { enrollment_id: 2002 },
        ] as any);

      await request(app.getHttpServer())
        .get(progressPath)
        .set(authHeaders(userId))
        .expect(409);
    });

    it('writes progress to distinct enrollment owners when explicit overrides differ', async () => {
      mockClassDetail();
      const findUniqueSpy = jest
        .spyOn(prisma.enrollments, 'findUnique')
        .mockResolvedValueOnce({
          enrollment_id: 3001,
          user_id: userId,
          class_id: 1,
          ecclesiastical_year_id: 2025,
        } as any)
        .mockResolvedValueOnce({
          enrollment_id: 3002,
          user_id: userId,
          class_id: 1,
          ecclesiastical_year_id: 2026,
        } as any);
      const txMock: ProgressTransactionMock = {
        class_section_progress: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({
            section_progress_id: 1,
            enrollment_id: 3001,
          }),
          update: jest.fn(),
          findMany: jest.fn().mockResolvedValue([{ score: 75 }]),
        },
        class_module_progress: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ module_progress_id: 1 }),
          update: jest.fn(),
        },
      };
      const transactionSpy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(
          (callback: (tx: ProgressTransactionMock) => Promise<unknown>) =>
            callback(txMock),
        );

      await request(app.getHttpServer())
        .patch(progressPath)
        .set(authHeaders(userId))
        .send({
          module_id: 10,
          section_id: 100,
          score: 75,
          enrollment_id: 3001,
        })
        .expect(200);

      await request(app.getHttpServer())
        .patch(progressPath)
        .set(authHeaders(userId))
        .send({
          module_id: 10,
          section_id: 100,
          score: 80,
          enrollment_id: 3002,
        })
        .expect(200);

      const firstFindUniqueCall = findUniqueSpy.mock.calls[0]?.[0] as {
        where: { enrollment_id: number };
      };
      const secondFindUniqueCall = findUniqueSpy.mock.calls[1]?.[0] as {
        where: { enrollment_id: number };
      };

      expect(firstFindUniqueCall.where.enrollment_id).toBe(3001);
      expect(secondFindUniqueCall.where.enrollment_id).toBe(3002);
      expect(transactionSpy).toHaveBeenCalledTimes(2);
    });
  });
});
