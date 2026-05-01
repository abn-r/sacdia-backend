import {
  CanActivate,
  ExecutionContext,
  Injectable,
  INestApplication,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/common/guards';
import { InsuranceService } from '../src/insurance/insurance.service';

// Stable UUID fixtures — deterministic across runs; required because
// users.user_id and related FK columns are declared @db.Uuid in Prisma schema.
// Passing non-UUID strings (e.g. "insured-user-1") raises P2007.
const FIX_USER_SUB = '00000000-0000-0000-0000-000000000001';
const FIX_MEMBER_ID = '00000000-0000-0000-0000-000000000002';

const TEST_USER = {
  sub: FIX_USER_SUB,
  email: 'insurance@test.local',
};

@Injectable()
class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = TEST_USER;
    return true;
  }
}

describe('Insurance E2E', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const mockInsuranceService = {
    listMembersInsurance: jest.fn(),
    getMemberInsurance: jest.fn(),
    createInsurance: jest.fn(),
    updateInsurance: jest.fn(),
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
      .overrideProvider(InsuranceService)
      .useValue(mockInsuranceService)
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
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

  const authHeaders = () => ({
    Authorization: `Bearer ${jwtService.sign(TEST_USER)}`,
  });

  it('GET /clubs/:clubId/sections/:sectionId/members/insurance returns the mapped list', async () => {
    mockInsuranceService.listMembersInsurance.mockResolvedValue([
      {
        user_id: FIX_MEMBER_ID,
        name: 'Juan',
        paternal_last_name: 'García',
        maternal_last_name: 'López',
        user_image: 'https://cdn.example/users/member-1.png',
        current_class: { name: 'Explorador' },
        insurance: {
          insurance_id: 101,
          insurance_type: 'GENERAL_ACTIVITIES',
          policy_number: 'POL-001',
          provider: 'Seguros SACDIA',
          start_date: '2025-01-01',
          end_date: '2025-12-31',
          coverage_amount: 500,
          active: true,
          evidence_file_url: 'https://cdn.example/evidence/pol-001.pdf',
          evidence_file_name: 'comprobante.pdf',
          created_at: '2025-01-02T10:00:00.000Z',
          modified_at: '2025-01-03T10:00:00.000Z',
          created_by_name: 'Director General',
          modified_by_name: null,
        },
      },
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/v1/clubs/9/sections/42/members/insurance')
      .set(authHeaders())
      .expect(200);

    expect(response.body).toEqual({
      status: 'success',
      data: [
        {
          user_id: FIX_MEMBER_ID,
          name: 'Juan',
          paternal_last_name: 'García',
          maternal_last_name: 'López',
          user_image: 'https://cdn.example/users/member-1.png',
          current_class: { name: 'Explorador' },
          insurance: expect.objectContaining({
            insurance_id: 101,
            insurance_type: 'GENERAL_ACTIVITIES',
            policy_number: 'POL-001',
            provider: 'Seguros SACDIA',
          }),
        },
      ],
    });

    expect(mockInsuranceService.listMembersInsurance).toHaveBeenCalledWith(
      9,
      42,
    );
  });

  it('GET /users/:memberId/insurance returns the member insurance detail', async () => {
    mockInsuranceService.getMemberInsurance.mockResolvedValue({
      user_id: FIX_MEMBER_ID,
      name: 'Juan',
      paternal_last_name: 'García',
      maternal_last_name: 'López',
      user_image: 'https://cdn.example/users/member-1.png',
      current_class: { name: 'Explorador' },
      insurance: {
        insurance_id: 101,
        insurance_type: 'GENERAL_ACTIVITIES',
        policy_number: 'POL-001',
        provider: 'Seguros SACDIA',
        start_date: '2025-01-01',
        end_date: '2025-12-31',
        coverage_amount: 500,
        active: true,
        evidence_file_url: 'https://cdn.example/evidence/pol-001.pdf',
        evidence_file_name: 'comprobante.pdf',
        created_at: '2025-01-02T10:00:00.000Z',
        modified_at: '2025-01-03T10:00:00.000Z',
        created_by_name: 'Director General',
        modified_by_name: null,
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/users/${FIX_MEMBER_ID}/insurance`)
      .set(authHeaders())
      .expect(200);

    expect(response.body).toEqual({
      status: 'success',
      data: expect.objectContaining({
        user_id: FIX_MEMBER_ID,
        insurance: expect.objectContaining({
          insurance_id: 101,
        }),
      }),
    });
    expect(mockInsuranceService.getMemberInsurance).toHaveBeenCalledWith(
      FIX_MEMBER_ID,
    );
  });

  it('POST /users/:memberId/insurance accepts multipart uploads and forwards the current user', async () => {
    mockInsuranceService.createInsurance.mockResolvedValue({
      insurance_id: 202,
      insurance_type: 'CAMPOREE',
      policy_number: 'POL-202',
      provider: 'Aseguradora Nacional',
      evidence_file_url: 'https://cdn.example/evidence/pol-202.pdf',
      evidence_file_name: 'poliza.pdf',
      created_by_id: TEST_USER.sub,
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/users/${FIX_MEMBER_ID}/insurance`)
      .set(authHeaders())
      .field('insurance_type', 'CAMPOREE')
      .field('policy_number', 'POL-202')
      .field('provider', 'Aseguradora Nacional')
      .field('start_date', '2025-02-01')
      .field('end_date', '2025-12-31')
      .field('coverage_amount', '1200')
      .attach(
        'evidence',
        Buffer.from('%PDF-1.4\ninsurance evidence'),
        'poliza.pdf',
      )
      .expect(201);

    expect(response.body).toEqual({
      status: 'success',
      data: expect.objectContaining({
        insurance_id: 202,
        evidence_file_name: 'poliza.pdf',
      }),
    });

    expect(mockInsuranceService.createInsurance).toHaveBeenCalledTimes(1);
    const [memberId, body, file, user] =
      mockInsuranceService.createInsurance.mock.calls[0];
    expect(memberId).toBe(FIX_MEMBER_ID);
    expect(body).toEqual(
      expect.objectContaining({
        insurance_type: 'CAMPOREE',
        policy_number: 'POL-202',
        provider: 'Aseguradora Nacional',
        start_date: '2025-02-01',
        end_date: '2025-12-31',
        coverage_amount: '1200',
      }),
    );
    expect(file).toEqual(
      expect.objectContaining({
        originalname: 'poliza.pdf',
        mimetype: 'application/pdf',
      }),
    );
    expect(user).toBe(TEST_USER.sub);
  });

  it('PATCH /insurance/:insuranceId accepts multipart form data without requiring a file', async () => {
    mockInsuranceService.updateInsurance.mockResolvedValue({
      insurance_id: 202,
      insurance_type: 'CAMPOREE',
      provider: 'Aseguradora Nacional Plus',
      evidence_file_url: 'https://cdn.example/evidence/pol-202.pdf',
      evidence_file_name: 'poliza.pdf',
      modified_by_id: TEST_USER.sub,
    });

    const response = await request(app.getHttpServer())
      .patch('/api/v1/insurance/202')
      .set(authHeaders())
      .field('provider', 'Aseguradora Nacional Plus')
      .field('active', 'false')
      .expect(200);

    expect(response.body).toEqual({
      status: 'success',
      data: expect.objectContaining({
        insurance_id: 202,
        provider: 'Aseguradora Nacional Plus',
      }),
    });
    expect(mockInsuranceService.updateInsurance).toHaveBeenCalledTimes(1);

    const [insuranceId, body, file, user] =
      mockInsuranceService.updateInsurance.mock.calls[0];
    expect(insuranceId).toBe(202);
    expect(body).toEqual(
      expect.objectContaining({
        provider: 'Aseguradora Nacional Plus',
        active: 'false',
      }),
    );
    expect(file).toBeUndefined();
    expect(user).toBe(TEST_USER.sub);
  });
});
