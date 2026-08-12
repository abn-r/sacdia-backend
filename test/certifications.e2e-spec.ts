// Must run before `../src/app.module` is required: its `@Module` decorator
// calls `buildBullRootConfig()` at import time, which reads
// `process.env.REDIS_URL` synchronously to decide whether to register a real
// BullMQ connection. An empty string is the documented "disabled" value
// (envValidationSchema allows '' when EMAIL_ENABLED !== 'true', and both
// buildBullRootConfig/buildCacheOptions treat a falsy value as "no Redis"),
// so it keeps this suite isolated from whatever Redis happens to be
// reachable on the machine running the tests. Because the key already
// exists on `process.env` (even as ''), dotenv's later load inside
// `ConfigModule.forRoot()` will not overwrite it, so `buildCacheOptions()`
// also falls back to the in-memory cache instead of probing a real
// connection.
process.env.REDIS_URL = '';

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
 * Certifications E2E — configurable certifications engine (Tasks 6–8).
 *
 * This module cannot reach the real Neon database from this sandbox (no
 * network route to Postgres), so PrismaService is replaced end-to-end with an
 * in-memory double instead of the "real AppModule + jest.spyOn(prisma, ...)"
 * pattern used by other *.e2e-spec.ts files. Every other layer is real:
 * routing, JwtAuthGuard (real HS256 verification), PermissionsGuard (real
 * permission + institutional-scope checks), DTO validation, and the actual
 * certifications services/state machine. Only AuthorizationContextService
 * (which itself does DB-backed role resolution) and FILE_STORAGE_SERVICE
 * (R2) are stubbed, matching how other suites stub external I/O.
 *
 * The four scenarios required by the task run as one continuous story
 * because they share mutable enrollment/requirement state:
 *   1. Participant uploads requirement evidence (presign → confirm).
 *   2. In-scope reviewer approves the (now SUBMITTED) requirement —
 *      enrollment auto-advances to READY_FOR_CLOSEOUT.
 *   3. Out-of-scope reviewer is rejected with CERT_REVIEW_SCOPE_FORBIDDEN.
 *   4. Full closeout: board-proof evidence → submit-final → reviewer
 *      approves the closeout evidence → certify (idempotent on retry).
 */

// Stable UUID fixtures — users.user_id and related FKs are @db.Uuid in Prisma.
const PARTICIPANT_ID = '00000000-0000-0000-0000-000000000101';
const REVIEWER_IN_SCOPE_ID = '00000000-0000-0000-0000-000000000102';
const REVIEWER_OUT_OF_SCOPE_ID = '00000000-0000-0000-0000-000000000103';

const CERTIFICATION_ID = 1;
const VERSION_ID = 7;
const ENROLLMENT_ID = 500;
const SECTION_ID = 10;
const MODULE_ID = 1;
const COMPONENT_ID = 20;
const PROGRESS_ID = 900;
const EVIDENCE_ID = 3000;
const RESPONSE_ID = 4000;
const CLOSEOUT_EVIDENCE_ID = 5000;

const IN_SCOPE_LOCAL_FIELD_ID = 10;
const OUT_OF_SCOPE_LOCAL_FIELD_ID = 99;

/** `then`/`catch`/`finally`/symbols must never be auto-vivified below: a
 * Proxy that hands back a function for `.then` makes the whole mock look
 * "thenable" to the JS engine. Any generic `await mock` (not calling a
 * specific method — e.g. Nest's DI resolving a `useValue` provider, or any
 * `Promise.resolve(mock)`) then calls that fake `.then(resolve, reject)`,
 * which never invokes either callback — an unresolvable await with an empty
 * JS stack and no pending I/O, indistinguishable from a native hang. */
function isThenLike(prop: string | symbol): boolean {
  return (
    typeof prop === 'symbol' ||
    prop === 'then' ||
    prop === 'catch' ||
    prop === 'finally'
  );
}

/** Auto-vivifying `prisma.<model>.<method>()` double: accessing any method
 * name lazily creates a `resolves-to-null` jest mock so tests only need to
 * wire the calls they actually assert on. */
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

/** Builds a Proxy whose top-level properties are Prisma model doubles (see
 * `createModelMock`), auto-creating one for any model not explicitly seeded.
 * Prisma's own top-level methods (`$transaction`, `$connect`, `$queryRaw`,
 * …) are callable directly, so any unseeded `$`-prefixed property falls back
 * to a plain jest mock instead of a nested model double. This keeps the
 * double resilient to Prisma calls made by unrelated code paths that happen
 * to run during app bootstrap. */
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

describe('Certifications E2E — evidence, review tray, and closeout', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prismaMock: any;

  // `APP_GUARD` is a Nest "multi" provider token — `overrideProvider(APP_GUARD)`
  // does not reliably replace a `useClass`-registered global guard bound
  // through it, so this suite disables real throttling with a prototype spy
  // instead, which affects every instance regardless of how it was resolved.
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

  const reviewerProfiles: Record<string, any> = {};

  /** Any authenticated user without an explicit fixture (e.g. a participant
   * hitting a route they don't own) resolves to a profile with zero global
   * permissions — matching production behavior for a plain member account. */
  const buildNoPermissionProfile = (userId: string) => ({
    profile: { user_id: userId },
    post_register_complete: true,
    authorization: buildAuthorizationSnapshot({}),
    legacy: {
      roles: [],
      permissions: [],
      club: null,
      club_context: { active_assignment_id: null, active: null, available: [] },
    },
  });

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(async (userId: string) => {
      return reviewerProfiles[userId] ?? buildNoPermissionProfile(userId);
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

    reviewerProfiles[REVIEWER_IN_SCOPE_ID] = {
      profile: { user_id: REVIEWER_IN_SCOPE_ID },
      post_register_complete: true,
      authorization: buildAuthorizationSnapshot({
        globalPermissions: ['certifications:review', 'certifications:certify'],
        globalRoleName: 'director-lf',
        localFieldId: IN_SCOPE_LOCAL_FIELD_ID,
      }),
      legacy: {
        roles: [],
        permissions: [],
        club: null,
        club_context: {
          active_assignment_id: null,
          active: null,
          available: [],
        },
      },
    };
    reviewerProfiles[REVIEWER_OUT_OF_SCOPE_ID] = {
      profile: { user_id: REVIEWER_OUT_OF_SCOPE_ID },
      post_register_complete: true,
      authorization: buildAuthorizationSnapshot({
        globalPermissions: ['certifications:review', 'certifications:certify'],
        globalRoleName: 'director-lf',
        localFieldId: OUT_OF_SCOPE_LOCAL_FIELD_ID,
      }),
      legacy: {
        roles: [],
        permissions: [],
        club: null,
        club_context: {
          active_assignment_id: null,
          active: null,
          available: [],
        },
      },
    };

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

  const enrollment = () => ({
    enrollment_id: ENROLLMENT_ID,
    user_id: PARTICIPANT_ID,
    certification_id: CERTIFICATION_ID,
    certification_version_id: VERSION_ID,
    status: 'IN_PROGRESS',
  });

  const section = () => ({
    section_id: SECTION_ID,
    module_id: MODULE_ID,
    certification_requirement_components: [
      { component_id: COMPONENT_ID, component_type: 'FILE_EVIDENCE' },
    ],
  });

  // ==========================================================================
  // 1) Participant — requirement evidence presign + confirm (Task 6)
  // ==========================================================================

  describe('Scenario 1 — participant uploads requirement evidence', () => {
    it('rejects a disallowed MIME type at the DTO whitelist before touching the database', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/users/${PARTICIPANT_ID}/certification-enrollments/${ENROLLMENT_ID}/requirements/${SECTION_ID}/evidences/presign`,
        )
        .set(authHeaders(PARTICIPANT_ID))
        .send({
          component_id: COMPONENT_ID,
          file_name: 'malware.exe',
          mime_type: 'application/x-msdownload',
          file_size: 1024,
        })
        .expect(400);

      expect(
        prismaMock.users_certifications.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('rejects a declared size over the limit with a stable domain error code', async () => {
      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/users/${PARTICIPANT_ID}/certification-enrollments/${ENROLLMENT_ID}/requirements/${SECTION_ID}/evidences/presign`,
        )
        .set(authHeaders(PARTICIPANT_ID))
        .send({
          component_id: COMPONENT_ID,
          file_name: 'comprobante.pdf',
          mime_type: 'application/pdf',
          file_size: 50 * 1024 * 1024,
        })
        .expect(400);

      expect(response.body).toHaveProperty('code', 'CERT_EVIDENCE_TOO_LARGE');
    });

    it('presigns a valid PDF and creates the evidence as PENDING_UPLOAD', async () => {
      prismaMock.users_certifications.findFirst.mockResolvedValueOnce(
        enrollment(),
      );
      prismaMock.certification_sections.findFirst.mockResolvedValueOnce(
        section(),
      );
      prismaMock.certification_section_progress.findFirst.mockResolvedValueOnce(
        null,
      );
      prismaMock.certification_section_progress.create.mockResolvedValueOnce({
        progress_id: PROGRESS_ID,
      });
      prismaMock.certification_component_responses.upsert.mockResolvedValueOnce(
        { response_id: RESPONSE_ID },
      );
      mockFileStorage.getSignedUploadUrl.mockResolvedValueOnce({
        url: 'https://r2.example.com/signed-put',
        key: `enrollment-${ENROLLMENT_ID}/requirement-${SECTION_ID}/component-${COMPONENT_ID}/fixed-uuid.pdf`,
        expiresInSeconds: 900,
      });
      prismaMock.certification_evidences.create.mockResolvedValueOnce({
        evidence_id: EVIDENCE_ID,
      });

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/users/${PARTICIPANT_ID}/certification-enrollments/${ENROLLMENT_ID}/requirements/${SECTION_ID}/evidences/presign`,
        )
        .set(authHeaders(PARTICIPANT_ID))
        .send({
          component_id: COMPONENT_ID,
          file_name: 'comprobante.pdf',
          mime_type: 'application/pdf',
          file_size: 20480,
        })
        .expect(201);

      expect(response.body).toEqual({
        status: 'success',
        data: expect.objectContaining({
          evidence_id: EVIDENCE_ID,
          upload_url: 'https://r2.example.com/signed-put',
        }),
      });
      expect(
        prismaMock.certification_evidences.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            response_id: RESPONSE_ID,
            upload_status: 'PENDING_UPLOAD',
            uploaded_by_id: PARTICIPANT_ID,
          }),
        }),
      );
    });

    it('confirms the upload once R2 reports a matching object', async () => {
      prismaMock.users_certifications.findFirst.mockResolvedValueOnce(
        enrollment(),
      );
      prismaMock.certification_sections.findFirst.mockResolvedValueOnce(
        section(),
      );
      prismaMock.certification_section_progress.findFirst.mockResolvedValueOnce(
        { progress_id: PROGRESS_ID, status: 'DRAFT' },
      );
      prismaMock.certification_evidences.findFirst.mockResolvedValueOnce({
        evidence_id: EVIDENCE_ID,
        object_key: `enrollment-${ENROLLMENT_ID}/requirement-${SECTION_ID}/component-${COMPONENT_ID}/fixed-uuid.pdf`,
        mime_type: 'application/pdf',
        size_bytes: BigInt(20480),
        checksum_sha256: null,
      });
      mockFileStorage.getObjectInfo.mockResolvedValueOnce({
        size: 20480,
        contentType: 'application/pdf',
      });
      prismaMock.certification_evidences.update.mockResolvedValueOnce({
        evidence_id: EVIDENCE_ID,
        object_key: `enrollment-${ENROLLMENT_ID}/requirement-${SECTION_ID}/component-${COMPONENT_ID}/fixed-uuid.pdf`,
        original_filename: 'comprobante.pdf',
        mime_type: 'application/pdf',
        size_bytes: BigInt(20480),
        upload_status: 'CONFIRMED',
        confirmed_at: new Date('2026-01-01T00:00:00.000Z'),
      });

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/users/${PARTICIPANT_ID}/certification-enrollments/${ENROLLMENT_ID}/requirements/${SECTION_ID}/evidences/confirm`,
        )
        .set(authHeaders(PARTICIPANT_ID))
        .send({ evidence_id: EVIDENCE_ID })
        .expect(201);

      expect(response.body.data).toMatchObject({
        evidence_id: EVIDENCE_ID,
        upload_status: 'CONFIRMED',
      });
    });

    it('blocks a participant from acting on another user (owner mismatch → 403)', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/users/${REVIEWER_IN_SCOPE_ID}/certification-enrollments/${ENROLLMENT_ID}/requirements/${SECTION_ID}/evidences/presign`,
        )
        .set(authHeaders(PARTICIPANT_ID))
        .send({
          component_id: COMPONENT_ID,
          file_name: 'comprobante.pdf',
          mime_type: 'application/pdf',
          file_size: 20480,
        })
        .expect(403);
    });

    it('rejects requests without a bearer token', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/users/${PARTICIPANT_ID}/certification-enrollments/${ENROLLMENT_ID}/requirements/${SECTION_ID}/evidences/presign`,
        )
        .send({
          component_id: COMPONENT_ID,
          file_name: 'comprobante.pdf',
          mime_type: 'application/pdf',
          file_size: 20480,
        })
        .expect(401);
    });
  });

  // ==========================================================================
  // 2) In-scope reviewer approves the requirement (Task 7)
  // ==========================================================================

  const submittedProgress = () => ({
    progress_id: PROGRESS_ID,
    enrollment_id: ENROLLMENT_ID,
    user_id: PARTICIPANT_ID,
    status: 'SUBMITTED',
    submitted_at: new Date('2026-01-02T00:00:00.000Z'),
    users: {
      user_id: PARTICIPANT_ID,
      name: 'Juan',
      paternal_last_name: 'Pérez',
    },
    certifications: { certification_id: CERTIFICATION_ID, name: 'Guía Mayor' },
    certification_sections: {
      section_id: SECTION_ID,
      name: 'Requisito 1',
      module_id: MODULE_ID,
      certification_modules: { module_id: MODULE_ID, name: 'Módulo 1' },
    },
  });

  describe('Scenario 2 — in-scope reviewer approves a SUBMITTED requirement', () => {
    it('lists the requirement in the review tray for the reviewer local field', async () => {
      prismaMock.certification_section_progress.findMany.mockResolvedValueOnce(
        [submittedProgress()],
      );

      const response = await request(app.getHttpServer())
        .get('/api/v1/certifications/reviews/requirements')
        .set(authHeaders(REVIEWER_IN_SCOPE_ID))
        .expect(200);

      expect(response.body.data).toEqual([
        expect.objectContaining({
          progress_id: PROGRESS_ID,
          status: 'SUBMITTED',
        }),
      ]);
    });

    it('approves the requirement and auto-advances the enrollment to READY_FOR_CLOSEOUT', async () => {
      prismaMock.certification_section_progress.findFirst.mockResolvedValueOnce(
        submittedProgress(),
      );
      prismaMock.users.findUnique.mockResolvedValueOnce({
        local_field_id: IN_SCOPE_LOCAL_FIELD_ID,
      });
      prismaMock.users_certifications.updateMany.mockResolvedValueOnce({
        count: 1,
      });
      prismaMock.certification_section_progress.update.mockResolvedValueOnce(
        { ...submittedProgress(), status: 'APPROVED' },
      );
      prismaMock.certification_review_events.create.mockResolvedValueOnce({});
      prismaMock.users_certifications.findUniqueOrThrow.mockResolvedValueOnce(
        enrollment(),
      );
      prismaMock.certification_sections.findMany.mockResolvedValueOnce([
        { section_id: SECTION_ID, required: true },
      ]);
      prismaMock.certification_section_progress.findMany.mockResolvedValueOnce(
        [{ section_id: SECTION_ID, status: 'APPROVED' }],
      );
      prismaMock.users_certifications.update.mockResolvedValueOnce({
        ...enrollment(),
        status: 'READY_FOR_CLOSEOUT',
      });

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/reviews/requirements/${PROGRESS_ID}/approve`,
        )
        .set(authHeaders(REVIEWER_IN_SCOPE_ID))
        .send({ lock_version: 0, comment: 'Todo en orden' })
        .expect(201);

      expect(response.body.data).toMatchObject({
        progress_id: PROGRESS_ID,
        status: 'APPROVED',
      });
      expect(prismaMock.users_certifications.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'READY_FOR_CLOSEOUT' }),
        }),
      );
    });
  });

  // ==========================================================================
  // 3) Out-of-scope reviewer is rejected (Task 7)
  // ==========================================================================

  describe('Scenario 3 — out-of-scope reviewer is forbidden from reviewing', () => {
    it('rejects approve with CERT_REVIEW_SCOPE_FORBIDDEN when local fields do not match', async () => {
      prismaMock.certification_section_progress.findFirst.mockResolvedValueOnce(
        submittedProgress(),
      );
      prismaMock.users.findUnique.mockResolvedValueOnce({
        local_field_id: IN_SCOPE_LOCAL_FIELD_ID,
      });

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/reviews/requirements/${PROGRESS_ID}/approve`,
        )
        .set(authHeaders(REVIEWER_OUT_OF_SCOPE_ID))
        .send({ lock_version: 0 })
        .expect(403);

      expect(response.body).toHaveProperty(
        'code',
        'CERT_REVIEW_SCOPE_FORBIDDEN',
      );
    });

    it('rejects request-changes without a comment (DTO validation)', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/reviews/requirements/${PROGRESS_ID}/request-changes`,
        )
        .set(authHeaders(REVIEWER_IN_SCOPE_ID))
        .send({ lock_version: 0 })
        .expect(400);
    });
  });

  // ==========================================================================
  // 4) Full closeout: board evidence → submit-final → approve → certify
  // ==========================================================================

  describe('Scenario 4 — full closeout and certification', () => {
    const readyEnrollment = () => ({ ...enrollment(), status: 'READY_FOR_CLOSEOUT' });

    it('presigns closeout (board proof) evidence', async () => {
      prismaMock.users_certifications.findFirst.mockResolvedValueOnce(
        readyEnrollment(),
      );
      prismaMock.certification_closeout_evidences.updateMany.mockResolvedValueOnce(
        { count: 0 },
      );
      mockFileStorage.getSignedUploadUrl.mockResolvedValueOnce({
        url: 'https://r2.example.com/signed-put-closeout',
        key: `enrollment-${ENROLLMENT_ID}/closeout/fixed-uuid.pdf`,
        expiresInSeconds: 900,
      });
      prismaMock.certification_closeout_evidences.create.mockResolvedValueOnce(
        { closeout_evidence_id: CLOSEOUT_EVIDENCE_ID },
      );

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/users/${PARTICIPANT_ID}/certification-enrollments/${ENROLLMENT_ID}/closeout-evidence/presign`,
        )
        .set(authHeaders(PARTICIPANT_ID))
        .send({
          file_name: 'acta-junta.pdf',
          mime_type: 'application/pdf',
          file_size: 102400,
        })
        .expect(201);

      expect(response.body.data.closeout_evidence_id).toBe(
        CLOSEOUT_EVIDENCE_ID,
      );
    });

    it('confirms the closeout evidence upload', async () => {
      prismaMock.users_certifications.findFirst.mockResolvedValueOnce(
        readyEnrollment(),
      );
      prismaMock.certification_closeout_evidences.findFirst.mockResolvedValueOnce(
        {
          closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
          object_key: `enrollment-${ENROLLMENT_ID}/closeout/fixed-uuid.pdf`,
          mime_type: 'application/pdf',
          size_bytes: BigInt(102400),
        },
      );
      mockFileStorage.getObjectInfo.mockResolvedValueOnce({
        size: 102400,
        contentType: 'application/pdf',
      });
      prismaMock.certification_closeout_evidences.update.mockResolvedValueOnce(
        {
          closeout_evidence_id: CLOSEOUT_EVIDENCE_ID,
          upload_status: 'CONFIRMED',
          review_status: 'PENDING',
        },
      );

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/users/${PARTICIPANT_ID}/certification-enrollments/${ENROLLMENT_ID}/closeout-evidence/confirm`,
        )
        .set(authHeaders(PARTICIPANT_ID))
        .send({ closeout_evidence_id: CLOSEOUT_EVIDENCE_ID })
        .expect(201);

      expect(response.body.data.upload_status).toBe('CONFIRMED');
    });

    it('submits the enrollment to final review once every condition is met', async () => {
      prismaMock.users_certifications.findFirst.mockResolvedValueOnce(
        readyEnrollment(),
      );
      prismaMock.certification_sections.findMany.mockResolvedValueOnce([
        { section_id: SECTION_ID, required: true },
      ]);
      prismaMock.certification_section_progress.findMany.mockResolvedValueOnce(
        [{ section_id: SECTION_ID, status: 'APPROVED' }],
      );
      prismaMock.certification_closeout_evidences.findFirst.mockResolvedValueOnce(
        { closeout_evidence_id: CLOSEOUT_EVIDENCE_ID, upload_status: 'CONFIRMED' },
      );
      prismaMock.users_certifications.update.mockResolvedValueOnce({});
      prismaMock.certification_closeout_evidences.update.mockResolvedValueOnce(
        {},
      );
      prismaMock.certification_review_events.create.mockResolvedValueOnce({});

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/users/${PARTICIPANT_ID}/certification-enrollments/${ENROLLMENT_ID}/submit-final`,
        )
        .set(authHeaders(PARTICIPANT_ID))
        .expect(201);

      expect(response.body.data).toMatchObject({
        enrollment_id: ENROLLMENT_ID,
        status: 'SUBMITTED_FOR_FINAL_REVIEW',
      });
    });

    it('rejects a certify attempt by the out-of-scope reviewer', async () => {
      prismaMock.users_certifications.findFirst.mockResolvedValueOnce({
        ...readyEnrollment(),
        status: 'SUBMITTED_FOR_FINAL_REVIEW',
        users: { local_field_id: IN_SCOPE_LOCAL_FIELD_ID },
      });

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/reviews/final/${ENROLLMENT_ID}/certify`,
        )
        .set(authHeaders(REVIEWER_OUT_OF_SCOPE_ID))
        .expect(403);

      expect(response.body).toHaveProperty(
        'code',
        'CERT_REVIEW_SCOPE_FORBIDDEN',
      );
    });

    it('lets the in-scope reviewer approve the closeout evidence', async () => {
      prismaMock.users_certifications.findFirst.mockResolvedValueOnce({
        ...readyEnrollment(),
        status: 'SUBMITTED_FOR_FINAL_REVIEW',
        users: { local_field_id: IN_SCOPE_LOCAL_FIELD_ID },
      });
      prismaMock.certification_closeout_evidences.findFirst.mockResolvedValueOnce(
        { closeout_evidence_id: CLOSEOUT_EVIDENCE_ID, review_status: 'SUBMITTED' },
      );
      prismaMock.certification_closeout_evidences.update.mockResolvedValueOnce(
        {},
      );
      prismaMock.users_certifications.update.mockResolvedValueOnce({});
      prismaMock.certification_review_events.create.mockResolvedValueOnce({});

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/certifications/reviews/final/${ENROLLMENT_ID}/approve-closeout-evidence`,
        )
        .set(authHeaders(REVIEWER_IN_SCOPE_ID))
        .expect(201);

      expect(response.body.data).toMatchObject({
        enrollment_id: ENROLLMENT_ID,
        status: 'APPROVED',
      });
    });

    it('certifies the enrollment after re-verifying every required condition', async () => {
      prismaMock.users_certifications.findFirst.mockResolvedValueOnce({
        ...readyEnrollment(),
        status: 'APPROVED',
        users: { local_field_id: IN_SCOPE_LOCAL_FIELD_ID },
      });
      prismaMock.certification_sections.findMany.mockResolvedValueOnce([
        { section_id: SECTION_ID, required: true },
      ]);
      prismaMock.certification_section_progress.findMany.mockResolvedValueOnce(
        [{ section_id: SECTION_ID, status: 'APPROVED' }],
      );
      prismaMock.certification_closeout_evidences.findFirst.mockResolvedValueOnce(
        { closeout_evidence_id: CLOSEOUT_EVIDENCE_ID, review_status: 'APPROVED' },
      );
      prismaMock.users_certifications.update.mockResolvedValueOnce({});
      prismaMock.certification_review_events.create.mockResolvedValueOnce({});

      const response = await request(app.getHttpServer())
        .post(`/api/v1/certifications/reviews/final/${ENROLLMENT_ID}/certify`)
        .set(authHeaders(REVIEWER_IN_SCOPE_ID))
        .expect(201);

      expect(response.body.data).toMatchObject({
        enrollment_id: ENROLLMENT_ID,
        status: 'CERTIFIED',
        already_certified: false,
      });
    });

    it('is idempotent: certifying an already-CERTIFIED enrollment succeeds without mutating anything', async () => {
      prismaMock.users_certifications.findFirst.mockResolvedValueOnce({
        ...readyEnrollment(),
        status: 'CERTIFIED',
        users: { local_field_id: IN_SCOPE_LOCAL_FIELD_ID },
      });
      prismaMock.users_certifications.update.mockClear();
      prismaMock.certification_review_events.create.mockClear();

      const response = await request(app.getHttpServer())
        .post(`/api/v1/certifications/reviews/final/${ENROLLMENT_ID}/certify`)
        .set(authHeaders(REVIEWER_IN_SCOPE_ID))
        .expect(201);

      expect(response.body.data).toMatchObject({
        enrollment_id: ENROLLMENT_ID,
        status: 'CERTIFIED',
        already_certified: true,
      });
      expect(prismaMock.users_certifications.update).not.toHaveBeenCalled();
      expect(
        prismaMock.certification_review_events.create,
      ).not.toHaveBeenCalled();
    });
  });
});
