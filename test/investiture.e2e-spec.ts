import {
  CanActivate,
  ExecutionContext,
  Injectable,
  INestApplication,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { useE2ePermissionsPassthrough } from './helpers/rbac-test-helpers';
import { accessJwtClaims } from '../src/common/constants/jwt-audiences';
import {
  JwtAuthGuard,
  PermissionsGuard,
  GlobalRolesGuard,
  ClubRolesGuard,
} from '../src/common/guards';
import { InvestitureService } from '../src/investiture/investiture.service';
import { RETIRED_LEGACY_INVESTITURE_ROUTES } from '../src/investiture/legacy-investiture-pipeline-retired';

const TEST_USER = {
  sub: 'investiture-user-1',
  email: 'investiture@test.local',
  ...accessJwtClaims(),
};

@Injectable()
class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = TEST_USER;
    return true;
  }
}

@Injectable()
class MockGlobalRolesGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class MockClubRolesGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class MockPermissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.authorization = {
      grants: { global_roles: [], club_assignments: [] },
      active_assignment: { assignment_id: null },
      effective: { permissions: [], scope: { global: {}, club: null } },
    };
    return true;
  }
}

@Injectable()
class MockThrottlerGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('Investiture E2E', () => {
  useE2ePermissionsPassthrough();
  let app: INestApplication;
  let jwtService: JwtService;

  const mockInvestitureService = {
    getHistory: jest.fn(),
  };

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;

    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET || 'test-secret';

    jwtService = new JwtService({ secret: process.env.BETTER_AUTH_SECRET });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(InvestitureService)
      .useValue(mockInvestitureService)
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .overrideGuard(GlobalRolesGuard)
      .useClass(MockGlobalRolesGuard)
      .overrideGuard(ClubRolesGuard)
      .useClass(MockClubRolesGuard)
      .overrideGuard(PermissionsGuard)
      .useClass(MockPermissionsGuard)
      .overrideProvider(APP_GUARD)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useClass(MockThrottlerGuard)
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
  });

  beforeEach(async () => {
    // Small delay to avoid rate limiting (throttler is set to 3 requests per second)
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  const authHeaders = () => ({
    Authorization: `Bearer ${jwtService.sign(TEST_USER)}`,
  });

  // ============================================================
  // GET /enrollments/:enrollmentId/investiture-history
  // ============================================================

  describe('GET /api/v1/enrollments/:enrollmentId/investiture-history', () => {
    const historyFixture = {
      enrollment_id: 101,
      history: [
        {
          history_id: 1,
          action: 'SUBMITTED',
          performed_by: { name: 'Juan', paternal_last_name: 'García' },
          comments: 'Todos los requisitos completados.',
          created_at: new Date('2026-04-01T10:00:00.000Z'),
        },
        {
          history_id: 2,
          action: 'APPROVED',
          performed_by: { name: 'Carlos', paternal_last_name: 'Pérez' },
          comments: null,
          created_at: new Date('2026-04-10T12:00:00.000Z'),
        },
      ],
    };

    it('admin/coordinator can view any enrollment history', async () => {
      mockInvestitureService.getHistory.mockResolvedValue(historyFixture);

      const response = await request(app.getHttpServer())
        .get('/api/v1/enrollments/101/investiture-history')
        .set(authHeaders())
        .expect(200);

      expect(response.body).toEqual({
        status: 'success',
        data: expect.objectContaining({
          enrollment_id: 101,
          history: expect.arrayContaining([
            expect.objectContaining({ action: 'SUBMITTED' }),
            expect.objectContaining({ action: 'APPROVED' }),
          ]),
        }),
      });

      expect(mockInvestitureService.getHistory).toHaveBeenCalledWith(
        101,
        TEST_USER.sub,
      );
    });

    it('enrollment owner can view their own history (service enforces auth)', async () => {
      mockInvestitureService.getHistory.mockResolvedValue({
        enrollment_id: 202,
        history: [],
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/enrollments/202/investiture-history')
        .set(authHeaders())
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.enrollment_id).toBe(202);
    });

    it('unauthorized user — service throws ForbiddenException → 403', async () => {
      mockInvestitureService.getHistory.mockRejectedValue(
        new ForbiddenException('Sin acceso al historial de este enrollment'),
      );

      await request(app.getHttpServer())
        .get('/api/v1/enrollments/303/investiture-history')
        .set(authHeaders())
        .expect(403);
    });

    it('enrollment not found — service throws NotFoundException → 404', async () => {
      mockInvestitureService.getHistory.mockRejectedValue(
        new NotFoundException('Enrollment no encontrado'),
      );

      await request(app.getHttpServer())
        .get('/api/v1/enrollments/9999/investiture-history')
        .set(authHeaders())
        .expect(404);
    });
  });

  describe('retired legacy pipeline (fase 8)', () => {
    it.each(
      RETIRED_LEGACY_INVESTITURE_ROUTES.map(
        (route) => [route.method, route.path] as const,
      ),
    )('%s /api/v1/%s answers 410', async (method, path) => {
      const url = `/api/v1/${path
        .replace(':enrollmentId', '42')
        .replace(':configId', '7')}`;
      const agent = request(app.getHttpServer());
      const call =
        method === 'GET'
          ? agent.get(url)
          : method === 'POST'
            ? agent.post(url)
            : method === 'PATCH'
              ? agent.patch(url)
              : agent.delete(url);
      const res = await call
        .set(authHeaders())
        .send({ action: 'invest', enrollment_ids: [42], comments: 'x' });

      expect(res.status).toBe(410);
      expect(res.body.code).toBe('INVESTITURE_LEGACY_PIPELINE_RETIRED');
      expect(mockInvestitureService.getHistory).not.toHaveBeenCalled();
    });
  });
});
