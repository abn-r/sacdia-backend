import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PermissionsGuard } from '../src/common/guards';
import {
  buildAuthorizationSnapshot,
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

describe('Camporees E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const mockThrottlerGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  // Test data constants
  const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440001';
  const TEST_USER_ID_2 = '550e8400-e29b-41d4-a716-446655440002';
  const TEST_CAMPOREE_ID = 1;
  const TEST_LOCAL_FIELD_ID = 1;
  const TEST_ECCLESIASTICAL_YEAR_ID = 1;
  const TEST_INSURANCE_ID = 1;
  let currentAuthorization = buildAuthorizationSnapshot({
    activePermissions: [
      'activities:read',
      'activities:create',
      'activities:update',
      'activities:delete',
      'attendance:read',
      'attendance:manage',
    ],
    assignmentId: 'assignment-1',
    clubId: 1,
    clubSectionId: 1,
    clubTypeName: 'Conquistadores',
    localFieldId: TEST_LOCAL_FIELD_ID,
    unionId: 1,
    countryId: 1,
  });

  const mockPermissionsGuard = {
    canActivate: jest.fn((context) => {
      const req = context.switchToHttp().getRequest();
      req.authorization = currentAuthorization;
      return true;
    }),
  };

  // Mock test data
  const mockEcclesiasticalYear = {
    year_id: TEST_ECCLESIASTICAL_YEAR_ID,
    start_date: new Date('2024-01-01'),
    end_date: new Date('2024-12-31'),
    active: true,
    created_at: new Date(),
    modified_at: new Date(),
  };

  const mockLocalField = {
    local_field_id: TEST_LOCAL_FIELD_ID,
    name: 'Campo Local Test',
    abbreviation: 'CLT',
    active: true,
    union_id: 1,
    created_at: new Date(),
    modified_at: new Date(),
  };

  const mockCamporee = {
    local_camporee_id: TEST_CAMPOREE_ID,
    name: 'Camporee de Primavera 2024',
    description: 'Evento anual de primavera',
    start_date: new Date('2024-05-15'),
    end_date: new Date('2024-05-17'),
    local_field_id: TEST_LOCAL_FIELD_ID,
    includes_adventurers: true,
    includes_pathfinders: true,
    includes_master_guides: false,
    local_camporee_place: 'Centro Recreacional La Montaña',
    registration_cost: 50000,
    ecclesiastical_year: TEST_ECCLESIASTICAL_YEAR_ID,
    active: true,
    created_at: new Date(),
    modified_at: new Date(),
    local_fields: mockLocalField,
    ecclesiastical_year_relation: mockEcclesiasticalYear,
    attending_members_camporees: [],
  };

  const mockUser = {
    user_id: TEST_USER_ID,
    name: 'Juan',
    paternal_last_name: 'Pérez',
    maternal_last_name: 'González',
    email: 'juan.perez@example.com',
    user_image: null,
    birthday: new Date('2005-03-15'),
  };

  const mockInsurance = {
    insurance_id: TEST_INSURANCE_ID,
    user_id: TEST_USER_ID,
    insurance_type: 'CAMPOREE',
    policy_number: 'POL-123456',
    provider: 'Seguros Adventistas',
    start_date: new Date('2024-01-01'),
    end_date: new Date('2024-12-31'),
    coverage_amount: 100000,
    active: true,
    created_at: new Date(),
    modified_at: new Date(),
  };

  const mockCamporeeMember = {
    camporee_member_id: 1,
    camporee_club_id: 31,
    camporee_id: TEST_CAMPOREE_ID,
    camporee_type: 'local',
    user_id: TEST_USER_ID,
    club_name: 'Club Conquistadores Central',
    local_field_id: null,
    insurance_verified: true,
    insurance_id: TEST_INSURANCE_ID,
    active: true,
    created_at: new Date(),
    modified_at: new Date(),
    users: mockUser,
    insurance: mockInsurance,
  };

  beforeAll(async () => {
    jwtService = createTestJwtService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_GUARD)
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

  beforeEach(() => {
    jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(async (input: any) => {
        if (Array.isArray(input)) {
          return Promise.all(input);
        }

        throw new TypeError(
          'Callback transactions require an explicit E2E transaction fixture',
        );
      });
  });

  afterEach(async () => {
    jest.clearAllMocks();
    currentAuthorization = buildAuthorizationSnapshot({
      activePermissions: [
        'activities:read',
        'activities:create',
        'activities:update',
        'activities:delete',
        'attendance:read',
        'attendance:manage',
      ],
      assignmentId: 'assignment-1',
      clubId: 1,
      clubSectionId: 1,
      clubTypeName: 'Conquistadores',
      localFieldId: TEST_LOCAL_FIELD_ID,
      unionId: 1,
      countryId: 1,
    });
    mockPermissionsGuard.canActivate.mockImplementation((context) => {
      const req = context.switchToHttp().getRequest();
      req.authorization = currentAuthorization;
      return true;
    });
    // Add small delay to avoid rate limiting (throttler is set to 3 requests per second)
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  const authHeaders = (userId = TEST_USER_ID, email = 'test@example.com') => ({
    Authorization: `Bearer ${createBearerToken(jwtService, userId, email)}`,
  });

  const getAsUser = (url: string) =>
    request(app.getHttpServer()).get(url).set(authHeaders());
  const postAsUser = (url: string) =>
    request(app.getHttpServer()).post(url).set(authHeaders());
  const patchAsUser = (url: string) =>
    request(app.getHttpServer()).patch(url).set(authHeaders());
  const deleteAsUser = (url: string) =>
    request(app.getHttpServer()).delete(url).set(authHeaders());

  // ========================================
  // POST /camporees - Create camporee
  // ========================================
  describe('POST /api/v1/camporees', () => {
    const createCamporeeDto = {
      name: 'Camporee de Primavera 2024',
      description: 'Evento anual de primavera',
      start_date: '2024-05-15',
      end_date: '2024-05-17',
      local_field_id: TEST_LOCAL_FIELD_ID,
      includes_adventurers: true,
      includes_pathfinders: true,
      includes_master_guides: false,
      local_camporee_place: 'Centro Recreacional La Montaña',
      registration_cost: 50000,
    };

    it('should successfully create camporee with valid data', async () => {
      jest
        .spyOn(prisma.ecclesiastical_years, 'findFirst')
        .mockResolvedValue(mockEcclesiasticalYear);
      jest
        .spyOn(prisma.local_fields, 'findUnique')
        .mockResolvedValue(mockLocalField);
      jest
        .spyOn(prisma.local_camporees, 'create')
        .mockResolvedValue(mockCamporee as any);

      const response = await postAsUser('/api/v1/camporees')
        .send(createCamporeeDto)
        .expect(201);

      expect(response.body).toHaveProperty('local_camporee_id');
      expect(response.body.name).toBe(createCamporeeDto.name);
      expect(response.body).toHaveProperty('local_fields');
      expect(response.body).toHaveProperty('ecclesiastical_year_relation');
    });

    it('should reject without authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/camporees')
        .send(createCamporeeDto)
        .expect(401);
    });

    it('should reject without required permissions', async () => {
      mockPermissionsGuard.canActivate.mockReturnValueOnce(false);

      await postAsUser('/api/v1/camporees').send(createCamporeeDto).expect(403);
    });

    it('should reject if no active ecclesiastical year exists', async () => {
      jest
        .spyOn(prisma.ecclesiastical_years, 'findFirst')
        .mockResolvedValue(null);

      await postAsUser('/api/v1/camporees').send(createCamporeeDto).expect(400);
    });

    it('should reject if local field does not exist', async () => {
      jest
        .spyOn(prisma.ecclesiastical_years, 'findFirst')
        .mockResolvedValue(mockEcclesiasticalYear);
      jest.spyOn(prisma.local_fields, 'findUnique').mockResolvedValue(null);

      await postAsUser('/api/v1/camporees').send(createCamporeeDto).expect(404);
    });

    it('should reject with invalid data (missing required fields)', async () => {
      await postAsUser('/api/v1/camporees')
        .send({
          name: 'Test Camporee',
          // Missing required fields
        })
        .expect(400);
    });
  });

  // ========================================
  // GET /camporees - List camporees (paginated)
  // ========================================
  describe('GET /api/v1/camporees', () => {
    it('should return paginated list of camporees', async () => {
      const mockCamporees = [
        mockCamporee,
        { ...mockCamporee, local_camporee_id: 2 },
      ];

      jest
        .spyOn(prisma.local_camporees, 'findMany')
        .mockResolvedValue(mockCamporees as any);
      jest.spyOn(prisma.local_camporees, 'count').mockResolvedValue(2);

      const response = await getAsUser('/api/v1/camporees').expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(2);
      expect(response.body.meta).toHaveProperty('total', 2);
    });

    it('should filter by active status (active=true)', async () => {
      const activeCamporees = [mockCamporee];

      jest
        .spyOn(prisma.local_camporees, 'findMany')
        .mockResolvedValue(activeCamporees as any);
      jest.spyOn(prisma.local_camporees, 'count').mockResolvedValue(1);

      const response = await getAsUser('/api/v1/camporees?active=true').expect(
        200,
      );

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].active).toBe(true);
    });

    it('should filter by active status (active=false)', async () => {
      const inactiveCamporee = { ...mockCamporee, active: false };

      jest
        .spyOn(prisma.local_camporees, 'findMany')
        .mockResolvedValue([inactiveCamporee] as any);
      jest.spyOn(prisma.local_camporees, 'count').mockResolvedValue(1);

      const response = await getAsUser('/api/v1/camporees?active=false').expect(
        200,
      );

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data[0].active).toBe(false);
    });

    it('should support pagination parameters', async () => {
      jest
        .spyOn(prisma.local_camporees, 'findMany')
        .mockResolvedValue([mockCamporee] as any);
      jest.spyOn(prisma.local_camporees, 'count').mockResolvedValue(10);

      const response = await getAsUser(
        '/api/v1/camporees?page=2&limit=5',
      ).expect(200);

      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta).toHaveProperty('page', 2);
      expect(response.body.meta).toHaveProperty('limit', 5);
    });

    it('should return empty array when no camporees exist', async () => {
      jest.spyOn(prisma.local_camporees, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.local_camporees, 'count').mockResolvedValue(0);

      const response = await getAsUser('/api/v1/camporees').expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(0);
      expect(response.body.meta.total).toBe(0);
    });
  });

  // ========================================
  // GET /camporees/:id - Get one camporee
  // ========================================
  describe('GET /api/v1/camporees/:camporeeId', () => {
    it('should return camporee by ID', async () => {
      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);

      const response = await getAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}`,
      ).expect(200);

      expect(response.body).toHaveProperty(
        'local_camporee_id',
        TEST_CAMPOREE_ID,
      );
      expect(response.body).toHaveProperty('name');
      expect(response.body).toHaveProperty('local_fields');
      expect(response.body).toHaveProperty('ecclesiastical_year_relation');
    });

    it('should return 404 if camporee not found', async () => {
      jest.spyOn(prisma.local_camporees, 'findUnique').mockResolvedValue(null);

      await getAsUser('/api/v1/camporees/9999').expect(404);
    });

    it('should return camporee with members list', async () => {
      const camporeeWithMembers = {
        ...mockCamporee,
        attending_members_camporees: [
          {
            camporee_member_id: 1,
            user_id: TEST_USER_ID,
            insurance_verified: true,
          },
        ],
      };

      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(camporeeWithMembers as any);

      const response = await getAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}`,
      ).expect(200);

      expect(response.body.attending_members_camporees).toBeInstanceOf(Array);
      expect(response.body.attending_members_camporees.length).toBe(1);
    });
  });

  // ========================================
  // PATCH /camporees/:id - Update camporee
  // ========================================
  describe('PATCH /api/v1/camporees/:camporeeId', () => {
    const updateDto = {
      name: 'Camporee de Primavera 2024 - Actualizado',
      registration_cost: 60000,
    };

    it('should update camporee successfully', async () => {
      const updatedCamporee = { ...mockCamporee, ...updateDto };

      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest
        .spyOn(prisma.local_camporees, 'update')
        .mockResolvedValue(updatedCamporee as any);

      const response = await patchAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}`,
      )
        .send(updateDto)
        .expect(200);

      expect(response.body.name).toBe(updateDto.name);
      expect(response.body.registration_cost).toBe(updateDto.registration_cost);
    });

    it('should return 404 if camporee not found', async () => {
      jest.spyOn(prisma.local_camporees, 'findUnique').mockResolvedValue(null);

      await patchAsUser('/api/v1/camporees/9999').send(updateDto).expect(404);
    });

    it('should update only provided fields', async () => {
      const partialUpdate = { name: 'Nuevo Nombre' };
      const updatedCamporee = { ...mockCamporee, ...partialUpdate };

      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest
        .spyOn(prisma.local_camporees, 'update')
        .mockResolvedValue(updatedCamporee as any);

      const response = await patchAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}`,
      )
        .send(partialUpdate)
        .expect(200);

      expect(response.body.name).toBe(partialUpdate.name);
    });

    it('should reject without required permissions', async () => {
      mockPermissionsGuard.canActivate.mockReturnValueOnce(false);

      await patchAsUser(`/api/v1/camporees/${TEST_CAMPOREE_ID}`)
        .send(updateDto)
        .expect(403);
    });
  });

  // ========================================
  // DELETE /camporees/:id - Soft delete
  // ========================================
  describe('DELETE /api/v1/camporees/:camporeeId', () => {
    it('should soft delete camporee (set active = false)', async () => {
      const deactivatedCamporee = { ...mockCamporee, active: false };

      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest
        .spyOn(prisma.local_camporees, 'update')
        .mockResolvedValue(deactivatedCamporee as any);

      const response = await deleteAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}`,
      ).expect(200);

      expect(response.body.active).toBe(false);
    });

    it('should return 404 if camporee not found', async () => {
      jest.spyOn(prisma.local_camporees, 'findUnique').mockResolvedValue(null);

      await deleteAsUser('/api/v1/camporees/9999').expect(404);
    });

    it('should require the delete permission', async () => {
      mockPermissionsGuard.canActivate.mockReturnValueOnce(false);

      await deleteAsUser(`/api/v1/camporees/${TEST_CAMPOREE_ID}`).expect(403);
    });
  });

  // ========================================
  // POST /camporees/:id/register - Register member
  // ========================================
  describe('POST /api/v1/camporees/:camporeeId/register', () => {
    type ParticipantLockName =
      | 'camporee'
      | 'enrollment'
      | 'user'
      | 'assignments'
      | 'profile';

    type ParticipantGateOptions = {
      camporeeId?: number;
      userId?: string;
      through?: ParticipantLockName;
    };

    type LockExpectation = {
      name: ParticipantLockName;
      sql: RegExp;
      values: unknown[];
      rows: () => Promise<unknown[]>;
    };

    const registerDto = {
      user_id: TEST_USER_ID,
      camporee_type: 'local',
      club_name: 'Club Conquistadores Central',
      insurance_id: TEST_INSURANCE_ID,
    };

    const withParticipantGate = (
      tx: any,
      enrollment: { camporee_club_id: number; status: string } | null = {
        camporee_club_id: 31,
        status: 'registered',
      },
      options: ParticipantGateOptions = {},
    ) => {
      const camporeeId = options.camporeeId ?? TEST_CAMPOREE_ID;
      const userId = options.userId ?? TEST_USER_ID;
      const originalCamporeeFindUnique = tx.local_camporees.findUnique;
      const originalUserFindUnique = tx.users?.findUnique;
      const trace: string[] = [];
      const sectionEnrollment = enrollment
        ? {
            ...enrollment,
            camporee_id: camporeeId,
            club_section_id: 1,
            active: true,
          }
        : null;

      const allLockExpectations: LockExpectation[] = [
        {
          name: 'camporee',
          sql: /^SELECT "local_camporee_id" FROM "local_camporees" WHERE "local_camporee_id" = \? AND "local_field_id" = \? FOR UPDATE$/,
          values: [camporeeId, TEST_LOCAL_FIELD_ID],
          rows: async () => {
            const camporee = await originalCamporeeFindUnique({});
            return camporee ? [{ local_camporee_id: camporeeId }] : [];
          },
        },
        {
          name: 'enrollment',
          sql: /^SELECT "camporee_club_id" FROM "camporee_clubs" WHERE "camporee_id" = \? AND "club_section_id" = \? AND "active" = true AND "status" IN \('registered', 'approved'\) ORDER BY "camporee_club_id" ASC FOR UPDATE$/,
          values: [camporeeId, 1],
          rows: async () =>
            sectionEnrollment
              ? [{ camporee_club_id: sectionEnrollment.camporee_club_id }]
              : [],
        },
        {
          name: 'user',
          sql: /^SELECT "user_id" FROM "users" WHERE "user_id" = \? FOR UPDATE$/,
          values: [userId],
          rows: async () => {
            const user = originalUserFindUnique
              ? await originalUserFindUnique({})
              : null;
            return user ? [{ user_id: user.user_id }] : [];
          },
        },
        {
          name: 'assignments',
          sql: /^SELECT "assignment_id" FROM "club_role_assignments" WHERE "user_id" = \? ORDER BY "assignment_id" ASC FOR UPDATE$/,
          values: [userId],
          rows: async () => [{ assignment_id: 'target-assignment' }],
        },
        {
          name: 'profile',
          sql: /^SELECT "user_pr_id" FROM "users_pr" WHERE "user_id" = \? FOR UPDATE$/,
          values: [userId],
          rows: async () => {
            const user = originalUserFindUnique
              ? await originalUserFindUnique({})
              : null;
            return user ? [{ user_pr_id: 1 }] : [];
          },
        },
      ];
      const through =
        options.through ?? (enrollment === null ? 'enrollment' : 'profile');
      const throughIndex = allLockExpectations.findIndex(
        ({ name }) => name === through,
      );
      const lockExpectations = allLockExpectations.slice(0, throughIndex + 1);

      const queryRaw = jest.fn(async (query: unknown) => {
        if (
          typeof query !== 'object' ||
          query === null ||
          !('strings' in query) ||
          !Array.isArray((query as { strings?: unknown }).strings) ||
          !('values' in query) ||
          !Array.isArray((query as { values?: unknown }).values)
        ) {
          throw new Error('Malformed Camporee lock query in E2E fixture');
        }

        const strings = (query as { strings: string[] }).strings;
        const values = (query as { values: unknown[] }).values;
        const sql = strings
          .map((part, index) => `${part}${index < values.length ? '?' : ''}`)
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        const expectation = lockExpectations.shift();
        if (!expectation) {
          throw new Error(
            'Unexpected Camporee lock query after expectation queue was exhausted',
          );
        }
        if (!expectation.sql.test(sql)) {
          throw new Error(
            `Camporee E2E SQL contract mismatch at ${expectation.name} lock`,
          );
        }
        if (
          values.length !== expectation.values.length ||
          values.some(
            (value, index) => !Object.is(value, expectation.values[index]),
          )
        ) {
          throw new Error(
            `Camporee E2E parameter contract mismatch at ${expectation.name} lock`,
          );
        }

        trace.push(`lock:${expectation.name}`);
        return expectation.rows();
      });

      const assertLockExpectationsConsumed = () => {
        if (lockExpectations.length > 0) {
          throw new Error(
            `Unconsumed Camporee E2E lock expectations: ${lockExpectations
              .map(({ name }) => name)
              .join(', ')}`,
          );
        }
      };

      const sectionFindUnique = jest.fn(async () => {
        trace.push('reread:section');
        return {
          club_section_id: 1,
          name: 'Conquistadores Central',
          active: true,
          club_type_id: 1,
          main_club_id: 1,
          clubs: {
            club_id: 1,
            name: 'Club Conquistadores Central',
            active: true,
            local_field_id: TEST_LOCAL_FIELD_ID,
          },
          club_types: {
            club_type_id: 1,
            name: 'Conquistadores',
            active: true,
          },
        };
      });
      const enrollmentFindUnique = jest.fn(async () => {
        trace.push('reread:enrollment');
        return sectionEnrollment;
      });
      const assignmentFindMany = jest.fn(async () => {
        trace.push('reread:assignments');
        return [
          {
            assignment_id: 'target-assignment',
            club_section_id: 1,
            active: true,
            status: 'active',
          },
        ];
      });

      return {
        ...tx,
        $queryRaw: queryRaw,
        $lockTrace: trace,
        $assertLockExpectationsConsumed: assertLockExpectationsConsumed,
        local_camporees: {
          ...tx.local_camporees,
          findFirst: jest.fn(async (args: unknown) => {
            trace.push('reread:camporee');
            const found = await originalCamporeeFindUnique(args);
            return found
              ? {
                  ...found,
                  local_field_id: TEST_LOCAL_FIELD_ID,
                  name: found.name ?? 'Camporee de Primavera 2024',
                }
              : null;
          }),
        },
        club_sections: {
          findUnique: sectionFindUnique,
        },
        camporee_clubs: {
          findUnique: enrollmentFindUnique,
        },
        users: originalUserFindUnique
          ? {
              ...tx.users,
              findUnique: jest.fn(async (args: unknown) => {
                trace.push('reread:user');
                const found = await originalUserFindUnique(args);
                return found
                  ? {
                      ...found,
                      users_pr: {
                        user_pr_id: 1,
                        active_club_assignment_id: 'target-assignment',
                      },
                    }
                  : null;
              }),
            }
          : tx.users,
        club_role_assignments: {
          findMany: assignmentFindMany,
        },
      };
    };

    const installParticipantGate = (
      tx: any,
      enrollment: { camporee_club_id: number; status: string } | null = {
        camporee_club_id: 31,
        status: 'registered',
      },
      options: ParticipantGateOptions = {},
    ) => {
      const transactionFixture = withParticipantGate(tx, enrollment, options);
      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) =>
          callback(transactionFixture),
        );
      return transactionFixture;
    };

    it('returns 422 with a stable code when the director section is not enrolled', async () => {
      const transactionFixture = installParticipantGate(
        {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue(mockCamporee),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue(mockUser),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue(mockInsurance),
          },
        },
        null,
      );

      const response = await postAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}/register`,
      )
        .send(registerDto)
        .expect(422);

      expect(response.body).toHaveProperty(
        'code',
        'CAMPOREE_SECTION_REGISTRATION_REQUIRED',
      );
      transactionFixture.$assertLockExpectationsConsumed();
      expect(transactionFixture.$lockTrace).toEqual([
        'lock:camporee',
        'reread:camporee',
        'reread:section',
        'lock:enrollment',
      ]);
      expect(
        transactionFixture.camporee_clubs.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('should register member with valid insurance', async () => {
      const transactionFixture = installParticipantGate({
        local_camporees: {
          findUnique: jest.fn().mockResolvedValue(mockCamporee),
        },
        users: {
          findUnique: jest.fn().mockResolvedValue(mockUser),
        },
        camporee_members: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(mockCamporeeMember),
        },
        member_insurances: {
          findUnique: jest.fn().mockResolvedValue(mockInsurance),
        },
      });

      const response = await postAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}/register`,
      )
        .send(registerDto)
        .expect(201);

      expect(response.body).toHaveProperty('camporee_member_id');
      expect(response.body).toHaveProperty('camporee_club_id', 31);
      expect(response.body.user_id).toBe(TEST_USER_ID);
      expect(response.body.insurance_verified).toBe(true);
      expect(response.body).toHaveProperty('users');
      expect(response.body).toHaveProperty('insurance');
      transactionFixture.$assertLockExpectationsConsumed();
      expect(transactionFixture.$lockTrace).toEqual([
        'lock:camporee',
        'reread:camporee',
        'reread:section',
        'lock:enrollment',
        'lock:user',
        'lock:assignments',
        'lock:profile',
        'reread:enrollment',
        'reread:user',
        'reread:assignments',
      ]);
    });

    it('should register member without insurance', async () => {
      const registerWithoutInsurance = {
        user_id: TEST_USER_ID_2,
        camporee_type: 'local',
        club_name: 'Club Aventureros',
      };

      const memberWithoutInsurance = {
        ...mockCamporeeMember,
        user_id: TEST_USER_ID_2,
        insurance_verified: false,
        insurance_id: null,
        insurance: null,
      };

      const transactionFixture = installParticipantGate(
        {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue(mockCamporee),
          },
          users: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ ...mockUser, user_id: TEST_USER_ID_2 }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(memberWithoutInsurance),
          },
        },
        undefined,
        { userId: TEST_USER_ID_2 },
      );

      const response = await postAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}/register`,
      )
        .send(registerWithoutInsurance)
        .expect(201);

      expect(response.body.insurance_verified).toBe(false);
      expect(response.body.insurance_id).toBeNull();
      transactionFixture.$assertLockExpectationsConsumed();
    });

    it('should reject if insurance type is wrong (not CAMPOREE)', async () => {
      const wrongTypeInsurance = { ...mockInsurance, insurance_type: 'ANNUAL' };

      const transactionFixture = installParticipantGate({
        local_camporees: {
          findUnique: jest.fn().mockResolvedValue(mockCamporee),
        },
        users: {
          findUnique: jest.fn().mockResolvedValue(mockUser),
        },
        camporee_members: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        member_insurances: {
          findUnique: jest.fn().mockResolvedValue(wrongTypeInsurance),
        },
      });

      await postAsUser(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
      transactionFixture.$assertLockExpectationsConsumed();
    });

    it('should reject if insurance expired before camporee ends', async () => {
      const expiredInsurance = {
        ...mockInsurance,
        end_date: new Date('2024-05-16'), // Before camporee ends on 2024-05-17
      };

      const transactionFixture = installParticipantGate({
        local_camporees: {
          findUnique: jest.fn().mockResolvedValue(mockCamporee),
        },
        users: {
          findUnique: jest.fn().mockResolvedValue(mockUser),
        },
        camporee_members: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        member_insurances: {
          findUnique: jest.fn().mockResolvedValue(expiredInsurance),
        },
      });

      await postAsUser(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
      transactionFixture.$assertLockExpectationsConsumed();
    });

    it('should reject if insurance is not active', async () => {
      const inactiveInsurance = { ...mockInsurance, active: false };

      const transactionFixture = installParticipantGate({
        local_camporees: {
          findUnique: jest.fn().mockResolvedValue(mockCamporee),
        },
        users: {
          findUnique: jest.fn().mockResolvedValue(mockUser),
        },
        camporee_members: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        member_insurances: {
          findUnique: jest.fn().mockResolvedValue(inactiveInsurance),
        },
      });

      await postAsUser(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
      transactionFixture.$assertLockExpectationsConsumed();
    });

    it('should reject if camporee not found', async () => {
      const transactionFixture = installParticipantGate(
        {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        },
        undefined,
        { camporeeId: 9999, through: 'camporee' },
      );

      await postAsUser('/api/v1/camporees/9999/register')
        .send(registerDto)
        .expect(404);
      transactionFixture.$assertLockExpectationsConsumed();
    });

    it('should reject if camporee is not active', async () => {
      const inactiveCamporee = { ...mockCamporee, active: false };

      const transactionFixture = installParticipantGate(
        {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue(inactiveCamporee),
          },
        },
        undefined,
        { through: 'camporee' },
      );

      await postAsUser(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
      transactionFixture.$assertLockExpectationsConsumed();
    });

    it('should reject if user not found', async () => {
      const transactionFixture = installParticipantGate(
        {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue(mockCamporee),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        },
        undefined,
        { through: 'user' },
      );

      await postAsUser(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
      transactionFixture.$assertLockExpectationsConsumed();
    });

    it('should reject if user already registered', async () => {
      const transactionFixture = installParticipantGate({
        local_camporees: {
          findUnique: jest.fn().mockResolvedValue(mockCamporee),
        },
        users: {
          findUnique: jest.fn().mockResolvedValue(mockUser),
        },
        camporee_members: {
          findFirst: jest.fn().mockResolvedValue(mockCamporeeMember),
        },
      });

      await postAsUser(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
      transactionFixture.$assertLockExpectationsConsumed();
    });

    it('should reject if insurance does not belong to user', async () => {
      const otherUserInsurance = { ...mockInsurance, user_id: TEST_USER_ID_2 };

      const transactionFixture = installParticipantGate({
        local_camporees: {
          findUnique: jest.fn().mockResolvedValue(mockCamporee),
        },
        users: {
          findUnique: jest.fn().mockResolvedValue(mockUser),
        },
        camporee_members: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        member_insurances: {
          findUnique: jest.fn().mockResolvedValue(otherUserInsurance),
        },
      });

      await postAsUser(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
      transactionFixture.$assertLockExpectationsConsumed();
    });

    it('should reject if insurance not found', async () => {
      const transactionFixture = installParticipantGate({
        local_camporees: {
          findUnique: jest.fn().mockResolvedValue(mockCamporee),
        },
        users: {
          findUnique: jest.fn().mockResolvedValue(mockUser),
        },
        camporee_members: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        member_insurances: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      });

      await postAsUser(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
      transactionFixture.$assertLockExpectationsConsumed();
    });
  });

  // ========================================
  // GET /camporees/:id/members - List members
  // ========================================
  describe('GET /api/v1/camporees/:camporeeId/members', () => {
    it('should return all active members of the camporee', async () => {
      const mockMembers = [
        mockCamporeeMember,
        {
          ...mockCamporeeMember,
          camporee_member_id: 2,
          user_id: TEST_USER_ID_2,
        },
      ];

      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest
        .spyOn(prisma.camporee_members, 'findMany')
        .mockResolvedValue(mockMembers as any);
      jest
        .spyOn(prisma.camporee_members, 'count')
        .mockResolvedValue(mockMembers.length);

      const response = await getAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}/members`,
      ).expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta).toMatchObject({
        page: 1,
        limit: 50,
        total: 2,
        totalPages: 1,
      });
      expect(response.body.data[0]).toHaveProperty('users');
      expect(response.body.data[0]).toHaveProperty('insurance');
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array));
    });

    it('should return empty array if no members registered', async () => {
      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest.spyOn(prisma.camporee_members, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.camporee_members, 'count').mockResolvedValue(0);

      const response = await getAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}/members`,
      ).expect(200);

      expect(response.body.data).toEqual([]);
      expect(response.body.meta.total).toBe(0);
    });

    it('should return 404 if camporee not found', async () => {
      jest.spyOn(prisma.local_camporees, 'findUnique').mockResolvedValue(null);

      await getAsUser('/api/v1/camporees/9999/members').expect(404);
    });

    it('should return only active members', async () => {
      const activeMember = mockCamporeeMember;

      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest
        .spyOn(prisma.camporee_members, 'findMany')
        .mockResolvedValue([activeMember] as any);
      jest.spyOn(prisma.camporee_members, 'count').mockResolvedValue(1);

      const response = await getAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}/members`,
      ).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].active).toBe(true);
    });

    it('should include user and insurance details', async () => {
      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest
        .spyOn(prisma.camporee_members, 'findMany')
        .mockResolvedValue([mockCamporeeMember] as any);
      jest.spyOn(prisma.camporee_members, 'count').mockResolvedValue(1);

      const response = await getAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}/members`,
      ).expect(200);

      expect(response.body.data[0].users).toHaveProperty('name');
      expect(response.body.data[0].users).toHaveProperty('email');
      expect(response.body.data[0].insurance).toHaveProperty('policy_number');
      expect(response.body.data[0].insurance).toHaveProperty('provider');
    });
  });

  // ========================================
  // DELETE /camporees/:id/members/:userId - Remove member
  // ========================================
  describe('DELETE /api/v1/camporees/:camporeeId/members/:userId', () => {
    it('should soft delete member registration', async () => {
      const deactivatedMember = { ...mockCamporeeMember, active: false };

      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest
        .spyOn(prisma.camporee_members, 'findFirst')
        .mockResolvedValue(mockCamporeeMember as any);
      jest
        .spyOn(prisma.camporee_members, 'update')
        .mockResolvedValue(deactivatedMember as any);

      const response = await deleteAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}/members/${TEST_USER_ID}`,
      ).expect(200);

      expect(response.body.active).toBe(false);
    });

    it('should return 404 if camporee not found', async () => {
      jest.spyOn(prisma.local_camporees, 'findUnique').mockResolvedValue(null);

      await deleteAsUser(
        `/api/v1/camporees/9999/members/${TEST_USER_ID}`,
      ).expect(404);
    });

    it('should return 404 if member registration not found', async () => {
      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest.spyOn(prisma.camporee_members, 'findFirst').mockResolvedValue(null);

      await deleteAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}/members/${TEST_USER_ID_2}`,
      ).expect(404);
    });

    it('should require the attendance manage permission', async () => {
      mockPermissionsGuard.canActivate.mockReturnValueOnce(false);

      await deleteAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}/members/${TEST_USER_ID}`,
      ).expect(403);
    });

    it('should not remove already inactive member', async () => {
      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest.spyOn(prisma.camporee_members, 'findFirst').mockResolvedValue(null);

      await deleteAsUser(
        `/api/v1/camporees/${TEST_CAMPOREE_ID}/members/${TEST_USER_ID}`,
      ).expect(404);
    });
  });
});
