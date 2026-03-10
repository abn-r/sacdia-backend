import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PermissionsGuard } from '../src/common/guards';
import { AuthorizationContextService } from '../src/common/services/authorization-context.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  buildAuthorizationSnapshot,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

describe('Admin Users Detail E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const makeToken = (sub: string, email: string) =>
    jwtService.sign({ sub, email });
  const mockThrottlerGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };
  const mockPermissionsGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;

    process.env.SUPABASE_JWT_SECRET =
      process.env.SUPABASE_JWT_SECRET || 'test-secret';

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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
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
    users_classes: [],
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

  function mockScopedDetailLookup() {
    jest.spyOn(prisma.users, 'findUnique').mockResolvedValue(actorRecord as any);
    jest.spyOn(prisma.users, 'findFirst').mockResolvedValue(userDetailRecord as any);
  }

  it('should return only the permitted fine-grained block when using family permissions', async () => {
    const token = makeToken('admin-1', 'admin@test.com');

    mockScopedDetailLookup();
    jest
      .spyOn(AuthorizationContextService.prototype, 'resolveUserAuthorization')
      .mockResolvedValue({
        profile: {} as any,
        post_register_complete: false,
        authorization: buildAuthorizationSnapshot({
          globalPermissions: ['health:read'],
          globalRoleName: 'admin',
          unionId: 2,
        }),
        legacy: {
          roles: ['admin'],
          permissions: ['health:read'],
          club: null,
          club_context: {
            active_assignment_id: null,
            active: null,
            available: [],
          },
        },
      } as any);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users/user-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data.health).toEqual({
      blood: 'A_POSITIVE',
      allergies: [{ allergy_id: 1, name: 'Peanuts' }],
      diseases: [{ disease_id: 2, name: 'Asthma' }],
      medicines: [{ medicine_id: 3, name: 'Salbutamol' }],
    });
    expect(response.body.data.emergency_contacts).toBeNull();
    expect(response.body.data.legal_representative).toBeNull();
    expect(response.body.data.post_registration).toBeNull();
  });

  it('should keep transitional legacy compatibility for users:read_detail', async () => {
    const token = makeToken('admin-1', 'admin@test.com');

    mockScopedDetailLookup();
    jest
      .spyOn(AuthorizationContextService.prototype, 'resolveUserAuthorization')
      .mockResolvedValue({
        profile: {} as any,
        post_register_complete: false,
        authorization: buildAuthorizationSnapshot({
          globalPermissions: ['users:read_detail'],
          globalRoleName: 'admin',
          unionId: 2,
        }),
        legacy: {
          roles: ['admin'],
          permissions: ['users:read_detail'],
          club: null,
          club_context: {
            active_assignment_id: null,
            active: null,
            available: [],
          },
        },
      } as any);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users/user-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data.health).toEqual({
      blood: 'A_POSITIVE',
      allergies: [{ allergy_id: 1, name: 'Peanuts' }],
      diseases: [{ disease_id: 2, name: 'Asthma' }],
      medicines: [{ medicine_id: 3, name: 'Salbutamol' }],
    });
    expect(response.body.data.emergency_contacts).toHaveLength(1);
    expect(response.body.data.legal_representative).toEqual({
      id: 41,
      representative_user_id: null,
      relationship_type_id: 8,
      name: 'Carlos',
      paternal_last_name: 'Tutor',
      maternal_last_name: 'Perez',
      phone: '555-2222',
    });
    expect(response.body.data.post_registration).toEqual({
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
      .mockResolvedValue({
        profile: {} as any,
        post_register_complete: false,
        authorization: buildAuthorizationSnapshot({
          globalPermissions: ['users:read'],
          globalRoleName: 'admin',
          unionId: 2,
        }),
        legacy: {
          roles: ['admin'],
          permissions: ['users:read'],
          club: null,
          club_context: {
            active_assignment_id: null,
            active: null,
            available: [],
          },
        },
      } as any);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/users/user-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data.health).toBeNull();
    expect(response.body.data.emergency_contacts).toBeNull();
    expect(response.body.data.legal_representative).toBeNull();
    expect(response.body.data.post_registration).toBeNull();
  });
});
