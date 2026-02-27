import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { ClubRolesGuard } from '../src/common/guards/club-roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

describe('Camporees E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const mockJwtAuthGuard = {
    canActivate: jest.fn((context) => {
      const request = context.switchToHttp().getRequest();
      // Mock the user in the request object
      request.user = { sub: TEST_USER_ID, email: 'test@example.com' };
      return true;
    }),
  };

  const mockClubRolesGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_GUARD)
      .useValue(mockThrottlerGuard)
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .overrideGuard(ClubRolesGuard)
      .useValue(mockClubRolesGuard)
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
    // Restore mock implementations
    mockJwtAuthGuard.canActivate.mockImplementation((context) => {
      const request = context.switchToHttp().getRequest();
      request.user = { sub: TEST_USER_ID, email: 'test@example.com' };
      return true;
    });
    mockClubRolesGuard.canActivate.mockReturnValue(true);
    // Add small delay to avoid rate limiting (throttler is set to 3 requests per second)
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

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

      const response = await request(app.getHttpServer())
        .post('/api/v1/camporees')
        .send(createCamporeeDto)
        .expect(201);

      expect(response.body).toHaveProperty('local_camporee_id');
      expect(response.body.name).toBe(createCamporeeDto.name);
      expect(response.body).toHaveProperty('local_fields');
      expect(response.body).toHaveProperty('ecclesiastical_year_relation');
    });

    it('should reject without authentication', async () => {
      mockJwtAuthGuard.canActivate.mockImplementationOnce(() => false);

      await request(app.getHttpServer())
        .post('/api/v1/camporees')
        .send(createCamporeeDto)
        .expect(403);

      // Restore mock
      mockJwtAuthGuard.canActivate.mockImplementation((context) => {
        const request = context.switchToHttp().getRequest();
        request.user = { sub: TEST_USER_ID, email: 'test@example.com' };
        return true;
      });
    });

    it('should reject without proper role (director/deputy director)', async () => {
      mockClubRolesGuard.canActivate.mockReturnValueOnce(false);

      await request(app.getHttpServer())
        .post('/api/v1/camporees')
        .send(createCamporeeDto)
        .expect(403);
    });

    it('should reject if no active ecclesiastical year exists', async () => {
      jest
        .spyOn(prisma.ecclesiastical_years, 'findFirst')
        .mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/v1/camporees')
        .send(createCamporeeDto)
        .expect(400);
    });

    it('should reject if local field does not exist', async () => {
      jest
        .spyOn(prisma.ecclesiastical_years, 'findFirst')
        .mockResolvedValue(mockEcclesiasticalYear);
      jest.spyOn(prisma.local_fields, 'findUnique').mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/v1/camporees')
        .send(createCamporeeDto)
        .expect(400);
    });

    it('should reject with invalid data (missing required fields)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/camporees')
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

      const response = await request(app.getHttpServer())
        .get('/api/v1/camporees')
        .expect(200);

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

      const response = await request(app.getHttpServer())
        .get('/api/v1/camporees?active=true')
        .expect(200);

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

      const response = await request(app.getHttpServer())
        .get('/api/v1/camporees?active=false')
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data[0].active).toBe(false);
    });

    it('should support pagination parameters', async () => {
      jest
        .spyOn(prisma.local_camporees, 'findMany')
        .mockResolvedValue([mockCamporee] as any);
      jest.spyOn(prisma.local_camporees, 'count').mockResolvedValue(10);

      const response = await request(app.getHttpServer())
        .get('/api/v1/camporees?page=2&limit=5')
        .expect(200);

      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta).toHaveProperty('page', 2);
      expect(response.body.meta).toHaveProperty('limit', 5);
    });

    it('should return empty array when no camporees exist', async () => {
      jest.spyOn(prisma.local_camporees, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.local_camporees, 'count').mockResolvedValue(0);

      const response = await request(app.getHttpServer())
        .get('/api/v1/camporees')
        .expect(200);

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

      const response = await request(app.getHttpServer())
        .get(`/api/v1/camporees/${TEST_CAMPOREE_ID}`)
        .expect(200);

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

      await request(app.getHttpServer())
        .get('/api/v1/camporees/9999')
        .expect(404);
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

      const response = await request(app.getHttpServer())
        .get(`/api/v1/camporees/${TEST_CAMPOREE_ID}`)
        .expect(200);

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

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/camporees/${TEST_CAMPOREE_ID}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.name).toBe(updateDto.name);
      expect(response.body.registration_cost).toBe(updateDto.registration_cost);
    });

    it('should return 404 if camporee not found', async () => {
      jest.spyOn(prisma.local_camporees, 'findUnique').mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch('/api/v1/camporees/9999')
        .send(updateDto)
        .expect(404);
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

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/camporees/${TEST_CAMPOREE_ID}`)
        .send(partialUpdate)
        .expect(200);

      expect(response.body.name).toBe(partialUpdate.name);
    });

    it('should reject without proper role', async () => {
      mockClubRolesGuard.canActivate.mockReturnValueOnce(false);

      await request(app.getHttpServer())
        .patch(`/api/v1/camporees/${TEST_CAMPOREE_ID}`)
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

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/camporees/${TEST_CAMPOREE_ID}`)
        .expect(200);

      expect(response.body.active).toBe(false);
    });

    it('should return 404 if camporee not found', async () => {
      jest.spyOn(prisma.local_camporees, 'findUnique').mockResolvedValue(null);

      await request(app.getHttpServer())
        .delete('/api/v1/camporees/9999')
        .expect(404);
    });

    it('should require director role', async () => {
      mockClubRolesGuard.canActivate.mockReturnValueOnce(false);

      await request(app.getHttpServer())
        .delete(`/api/v1/camporees/${TEST_CAMPOREE_ID}`)
        .expect(403);
    });
  });

  // ========================================
  // POST /camporees/:id/register - Register member
  // ========================================
  describe('POST /api/v1/camporees/:camporeeId/register', () => {
    const registerDto = {
      user_id: TEST_USER_ID,
      camporee_type: 'local',
      club_name: 'Club Conquistadores Central',
      insurance_id: TEST_INSURANCE_ID,
    };

    it('should register member with valid insurance', async () => {
      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) => {
          return callback({
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
        });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(201);

      expect(response.body).toHaveProperty('camporee_member_id');
      expect(response.body.user_id).toBe(TEST_USER_ID);
      expect(response.body.insurance_verified).toBe(true);
      expect(response.body).toHaveProperty('users');
      expect(response.body).toHaveProperty('insurance');
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

      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) => {
          return callback({
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
          });
        });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerWithoutInsurance)
        .expect(201);

      expect(response.body.insurance_verified).toBe(false);
      expect(response.body.insurance_id).toBeNull();
    });

    it('should reject if insurance type is wrong (not CAMPOREE)', async () => {
      const wrongTypeInsurance = { ...mockInsurance, insurance_type: 'ANNUAL' };

      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) => {
          return callback({
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
        });

      await request(app.getHttpServer())
        .post(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
    });

    it('should reject if insurance expired before camporee ends', async () => {
      const expiredInsurance = {
        ...mockInsurance,
        end_date: new Date('2024-05-16'), // Before camporee ends on 2024-05-17
      };

      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) => {
          return callback({
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
        });

      await request(app.getHttpServer())
        .post(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
    });

    it('should reject if insurance is not active', async () => {
      const inactiveInsurance = { ...mockInsurance, active: false };

      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) => {
          return callback({
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
        });

      await request(app.getHttpServer())
        .post(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
    });

    it('should reject if camporee not found', async () => {
      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) => {
          return callback({
            local_camporees: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          });
        });

      await request(app.getHttpServer())
        .post('/api/v1/camporees/9999/register')
        .send(registerDto)
        .expect(404);
    });

    it('should reject if camporee is not active', async () => {
      const inactiveCamporee = { ...mockCamporee, active: false };

      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) => {
          return callback({
            local_camporees: {
              findUnique: jest.fn().mockResolvedValue(inactiveCamporee),
            },
          });
        });

      await request(app.getHttpServer())
        .post(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
    });

    it('should reject if user not found', async () => {
      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) => {
          return callback({
            local_camporees: {
              findUnique: jest.fn().mockResolvedValue(mockCamporee),
            },
            users: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          });
        });

      await request(app.getHttpServer())
        .post(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
    });

    it('should reject if user already registered', async () => {
      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) => {
          return callback({
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
        });

      await request(app.getHttpServer())
        .post(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
    });

    it('should reject if insurance does not belong to user', async () => {
      const otherUserInsurance = { ...mockInsurance, user_id: TEST_USER_ID_2 };

      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) => {
          return callback({
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
        });

      await request(app.getHttpServer())
        .post(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
    });

    it('should reject if insurance not found', async () => {
      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (callback: any) => {
          return callback({
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
        });

      await request(app.getHttpServer())
        .post(`/api/v1/camporees/${TEST_CAMPOREE_ID}/register`)
        .send(registerDto)
        .expect(400);
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

      const response = await request(app.getHttpServer())
        .get(`/api/v1/camporees/${TEST_CAMPOREE_ID}/members`)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(2);
      expect(response.body[0]).toHaveProperty('users');
      expect(response.body[0]).toHaveProperty('insurance');
    });

    it('should return empty array if no members registered', async () => {
      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest.spyOn(prisma.camporee_members, 'findMany').mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/camporees/${TEST_CAMPOREE_ID}/members`)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(0);
    });

    it('should return 404 if camporee not found', async () => {
      jest.spyOn(prisma.local_camporees, 'findUnique').mockResolvedValue(null);

      await request(app.getHttpServer())
        .get('/api/v1/camporees/9999/members')
        .expect(404);
    });

    it('should return only active members', async () => {
      const activeMember = mockCamporeeMember;
      const inactiveMember = {
        ...mockCamporeeMember,
        camporee_member_id: 2,
        active: false,
      };

      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest
        .spyOn(prisma.camporee_members, 'findMany')
        .mockResolvedValue([activeMember] as any);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/camporees/${TEST_CAMPOREE_ID}/members`)
        .expect(200);

      expect(response.body.length).toBe(1);
      expect(response.body[0].active).toBe(true);
    });

    it('should include user and insurance details', async () => {
      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest
        .spyOn(prisma.camporee_members, 'findMany')
        .mockResolvedValue([mockCamporeeMember] as any);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/camporees/${TEST_CAMPOREE_ID}/members`)
        .expect(200);

      expect(response.body[0].users).toHaveProperty('name');
      expect(response.body[0].users).toHaveProperty('email');
      expect(response.body[0].insurance).toHaveProperty('policy_number');
      expect(response.body[0].insurance).toHaveProperty('provider');
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

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/camporees/${TEST_CAMPOREE_ID}/members/${TEST_USER_ID}`)
        .expect(200);

      expect(response.body.active).toBe(false);
    });

    it('should return 404 if camporee not found', async () => {
      jest.spyOn(prisma.local_camporees, 'findUnique').mockResolvedValue(null);

      await request(app.getHttpServer())
        .delete(`/api/v1/camporees/9999/members/${TEST_USER_ID}`)
        .expect(404);
    });

    it('should return 404 if member registration not found', async () => {
      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest.spyOn(prisma.camporee_members, 'findFirst').mockResolvedValue(null);

      await request(app.getHttpServer())
        .delete(
          `/api/v1/camporees/${TEST_CAMPOREE_ID}/members/${TEST_USER_ID_2}`,
        )
        .expect(404);
    });

    it('should require director or deputy director role', async () => {
      mockClubRolesGuard.canActivate.mockReturnValueOnce(false);

      await request(app.getHttpServer())
        .delete(`/api/v1/camporees/${TEST_CAMPOREE_ID}/members/${TEST_USER_ID}`)
        .expect(403);
    });

    it('should not remove already inactive member', async () => {
      const inactiveMember = { ...mockCamporeeMember, active: false };

      jest
        .spyOn(prisma.local_camporees, 'findUnique')
        .mockResolvedValue(mockCamporee as any);
      jest.spyOn(prisma.camporee_members, 'findFirst').mockResolvedValue(null);

      await request(app.getHttpServer())
        .delete(`/api/v1/camporees/${TEST_CAMPOREE_ID}/members/${TEST_USER_ID}`)
        .expect(404);
    });
  });
});
