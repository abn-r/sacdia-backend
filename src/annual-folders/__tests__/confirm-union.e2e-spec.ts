/**
 * confirm-union.e2e-spec.ts
 *
 * Integration-level RBAC and service-precondition tests for the
 * `POST /:folderId/sections/:sectionId/confirm-union` endpoint introduced
 * by T-B3-1 (SDD annual-folders-ownership-rework).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE NOTE — RBAC SCOPE GAP (read before modifying these tests)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The task spec requires verifying that director-lf and assistant-lf are
 * FORBIDDEN from calling confirm-union (only union-tier actors should be
 * allowed). This is a LEGITIMATE business rule, but the current implementation
 * does NOT enforce it:
 *
 *   1. EvaluationController decorates the endpoint with:
 *        @RequirePermissions('annual_folders:evaluate')
 *        @AuthorizationResource({ type: 'global' })
 *
 *   2. PermissionsGuard.hasRequiredPermissions checks only global_roles
 *      permissions when type='global'.
 *
 *   3. role-permissions.seed.sql grants `annual_folders:evaluate` to ALL
 *      four global roles: assistant-lf, director-lf, assistant-union,
 *      director-union (via the assistant-lf block at line ~1150).
 *
 *   4. EvaluationService.confirmUnion does NOT check the actor's role —
 *      it only validates folder state and evaluation row state.
 *
 * CONSEQUENCE: director-lf and assistant-lf can successfully call
 * confirm-union in the current implementation. The guard allows them through.
 *
 * RESOLVED — Option B implemented (SDD annual-folders-ownership-rework / T-B4-6):
 *   EvaluationService.confirmUnion now queries users_roles for the actorUserId
 *   before entering the $transaction and throws ForbiddenException if neither
 *   'director-union' nor 'assistant-union' is present among the actor's active
 *   roles. The permission seed is intentionally unchanged: annual_folders:evaluate
 *   remains granted to all 4 tiers because LF actors still need it for
 *   evaluateSection. The tier distinction is enforced exclusively in the service.
 *
 * Tests T-C3 and T-C4 have been un-skipped and now assert ForbiddenException.
 *
 * What IS enforced today and tested here:
 *   - Club users (club_role_assignments only, no global role) cannot call the
 *     endpoint because they lack `annual_folders:evaluate` in their
 *     global_roles — this IS enforced by the guard. Tested at service level
 *     via the service's precondition checks (no HTTP stack required).
 *   - Service-level preconditions: PREAPPROVED_LF state, requires_union_confirmation,
 *     LF data populated, terminal-state guard, non-existent-folder guard.
 *   - Happy path: director-union and assistant-union can confirm.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST SCOPE: Integration (PrismaClient + PrismaPg against real dev DB)
 * ═══════════════════════════════════════════════════════════════════════════
 * No HTTP server is spun up. The RBAC guard runs in the controller pipeline
 * and cannot be tested here without a full NestJS app + supertest. The tests
 * invoke EvaluationService.confirmUnion directly after seeding the necessary
 * data.
 *
 * For guard-level e2e coverage, see: TODO — add supertest-based test once
 * a shared NestJS test app harness is established for annual-folders.
 *
 * Uses seeded test users from prisma/seeds/test-users.seed.ts:
 *   director-union@sacdia.com   → director-union (GLOBAL, UNION_ID=20)
 *   assistant-union@sacdia.com  → assistant-union (GLOBAL, UNION_ID=20)
 *   director-lf@sacdia.com      → director-lf    (GLOBAL, LOCAL_FIELD_ID=4)
 *   assistant-lf@sacdia.com     → assistant-lf   (GLOBAL, LOCAL_FIELD_ID=4)
 *   director-club@sacdia.com    → director        (CLUB, CLUB_SECTION_ID=1)
 *
 * Fixture constants (stable dev-DB rows — do NOT delete):
 *   UNION_ID        = 20   (IOMU - Unión Mexicana Interoceánica)
 *   LOCAL_FIELD_ID  = 4    (ACV - Asociación Centro de Veracruz)
 *   YEAR_ID         = 1    (Ecclesiastical year 2026)
 *   CLUB_TYPE_ID    = 3    (Guías Mayores)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EvaluationService } from '../evaluation.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  annual_folder_section_status_enum,
  union_evaluation_decision_enum,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Stable fixture constants (match seed file)
// ---------------------------------------------------------------------------

const YEAR_ID = 1;
const LOCAL_FIELD_ID = 4;
const UNION_ID = 20;
const CLUB_TYPE_ID = 3; // Guías Mayores

// ---------------------------------------------------------------------------
// Seeded test-user emails (from test-users.seed.ts)
// ---------------------------------------------------------------------------

const EMAIL_DIRECTOR_UNION = 'director-union@sacdia.com';
const EMAIL_ASSISTANT_UNION = 'assistant-union@sacdia.com';
const EMAIL_DIRECTOR_LF = 'director-lf@sacdia.com';
const EMAIL_ASSISTANT_LF = 'assistant-lf@sacdia.com';
const EMAIL_CLUB_DIRECTOR = 'director-club@sacdia.com';

// ---------------------------------------------------------------------------
// Prisma bootstrap — mirrors PrismaService minus NestJS lifecycle
// ---------------------------------------------------------------------------

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const rawPrisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Shared state created in beforeAll, cleaned in afterAll
// ---------------------------------------------------------------------------

let clubSectionId: number;
let clubEnrollmentId: string;
let folderTemplateId: string;
let unionCamporeeId: number;

/** annual_folder_id of the folder created per test — cleaned in afterEach */
let folderId: string | undefined;

/** evaluation row section_id reused across tests */
let sectionId: string;

// ---------------------------------------------------------------------------
// Actor user IDs — resolved from seeded email addresses
// ---------------------------------------------------------------------------

let directorUnionUserId: string;
let assistantUnionUserId: string;
let directorLfUserId: string;
let assistantLfUserId: string;
let clubDirectorUserId: string;
/** Non-assigned user: a fresh user with no roles, created in beforeAll */
let nonAssignedUserId: string;

// ---------------------------------------------------------------------------
// NestJS TestingModule for EvaluationService
// ---------------------------------------------------------------------------

let evaluationService: EvaluationService;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a user_id from email, throw if not found (seed must have run). */
async function resolveUserId(email: string): Promise<string> {
  const user = await rawPrisma.users.findFirst({
    where: { email },
    select: { user_id: true },
  });
  if (!user) {
    throw new Error(
      `Test user "${email}" not found — run prisma/seeds/test-users.seed.ts first.`,
    );
  }
  return user.user_id;
}

/**
 * Seed a fresh annual_folder (with requires_union_confirmation=true) and ONE
 * evaluation row in the state specified by `evalStatus`.
 *
 * Returns { folderId, sectionId } where sectionId is the first section of the
 * reused folder_template.
 *
 * IMPORTANT: each call re-uses the shared clubEnrollmentId — so only ONE folder
 * may exist at a time (@@unique on club_enrollment_id). afterEach cleans up.
 */
async function seedFolderWithEvaluation(opts: {
  evalStatus: annual_folder_section_status_enum;
  lfApprovedBy?: string;
  lfApprovedAt?: Date;
}): Promise<{ folderId: string; sectionId: string }> {
  // 1. Create annual_folder
  const folder = await rawPrisma.annual_folders.create({
    data: {
      club_enrollment_id: clubEnrollmentId,
      folder_template_id: folderTemplateId,
      union_camporee_id: unionCamporeeId,
      local_camporee_id: null,
      requires_union_confirmation: true,
    },
  });

  // 2. Get first section of the template
  const templateSection =
    await rawPrisma.folder_template_sections.findFirst({
      where: { folder_template_id: folderTemplateId },
      orderBy: { order: 'asc' },
      select: { section_id: true },
    });
  if (!templateSection) {
    throw new Error(
      `No folder_template_sections found for template ${folderTemplateId}. ` +
        'Ensure the template has at least one section.',
    );
  }

  // 3. Upsert evaluation row into requested state
  const now = new Date();
  await rawPrisma.annual_folder_section_evaluations.upsert({
    where: {
      annual_folder_id_section_id: {
        annual_folder_id: folder.annual_folder_id,
        section_id: templateSection.section_id,
      },
    },
    create: {
      annual_folder_id: folder.annual_folder_id,
      section_id: templateSection.section_id,
      earned_points: opts.evalStatus === annual_folder_section_status_enum.PREAPPROVED_LF ? 80 : 0,
      max_points: 100,
      status: opts.evalStatus,
      lf_approved_by: opts.lfApprovedBy ?? null,
      lf_approved_at: opts.lfApprovedAt ?? (opts.evalStatus === annual_folder_section_status_enum.PREAPPROVED_LF ? now : null),
    },
    update: {
      status: opts.evalStatus,
      lf_approved_by: opts.lfApprovedBy ?? null,
      lf_approved_at: opts.lfApprovedAt ?? (opts.evalStatus === annual_folder_section_status_enum.PREAPPROVED_LF ? now : null),
      earned_points: opts.evalStatus === annual_folder_section_status_enum.PREAPPROVED_LF ? 80 : 0,
    },
  });

  return {
    folderId: folder.annual_folder_id,
    sectionId: templateSection.section_id,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await rawPrisma.$connect();

  // --- Resolve seeded test-user IDs ---
  directorUnionUserId = await resolveUserId(EMAIL_DIRECTOR_UNION);
  assistantUnionUserId = await resolveUserId(EMAIL_ASSISTANT_UNION);
  directorLfUserId = await resolveUserId(EMAIL_DIRECTOR_LF);
  assistantLfUserId = await resolveUserId(EMAIL_ASSISTANT_LF);
  clubDirectorUserId = await resolveUserId(EMAIL_CLUB_DIRECTOR);

  // --- Create a non-assigned test user (no roles, no assignments) ---
  // Use a stable email so this is idempotent across test runs.
  const nonAssignedUser = await rawPrisma.users.upsert({
    where: { email: 'no-role-confirm-union@sacdia.test' },
    create: {
      email: 'no-role-confirm-union@sacdia.test',
      name: 'NoRole',
      paternal_last_name: 'ConfirmUnion',
      active: true,
      email_verified: true,
      approval_status: 'approved',
      access_app: false,
      access_panel: false,
    },
    update: {
      name: 'NoRole',
      paternal_last_name: 'ConfirmUnion',
      active: true,
    },
  });
  nonAssignedUserId = nonAssignedUser.user_id;

  // --- Create isolated club_section (main_club_id=null avoids @@unique clash) ---
  const section = await rawPrisma.club_sections.create({
    data: {
      club_type_id: CLUB_TYPE_ID,
      main_club_id: null,
      active: true,
      souls_target: 1,
      fee: 0,
    },
  });
  clubSectionId = section.club_section_id;

  // --- Create club_enrollment for this section + year ---
  const enrollment = await rawPrisma.club_enrollments.create({
    data: {
      club_section_id: clubSectionId,
      ecclesiastical_year_id: YEAR_ID,
      status: 'active',
      created_by: directorUnionUserId,
    },
  });
  clubEnrollmentId = enrollment.club_enrollment_id;

  // --- Reuse a pre-seeded folder_template ---
  const template = await rawPrisma.folder_templates.findFirst({
    where: {
      club_type_id: CLUB_TYPE_ID,
      ecclesiastical_year_id: YEAR_ID,
      active: true,
    },
  });
  if (!template) {
    throw new Error(
      'No folder_template found for club_type_id=3 + year_id=1. ' +
        'Run prisma/seeds/folder-templates.seed.ts first.',
    );
  }
  folderTemplateId = template.folder_template_id;

  // --- Create a union_camporee for these tests ---
  const unionCamporee = await rawPrisma.union_camporees.create({
    data: {
      name: '[TEST] Union Camporee — confirm-union spec',
      start_date: new Date('2026-08-01'),
      end_date: new Date('2026-08-05'),
      union_id: UNION_ID,
      ecclesiastical_year: YEAR_ID,
      active: true,
    },
  });
  unionCamporeeId = unionCamporee.union_camporee_id;

  // --- Wire up NestJS TestingModule with real PrismaService ---
  // PrismaService wraps the same raw connection; we pass a thin shim that
  // delegates to rawPrisma so we can reuse the PgPool.
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EvaluationService,
      {
        provide: PrismaService,
        useValue: rawPrisma,
      },
    ],
  }).compile();

  evaluationService = module.get<EvaluationService>(EvaluationService);
});

afterEach(async () => {
  // Clean up evaluation rows and annual_folder created by this test.
  if (folderId) {
    await rawPrisma.annual_folder_section_evaluations.deleteMany({
      where: { annual_folder_id: folderId },
    });
    await rawPrisma.annual_folders.deleteMany({
      where: { annual_folder_id: folderId },
    });
    folderId = undefined;
  }
});

afterAll(async () => {
  // Reverse FK order: union_camporee → club_enrollment → club_section → test user
  if (unionCamporeeId) {
    await rawPrisma.union_camporees.delete({
      where: { union_camporee_id: unionCamporeeId },
    });
  }
  if (clubEnrollmentId) {
    await rawPrisma.club_enrollments.delete({
      where: { club_enrollment_id: clubEnrollmentId },
    });
  }
  if (clubSectionId) {
    await rawPrisma.club_sections.delete({
      where: { club_section_id: clubSectionId },
    });
  }
  // Clean up ephemeral non-assigned user (idempotent)
  await rawPrisma.users.deleteMany({
    where: { email: 'no-role-confirm-union@sacdia.test' },
  });

  await rawPrisma.$disconnect();
  await pool.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('confirmUnion — RBAC and service preconditions', () => {
  // =========================================================================
  // T-C1: director-union can confirm (happy path)
  // =========================================================================

  describe('T-C1: director-union can confirm a PREAPPROVED_LF section', () => {
    it('transitions the evaluation to VALIDATED and sets union_approved_by', async () => {
      const seeded = await seedFolderWithEvaluation({
        evalStatus: annual_folder_section_status_enum.PREAPPROVED_LF,
        lfApprovedBy: directorLfUserId,
        lfApprovedAt: new Date(),
      });
      folderId = seeded.folderId;
      sectionId = seeded.sectionId;

      const result = await evaluationService.confirmUnion(
        folderId,
        sectionId,
        { decision: union_evaluation_decision_enum.APPROVED },
        directorUnionUserId,
      );

      expect(result.evaluation).toBeDefined();
      expect(result.folder_summary).toBeDefined();

      // Verify DB state directly
      const evalRow =
        await rawPrisma.annual_folder_section_evaluations.findUnique({
          where: {
            annual_folder_id_section_id: {
              annual_folder_id: folderId,
              section_id: sectionId,
            },
          },
        });

      expect(evalRow?.status).toBe(annual_folder_section_status_enum.VALIDATED);
      expect(evalRow?.union_approved_by).toBe(directorUnionUserId);
      expect(evalRow?.union_decision).toBe(
        union_evaluation_decision_enum.APPROVED,
      );
      expect(evalRow?.union_approved_at).toBeInstanceOf(Date);
    });

    it('preserves lf_approved_by and lf_approved_at (LF columns not overwritten)', async () => {
      const lfAt = new Date('2026-07-01T10:00:00Z');
      const seeded = await seedFolderWithEvaluation({
        evalStatus: annual_folder_section_status_enum.PREAPPROVED_LF,
        lfApprovedBy: directorLfUserId,
        lfApprovedAt: lfAt,
      });
      folderId = seeded.folderId;
      sectionId = seeded.sectionId;

      await evaluationService.confirmUnion(
        folderId,
        sectionId,
        { decision: union_evaluation_decision_enum.APPROVED },
        directorUnionUserId,
      );

      const evalRow =
        await rawPrisma.annual_folder_section_evaluations.findUnique({
          where: {
            annual_folder_id_section_id: {
              annual_folder_id: folderId,
              section_id: sectionId,
            },
          },
        });

      expect(evalRow?.lf_approved_by).toBe(directorLfUserId);
      // lf_approved_at should still equal the original timestamp (within 1 s)
      expect(evalRow?.lf_approved_at?.getTime()).toBeCloseTo(lfAt.getTime(), -3);
    });
  });

  // =========================================================================
  // T-C2: assistant-union can confirm (happy path)
  // =========================================================================

  describe('T-C2: assistant-union can confirm a PREAPPROVED_LF section', () => {
    it('transitions the evaluation to REJECTED when decision=REJECTED_OVERRIDE', async () => {
      const seeded = await seedFolderWithEvaluation({
        evalStatus: annual_folder_section_status_enum.PREAPPROVED_LF,
        lfApprovedBy: assistantLfUserId,
        lfApprovedAt: new Date(),
      });
      folderId = seeded.folderId;
      sectionId = seeded.sectionId;

      const result = await evaluationService.confirmUnion(
        folderId,
        sectionId,
        {
          decision: union_evaluation_decision_enum.REJECTED_OVERRIDE,
          notes: 'Documentación incompleta',
        },
        assistantUnionUserId,
      );

      expect(result.evaluation).toBeDefined();

      const evalRow =
        await rawPrisma.annual_folder_section_evaluations.findUnique({
          where: {
            annual_folder_id_section_id: {
              annual_folder_id: folderId,
              section_id: sectionId,
            },
          },
        });

      expect(evalRow?.status).toBe(annual_folder_section_status_enum.REJECTED);
      expect(evalRow?.union_approved_by).toBe(assistantUnionUserId);
      expect(evalRow?.union_decision).toBe(
        union_evaluation_decision_enum.REJECTED_OVERRIDE,
      );
    });
  });

  // =========================================================================
  // T-C3: director-lf — rejected by service-layer role check (Option B)
  // =========================================================================

  describe('T-C3: director-lf is FORBIDDEN from calling confirm-union', () => {
    it('throws ForbiddenException when actor is director-lf', async () => {
      const seeded = await seedFolderWithEvaluation({
        evalStatus: annual_folder_section_status_enum.PREAPPROVED_LF,
        lfApprovedBy: directorLfUserId,
        lfApprovedAt: new Date(),
      });
      folderId = seeded.folderId;
      sectionId = seeded.sectionId;

      await expect(
        evaluationService.confirmUnion(
          folderId,
          sectionId,
          { decision: union_evaluation_decision_enum.APPROVED },
          directorLfUserId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // T-C4: assistant-lf — rejected by service-layer role check (Option B)
  // =========================================================================

  describe('T-C4: assistant-lf is FORBIDDEN from calling confirm-union', () => {
    it('throws ForbiddenException when actor is assistant-lf', async () => {
      const seeded = await seedFolderWithEvaluation({
        evalStatus: annual_folder_section_status_enum.PREAPPROVED_LF,
        lfApprovedBy: assistantLfUserId,
        lfApprovedAt: new Date(),
      });
      folderId = seeded.folderId;
      sectionId = seeded.sectionId;

      await expect(
        evaluationService.confirmUnion(
          folderId,
          sectionId,
          { decision: union_evaluation_decision_enum.APPROVED },
          assistantLfUserId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // T-C5: Service-level precondition — SUBMITTED state is rejected
  // =========================================================================

  describe('T-C5: evaluationService.confirmUnion rejects SUBMITTED state', () => {
    it('throws BadRequestException when evaluation is in SUBMITTED (LF has not pre-approved yet)', async () => {
      const seeded = await seedFolderWithEvaluation({
        evalStatus: annual_folder_section_status_enum.SUBMITTED,
      });
      folderId = seeded.folderId;
      sectionId = seeded.sectionId;

      await expect(
        evaluationService.confirmUnion(
          folderId,
          sectionId,
          { decision: union_evaluation_decision_enum.APPROVED },
          directorUnionUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('error message mentions PREAPPROVED_LF requirement', async () => {
      const seeded = await seedFolderWithEvaluation({
        evalStatus: annual_folder_section_status_enum.SUBMITTED,
      });
      folderId = seeded.folderId;
      sectionId = seeded.sectionId;

      await expect(
        evaluationService.confirmUnion(
          folderId,
          sectionId,
          { decision: union_evaluation_decision_enum.APPROVED },
          directorUnionUserId,
        ),
      ).rejects.toThrow(/PREAPPROVED_LF/);
    });
  });

  // =========================================================================
  // T-C6: Service-level precondition — VALIDATED (terminal) state is rejected
  // =========================================================================

  describe('T-C6: evaluationService.confirmUnion rejects already-terminal VALIDATED state', () => {
    it('throws BadRequestException when evaluation is already VALIDATED', async () => {
      const seeded = await seedFolderWithEvaluation({
        evalStatus: annual_folder_section_status_enum.VALIDATED,
        lfApprovedBy: directorLfUserId,
        lfApprovedAt: new Date(),
      });
      folderId = seeded.folderId;
      sectionId = seeded.sectionId;

      await expect(
        evaluationService.confirmUnion(
          folderId,
          sectionId,
          { decision: union_evaluation_decision_enum.APPROVED },
          directorUnionUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // T-C7: Service-level precondition — folder does not require union confirmation
  // =========================================================================

  describe('T-C7: evaluationService.confirmUnion rejects when folder does not require union confirmation', () => {
    /**
     * Helper: creates a folder with requires_union_confirmation=false and seeds a
     * PREAPPROVED_LF evaluation row, returning both IDs for cleanup.
     */
    async function seedNoUnionFolder(): Promise<{
      noUnionFolderId: string;
      noUnionSectionId: string;
    }> {
      const folder = await rawPrisma.annual_folders.create({
        data: {
          club_enrollment_id: clubEnrollmentId,
          folder_template_id: folderTemplateId,
          requires_union_confirmation: false,
          union_camporee_id: null,
          local_camporee_id: null,
        },
      });

      const templateSection =
        await rawPrisma.folder_template_sections.findFirst({
          where: { folder_template_id: folderTemplateId },
          orderBy: { order: 'asc' },
          select: { section_id: true },
        });

      await rawPrisma.annual_folder_section_evaluations.upsert({
        where: {
          annual_folder_id_section_id: {
            annual_folder_id: folder.annual_folder_id,
            section_id: templateSection!.section_id,
          },
        },
        create: {
          annual_folder_id: folder.annual_folder_id,
          section_id: templateSection!.section_id,
          earned_points: 80,
          max_points: 100,
          status: annual_folder_section_status_enum.PREAPPROVED_LF,
          lf_approved_by: directorLfUserId,
          lf_approved_at: new Date(),
        },
        update: {
          status: annual_folder_section_status_enum.PREAPPROVED_LF,
          lf_approved_by: directorLfUserId,
          lf_approved_at: new Date(),
        },
      });

      return {
        noUnionFolderId: folder.annual_folder_id,
        noUnionSectionId: templateSection!.section_id,
      };
    }

    it('throws BadRequestException for a folder with requires_union_confirmation=false', async () => {
      const { noUnionFolderId, noUnionSectionId } = await seedNoUnionFolder();
      folderId = noUnionFolderId;

      await expect(
        evaluationService.confirmUnion(
          noUnionFolderId,
          noUnionSectionId,
          { decision: union_evaluation_decision_enum.APPROVED },
          directorUnionUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('error message mentions union confirmation not required', async () => {
      const { noUnionFolderId, noUnionSectionId } = await seedNoUnionFolder();
      folderId = noUnionFolderId;

      await expect(
        evaluationService.confirmUnion(
          noUnionFolderId,
          noUnionSectionId,
          { decision: union_evaluation_decision_enum.APPROVED },
          directorUnionUserId,
        ),
      ).rejects.toThrow(/does not require union confirmation/);
    });
  });

  // =========================================================================
  // T-C8: Non-existent folder returns NotFoundException
  // =========================================================================

  describe('T-C8: non-existent folder throws NotFoundException', () => {
    it('throws NotFoundException for a random UUID that does not exist', async () => {
      const ghostFolderId = '00000000-dead-beef-0000-000000000000';
      const ghostSectionId = '00000000-dead-beef-0000-000000000001';

      await expect(
        evaluationService.confirmUnion(
          ghostFolderId,
          ghostSectionId,
          { decision: union_evaluation_decision_enum.APPROVED },
          directorUnionUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // T-C9: Club user — rejected by service-layer role check (Option B)
  //
  // Club users (director, secretary, etc.) do NOT have `annual_folders:evaluate`
  // in their global_roles — the guard blocks them at the HTTP layer.
  //
  // With Option B implemented, the service now ALSO rejects club users because
  // they hold neither director-union nor assistant-union in their users_roles.
  // This is defence-in-depth: the guard remains the primary enforcement layer,
  // but the service adds a second check.
  // =========================================================================

  describe('T-C9: club user — rejected by service-layer role check', () => {
    it.todo(
      'T-C9a: club-user director is FORBIDDEN at HTTP layer (guard: no global annual_folders:evaluate) — requires supertest e2e harness',
    );

    it.todo(
      'T-C9b: non-assigned user is FORBIDDEN at HTTP layer (guard: no global annual_folders:evaluate) — requires supertest e2e harness',
    );

    it('T-C9c: club-user director is rejected at service layer (no union role in users_roles)', async () => {
      const seeded = await seedFolderWithEvaluation({
        evalStatus: annual_folder_section_status_enum.PREAPPROVED_LF,
        lfApprovedBy: directorLfUserId,
        lfApprovedAt: new Date(),
      });
      folderId = seeded.folderId;
      sectionId = seeded.sectionId;

      await expect(
        evaluationService.confirmUnion(
          folderId,
          sectionId,
          { decision: union_evaluation_decision_enum.APPROVED },
          clubDirectorUserId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
