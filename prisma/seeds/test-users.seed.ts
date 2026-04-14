/**
 * Test users seed — creates one user per administrative role for testing RBAC flows.
 *
 * Run:
 *   pnpm exec tsx prisma/seeds/test-users.seed.ts
 *
 * Idempotent: safe to re-run. Refreshes password hash and resets state on each run.
 *
 * Created during session 2026-04-14 as part of "Camino C" (quirurgical fix + SDD preparation).
 *
 * Known role naming chaos (see engram topic sacdia-backend/rbac/role-naming-guard-bug):
 *   - DB has LF/union roles with DASHES (director-lf, assistant-lf, director-union, assistant-union)
 *   - permissions.guard.ts:630 checks with UNDERSCORES (director_lf, assistant_lf) — BROKEN SHORTCUT
 *   - Permission-based auth (role_permissions table) works correctly for dashed names
 *   - Cleanup scheduled for SDD annual-folders-ownership-rework
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---------- Constants (discovered via discovery script 2026-04-14) ----------
const PASSWORD = 'Sacdia2026!';
const BCRYPT_ROUNDS = 12;
const LOCAL_FIELD_ID = 4;   // ACV - Asociación Centro de Veracruz
const UNION_ID = 20;         // IOMU - Unión Mexicana Interoceánica
const CLUB_SECTION_ID = 1;   // Club 1, Guías Mayores (has active annual folder)
const YEAR_ID = 1;           // Active ecclesiastical year (2026-01-01 → 2026-12-31)

// ---------- User definitions ----------

type GlobalUserSpec = {
  email: string;
  name: string;
  lastName: string;
  roleName: string;
  scope: 'local_field' | 'union';
};

type ClubUserSpec = {
  email: string;
  name: string;
  lastName: string;
  roleName: string;
};

const GLOBAL_USERS: GlobalUserSpec[] = [
  {
    email: 'director-lf@sacdia.com',
    name: 'Director',
    lastName: 'LF Test',
    roleName: 'director-lf',
    scope: 'local_field',
  },
  {
    email: 'assistant-lf@sacdia.com',
    name: 'Assistant',
    lastName: 'LF Test',
    roleName: 'assistant-lf',
    scope: 'local_field',
  },
  {
    email: 'director-union@sacdia.com',
    name: 'Director',
    lastName: 'Union Test',
    roleName: 'director-union',
    scope: 'union',
  },
  {
    email: 'assistant-union@sacdia.com',
    name: 'Assistant',
    lastName: 'Union Test',
    roleName: 'assistant-union',
    scope: 'union',
  },
];

const CLUB_USERS: ClubUserSpec[] = [
  {
    email: 'director-club@sacdia.com',
    name: 'Director',
    lastName: 'Club Test',
    roleName: 'director',
  },
  {
    email: 'secretary-club@sacdia.com',
    name: 'Secretary',
    lastName: 'Club Test',
    roleName: 'secretary',
  },
  {
    email: 'treasurer-club@sacdia.com',
    name: 'Treasurer',
    lastName: 'Club Test',
    roleName: 'treasurer',
  },
  {
    email: 'counselor@sacdia.com',
    name: 'Counselor',
    lastName: 'Test',
    roleName: 'counselor',
  },
];

// ---------- Helpers ----------

async function resolveRoleId(roleName: string, category: 'GLOBAL' | 'CLUB'): Promise<string> {
  const role = await prisma.roles.findFirst({
    where: { role_name: roleName, role_category: category, active: true },
  });
  if (!role) {
    throw new Error(
      `Role "${roleName}" (category ${category}) not found in DB. ` +
      `Ensure role-permissions.seed.sql has been applied.`,
    );
  }
  return role.role_id;
}

async function upsertUserWithCredentials(opts: {
  email: string;
  name: string;
  lastName: string;
  passwordHash: string;
  localFieldId: number | null;
  unionId: number | null;
  accessPanel: boolean;
}): Promise<{ user_id: string }> {
  const user = await prisma.users.upsert({
    where: { email: opts.email },
    create: {
      email: opts.email,
      name: opts.name,
      paternal_last_name: opts.lastName,
      active: true,
      email_verified: true,
      approval_status: 'approved',
      access_app: true,
      access_panel: opts.accessPanel,
      local_field_id: opts.localFieldId,
      union_id: opts.unionId,
    },
    update: {
      name: opts.name,
      paternal_last_name: opts.lastName,
      active: true,
      email_verified: true,
      approval_status: 'approved',
      access_app: true,
      access_panel: opts.accessPanel,
      local_field_id: opts.localFieldId,
      union_id: opts.unionId,
    },
  });

  // Upsert credential in accounts table (Better Auth)
  const existingAccount = await prisma.account.findFirst({
    where: {
      providerId: 'credential',
      accountId: user.user_id,
    },
  });

  if (existingAccount) {
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: { password: opts.passwordHash },
    });
  } else {
    await prisma.account.create({
      data: {
        id: randomUUID(),
        accountId: user.user_id,
        providerId: 'credential',
        userId: user.user_id,
        password: opts.passwordHash,
      },
    });
  }

  // Mark post-registration as complete (test users skip the onboarding flow)
  await prisma.users_pr.upsert({
    where: { user_id: user.user_id },
    create: {
      user_id: user.user_id,
      complete: true,
      profile_picture_complete: true,
      personal_info_complete: true,
      club_selection_complete: true,
      date_completed: new Date(),
    },
    update: {
      complete: true,
      profile_picture_complete: true,
      personal_info_complete: true,
      club_selection_complete: true,
      date_completed: new Date(),
    },
  });

  return { user_id: user.user_id };
}

// ---------- Main ----------

async function main() {
  console.log('=== SACDIA Test Users Seed ===\n');

  // Hash once, reuse for all users
  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
  console.log(`Password: ${PASSWORD} (hashed with bcrypt cost ${BCRYPT_ROUNDS})\n`);

  // Resolve ecclesiastical year start_date for club assignments (stable for idempotency)
  const year = await prisma.ecclesiastical_years.findUnique({
    where: { year_id: YEAR_ID },
  });
  if (!year) {
    throw new Error(`Ecclesiastical year ${YEAR_ID} not found in DB`);
  }
  const assignmentStartDate = new Date(year.start_date);
  console.log(
    `Active ecclesiastical year: ${YEAR_ID} (start: ${assignmentStartDate.toISOString().slice(0, 10)})\n`,
  );

  // ========== GLOBAL users (LF + Union roles) ==========
  console.log('--- GLOBAL users (users_roles) ---\n');

  for (const spec of GLOBAL_USERS) {
    const roleId = await resolveRoleId(spec.roleName, 'GLOBAL');

    const localFieldId = spec.scope === 'local_field' ? LOCAL_FIELD_ID : null;
    const unionId = UNION_ID; // both LF and Union users belong to UMI in this seed

    const { user_id } = await upsertUserWithCredentials({
      email: spec.email,
      name: spec.name,
      lastName: spec.lastName,
      passwordHash,
      localFieldId,
      unionId,
      accessPanel: true, // global admins get panel access
    });

    // Upsert users_roles (global role assignment)
    await prisma.users_roles.upsert({
      where: {
        user_id_role_id: {
          user_id,
          role_id: roleId,
        },
      },
      create: {
        user_id,
        role_id: roleId,
        active: true,
      },
      update: {
        active: true,
      },
    });

    console.log(
      `  ✓ ${spec.email.padEnd(32)} → ${spec.roleName.padEnd(18)} (scope: ${spec.scope}, LF: ${localFieldId ?? '-'}, Union: ${unionId})`,
    );
  }

  // ========== CLUB users (club_role_assignments) ==========
  console.log('\n--- CLUB users (club_role_assignments) ---\n');

  for (const spec of CLUB_USERS) {
    const roleId = await resolveRoleId(spec.roleName, 'CLUB');

    const { user_id } = await upsertUserWithCredentials({
      email: spec.email,
      name: spec.name,
      lastName: spec.lastName,
      passwordHash,
      localFieldId: LOCAL_FIELD_ID, // club users also scoped to ACV
      unionId: UNION_ID,
      accessPanel: false, // club users only use the mobile app
    });

    // Upsert club_role_assignment — use findFirst + create/update to avoid ugly compound key
    const existingAssignment = await prisma.club_role_assignments.findFirst({
      where: {
        user_id,
        role_id: roleId,
        club_section_id: CLUB_SECTION_ID,
        ecclesiastical_year_id: YEAR_ID,
      },
    });

    if (existingAssignment) {
      await prisma.club_role_assignments.update({
        where: { assignment_id: existingAssignment.assignment_id },
        data: {
          active: true,
          status: 'active',
          end_date: null,
        },
      });
    } else {
      await prisma.club_role_assignments.create({
        data: {
          user_id,
          role_id: roleId,
          club_section_id: CLUB_SECTION_ID,
          ecclesiastical_year_id: YEAR_ID,
          start_date: assignmentStartDate,
          active: true,
          status: 'active',
        },
      });
    }

    console.log(
      `  ✓ ${spec.email.padEnd(32)} → ${spec.roleName.padEnd(18)} (section: ${CLUB_SECTION_ID}, year: ${YEAR_ID})`,
    );
  }

  // ========== Summary ==========
  console.log('\n=== Done ===\n');
  console.log('Credentials for all test users:');
  console.log(`  Password: ${PASSWORD}\n`);
  console.log('Emails:');
  [...GLOBAL_USERS, ...CLUB_USERS].forEach((u) => console.log(`  - ${u.email}`));
  console.log('\nTo verify in DB:');
  console.log(`  SELECT email, active, local_field_id, union_id FROM users WHERE email LIKE '%@sacdia.com' ORDER BY email;\n`);
}

main()
  .catch((err) => {
    console.error('\n❌ Seed failed:');
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
