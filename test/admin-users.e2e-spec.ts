import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import request, { type Response } from 'supertest';
import type { AdminUsersService } from '../src/admin/admin-users.service';
import { AppModule } from '../src/app.module';
import { PermissionsGuard } from '../src/common/guards';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../src/common/services/authorization-context.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  buildAuthorizationSnapshot,
  createTestJwtService,
  useE2ePermissionsPassthrough,
} from './helpers/rbac-test-helpers';

describe('Admin Users Detail E2E', () => {
  useE2ePermissionsPassthrough();
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  type AdminUserDetailResponse = {
    status: string;
    data: Awaited<ReturnType<AdminUsersService['getUserById']>>;
  };

  type UsersFindUniqueResult = Awaited<
    ReturnType<PrismaService['users']['findUnique']>
  >;
  type UsersFindFirstResult = Awaited<
    ReturnType<PrismaService['users']['findFirst']>
  >;
  type EcclesiasticalYearFindFirstResult = Awaited<
    ReturnType<PrismaService['ecclesiastical_years']['findFirst']>
  >;
  type EnrollmentsFindManyResult = Awaited<
    ReturnType<PrismaService['enrollments']['findMany']>
  >;

  const makeToken = (sub: string, email: string) =>
    jwtService.sign({ sub, email });
  const mockThrottlerGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };
  const mockPermissionsGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  const getHttpServer = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const getResponseBody = (response: Response): AdminUserDetailResponse =>
    response.body as AdminUserDetailResponse;

  const buildResolvedAuthorization = (
    globalPermissions: string[],
  ): ResolvedAuthorizationProfile => ({
    profile: {
      user_id: 'admin-1',
      email: 'admin@test.com',
      name: 'Admin',
      paternal_last_name: 'Tester',
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      user_image: null,
      country_id: null,
      union_id: 2,
      local_field_id: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    },
    post_register_complete: false,
    authorization: buildAuthorizationSnapshot({
      globalPermissions,
      globalRoleName: 'admin',
      unionId: 2,
    }),
    legacy: {
      roles: ['admin'],
      permissions: globalPermissions,
      club: null,
      club_context: {
        active_assignment_id: null,
        active: null,
        available: [],
      },
    },
  });

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

  const actorRecord = {
    user_id: 'admin-1',
    union_id: 2,
    local_field_id: null,
    users_roles: [{ roles: { role_name: 'admin' } }],
  };

  const userDetailRecord = {
    user_id: 'user-1',
    email: 'user1@example.com',
    name: 'Maria',
    paternal_last_name: 'Lopez',
    maternal_last_name: 'Diaz',
    gender: 'Femenino',
    birthday: new Date('2010-10-01'),
    blood: 'A_POSITIVE',
    baptism: false,
    baptism_date: null,
    user_image: null,
    active: true,
    access_app: true,
    access_panel: false,
    country_id: 1,
    union_id: 2,
    local_field_id: 3,
    created_at: new Date('2026-01-01'),
    modified_at: new Date('2026-01-05'),
    countries: { country_id: 1, name: 'Mexico' },
    unions: { union_id: 2, name: 'UMS' },
    local_fields: { local_field_id: 3, union_id: 2, name: 'Campo Sur' },
    users_roles: [{ role_id: 'r1', roles: { role_name: 'user' } }],
    users_pr: [
      {
        complete: false,
        profile_picture_complete: true,
        personal_info_complete: false,
        club_selection_complete: false,
        date_completed: null,
      },
    ],
    enrollments: [],
    club_role_assignments: [],
    emergency_contact: [
      {
        emergency_id: 91,
        name: 'Ana Tutor',
        phone: '555-1111',
        primary: true,
        relationship_type_id: 4,
      },
    ],
    legal_representative: {
      id: 41,
      representative_user_id: null,
      relationship_type_id: 8,
      name: 'Carlos',
      paternal_last_name: 'Tutor',
      maternal_last_name: 'Perez',
      phone: '555-2222',
    },
    users_allergies: [
      {
        allergy_id: 1,
        allergies: { name: 'Peanuts' },
      },
    ],
    users_diseases: [
      {
        disease_id: 2,
        diseases: { name: 'Asthma' },
      },
    ],
    users_medicines: [
      {
        medicine_id: 3,
        medicines: { name: 'Salbutamol' },
      },
    ],
  };

  const buildTrajectoryEnrollment = () => ({
    enrollment_id: 55,
    class_id: 9,
    ecclesiastical_year_id: 2025,
    advanced_status: false,
    active: true,
    enrollment_date: new Date('2025-01-10T00:00:00.000Z'),
    investiture_status: 'INVESTED',
    investiture_date: new Date('2025-11-10T00:00:00.000Z'),
    classes: {
      name: 'Explorador',
    },
    ecclesiastical_year: {
      start_date: new Date('2025-01-01T00:00:00.000Z'),
      end_date: new Date('2025-12-31T00:00:00.000Z'),
    },
  });

  const buildEnrollmentCandidate = (enrollmentId: number) => ({
    enrollment_id: enrollmentId,
    ecclesiastical_year_id: 2026,
    class_id: 7,
    enrollment_date: new Date('2026-01-05T10:00:00.000Z'),
    investiture_status: 'IN_PROGRESS',
    submitted_for_validation: false,
    submitted_at: null,
    validated_by: null,
    validated_at: null,
    rejection_reason: null,
    investiture_date: null,
    advanced_status: false,
    locked_for_validation: false,
    cross_type_enrollment: false,
    active: true,
    classes: {
      name: 'Amigo',
    },
  });

  function mockScopedDetailLookup() {
    jest.spyOn(prisma.users, 'findUnique').mockResolvedValue(actorRecord);
    jest.spyOn(prisma.users, 'findFirst').mockResolvedValue(userDetailRecord);
    jest
      .spyOn(prisma.ecclesiastical_years, 'findFirst')
      .mockResolvedValue(null);
    jest
      .spyOn(prisma.enrollments, 'findMany')
      .mockResolvedValue([] as EnrollmentsFindManyResult);
  }

  it('should return only the permitted fine-grained block when using family permissions', async () => {
    const token = makeToken('admin-1', 'admin@test.com');

    mockScopedDetailLookup();
    jest
      .spyOn(AuthorizationContextService.prototype, 'resolveUserAuthorization')
      .mockResolvedValue(buildResolvedAuthorization(['health:read']));

    const response = await request(getHttpServer())
      .get('/api/v1/admin/users/user-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = getResponseBody(response);

    expect(body.data.health).toEqual({
      blood: 'A_POSITIVE',
      allergies: [{ allergy_id: 1, name: 'Peanuts' }],
      diseases: [{ disease_id: 2, name: 'Asthma' }],
      medicines: [{ medicine_id: 3, name: 'Salbutamol' }],
    });
    expect(body.data.emergency_contacts).toBeNull();
    expect(body.data.legal_representative).toBeNull();
    expect(body.data.post_registration).toBeNull();
  });

  it('should keep transitional legacy compatibility for users:read_detail', async () => {
    const token = makeToken('admin-1', 'admin@test.com');

    mockScopedDetailLookup();
    jest
      .spyOn(AuthorizationContextService.prototype, 'resolveUserAuthorization')
      .mockResolvedValue(buildResolvedAuthorization(['users:read_detail']));

    const response = await request(getHttpServer())
      .get('/api/v1/admin/users/user-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = getResponseBody(response);

    expect(body.data.health).toEqual({
      blood: 'A_POSITIVE',
      allergies: [{ allergy_id: 1, name: 'Peanuts' }],
      diseases: [{ disease_id: 2, name: 'Asthma' }],
      medicines: [{ medicine_id: 3, name: 'Salbutamol' }],
    });
    expect(body.data.emergency_contacts).toHaveLength(1);
    expect(body.data.legal_representative).toEqual({
      id: 41,
      representative_user_id: null,
      relationship_type_id: 8,
      name: 'Carlos',
      paternal_last_name: 'Tutor',
      maternal_last_name: 'Perez',
      phone: '555-2222',
    });
    expect(body.data.post_registration).toEqual({
      complete: false,
      profile_picture_complete: true,
      personal_info_complete: false,
      club_selection_complete: false,
      date_completed: null,
    });
  });

  it('should prune sensitive blocks when the actor lacks fine and legacy detail permissions', async () => {
    const token = makeToken('admin-1', 'admin@test.com');

    mockScopedDetailLookup();
    jest
      .spyOn(AuthorizationContextService.prototype, 'resolveUserAuthorization')
      .mockResolvedValue(buildResolvedAuthorization(['users:read']));

    const response = await request(getHttpServer())
      .get('/api/v1/admin/users/user-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = getResponseBody(response);

    expect(body.data.health).toBeNull();
    expect(body.data.emergency_contacts).toBeNull();
    expect(body.data.legal_representative).toBeNull();
    expect(body.data.post_registration).toBeNull();
  });

  it('should expose transitional formative fields from the correct sources', async () => {
    const token = makeToken('admin-1', 'admin@test.com');

    mockScopedDetailLookup();
    jest.spyOn(prisma.ecclesiastical_years, 'findFirst').mockResolvedValue({
      year_id: 2026,
    });
    jest
      .spyOn(prisma.enrollments, 'findMany')
      .mockResolvedValue([buildEnrollmentCandidate(9001)] as unknown);
    jest
      .spyOn(AuthorizationContextService.prototype, 'resolveUserAuthorization')
      .mockResolvedValue(buildResolvedAuthorization(['users:read_detail']));

    jest.spyOn(prisma.users, 'findFirst').mockResolvedValue({
      ...userDetailRecord,
      enrollments: [buildTrajectoryEnrollment()],
    });

    const response = await request(getHttpServer())
      .get('/api/v1/admin/users/user-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = getResponseBody(response);

    expect(body.data.current_operational_enrollment).toEqual({
      enrollment_id: 9001,
      ecclesiastical_year_id: 2026,
      class_id: 7,
      class_name: 'Amigo',
      enrollment_date: '2026-01-05T10:00:00.000Z',
      investiture_status: 'IN_PROGRESS',
      submitted_for_validation: false,
      submitted_at: null,
      validated_by: null,
      validated_at: null,
      rejection_reason: null,
      investiture_date: null,
      advanced_status: false,
      locked_for_validation: false,
      cross_type_enrollment: false,
      active: true,
    });
    expect(body.data.trajectory_classes).toEqual([
      {
        enrollment_id: 55,
        class_id: 9,
        class_name: 'Explorador',
        ecclesiastical_year_id: 2025,
        advanced: false,
        current_class: false,
        investiture_status: 'INVESTED',
        enrollment_date: '2025-01-10T00:00:00.000Z',
      },
    ]);
    expect(body.data.classes).toEqual(body.data.trajectory_classes);
  });

  it('should return null operational enrollment when no active ecclesiastical year is resolved', async () => {
    const token = makeToken('admin-1', 'admin@test.com');

    mockScopedDetailLookup();
    jest
      .spyOn(AuthorizationContextService.prototype, 'resolveUserAuthorization')
      .mockResolvedValue(buildResolvedAuthorization(['users:read_detail']));

    jest.spyOn(prisma.users, 'findFirst').mockResolvedValue({
      ...userDetailRecord,
      enrollments: [buildTrajectoryEnrollment()],
    });
    const findYearSpy = jest.spyOn(prisma.ecclesiastical_years, 'findFirst');
    const findEnrollmentsSpy = jest.spyOn(prisma.enrollments, 'findMany');

    findYearSpy.mockResolvedValueOnce(null);

    const missingYearResponse = await request(getHttpServer())
      .get('/api/v1/admin/users/user-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = getResponseBody(missingYearResponse);

    expect(body.data.current_operational_enrollment).toBeNull();
    expect(body.data.trajectory_classes).toEqual([
      {
        enrollment_id: 55,
        class_id: 9,
        class_name: 'Explorador',
        ecclesiastical_year_id: 2025,
        advanced: false,
        current_class: false,
        investiture_status: 'INVESTED',
        enrollment_date: '2025-01-10T00:00:00.000Z',
      },
    ]);
    expect(body.data.classes).toEqual(body.data.trajectory_classes);
    expect(findEnrollmentsSpy).not.toHaveBeenCalled();
  });

  it('should return null operational enrollment on conflicting annual enrollment candidates', async () => {
    const token = makeToken('admin-1', 'admin@test.com');

    mockScopedDetailLookup();
    jest
      .spyOn(AuthorizationContextService.prototype, 'resolveUserAuthorization')
      .mockResolvedValue(buildResolvedAuthorization(['users:read_detail']));

    jest.spyOn(prisma.users, 'findFirst').mockResolvedValue({
      ...userDetailRecord,
      enrollments: [buildTrajectoryEnrollment()],
    });
    jest.spyOn(prisma.ecclesiastical_years, 'findFirst').mockResolvedValue({
      year_id: 2026,
    });
    jest
      .spyOn(prisma.enrollments, 'findMany')
      .mockResolvedValue([
        buildEnrollmentCandidate(9001),
        buildEnrollmentCandidate(9002),
      ] as unknown);

    const response = await request(getHttpServer())
      .get('/api/v1/admin/users/user-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = getResponseBody(response);

    expect(body.data.current_operational_enrollment).toBeNull();
    expect(body.data.trajectory_classes).toEqual([
      {
        enrollment_id: 55,
        class_id: 9,
        class_name: 'Explorador',
        ecclesiastical_year_id: 2025,
        advanced: false,
        current_class: false,
        investiture_status: 'INVESTED',
        enrollment_date: '2025-01-10T00:00:00.000Z',
      },
    ]);
    expect(body.data.classes).toEqual(body.data.trajectory_classes);
  });
});
