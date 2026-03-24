import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PermissionsGuard } from '../src/common/guards';
import { BetterAuthService } from '../src/better-auth/better-auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

describe('Post-registration step 3 E2E', () => {
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

  const authHeaders = () => ({
    Authorization: `Bearer ${createBearerToken(
      jwtService,
      'owner-user-1',
      'owner@example.com',
    )}`,
  });

  const payload = {
    country_id: 1,
    union_id: 2,
    local_field_id: 3,
    club_section_id: 10,
    class_id: 5,
  };

  const getHttpServer = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('converges to one active annual enrollment and completes step 3', async () => {
    const tx = {
      users: { update: jest.fn().mockResolvedValue({}) },
      ecclesiastical_years: {
        findFirst: jest.fn().mockResolvedValue({
          year_id: 2026,
          start_date: new Date('2026-01-01'),
        }),
      },
      roles: {
        findFirst: jest.fn().mockResolvedValue({ role_id: 'role-member' }),
      },
      club_sections: {
        findUnique: jest.fn().mockResolvedValue({ club_section_id: 10 }),
      },
      classes: {
        findUnique: jest.fn().mockResolvedValue({ class_id: 5, active: true }),
      },
      club_role_assignments: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ assignment_id: 'assignment-1' }),
        update: jest.fn(),
      },
      enrollments: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ enrollment_id: 1001 }),
        update: jest.fn(),
      },
      users_pr: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce((callback) =>
        callback(tx as unknown as Prisma.TransactionClient),
      );

    await request(getHttpServer())
      .post('/api/v1/users/owner-user-1/post-registration/step-3/complete')
      .set(authHeaders())
      .send(payload)
      .expect(200)
      .expect((res) => {
        const body = res.body as { status: string };
        expect(body.status).toBe('success');
      });

    expect(tx.enrollments.updateMany).toHaveBeenCalledWith({
      where: {
        user_id: 'owner-user-1',
        ecclesiastical_year_id: 2026,
        active: true,
        NOT: { class_id: 5 },
      },
      data: {
        active: false,
      },
    });
    expect(tx.enrollments.create).toHaveBeenCalledWith({
      data: {
        user_id: 'owner-user-1',
        class_id: 5,
        ecclesiastical_year_id: 2026,
      },
    });
    expect(tx.users_pr.update).toHaveBeenCalled();
  });

  it('fails without active year and does not commit enrollment writes', async () => {
    const tx = {
      users: { update: jest.fn().mockResolvedValue({}) },
      ecclesiastical_years: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      roles: { findFirst: jest.fn() },
      club_sections: { findUnique: jest.fn() },
      classes: { findUnique: jest.fn() },
      club_role_assignments: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      enrollments: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      users_pr: {
        update: jest.fn(),
      },
    };

    jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce((callback) =>
        callback(tx as unknown as Prisma.TransactionClient),
      );

    await request(getHttpServer())
      .post('/api/v1/users/owner-user-1/post-registration/step-3/complete')
      .set(authHeaders())
      .send(payload)
      .expect(500);

    expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
    expect(tx.enrollments.create).not.toHaveBeenCalled();
    expect(tx.users_pr.update).not.toHaveBeenCalled();
  });
});
