// Must run before `../src/app.module` is required (see certifications spec).
process.env.REDIS_URL = '';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
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
 * Field Payment Orders E2E — kernel + camporee fulfillment (plan §5 matrix).
 *
 * Same architecture as certifications.e2e-spec.ts: PrismaService is replaced
 * with an in-memory auto-mock (no network route to Postgres from this
 * sandbox); everything else is real — routing, JwtAuthGuard (HS256),
 * PermissionsGuard (permissions from the stubbed authorization snapshot),
 * DTO validation, ProofFileValidationPipe (magic bytes), the state machine,
 * and the actual FieldPaymentOrdersService + CamporeeFulfillmentService.
 *
 * Matrix covered over HTTP:
 *  1. create feliz (folio + snapshot de costo)
 *  2. director fuera de alcance → 403
 *  3. transición inválida (approve sobre ISSUED) → 422
 *  4. archivo inválido (mime/magic) → 400
 *  5. reject → re-upload con el mismo folio (sin nueva asignación de folio)
 *  6. maker-checker (mismo usuario sube y aprueba) → 403
 *  7. approve concurrente (P2025 al perder la carrera) → 409
 *  8. rollback de fulfill (elegibilidad rota en approve) → 400 sin aprobar proof
 *  9. flag OFF → 403 FLAG_DISABLED (legacy queda intacto: gates sólo con flag ON)
 */

const DIRECTOR_A_ID = '00000000-0000-0000-0000-000000000201';
const DIRECTOR_B_ID = '00000000-0000-0000-0000-000000000202';
const REVIEWER_ID = '00000000-0000-0000-0000-000000000203';
const OTHER_LF_REVIEWER_ID = '00000000-0000-0000-0000-000000000204';
const BEN_1 = '00000000-0000-4000-8000-000000000301';
const BEN_2 = '00000000-0000-4000-8000-000000000302';

const LF_ID = 7;
const OTHER_LF_ID = 99;
const SECTION_A = 11;
const SECTION_B = 22;
const CLUB_A = 5;
const CAMPOREE_ID = 40;
const ORDER_ID = '10000000-0000-0000-0000-000000000001';
const PROOF_ID = '20000000-0000-0000-0000-000000000001';

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const DIRECTOR_PERMISSIONS = [
  'field-payment-orders:create',
  'field-payment-orders:read',
  'field-payment-orders:upload-proof',
  'field-payment-orders:cancel',
];
const REVIEWER_PERMISSIONS = [
  'field-payment-orders:review',
  'field-payment-orders:read',
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

describe('Field Payment Orders E2E — camporee lifecycle', () => {
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
    [DIRECTOR_B_ID]: {
      profile: { user_id: DIRECTOR_B_ID },
      post_register_complete: true,
      authorization: buildAuthorizationSnapshot({
        activePermissions: DIRECTOR_PERMISSIONS,
        activeRoleName: 'director',
        clubId: 6,
        clubSectionId: SECTION_B,
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
        assignmentId: null,
      }),
      legacy: legacyBlock,
    },
    [OTHER_LF_REVIEWER_ID]: {
      profile: { user_id: OTHER_LF_REVIEWER_ID },
      post_register_complete: true,
      authorization: buildAuthorizationSnapshot({
        globalPermissions: REVIEWER_PERMISSIONS,
        globalRoleName: 'director-lf',
        localFieldId: OTHER_LF_ID,
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
    await app.close();
    throttlerSpy.mockRestore();
  });

  const authHeaders = (userId: string) => ({
    Authorization: `Bearer ${createBearerToken(jwtService, userId)}`,
  });

  const camporeeRow = () => ({
    local_camporee_id: CAMPOREE_ID,
    name: 'Camporee de Conquistadores 2026',
    local_field_id: LF_ID,
    active: true,
    registration_cost: 250,
    member_registration_deadline: FUTURE,
    start_date: new Date('2026-11-20'),
    end_date: new Date('2026-11-23'),
  });

  const orderRow = (overrides: Record<string, unknown> = {}) => ({
    field_payment_order_id: ORDER_ID,
    purpose: 'CAMPOREE',
    local_field_id: LF_ID,
    club_id: CLUB_A,
    club_section_id: SECTION_A,
    folio: 9,
    folio_reference: 'ORD20260009',
    insurance_cycle_config_id: null,
    local_camporee_id: CAMPOREE_ID,
    currency: 'MXN',
    unit_cost_centavos: 25000,
    total_centavos: 50000,
    status: 'ISSUED',
    expires_at: FUTURE,
    created_at: new Date(),
    issued_by_id: DIRECTOR_A_ID,
    lines: [
      {
        field_payment_order_line_id: 'l1',
        beneficiary_user_id: BEN_1,
        sequence: 1,
      },
      {
        field_payment_order_line_id: 'l2',
        beneficiary_user_id: BEN_2,
        sequence: 2,
      },
    ],
    ...overrides,
  });

  const submittedProof = (uploadedBy = DIRECTOR_A_ID) => ({
    field_payment_order_proof_id: PROOF_ID,
    field_payment_order_id: ORDER_ID,
    r2_key: 'field-payment-orders/lf-7/order-x/proof.pdf',
    file_name: 'comprobante.pdf',
    mime_type: 'application/pdf',
    status: 'SUBMITTED',
    uploaded_by_id: uploadedBy,
    created_at: new Date(),
  });

  /** Happy-path wiring shared by create/approve scenarios. */
  const wireHappyDefaults = () => {
    prismaMock.system_config.findUnique.mockImplementation(
      async (args: any) => {
        if (args.where.config_key === 'field_payment_orders_v1') {
          return { config_key: args.where.config_key, config_value: `[${LF_ID}]` };
        }
        if (args.where.config_key === 'field_payment_orders.expiry_days') {
          return { config_key: args.where.config_key, config_value: '15' };
        }
        return null;
      },
    );
    prismaMock.local_camporees.findUnique.mockResolvedValue(camporeeRow());
    prismaMock.club_sections.findUnique.mockImplementation(
      async (args: any) => {
        const id = args.where.club_section_id;
        if (id === SECTION_A) {
          return {
            club_type_id: 1,
            main_club_id: CLUB_A,
            clubs: { club_id: CLUB_A, local_field_id: LF_ID },
          };
        }
        if (id === SECTION_B) {
          return {
            club_type_id: 1,
            main_club_id: 6,
            clubs: { club_id: 6, local_field_id: LF_ID },
          };
        }
        return null;
      },
    );
    prismaMock.camporee_clubs.findFirst.mockResolvedValue({
      camporee_club_id: 70,
    });
    prismaMock.club_role_assignments.findMany.mockResolvedValue([
      { user_id: BEN_1 },
      { user_id: BEN_2 },
    ]);
    prismaMock.camporee_members.findMany.mockResolvedValue([]);
    prismaMock.insurance_assignments.findMany.mockResolvedValue([
      { user_id: BEN_1 },
      { user_id: BEN_2 },
    ]);
    prismaMock.member_insurances.findMany.mockResolvedValue([]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ last_folio: 8 }]);
    prismaMock.$executeRawUnsafe.mockResolvedValue(1);
    prismaMock.field_payment_orders.findMany.mockResolvedValue([]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    wireHappyDefaults();
  });

  // ==========================================================================
  // 1) Create — folio + snapshot de costo
  // ==========================================================================

  it('issues a camporee order with an allocated folio and cost snapshot', async () => {
    prismaMock.field_payment_orders.create.mockImplementation(
      async (args: any) => ({ ...orderRow(), ...args.data, lines: [] }),
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/camporees/${CAMPOREE_ID}/payment-orders`)
      .set(authHeaders(DIRECTOR_A_ID))
      .send({ beneficiary_user_ids: [BEN_1, BEN_2] })
      .expect(201);

    expect(response.body.data).toMatchObject({
      purpose: 'CAMPOREE',
      local_field_id: LF_ID,
      club_section_id: SECTION_A,
      folio: 9,
      unit_cost_centavos: 25000,
      total_centavos: 50000,
    });
    expect(response.body.data.folio_reference).toMatch(/^ORD\d{4}0009$/);
    expect(prismaMock.field_payment_orders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          issued_by_id: DIRECTOR_A_ID,
          local_camporee_id: CAMPOREE_ID,
          lines: {
            create: [
              expect.objectContaining({
                sequence: 1,
                beneficiary_user_id: BEN_1,
                unit_cost_centavos: 25000,
              }),
              expect.objectContaining({
                sequence: 2,
                beneficiary_user_id: BEN_2,
              }),
            ],
          },
        }),
      }),
    );
  });

  it('rejects an empty beneficiary list at the DTO layer', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/camporees/${CAMPOREE_ID}/payment-orders`)
      .set(authHeaders(DIRECTOR_A_ID))
      .send({ beneficiary_user_ids: [] })
      .expect(400);
    expect(prismaMock.field_payment_orders.create).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // 2) Flag OFF — órdenes bloqueadas, legacy intacto
  // ==========================================================================

  it('returns FLAG_DISABLED when the local field is not in the rollout flag', async () => {
    prismaMock.system_config.findUnique.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/camporees/${CAMPOREE_ID}/payment-orders`)
      .set(authHeaders(DIRECTOR_A_ID))
      .send({ beneficiary_user_ids: [BEN_1] })
      .expect(403);

    expect(response.body).toHaveProperty(
      'code',
      'FIELD_PAYMENT_ORDER_FLAG_DISABLED',
    );
    expect(prismaMock.field_payment_orders.create).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // 3) Director fuera de alcance
  // ==========================================================================

  it('forbids a director from another section from reading the order', async () => {
    prismaMock.field_payment_orders.findUnique.mockResolvedValue(orderRow());

    const response = await request(app.getHttpServer())
      .get(`/api/v1/payment-orders/${ORDER_ID}`)
      .set(authHeaders(DIRECTOR_B_ID))
      .expect(403);

    expect(response.body).toHaveProperty(
      'code',
      'FIELD_PAYMENT_ORDER_FORBIDDEN',
    );
  });

  it('forbids a director from another section from uploading a proof', async () => {
    prismaMock.field_payment_orders.findUnique.mockResolvedValue(orderRow());

    await request(app.getHttpServer())
      .post(`/api/v1/payment-orders/${ORDER_ID}/proof`)
      .set(authHeaders(DIRECTOR_B_ID))
      .attach('file', PDF_BUFFER, 'comprobante.pdf')
      .expect(403);
    expect(mockFileStorage.upload).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // 4) Transición inválida — approve directo sobre ISSUED
  // ==========================================================================

  it('rejects approving an ISSUED order without a submitted proof', async () => {
    prismaMock.field_payment_orders.findUnique.mockResolvedValue(orderRow());

    const response = await request(app.getHttpServer())
      .post(`/api/v1/payment-orders/${ORDER_ID}/approve`)
      .set(authHeaders(REVIEWER_ID))
      .expect(422);

    expect(response.body).toHaveProperty(
      'code',
      'FIELD_PAYMENT_ORDER_INVALID_TRANSITION',
    );
  });

  // ==========================================================================
  // 5) Archivo inválido — magic bytes reales del pipe
  // ==========================================================================

  it('rejects a text file disguised as proof before touching storage', async () => {
    prismaMock.field_payment_orders.findUnique.mockResolvedValue(orderRow());

    await request(app.getHttpServer())
      .post(`/api/v1/payment-orders/${ORDER_ID}/proof`)
      .set(authHeaders(DIRECTOR_A_ID))
      .attach('file', Buffer.from('definitely not a pdf'), 'proof.txt')
      .expect(400);
    expect(mockFileStorage.upload).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // 6) Reject → re-upload con el mismo folio
  // ==========================================================================

  it('allows re-uploading a proof after rejection, keeping the same folio', async () => {
    prismaMock.field_payment_orders.findUnique.mockResolvedValue(
      orderRow({ status: 'PROOF_REJECTED' }),
    );
    mockFileStorage.upload.mockResolvedValue({ key: 'r2/new-proof.pdf' });
    prismaMock.field_payment_order_proofs.create.mockResolvedValue(
      submittedProof(),
    );
    prismaMock.field_payment_orders.update.mockResolvedValue(
      orderRow({ status: 'PROOF_SUBMITTED' }),
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/payment-orders/${ORDER_ID}/proof`)
      .set(authHeaders(DIRECTOR_A_ID))
      .attach('file', PDF_BUFFER, 'comprobante-v2.pdf')
      .expect(201);

    expect(response.body.data.order).toMatchObject({
      status: 'PROOF_SUBMITTED',
      folio_reference: 'ORD20260009',
    });
    // No new folio was allocated for the re-upload.
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // 7) Maker-checker
  // ==========================================================================

  it('forbids approving a proof uploaded by the same reviewer', async () => {
    prismaMock.field_payment_orders.findUnique.mockResolvedValue(
      orderRow({ status: 'PROOF_SUBMITTED' }),
    );
    prismaMock.field_payment_order_proofs.findFirst.mockResolvedValue(
      submittedProof(REVIEWER_ID),
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/payment-orders/${ORDER_ID}/approve`)
      .set(authHeaders(REVIEWER_ID))
      .expect(403);

    expect(response.body).toHaveProperty(
      'code',
      'FIELD_PAYMENT_ORDER_MAKER_CHECKER',
    );
  });

  it('forbids a reviewer from another local field from approving', async () => {
    prismaMock.field_payment_orders.findUnique.mockResolvedValue(
      orderRow({ status: 'PROOF_SUBMITTED' }),
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/payment-orders/${ORDER_ID}/approve`)
      .set(authHeaders(OTHER_LF_REVIEWER_ID))
      .expect(403);

    expect(response.body).toHaveProperty(
      'code',
      'FIELD_PAYMENT_ORDER_FORBIDDEN',
    );
  });

  // ==========================================================================
  // 8) Approve feliz — fulfillment camporee dentro de la TX
  // ==========================================================================

  it('approves the order and materializes approved camporee members', async () => {
    prismaMock.field_payment_orders.findUnique.mockResolvedValue(
      orderRow({ status: 'PROOF_SUBMITTED' }),
    );
    prismaMock.field_payment_order_proofs.findFirst.mockResolvedValue(
      submittedProof(DIRECTOR_A_ID),
    );
    prismaMock.field_payment_orders.update.mockResolvedValue(
      orderRow({ status: 'APPROVED' }),
    );
    prismaMock.clubs.findUnique.mockResolvedValue({ name: 'Club Orión' });
    prismaMock.member_insurances.findMany.mockResolvedValue([
      { user_id: BEN_1, insurance_id: 101 },
      { user_id: BEN_2, insurance_id: 102 },
    ]);
    let memberSeq = 0;
    prismaMock.camporee_members.create.mockImplementation(async () => ({
      camporee_member_id: ++memberSeq,
    }));

    const response = await request(app.getHttpServer())
      .post(`/api/v1/payment-orders/${ORDER_ID}/approve`)
      .set(authHeaders(REVIEWER_ID))
      .expect(201);

    expect(response.body.data.status).toBe('APPROVED');
    expect(prismaMock.camporee_members.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.camporee_members.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        camporee_id: CAMPOREE_ID,
        user_id: BEN_1,
        status: 'approved',
        insurance_verified: true,
        insurance_id: 101,
        approved_by: REVIEWER_ID,
      }),
    });
    expect(
      prismaMock.field_payment_order_proofs.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
  });

  // ==========================================================================
  // 9) Rollback de fulfill — elegibilidad rota en el approve
  // ==========================================================================

  it('fails the whole approve when a beneficiary lost insurance, without approving the proof', async () => {
    prismaMock.field_payment_orders.findUnique.mockResolvedValue(
      orderRow({ status: 'PROOF_SUBMITTED' }),
    );
    prismaMock.field_payment_order_proofs.findFirst.mockResolvedValue(
      submittedProof(DIRECTOR_A_ID),
    );
    prismaMock.field_payment_orders.update.mockResolvedValue(
      orderRow({ status: 'APPROVED' }),
    );
    prismaMock.insurance_assignments.findMany.mockResolvedValue([
      { user_id: BEN_1 },
    ]);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/payment-orders/${ORDER_ID}/approve`)
      .set(authHeaders(REVIEWER_ID))
      .expect(400);

    expect(response.body).toHaveProperty(
      'code',
      'FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED',
    );
    expect(prismaMock.camporee_members.create).not.toHaveBeenCalled();
    expect(prismaMock.field_payment_order_proofs.update).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // 10) Approve concurrente — el segundo pierde la carrera
  // ==========================================================================

  it('returns a conflict when a concurrent approve already transitioned the order', async () => {
    prismaMock.field_payment_orders.findUnique.mockResolvedValue(
      orderRow({ status: 'PROOF_SUBMITTED' }),
    );
    prismaMock.field_payment_order_proofs.findFirst.mockResolvedValue(
      submittedProof(DIRECTOR_A_ID),
    );
    prismaMock.field_payment_orders.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/payment-orders/${ORDER_ID}/approve`)
      .set(authHeaders(REVIEWER_ID))
      .expect(409);

    expect(response.body).toHaveProperty(
      'code',
      'FIELD_PAYMENT_ORDER_INVALID_TRANSITION',
    );
    expect(prismaMock.camporee_members.create).not.toHaveBeenCalled();
  });
});
