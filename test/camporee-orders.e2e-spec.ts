// Must run before `../src/app.module` is required (see certifications spec).
process.env.REDIS_URL = '';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://sacdia:sacdia@localhost:5432/sacdia_test';
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET || 'test-secret-test-secret-test-secret';
process.env.R2_BUCKET_HONORS_PDF =
  process.env.R2_BUCKET_HONORS_PDF || 'honors-pdf';
process.env.R2_PUBLIC_URL_HONORS_PDF =
  process.env.R2_PUBLIC_URL_HONORS_PDF || 'https://r2.example/honors-pdf';
process.env.R2_BUCKET_EVIDENCE_FILES =
  process.env.R2_BUCKET_EVIDENCE_FILES || 'evidence-files';
process.env.R2_PUBLIC_URL_EVIDENCE_FILES =
  process.env.R2_PUBLIC_URL_EVIDENCE_FILES || 'https://r2.example/evidence';
process.env.R2_BUCKET_INSURANCE_EVIDENCE =
  process.env.R2_BUCKET_INSURANCE_EVIDENCE || 'insurance-evidence';
process.env.R2_PUBLIC_URL_INSURANCE_EVIDENCE =
  process.env.R2_PUBLIC_URL_INSURANCE_EVIDENCE ||
  'https://r2.example/insurance-evidence';
process.env.R2_BUCKET_DATA_EXPORTS =
  process.env.R2_BUCKET_DATA_EXPORTS || 'data-exports';
process.env.R2_PUBLIC_URL_DATA_EXPORTS =
  process.env.R2_PUBLIC_URL_DATA_EXPORTS || 'https://r2.example/data-exports';
process.env.R2_BUCKET_MONTHLY_REPORTS =
  process.env.R2_BUCKET_MONTHLY_REPORTS || 'monthly-reports';
process.env.R2_PUBLIC_URL_MONTHLY_REPORTS =
  process.env.R2_PUBLIC_URL_MONTHLY_REPORTS ||
  'https://r2.example/monthly-reports';
process.env.R2_BUCKET_RESOURCES_FILES =
  process.env.R2_BUCKET_RESOURCES_FILES || 'resources-files';
process.env.R2_PUBLIC_URL_RESOURCES_FILES =
  process.env.R2_PUBLIC_URL_RESOURCES_FILES ||
  'https://r2.example/resources-files';
process.env.EMAIL_ENABLED = process.env.EMAIL_ENABLED || 'false';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_key';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthorizationContextService } from '../src/common/services/authorization-context.service';
import { FILE_STORAGE_SERVICE } from '../src/common/services/file-storage.service';
import { UserAwareThrottlerGuard } from '../src/config/user-aware-throttler.guard';
import {
  buildAuthorizationSnapshot,
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

/**
 * Camporee Orders E2E — PDF/proof/delivery cycle.
 *
 * Same architecture as field-payment-orders.e2e-spec.ts: PrismaService is
 * replaced with an in-memory auto-mock (no network route to Postgres);
 * everything else is real — routing, JwtAuthGuard (HS256), PermissionsGuard,
 * DTO validation, ProofFileValidationPipe (magic bytes), the state machine,
 * and CamporeeOrdersService.
 */

const DIRECTOR_A_ID = '00000000-0000-4000-8000-000000000201';
const TREASURER_ID = '00000000-0000-4000-8000-000000000205';
const REVIEWER_ID = '00000000-0000-4000-8000-000000000203';
const MEMBER_USER = '00000000-0000-4000-8000-000000000301';

const LF_ID = 7;
const SECTION_A = 11;
const CLUB_A = 5;
const CAMPOREE_ID = 40;
const MEMBER_ID = 801;
const ORDER_ID = '10000000-0000-4000-8000-000000000001';
const LINE_ID = '30000000-0000-4000-8000-000000000001';
const PROOF_ID = '20000000-0000-4000-8000-000000000001';
const OFFERING_ID = '99999999-9999-4999-8999-999999999999';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OPTION_ID = '77777777-7777-4777-8777-777777777777';

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const DIRECTOR_PERMISSIONS = [
  'camporee-orders:create',
  'camporee-orders:read',
  'camporee-orders:upload-proof',
  'camporee-orders:distribute',
];
const TREASURER_PERMISSIONS = [
  'camporee-orders:create',
  'camporee-orders:read',
  'camporee-orders:upload-proof',
];
const REVIEWER_PERMISSIONS = [
  'camporee-orders:review',
  'camporee-orders:read',
  'camporee-orders:authorize-without-proof',
  'camporee-orders:deliver',
];

const PDF_BUFFER = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.alloc(64, 0x20),
]);

function isThenLike(prop: string | symbol): boolean {
  return (
    typeof prop === 'symbol' ||
    prop === 'then' ||
    prop === 'catch' ||
    prop === 'finally'
  );
}

function createModelMock(): any {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(_target: any, prop: string | symbol) {
      if (isThenLike(prop)) return undefined;
      if (prop in target) return target[prop as string];
      const fn = jest.fn().mockResolvedValue(null);
      target[prop as string] = fn;
      return fn;
    },
  });
}

function createAutoMock(seed: Record<string, unknown> = {}): any {
  const target: Record<string, unknown> = { ...seed };
  return new Proxy(target, {
    get(_target: any, prop: string | symbol) {
      if (isThenLike(prop)) return undefined;
      if (prop in target) return target[prop as string];
      const mock =
        typeof prop === 'string' && prop.startsWith('$')
          ? jest.fn().mockResolvedValue(null)
          : createModelMock();
      target[prop as string] = mock;
      return mock;
    },
  });
}

describe('Camporee Orders E2E — proof and two-level delivery', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prismaMock: any;
  let throttlerSpy: jest.SpyInstance;

  const mockFileStorage = {
    getSignedUploadUrl: jest.fn(),
    getObjectInfo: jest.fn(),
    upload: jest.fn(),
    deleteMany: jest.fn(),
    extractKeyFromPublicUrl: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    resolvePublicUrl: jest.fn(),
  };

  const legacyBlock = {
    roles: [],
    permissions: [],
    club: null,
    club_context: { active_assignment_id: null, active: null, available: [] },
  };

  const profiles: Record<string, any> = {
    [DIRECTOR_A_ID]: {
      profile: { user_id: DIRECTOR_A_ID },
      post_register_complete: true,
      authorization: buildAuthorizationSnapshot({
        activePermissions: DIRECTOR_PERMISSIONS,
        activeRoleName: 'director',
        clubId: CLUB_A,
        clubSectionId: SECTION_A,
        localFieldId: LF_ID,
      }),
      legacy: legacyBlock,
    },
    [TREASURER_ID]: {
      profile: { user_id: TREASURER_ID },
      post_register_complete: true,
      authorization: buildAuthorizationSnapshot({
        activePermissions: TREASURER_PERMISSIONS,
        activeRoleName: 'treasurer',
        clubId: CLUB_A,
        clubSectionId: SECTION_A,
        localFieldId: LF_ID,
      }),
      legacy: legacyBlock,
    },
    [REVIEWER_ID]: {
      profile: { user_id: REVIEWER_ID },
      post_register_complete: true,
      authorization: buildAuthorizationSnapshot({
        globalPermissions: REVIEWER_PERMISSIONS,
        globalRoleName: 'director-lf',
        localFieldId: LF_ID,
        unionId: 2,
        assignmentId: null,
      }),
      legacy: legacyBlock,
    },
  };

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(async (userId: string) => {
      return (
        profiles[userId] ?? {
          profile: { user_id: userId },
          post_register_complete: true,
          authorization: buildAuthorizationSnapshot({}),
          legacy: legacyBlock,
        }
      );
    }),
    canManageClub: jest.fn().mockResolvedValue(false),
    canAccessHierarchyScope: jest.fn().mockReturnValue(false),
  };

  beforeAll(async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET || 'test-secret';

    jwtService = createTestJwtService();
    throttlerSpy = jest
      .spyOn(UserAwareThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FILE_STORAGE_SERVICE)
      .useValue(mockFileStorage)
      .overrideProvider(AuthorizationContextService)
      .useValue(mockAuthorizationContext)
      .overrideProvider(PrismaService)
      .useValue(
        createAutoMock({
          $transaction: jest.fn(async (arg: unknown) =>
            typeof arg === 'function'
              ? (arg as (tx: unknown) => Promise<unknown>)(prismaMock)
              : Promise.all(arg as Array<Promise<unknown>>),
          ),
        }),
      )
      .compile();

    prismaMock = moduleFixture.get(PrismaService);

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    throttlerSpy?.mockRestore();
  });

  const authHeaders = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(jwtService, userId)}`,
  });

  const orderRow = (overrides: Record<string, unknown> = {}) => ({
    camporee_order_id: ORDER_ID,
    local_field_id: LF_ID,
    club_id: CLUB_A,
    club_section_id: SECTION_A,
    local_camporee_id: CAMPOREE_ID,
    union_camporee_id: null,
    folio: 9,
    folio_reference: 'PED20260009',
    status: 'ISSUED',
    currency: 'MXN',
    total_centavos: 15000,
    expires_at: FUTURE,
    issued_by_id: DIRECTOR_A_ID,
    approved_by_id: null,
    approved_at: null,
    authorized_without_proof: false,
    authorized_by_id: null,
    authorized_at: null,
    authorization_reason: null,
    delivered_to_section_by_id: null,
    delivered_to_section_at: null,
    bank_name: 'BBVA',
    bank_account: '123456',
    bank_clabe: '012345678901234567',
    bank_holder: 'Asociacion',
    cash_instructions: 'Caja LF',
    extra_notes: 'Usar folio PED',
    created_at: new Date(),
    modified_at: new Date(),
    lines: [
      {
        camporee_order_line_id: LINE_ID,
        sequence: 1,
        camporee_member_id: MEMBER_ID,
        beneficiary_user_id: MEMBER_USER,
        beneficiary_name_snapshot: 'Ana Garcia',
        offering_id: OFFERING_ID,
        product_id: PRODUCT_ID,
        option_id: OPTION_ID,
        product_title_snapshot: 'Playera',
        option_label_snapshot: 'M',
        qty: 1,
        unit_price_centavos: 15000,
        line_total_centavos: 15000,
        delivered_to_member_at: null,
        delivered_to_member_by_id: null,
      },
    ],
    ...overrides,
  });

  const submittedProof = (uploadedBy = DIRECTOR_A_ID) => ({
    camporee_order_proof_id: PROOF_ID,
    order_id: ORDER_ID,
    r2_key: 'camporee-orders/lf-7/order-x/proof.pdf',
    file_name: 'comprobante.pdf',
    mime_type: 'application/pdf',
    status: 'SUBMITTED',
    uploaded_by_id: uploadedBy,
    created_at: new Date(),
  });

  const wireHappyDefaults = () => {
    prismaMock.camporee_orders.findMany.mockResolvedValue([]);
    prismaMock.camporee_orders.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.camporee_orders.findFirst.mockResolvedValue(null);
    prismaMock.system_config.findUnique.mockResolvedValue(null);
    prismaMock.local_camporees.findUnique.mockResolvedValue({
      orders_enabled: true,
      orders_opens_at: null,
      orders_deadline: FUTURE,
      end_date: new Date(Date.UTC(2026, 11, 31)),
      timezone: 'America/Mexico_City',
      name: 'Camporee de Conquistadores 2026',
    });
    prismaMock.field_payment_order_configs.findUnique.mockResolvedValue({
      local_field_id: LF_ID,
      active: true,
      bank_name: 'BBVA',
      bank_account: '123456',
      bank_clabe: '012345678901234567',
      bank_holder: 'Asociacion',
      cash_instructions: 'Caja LF',
      extra_notes: 'Usar folio PED',
    });
    prismaMock.camporee_clubs.findFirst.mockResolvedValue({
      camporee_club_id: 70,
    });
    prismaMock.camporee_members.findMany.mockResolvedValue([
      {
        camporee_member_id: MEMBER_ID,
        user_id: MEMBER_USER,
        active: true,
        status: 'approved',
        camporee_id: CAMPOREE_ID,
        union_camporee_id: null,
        camporee_club: {
          club_section_id: SECTION_A,
          active: true,
          status: 'approved',
        },
        users: {
          name: 'Ana',
          paternal_last_name: 'Garcia',
          maternal_last_name: null,
        },
      },
    ]);
    prismaMock.camporee_order_offerings.findMany.mockResolvedValue([
      {
        camporee_order_offering_id: OFFERING_ID,
        local_camporee_id: CAMPOREE_ID,
        union_camporee_id: null,
        product_id: PRODUCT_ID,
        price_centavos: 15000,
        active: true,
        product: {
          camporee_order_product_id: PRODUCT_ID,
          title: 'Playera',
          size_scheme: 'LETTER',
          active: true,
          options: [
            {
              camporee_order_product_option_id: OPTION_ID,
              product_id: PRODUCT_ID,
              label: 'M',
              active: true,
            },
          ],
        },
      },
    ]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ last_folio: 8 }]);
    prismaMock.$executeRawUnsafe.mockResolvedValue(1);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    wireHappyDefaults();
  });

  it('issues a camporee order with an allocated PED folio and named lines', async () => {
    prismaMock.camporee_orders.create.mockImplementation(async (args: any) => {
      const { lines, ...header } = args.data;
      return {
        camporee_order_id: ORDER_ID,
        ...header,
        created_at: new Date(),
        modified_at: new Date(),
        lines: (lines.create as any[]).map((line: any, index: number) => ({
          camporee_order_line_id: LINE_ID,
          delivered_to_member_at: null,
          delivered_to_member_by_id: null,
          ...line,
          sequence: index + 1,
        })),
      };
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/camporees/${CAMPOREE_ID}/orders`)
      .set(authHeaders(DIRECTOR_A_ID))
      .send({
        lines: [
          {
            camporee_member_id: MEMBER_ID,
            offering_id: OFFERING_ID,
            option_id: OPTION_ID,
            qty: 1,
          },
        ],
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      folio_reference: expect.stringMatching(/^PED\d{4}0009$/),
      status: 'ISSUED',
      total_centavos: 15000,
      club_section_id: SECTION_A,
      distribution_status: 'NOT_STARTED',
    });
    expect(prismaMock.camporee_orders.create).toHaveBeenCalled();
  });

  it('rejects a text file disguised as proof before touching storage', async () => {
    prismaMock.camporee_orders.findUnique.mockResolvedValue(orderRow());

    const response = await request(app.getHttpServer())
      .post(`/api/v1/camporee-orders/${ORDER_ID}/proof`)
      .set(authHeaders(DIRECTOR_A_ID))
      .attach('file', Buffer.from('definitely not a pdf'), 'proof.txt')
      .expect(400);

    expect(response.body).toHaveProperty(
      'code',
      'CAMPOREE_ORDER_PROOF_INVALID_FILE',
    );
    expect(mockFileStorage.upload).not.toHaveBeenCalled();
  });

  it('forbids approving a proof uploaded by the same reviewer', async () => {
    prismaMock.camporee_orders.findUnique.mockResolvedValue(
      orderRow({ status: 'PROOF_SUBMITTED' }),
    );
    prismaMock.camporee_order_proofs.findFirst.mockResolvedValue(
      submittedProof(REVIEWER_ID),
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/camporee-orders/${ORDER_ID}/approve`)
      .set(authHeaders(REVIEWER_ID))
      .expect(403);

    expect(response.body).toHaveProperty(
      'code',
      'CAMPOREE_ORDER_MAKER_CHECKER',
    );
  });

  it('forbids club leadership from authorize-without-proof', async () => {
    prismaMock.camporee_orders.findUnique.mockResolvedValue(orderRow());

    const response = await request(app.getHttpServer())
      .post(`/api/v1/camporee-orders/${ORDER_ID}/authorize-without-proof`)
      .set(authHeaders(DIRECTOR_A_ID))
      .send({ reason: 'pago en caja' })
      .expect(403);

    expect(prismaMock.camporee_orders.update).not.toHaveBeenCalled();
    expect(response.body.code).toBeDefined();
  });

  it('lets the Campo Local authorize without proof and then deliver', async () => {
    let current = orderRow();
    prismaMock.camporee_orders.findUnique.mockImplementation(async () => current);
    prismaMock.camporee_orders.update.mockImplementation(async (args: any) => {
      current = { ...current, ...args.data };
      return current;
    });

    const authorized = await request(app.getHttpServer())
      .post(`/api/v1/camporee-orders/${ORDER_ID}/authorize-without-proof`)
      .set(authHeaders(REVIEWER_ID))
      .send({ reason: 'pago en caja del Campo Local' })
      .expect(201);

    expect(authorized.body.data).toMatchObject({
      status: 'PAID',
      authorized_without_proof: true,
    });

    const delivered = await request(app.getHttpServer())
      .post(`/api/v1/camporee-orders/${ORDER_ID}/deliver`)
      .set(authHeaders(REVIEWER_ID))
      .expect(201);

    expect(delivered.body.data.status).toBe('DELIVERED');
  });

  it('forbids a treasurer from marking named delivery to a member', async () => {
    prismaMock.camporee_orders.findUnique.mockResolvedValue(
      orderRow({ status: 'DELIVERED' }),
    );

    await request(app.getHttpServer())
      .post(
        `/api/v1/camporee-orders/${ORDER_ID}/lines/${LINE_ID}/deliver-to-member`,
      )
      .set(authHeaders(TREASURER_ID))
      .expect(403);
  });
});
