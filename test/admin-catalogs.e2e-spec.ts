import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AdminGeographyService } from '../src/admin/admin-geography.service';
import { AdminReferenceService } from '../src/admin/admin-reference.service';

describe('Admin Catalogs E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const mockAdminGeographyService = {
    listCountries: jest.fn().mockResolvedValue([]),
    createCountry: jest.fn().mockResolvedValue({ country_id: 1, name: 'México' }),
    updateCountry: jest.fn(),
    deleteCountry: jest.fn(),
    listUnions: jest.fn(),
    createUnion: jest.fn(),
    updateUnion: jest.fn(),
    deleteUnion: jest.fn(),
    listLocalFields: jest.fn(),
    createLocalField: jest.fn(),
    updateLocalField: jest.fn(),
    deleteLocalField: jest.fn(),
    listDistricts: jest.fn(),
    createDistrict: jest.fn(),
    updateDistrict: jest.fn(),
    deleteDistrict: jest.fn(),
    listChurches: jest.fn(),
    createChurch: jest.fn(),
    updateChurch: jest.fn(),
    deleteChurch: jest.fn(),
  };

  const mockAdminReferenceService = {
    listRelationshipTypes: jest.fn().mockResolvedValue([]),
    createRelationshipType: jest.fn(),
    updateRelationshipType: jest.fn(),
    deleteRelationshipType: jest.fn(),
    listAllergies: jest.fn(),
    createAllergy: jest.fn(),
    updateAllergy: jest.fn(),
    deleteAllergy: jest.fn(),
    listDiseases: jest.fn(),
    createDisease: jest.fn(),
    updateDisease: jest.fn(),
    deleteDisease: jest.fn(),
    listEcclesiasticalYears: jest.fn(),
    createEcclesiasticalYear: jest.fn(),
    updateEcclesiasticalYear: jest.fn(),
    deleteEcclesiasticalYear: jest.fn(),
  };

  const makeToken = (sub: string, email: string) =>
    jwtService.sign({ sub, email });

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;

    process.env.SUPABASE_JWT_SECRET =
      process.env.SUPABASE_JWT_SECRET || 'test-secret';

    jwtService = new JwtService({
      secret: process.env.SUPABASE_JWT_SECRET,
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AdminGeographyService)
      .useValue(mockAdminGeographyService)
      .overrideProvider(AdminReferenceService)
      .useValue(mockAdminReferenceService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    prisma = app.get(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 when no token is provided', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/countries')
      .send({ name: 'México', abbreviation: 'MX' })
      .expect(401);
  });

  it('should return 403 for non-admin user', async () => {
    const token = makeToken('user-1', 'user@test.com');
    jest.spyOn(prisma.users_roles, 'findMany').mockResolvedValue([
      {
        roles: { role_name: 'user', active: true },
      } as any,
    ]);

    await request(app.getHttpServer())
      .post('/api/v1/admin/countries')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'México', abbreviation: 'MX' })
      .expect(403);
  });

  it('should allow admin to create country', async () => {
    const token = makeToken('admin-1', 'admin@test.com');
    jest.spyOn(prisma.users_roles, 'findMany').mockResolvedValue([
      {
        roles: { role_name: 'admin', active: true },
      } as any,
    ]);

    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/countries')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'México', abbreviation: 'MX' })
      .expect(201);

    expect(response.body.status).toBe('success');
    expect(mockAdminGeographyService.createCountry).toHaveBeenCalled();
  });

  it('should allow admin to list relationship types', async () => {
    const token = makeToken('admin-1', 'admin@test.com');
    jest.spyOn(prisma.users_roles, 'findMany').mockResolvedValue([
      {
        roles: { role_name: 'super_admin', active: true },
      } as any,
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/relationship-types')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.status).toBe('success');
  });
});
