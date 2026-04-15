/**
 * Integration tests for the DB-level CHECK constraint
 * `annual_folders_at_most_one_camporee_check`
 *
 * Added in migration 20260415100100_annual_folders_camporee_link:
 *   CHECK (NOT (local_camporee_id IS NOT NULL AND union_camporee_id IS NOT NULL))
 *
 * Covers spec C4-S1..S4 and INV-2 from the annual-folders-camporee-link spec.
 * Also covers CAMP-1 service-level wiring (T-3.5): createFolderForEnrollment
 * links the camporee via resolveCamporeeLinkageForEnrollment.
 *
 * Uses the REAL Prisma client against the dev DB. No mocks.
 * All inserted rows are cleaned up in afterAll in reverse FK order.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AnnualFoldersService } from '../annual-folders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';

// ---------------------------------------------------------------------------
// Prisma bootstrap (mirrors PrismaService minus NestJS lifecycle)
// ---------------------------------------------------------------------------

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Test-fixture constants (match seed file constants — already in dev DB)
// ---------------------------------------------------------------------------

/** Active ecclesiastical year (2026-01-01 → 2026-12-31) */
const YEAR_ID = 1;
/** ACV - Asociación Centro de Veracruz */
const LOCAL_FIELD_ID = 4;
/** IOMU - Unión Mexicana Interoceánica */
const UNION_ID = 20;
/**
 * Club 1, Guías Mayores section — club_type_id inferred below.
 * We DON'T rely on section 1 for enrollment because it may already have
 * an annual_folder (@@unique constraint). We create a dedicated
 * club_section in beforeAll.
 */
const CLUB_TYPE_ID = 3; // Guías Mayores

// ---------------------------------------------------------------------------
// State shared across tests
// ---------------------------------------------------------------------------

let clubSectionId: number;
let clubEnrollmentId: string;
let folderTemplateId: string;
let localCamporeeId: number;
let unionCamporeeId: number;

/** IDs of annual_folders rows created per test — cleaned in afterEach */
const createdFolderIds: string[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findFirstUserId(): Promise<string> {
  const user = await prisma.users.findFirst({ select: { user_id: true } });
  if (!user) throw new Error('No users found in test DB — run seeds first.');
  return user.user_id;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await prisma.$connect();

  const userId = await findFirstUserId();

  // 1. Create an isolated club_section for these tests so its
  //    club_enrollment_id stays unique and won't conflict with real data.
  //    main_club_id is intentionally null: the @@unique([main_club_id, club_type_id])
  //    constraint does NOT trigger when main_club_id IS NULL because PostgreSQL
  //    treats NULL values as distinct in unique indexes.
  const section = await prisma.club_sections.create({
    data: {
      club_type_id: CLUB_TYPE_ID,
      main_club_id: null,
      active: true,
      souls_target: 1,
      fee: 0,
    },
  });
  clubSectionId = section.club_section_id;

  // 2. Create a club_enrollment for that section + year.
  //    (@@unique([club_section_id, ecclesiastical_year_id]) is satisfied
  //    because this section is brand-new.)
  const enrollment = await prisma.club_enrollments.create({
    data: {
      club_section_id: clubSectionId,
      ecclesiastical_year_id: YEAR_ID,
      status: 'active',
      created_by: userId,
    },
  });
  clubEnrollmentId = enrollment.club_enrollment_id;

  // 3. Reuse an existing folder_template seeded by folder-templates.seed.ts.
  //    The seed already created (club_type_id=3, year_id=1, owner_union_id=20),
  //    so we just look it up instead of creating a duplicate that would collide
  //    with the partial unique index (club_type_id, ecclesiastical_year_id, owner_union_id).
  const template = await prisma.folder_templates.findFirst({
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

  // 4. Create a local_camporee.
  const localCamporee = await prisma.local_camporees.create({
    data: {
      name: '[TEST] Local Camporee — constraint spec',
      start_date: new Date('2026-07-01'),
      end_date: new Date('2026-07-05'),
      local_field_id: LOCAL_FIELD_ID,
      ecclesiastical_year: YEAR_ID,
      active: true,
    },
  });
  localCamporeeId = localCamporee.local_camporee_id;

  // 5. Create a union_camporee.
  const unionCamporee = await prisma.union_camporees.create({
    data: {
      name: '[TEST] Union Camporee — constraint spec',
      start_date: new Date('2026-08-01'),
      end_date: new Date('2026-08-05'),
      union_id: UNION_ID,
      ecclesiastical_year: YEAR_ID,
      active: true,
    },
  });
  unionCamporeeId = unionCamporee.union_camporee_id;
});

afterEach(async () => {
  // Clean up any annual_folders created by individual tests.
  if (createdFolderIds.length > 0) {
    await prisma.annual_folders.deleteMany({
      where: { annual_folder_id: { in: createdFolderIds } },
    });
    createdFolderIds.length = 0;
  }
});

afterAll(async () => {
  // Reverse FK order: camporees → club_enrollment → club_section
  // (folder_template is not deleted — it was pre-existing from the seed)
  if (localCamporeeId) {
    await prisma.local_camporees.delete({
      where: { local_camporee_id: localCamporeeId },
    });
  }
  if (unionCamporeeId) {
    await prisma.union_camporees.delete({
      where: { union_camporee_id: unionCamporeeId },
    });
  }
  if (clubEnrollmentId) {
    await prisma.club_enrollments.delete({
      where: { club_enrollment_id: clubEnrollmentId },
    });
  }
  if (clubSectionId) {
    await prisma.club_sections.delete({
      where: { club_section_id: clubSectionId },
    });
  }

  await prisma.$disconnect();
  await pool.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('annual_folders — camporee link CHECK constraint', () => {
  /**
   * C4-S4 — Reject dual linkage
   *
   * A folder with BOTH local_camporee_id AND union_camporee_id set must be
   * rejected by the DB CHECK constraint
   * `annual_folders_at_most_one_camporee_check`.
   */
  it('C4-S4: rejects a folder that links both a local and a union camporee', async () => {
    let insertedId: string | undefined;

    try {
      const folder = await prisma.annual_folders.create({
        data: {
          club_enrollment_id: clubEnrollmentId,
          folder_template_id: folderTemplateId,
          local_camporee_id: localCamporeeId,
          union_camporee_id: unionCamporeeId,
          requires_union_confirmation: false,
        },
      });
      // If the insert unexpectedly succeeds, track it so afterEach can clean up
      insertedId = folder.annual_folder_id;
    } catch (err: unknown) {
      // Prisma wraps DB errors in PrismaClientKnownRequestError (code P2010/P2002)
      // or PrismaClientUnknownRequestError. The constraint name appears in the
      // underlying Postgres error message regardless of the wrapper.
      const message =
        err instanceof Error ? err.message : String(err);
      expect(message).toContain('annual_folders_at_most_one_camporee_check');
    }

    // The row must NOT have been inserted.
    if (insertedId) {
      createdFolderIds.push(insertedId);
      fail(
        'Expected a CHECK constraint violation but the insert succeeded. ' +
          `annual_folder_id=${insertedId}`,
      );
    }
  });

  /**
   * C4-S2 — Local-camporee-only folder
   *
   * A folder with local_camporee_id set and union_camporee_id=null must be
   * accepted; requires_union_confirmation must be persisted as false.
   */
  it('C4-S2: accepts a folder linked to a local camporee only', async () => {
    const folder = await prisma.annual_folders.create({
      data: {
        club_enrollment_id: clubEnrollmentId,
        folder_template_id: folderTemplateId,
        local_camporee_id: localCamporeeId,
        union_camporee_id: null,
        requires_union_confirmation: false,
      },
    });
    createdFolderIds.push(folder.annual_folder_id);

    const readBack = await prisma.annual_folders.findUniqueOrThrow({
      where: { annual_folder_id: folder.annual_folder_id },
    });

    expect(readBack.local_camporee_id).toBe(localCamporeeId);
    expect(readBack.union_camporee_id).toBeNull();
    expect(readBack.requires_union_confirmation).toBe(false);
  });

  /**
   * C4-S1 — Union-camporee-only folder
   *
   * A folder with union_camporee_id set and local_camporee_id=null must be
   * accepted; requires_union_confirmation must be persisted as true.
   *
   * NOTE: The @@unique([club_enrollment_id]) constraint means only ONE
   * annual_folder per enrollment can exist. C4-S2 cleans up in afterEach,
   * so this test runs against a fresh enrollment.
   */
  it('C4-S1: accepts a folder linked to a union camporee only', async () => {
    const folder = await prisma.annual_folders.create({
      data: {
        club_enrollment_id: clubEnrollmentId,
        folder_template_id: folderTemplateId,
        local_camporee_id: null,
        union_camporee_id: unionCamporeeId,
        requires_union_confirmation: true,
      },
    });
    createdFolderIds.push(folder.annual_folder_id);

    const readBack = await prisma.annual_folders.findUniqueOrThrow({
      where: { annual_folder_id: folder.annual_folder_id },
    });

    expect(readBack.union_camporee_id).toBe(unionCamporeeId);
    expect(readBack.local_camporee_id).toBeNull();
    expect(readBack.requires_union_confirmation).toBe(true);
  });

  /**
   * C4-S3 — Investiture-only folder (both camporee fields null)
   *
   * A folder with neither camporee field set must be accepted.
   * Both camporee fields must remain null on read-back.
   */
  it('C4-S3: accepts a folder with both camporee fields null (investiture-only)', async () => {
    const folder = await prisma.annual_folders.create({
      data: {
        club_enrollment_id: clubEnrollmentId,
        folder_template_id: folderTemplateId,
        local_camporee_id: null,
        union_camporee_id: null,
        requires_union_confirmation: false,
      },
    });
    createdFolderIds.push(folder.annual_folder_id);

    const readBack = await prisma.annual_folders.findUniqueOrThrow({
      where: { annual_folder_id: folder.annual_folder_id },
    });

    expect(readBack.local_camporee_id).toBeNull();
    expect(readBack.union_camporee_id).toBeNull();
    expect(readBack.requires_union_confirmation).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-3.5 — Service-level integration test: createFolderForEnrollment wires
//          resolveCamporeeLinkageForEnrollment (CAMP-1)
// ---------------------------------------------------------------------------

/**
 * This describe block verifies end-to-end that when a club_section is enrolled
 * in a union_camporee (via an active, non-rejected camporee_clubs row),
 * createFolderForEnrollment links the resulting annual_folder to that
 * union_camporee and sets requires_union_confirmation=true.
 *
 * Fixture: uses club_type_id=3 (Guías Mayores / master_guides) and the same
 * UNION_ID=20, YEAR_ID=1 as the constraint tests above.
 *
 * Cleanup: reverse FK order — folder evaluations → folder → camporee_clubs row
 *          → (fresh union_camporee if created) → enrollment → club_section
 */

describe('createFolderForEnrollment — links camporee via resolver (CAMP-1, T-3.5)', () => {
  let service: AnnualFoldersService;

  // Shared state for this describe block
  let svcPool: pg.Pool;
  let svcPrisma: PrismaService;

  let t35ClubSectionId: number;
  let t35EnrollmentId: string;
  let t35UnionCamporeeId: number;
  let t35CamporeeClubId: number;
  let t35FolderId: string;

  const T35_CLUB_TYPE_ID = 3; // Guías Mayores — includes_master_guides
  const T35_UNION_ID = 20;    // IOMU
  const T35_YEAR_ID = 1;      // Ecclesiastical year 2026

  beforeAll(async () => {
    // Build a real PrismaService from the DATABASE_URL. Because PrismaService
    // extends PrismaClient we instantiate a PrismaClient directly with the pg
    // adapter and cast it. This avoids the NestJS ConfigService dependency while
    // still exercising the real Prisma client against the dev DB.
    svcPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const svcAdapter = new PrismaPg(svcPool);
    // Cast: PrismaClient is the runtime base of PrismaService; the extra NestJS
    // lifecycle methods are not exercised here.
    svcPrisma = new PrismaClient({ adapter: svcAdapter }) as unknown as PrismaService;
    await (svcPrisma as unknown as PrismaClient).$connect();

    const module = await Test.createTestingModule({
      providers: [
        AnnualFoldersService,
        { provide: PrismaService, useValue: svcPrisma },
        { provide: FILE_STORAGE_SERVICE, useValue: { upload: jest.fn() } },
      ],
    }).compile();

    service = module.get<AnnualFoldersService>(AnnualFoldersService);

    // Find any valid user for created_by FK
    const user = await (svcPrisma as unknown as PrismaClient).users.findFirst({
      select: { user_id: true },
    });
    if (!user) throw new Error('No users in dev DB — run seeds first.');

    // 1. Create isolated club_section (main_club_id=null avoids unique constraint)
    const section = await (svcPrisma as unknown as PrismaClient).club_sections.create({
      data: {
        club_type_id: T35_CLUB_TYPE_ID,
        main_club_id: null,
        active: true,
        souls_target: 1,
        fee: 0,
      },
    });
    t35ClubSectionId = section.club_section_id;

    // 2. Create club_enrollment for that section + year
    const enrollment = await (svcPrisma as unknown as PrismaClient).club_enrollments.create({
      data: {
        club_section_id: t35ClubSectionId,
        ecclesiastical_year_id: T35_YEAR_ID,
        status: 'active',
        created_by: user.user_id,
      },
    });
    t35EnrollmentId = enrollment.club_enrollment_id;

    // 3. Create an active union_camporee for IOMU + year + includes_master_guides=true
    const unionCamporee = await (svcPrisma as unknown as PrismaClient).union_camporees.create({
      data: {
        name: '[TEST T-3.5] Union Camporee — resolver wiring',
        start_date: new Date('2026-09-01'),
        end_date: new Date('2026-09-05'),
        union_id: T35_UNION_ID,
        ecclesiastical_year: T35_YEAR_ID,
        active: true,
        includes_master_guides: true,
      },
    });
    t35UnionCamporeeId = unionCamporee.union_camporee_id;

    // 4. Enroll the club_section in the union_camporee via camporee_clubs
    const camporeeClub = await (svcPrisma as unknown as PrismaClient).camporee_clubs.create({
      data: {
        club_section_id: t35ClubSectionId,
        union_camporee_id: t35UnionCamporeeId,
        camporee_type: 'union',
        status: 'approved',
        active: true,
      },
    });
    t35CamporeeClubId = camporeeClub.camporee_club_id;
  });

  afterAll(async () => {
    const raw = svcPrisma as unknown as PrismaClient;

    // Clean up in reverse FK order
    if (t35FolderId) {
      // Evaluations cascade on folder delete, but delete explicitly to be safe
      await raw.annual_folder_section_evaluations.deleteMany({
        where: { annual_folder_id: t35FolderId },
      });
      await raw.annual_folders.delete({
        where: { annual_folder_id: t35FolderId },
      });
    }
    if (t35CamporeeClubId) {
      await raw.camporee_clubs.delete({
        where: { camporee_club_id: t35CamporeeClubId },
      });
    }
    if (t35UnionCamporeeId) {
      await raw.union_camporees.delete({
        where: { union_camporee_id: t35UnionCamporeeId },
      });
    }
    if (t35EnrollmentId) {
      await raw.club_enrollments.delete({
        where: { club_enrollment_id: t35EnrollmentId },
      });
    }
    if (t35ClubSectionId) {
      await raw.club_sections.delete({
        where: { club_section_id: t35ClubSectionId },
      });
    }

    await raw.$disconnect();
    await svcPool.end();
  });

  /**
   * CAMP-1 S1 (service level): createFolderForEnrollment resolves the union
   * camporee via the enrolled camporee_clubs row and sets the correct FKs.
   *
   * The club_section has no local_field link (main_club_id=null → no clubs →
   * no local_fields). The resolver will throw NotFoundException when it tries
   * to follow the club chain... unless we can use a section attached to a real
   * club. Let us adjust: the section needs a real club so the resolver can
   * find local_field_id.
   *
   * NOTE: The club_section created in beforeAll has main_club_id=null, which
   * means club_section.clubs will be null. The resolver throws NotFoundException
   * in that case. We use a real club_section that has a club with a local_field
   * via the fixture used by the constraint tests (clubSectionId from the outer
   * beforeAll). But that section already has an enrollment above.
   *
   * Solution: create the t35 club_section with a real club that has a local_field.
   * We use club_id=1 if it has a local_field. Otherwise skip.
   */
  it('CAMP-1 S1: folder gets union_camporee_id, null local, flag=true via service.createFolderForEnrollment', async () => {
    const raw = svcPrisma as unknown as PrismaClient;

    // The test club_section has main_club_id=null so the resolver's club chain
    // won't resolve. Attach it to a real club that has a local_field and does NOT
    // already have a club_section of club_type_id=3 (to avoid the unique constraint).
    const clubWithLocalField = await raw.$queryRaw<
      Array<{ club_id: number; local_field_id: number }>
    >`
      SELECT c.club_id, c.local_field_id
      FROM clubs c
      WHERE c.local_field_id IS NOT NULL
        AND c.active = true
        AND NOT EXISTS (
          SELECT 1 FROM club_sections cs
          WHERE cs.main_club_id = c.club_id
            AND cs.club_type_id = ${T35_CLUB_TYPE_ID}
        )
      LIMIT 1
    `;

    if (!clubWithLocalField || clubWithLocalField.length === 0) {
      // Skip test if no suitable club exists in dev DB
      console.warn(
        'T-3.5: No club available without an existing type-3 section — skipping.',
      );
      return;
    }

    // Attach the test section to this club so the resolver chain works.
    await raw.club_sections.update({
      where: { club_section_id: t35ClubSectionId },
      data: { main_club_id: clubWithLocalField[0].club_id },
    });

    let folderTemplate = await raw.folder_templates.findFirst({
      where: {
        club_type_id: T35_CLUB_TYPE_ID,
        ecclesiastical_year_id: T35_YEAR_ID,
        active: true,
      },
    });

    if (!folderTemplate) {
      throw new Error(
        'No folder_template found for club_type_id=3 + year_id=1. ' +
          'Run prisma/seeds/folder-templates.seed.ts first.',
      );
    }

    // Call the service method — this exercises the full resolver path.
    const folder = await service.createFolderForEnrollment(t35EnrollmentId);
    t35FolderId = folder.annual_folder_id;

    // Read back from DB to assert persisted values.
    const readBack = await raw.annual_folders.findUniqueOrThrow({
      where: { annual_folder_id: t35FolderId },
    });

    expect(readBack.union_camporee_id).toBe(t35UnionCamporeeId);
    expect(readBack.local_camporee_id).toBeNull();
    expect(readBack.requires_union_confirmation).toBe(true);

    // Evaluation rows must exist (one per template section, status=PENDING)
    const evaluations = await raw.annual_folder_section_evaluations.findMany({
      where: { annual_folder_id: t35FolderId },
    });
    expect(evaluations.length).toBeGreaterThan(0);
    for (const ev of evaluations) {
      expect(ev.status).toBe('PENDING');
    }
  });
});
