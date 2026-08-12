/**
 * Core operational development seed for SACDIA.
 *
 * Creates a realistic ACV operational baseline:
 * - 60 approved app users (30 Conquistadores + 30 Guías Mayores)
 * - Active club role assignments for members and reused test leaders
 * - 6 units (3 per section) with captains, secretaries, and counselor advisor
 * - Current-year club enrollments for ACV sections
 * - Active class enrollments mapped by age and club type
 *
 * Run:
 *   pnpm prisma:seed:core
 *   pnpm prisma:seed:core -- --dry-run
 *
 * Safety:
 * - By default this only runs against the known Neon development branch marker.
 * - Override with SACDIA_CORE_SEED_ALLOW_ANY_DB=1 only for disposable/dev DBs.
 */

import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { seedBasicPathfinderStaffTraining } from './certifications/basic-pathfinder-staff-training.seed';

const DEVELOPMENT_BRANCH_MARKER = 'ep-rough-hill-anztwk76';
const ALLOW_ANY_DB_ENV = 'SACDIA_CORE_SEED_ALLOW_ANY_DB';
const DEFAULT_PASSWORD = 'Sacdia2026!';
const BCRYPT_ROUNDS = 12;
const TARGET_CLUB_NAME = 'ACV';
const TARGET_CLUB_TYPE_NAMES = ['Conquistadores', 'Guías Mayores'] as const;
const MEMBERS_PER_SECTION = 30;
const UNITS_PER_SECTION = 3;

type TransactionClient = Prisma.TransactionClient;

type ClubTypeName = (typeof TARGET_CLUB_TYPE_NAMES)[number];

interface SectionContext {
  clubSectionId: number;
  clubTypeId: number;
  clubTypeName: ClubTypeName;
}

interface SeedUser {
  userId: string;
  email: string;
}

interface MemberSpec {
  email: string;
  name: string;
  paternalLastName: string;
  maternalLastName: string;
  gender: 'Masculino' | 'Femenino';
  age: number;
  section: SectionContext;
}

interface LeaderUsers {
  director: SeedUser;
  secretary: SeedUser;
  treasurer: SeedUser;
  counselor: SeedUser;
}

interface RoleIds {
  director: string;
  secretary: string;
  treasurer: string;
  counselor: string;
  member: string;
}

interface ClassCandidate {
  class_id: number;
  minimum_age: number;
  display_order: number;
}

interface SeedSummary {
  leadersUpserted: number;
  membersUpserted: number;
  roleAssignmentsUpserted: number;
  clubEnrollmentsUpserted: number;
  unitsUpserted: number;
  unitMembershipsUpserted: number;
  classEnrollmentsUpserted: number;
  certificationModulesUpserted: number;
  certificationRequirementsUpserted: number;
  certificationComponentsUpserted: number;
}

class DryRunRollback extends Error {
  constructor(readonly summary: SeedSummary) {
    super('Dry run rollback');
  }
}

const maleNames = [
  'Mateo',
  'Santiago',
  'Sebastián',
  'Daniel',
  'Emiliano',
  'Leonardo',
  'Diego',
  'Nicolás',
  'Samuel',
  'Adrián',
  'Andrés',
  'Gabriel',
  'Joaquín',
  'Tomás',
  'Iván',
];

const femaleNames = [
  'Valentina',
  'Camila',
  'Sofía',
  'Mariana',
  'Regina',
  'Renata',
  'Natalia',
  'Lucía',
  'Daniela',
  'Abril',
  'Paula',
  'Fernanda',
  'Ximena',
  'Andrea',
  'Elena',
];

const paternalLastNames = [
  'Hernández',
  'García',
  'Martínez',
  'López',
  'González',
  'Pérez',
  'Rodríguez',
  'Sánchez',
  'Ramírez',
  'Cruz',
];

const maternalLastNames = [
  'Flores',
  'Morales',
  'Vargas',
  'Castillo',
  'Ortiz',
  'Reyes',
  'Torres',
  'Mendoza',
  'Rojas',
  'Navarro',
];

const unitNamesByClubType: Record<ClubTypeName, string[]> = {
  Conquistadores: ['Águilas', 'Leones', 'Halcones'],
  'Guías Mayores': ['Cumbres', 'Antorchas', 'Centinelas'],
};

const ageBandsByClubType: Record<ClubTypeName, number[]> = {
  Conquistadores: [10, 11, 12, 13, 14, 15],
  'Guías Mayores': [16, 17, 18, 19, 20, 21, 22, 23],
};

const leaderSpecs = {
  director: {
    email: 'director-club@sacdia.com',
    name: 'Director',
    paternalLastName: 'Club Test',
  },
  secretary: {
    email: 'secretary-club@sacdia.com',
    name: 'Secretary',
    paternalLastName: 'Club Test',
  },
  treasurer: {
    email: 'treasurer-club@sacdia.com',
    name: 'Treasurer',
    paternalLastName: 'Club Test',
  },
  counselor: {
    email: 'counselor@sacdia.com',
    name: 'Counselor',
    paternalLastName: 'Test',
  },
} as const;

function printHelp() {
  console.log(`
SACDIA core operational seed

Usage:
  pnpm prisma:seed:core
  pnpm prisma:seed:core -- --dry-run

Options:
  --dry-run   Execute inside a transaction and rollback at the end.
  --help      Show this message.
`);
}

function assertDevelopmentDatabase(connectionString: string | undefined) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run the core seed.');
  }

  if (process.env[ALLOW_ANY_DB_ENV] === '1') {
    return;
  }

  if (!connectionString.includes(DEVELOPMENT_BRANCH_MARKER)) {
    throw new Error(
      `Refusing to run core seed: DATABASE_URL is not the approved development branch. ` +
        `Set ${ALLOW_ANY_DB_ENV}=1 only for disposable/dev databases.`,
    );
  }
}

function createPrismaClient(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  return {
    prisma,
    async disconnect() {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function birthDateForAge(age: number, offset: number) {
  const birthYear = 2026 - age;
  const month = offset % 12;
  const day = (offset % 24) + 1;
  return new Date(Date.UTC(birthYear, month, day));
}

function emptySummary(): SeedSummary {
  return {
    leadersUpserted: 0,
    membersUpserted: 0,
    roleAssignmentsUpserted: 0,
    clubEnrollmentsUpserted: 0,
    unitsUpserted: 0,
    unitMembershipsUpserted: 0,
    classEnrollmentsUpserted: 0,
    certificationModulesUpserted: 0,
    certificationRequirementsUpserted: 0,
    certificationComponentsUpserted: 0,
  };
}

async function resolveRoleIds(tx: TransactionClient): Promise<RoleIds> {
  const roleNames = [
    'director',
    'secretary',
    'treasurer',
    'counselor',
    'member',
  ];
  const roles = await tx.roles.findMany({
    where: {
      role_name: { in: roleNames },
      role_category: 'CLUB',
      active: true,
    },
    select: { role_id: true, role_name: true },
  });

  const byName = new Map(roles.map((role) => [role.role_name, role.role_id]));

  for (const roleName of roleNames) {
    if (!byName.has(roleName)) {
      throw new Error(`Required CLUB role "${roleName}" not found.`);
    }
  }

  return {
    director: byName.get('director')!,
    secretary: byName.get('secretary')!,
    treasurer: byName.get('treasurer')!,
    counselor: byName.get('counselor')!,
    member: byName.get('member')!,
  };
}

async function resolveTargetSections(tx: TransactionClient) {
  const club = await tx.clubs.findFirst({
    where: { name: TARGET_CLUB_NAME, active: true },
    select: {
      club_id: true,
      local_field_id: true,
      church_id: true,
      local_fields: { select: { union_id: true } },
    },
  });

  if (!club) {
    throw new Error(`Active club "${TARGET_CLUB_NAME}" not found.`);
  }

  const sections = await tx.club_sections.findMany({
    where: {
      main_club_id: club.club_id,
      active: true,
      club_types: {
        name: { in: [...TARGET_CLUB_TYPE_NAMES] },
      },
    },
    select: {
      club_section_id: true,
      club_type_id: true,
      club_types: { select: { name: true } },
    },
    orderBy: [{ club_type_id: 'asc' }, { club_section_id: 'asc' }],
  });

  const contexts = sections.map((section) => ({
    clubSectionId: section.club_section_id,
    clubTypeId: section.club_type_id,
    clubTypeName: section.club_types.name as ClubTypeName,
  }));

  for (const clubTypeName of TARGET_CLUB_TYPE_NAMES) {
    if (!contexts.some((section) => section.clubTypeName === clubTypeName)) {
      throw new Error(
        `Active ${clubTypeName} section for club "${TARGET_CLUB_NAME}" not found.`,
      );
    }
  }

  return {
    club,
    sections: contexts,
  };
}

async function resolveOperationalYear(tx: TransactionClient) {
  const activeYear = await tx.ecclesiastical_years.findFirst({
    where: { active: true },
    orderBy: { start_date: 'desc' },
  });

  if (activeYear) {
    return activeYear;
  }

  const fallbackYear = await tx.ecclesiastical_years.findFirst({
    orderBy: { start_date: 'desc' },
  });

  if (!fallbackYear) {
    throw new Error('No ecclesiastical year found.');
  }

  return fallbackYear;
}

async function upsertUserWithCredential(
  tx: TransactionClient,
  params: {
    email: string;
    name: string;
    paternalLastName: string;
    maternalLastName?: string | null;
    gender?: 'Masculino' | 'Femenino' | null;
    birthday?: Date | null;
    localFieldId: number | null;
    unionId: number | null;
    countryId: number | null;
    accessPanel: boolean;
    passwordHash: string;
  },
): Promise<SeedUser> {
  const user = await tx.users.upsert({
    where: { email: params.email },
    create: {
      email: params.email,
      name: params.name,
      paternal_last_name: params.paternalLastName,
      maternal_last_name: params.maternalLastName,
      gender: params.gender,
      birthday: params.birthday,
      active: true,
      email_verified: true,
      approval_status: 'approved',
      access_app: true,
      access_panel: params.accessPanel,
      local_field_id: params.localFieldId,
      union_id: params.unionId,
      country_id: params.countryId,
    },
    update: {
      name: params.name,
      paternal_last_name: params.paternalLastName,
      maternal_last_name: params.maternalLastName,
      gender: params.gender,
      birthday: params.birthday,
      active: true,
      email_verified: true,
      approval_status: 'approved',
      access_app: true,
      access_panel: params.accessPanel,
      local_field_id: params.localFieldId,
      union_id: params.unionId,
      country_id: params.countryId,
    },
    select: { user_id: true, email: true },
  });

  const existingAccount = await tx.account.findFirst({
    where: {
      providerId: 'credential',
      accountId: user.user_id,
    },
    select: { id: true },
  });

  if (existingAccount) {
    await tx.account.update({
      where: { id: existingAccount.id },
      data: { password: params.passwordHash },
    });
  } else {
    await tx.account.create({
      data: {
        id: randomUUID(),
        accountId: user.user_id,
        providerId: 'credential',
        userId: user.user_id,
        password: params.passwordHash,
      },
    });
  }

  await tx.users_pr.upsert({
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

  return { userId: user.user_id, email: user.email };
}

async function upsertClubAssignment(
  tx: TransactionClient,
  params: {
    userId: string;
    roleId: string;
    clubSectionId: number;
    yearId: number;
    startDate: Date;
  },
) {
  const existing = await tx.club_role_assignments.findFirst({
    where: {
      user_id: params.userId,
      role_id: params.roleId,
      club_section_id: params.clubSectionId,
      ecclesiastical_year_id: params.yearId,
    },
    orderBy: { created_at: 'desc' },
    select: { assignment_id: true },
  });

  if (existing) {
    return tx.club_role_assignments.update({
      where: { assignment_id: existing.assignment_id },
      data: {
        start_date: params.startDate,
        active: true,
        status: 'active',
        end_date: null,
        expires_at: null,
        rejection_reason: null,
      },
      select: { assignment_id: true },
    });
  }

  return tx.club_role_assignments.create({
    data: {
      user_id: params.userId,
      role_id: params.roleId,
      club_section_id: params.clubSectionId,
      ecclesiastical_year_id: params.yearId,
      start_date: params.startDate,
      active: true,
      status: 'active',
    },
    select: { assignment_id: true },
  });
}

function createMemberSpecs(sections: SectionContext[]): MemberSpec[] {
  return sections.flatMap((section) => {
    const slug = slugify(section.clubTypeName);
    const ages = ageBandsByClubType[section.clubTypeName];

    return Array.from({ length: MEMBERS_PER_SECTION }, (_, index) => {
      const sequence = index + 1;
      const isMale = index % 2 === 0;

      return {
        email: `core.member.${slug}.${String(sequence).padStart(2, '0')}@sacdia.test`,
        name: isMale
          ? maleNames[index % maleNames.length]
          : femaleNames[index % femaleNames.length],
        paternalLastName: paternalLastNames[index % paternalLastNames.length],
        maternalLastName: maternalLastNames[index % maternalLastNames.length],
        gender: isMale ? 'Masculino' : 'Femenino',
        age: ages[index % ages.length],
        section,
      };
    });
  });
}

async function upsertLeaders(
  tx: TransactionClient,
  params: {
    roleIds: RoleIds;
    sections: SectionContext[];
    yearId: number;
    assignmentStartDate: Date;
    passwordHash: string;
    localFieldId: number | null;
    unionId: number | null;
    countryId: number | null;
    summary: SeedSummary;
  },
): Promise<LeaderUsers> {
  const leaders = {} as LeaderUsers;

  for (const [key, spec] of Object.entries(leaderSpecs) as Array<
    [keyof LeaderUsers, (typeof leaderSpecs)[keyof typeof leaderSpecs]]
  >) {
    const user = await upsertUserWithCredential(tx, {
      email: spec.email,
      name: spec.name,
      paternalLastName: spec.paternalLastName,
      localFieldId: params.localFieldId,
      unionId: params.unionId,
      countryId: params.countryId,
      accessPanel: false,
      passwordHash: params.passwordHash,
    });

    leaders[key] = user;
    params.summary.leadersUpserted += 1;
  }

  for (const section of params.sections) {
    const assignments = [
      { user: leaders.director, roleId: params.roleIds.director },
      { user: leaders.secretary, roleId: params.roleIds.secretary },
      { user: leaders.treasurer, roleId: params.roleIds.treasurer },
      { user: leaders.counselor, roleId: params.roleIds.counselor },
    ];

    for (const assignment of assignments) {
      const result = await upsertClubAssignment(tx, {
        userId: assignment.user.userId,
        roleId: assignment.roleId,
        clubSectionId: section.clubSectionId,
        yearId: params.yearId,
        startDate: params.assignmentStartDate,
      });

      params.summary.roleAssignmentsUpserted += 1;

      await tx.users_pr.update({
        where: { user_id: assignment.user.userId },
        data: { active_club_assignment_id: result.assignment_id },
      });
    }
  }

  return leaders;
}

async function loadClassesByType(
  tx: TransactionClient,
  sections: SectionContext[],
) {
  const clubTypeIds = [
    ...new Set(sections.map((section) => section.clubTypeId)),
  ];
  const classes = await tx.classes.findMany({
    where: {
      club_type_id: { in: clubTypeIds },
      active: true,
    },
    select: {
      class_id: true,
      club_type_id: true,
      minimum_age: true,
      display_order: true,
    },
    orderBy: [
      { club_type_id: 'asc' },
      { minimum_age: 'asc' },
      { display_order: 'asc' },
    ],
  });

  const byType = new Map<number, ClassCandidate[]>();

  for (const currentClass of classes) {
    const candidates = byType.get(currentClass.club_type_id) ?? [];
    candidates.push({
      class_id: currentClass.class_id,
      minimum_age: currentClass.minimum_age,
      display_order: currentClass.display_order,
    });
    byType.set(currentClass.club_type_id, candidates);
  }

  for (const section of sections) {
    if (!byType.has(section.clubTypeId)) {
      throw new Error(`No active classes found for ${section.clubTypeName}.`);
    }
  }

  return byType;
}

function selectClassForMember(
  classesByType: Map<number, ClassCandidate[]>,
  section: SectionContext,
  age: number,
) {
  const candidates = classesByType.get(section.clubTypeId) ?? [];
  const ageEligible = candidates
    .filter((candidate) => candidate.minimum_age <= age)
    .sort(
      (a, b) =>
        b.minimum_age - a.minimum_age || a.display_order - b.display_order,
    );

  return ageEligible[0] ?? candidates[0];
}

async function upsertMemberEnrollment(
  tx: TransactionClient,
  params: {
    userId: string;
    classId: number;
    yearId: number;
  },
) {
  await tx.enrollments.updateMany({
    where: {
      user_id: params.userId,
      ecclesiastical_year_id: params.yearId,
      active: true,
      NOT: { class_id: params.classId },
    },
    data: { active: false },
  });

  return tx.enrollments.upsert({
    where: {
      user_id_class_id_ecclesiastical_year_id: {
        user_id: params.userId,
        class_id: params.classId,
        ecclesiastical_year_id: params.yearId,
      },
    },
    create: {
      user_id: params.userId,
      class_id: params.classId,
      ecclesiastical_year_id: params.yearId,
      investiture_status: 'IN_PROGRESS',
      active: true,
    },
    update: {
      investiture_status: 'IN_PROGRESS',
      submitted_for_validation: false,
      submitted_at: null,
      validated_by: null,
      validated_at: null,
      rejection_reason: null,
      investiture_date: null,
      locked_for_validation: false,
      active: true,
      last_progress_change: new Date(),
    },
  });
}

async function upsertClubEnrollments(
  tx: TransactionClient,
  params: {
    sections: SectionContext[];
    yearId: number;
    leaders: LeaderUsers;
    summary: SeedSummary;
  },
) {
  for (const section of params.sections) {
    await tx.club_enrollments.upsert({
      where: {
        club_section_id_ecclesiastical_year_id: {
          club_section_id: section.clubSectionId,
          ecclesiastical_year_id: params.yearId,
        },
      },
      create: {
        club_section_id: section.clubSectionId,
        ecclesiastical_year_id: params.yearId,
        status: 'active',
        address: 'Sede ACV',
        meeting_days: 'Sábados',
        meeting_schedule: [{ day: 'Sábado', time: '16:00' }],
        souls_target: MEMBERS_PER_SECTION,
        fee: false,
        fee_amount: null,
        director_id: params.leaders.director.userId,
        deputy_director_ids: [],
        secretary_id: params.leaders.secretary.userId,
        treasurer_id: params.leaders.treasurer.userId,
        secretary_treasurer_id: null,
        created_by: params.leaders.director.userId,
      },
      update: {
        status: 'active',
        address: 'Sede ACV',
        meeting_days: 'Sábados',
        meeting_schedule: [{ day: 'Sábado', time: '16:00' }],
        souls_target: MEMBERS_PER_SECTION,
        fee: false,
        fee_amount: null,
        director_id: params.leaders.director.userId,
        deputy_director_ids: [],
        secretary_id: params.leaders.secretary.userId,
        treasurer_id: params.leaders.treasurer.userId,
        secretary_treasurer_id: null,
        created_by: params.leaders.director.userId,
        closed_at: null,
      },
    });

    params.summary.clubEnrollmentsUpserted += 1;
  }
}

async function upsertUnits(
  tx: TransactionClient,
  params: {
    section: SectionContext;
    members: SeedUser[];
    leaders: LeaderUsers;
    summary: SeedSummary;
  },
) {
  const unitNames = unitNamesByClubType[params.section.clubTypeName];

  for (let unitIndex = 0; unitIndex < UNITS_PER_SECTION; unitIndex += 1) {
    const unitMembers = params.members.filter(
      (_, index) => index % UNITS_PER_SECTION === unitIndex,
    );
    const captain = unitMembers[0];
    const secretary = unitMembers[1] ?? unitMembers[0];
    const unitName = unitNames[unitIndex];

    const existingUnit = await tx.units.findFirst({
      where: {
        club_section_id: params.section.clubSectionId,
        name: unitName,
      },
      select: { unit_id: true },
    });

    const unit = existingUnit
      ? await tx.units.update({
          where: { unit_id: existingUnit.unit_id },
          data: {
            captain_id: captain.userId,
            secretary_id: secretary.userId,
            advisor_id: params.leaders.counselor.userId,
            substitute_advisor_id: null,
            club_type_id: params.section.clubTypeId,
            club_section_id: params.section.clubSectionId,
            active: true,
          },
          select: { unit_id: true },
        })
      : await tx.units.create({
          data: {
            name: unitName,
            captain_id: captain.userId,
            secretary_id: secretary.userId,
            advisor_id: params.leaders.counselor.userId,
            substitute_advisor_id: null,
            club_type_id: params.section.clubTypeId,
            club_section_id: params.section.clubSectionId,
            active: true,
          },
          select: { unit_id: true },
        });

    params.summary.unitsUpserted += 1;

    for (const member of unitMembers) {
      await tx.unit_members.updateMany({
        where: {
          user_id: member.userId,
          active: true,
          NOT: { unit_id: unit.unit_id },
        },
        data: { active: false },
      });

      const existingMembership = await tx.unit_members.findFirst({
        where: {
          user_id: member.userId,
          unit_id: unit.unit_id,
        },
        select: { unit_member_id: true },
      });

      if (existingMembership) {
        await tx.unit_members.update({
          where: { unit_member_id: existingMembership.unit_member_id },
          data: { active: true },
        });
      } else {
        await tx.unit_members.create({
          data: {
            user_id: member.userId,
            unit_id: unit.unit_id,
            active: true,
          },
        });
      }

      params.summary.unitMembershipsUpserted += 1;
    }
  }
}

async function seedCore(prisma: PrismaClient, dryRun: boolean) {
  return prisma.$transaction(
    async (tx) => {
      const summary = emptySummary();
      const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);
      const roleIds = await resolveRoleIds(tx);
      const { club, sections } = await resolveTargetSections(tx);
      const year = await resolveOperationalYear(tx);
      const assignmentStartDate = new Date(year.start_date);
      const mexico = await tx.countries.findFirst({
        where: { abbreviation: 'MX' },
        select: { country_id: true },
      });

      const leaders = await upsertLeaders(tx, {
        roleIds,
        sections,
        yearId: year.year_id,
        assignmentStartDate,
        passwordHash,
        localFieldId: club.local_field_id,
        unionId: club.local_fields.union_id,
        countryId: mexico?.country_id ?? null,
        summary,
      });

      await upsertClubEnrollments(tx, {
        sections,
        yearId: year.year_id,
        leaders,
        summary,
      });

      const classesByType = await loadClassesByType(tx, sections);
      const memberSpecs = createMemberSpecs(sections);
      const membersBySection = new Map<number, SeedUser[]>();

      for (const spec of memberSpecs) {
        const user = await upsertUserWithCredential(tx, {
          email: spec.email,
          name: spec.name,
          paternalLastName: spec.paternalLastName,
          maternalLastName: spec.maternalLastName,
          gender: spec.gender,
          birthday: birthDateForAge(spec.age, summary.membersUpserted),
          localFieldId: club.local_field_id,
          unionId: club.local_fields.union_id,
          countryId: mexico?.country_id ?? null,
          accessPanel: false,
          passwordHash,
        });

        summary.membersUpserted += 1;

        const assignment = await upsertClubAssignment(tx, {
          userId: user.userId,
          roleId: roleIds.member,
          clubSectionId: spec.section.clubSectionId,
          yearId: year.year_id,
          startDate: assignmentStartDate,
        });

        summary.roleAssignmentsUpserted += 1;

        await tx.users_pr.update({
          where: { user_id: user.userId },
          data: { active_club_assignment_id: assignment.assignment_id },
        });

        const selectedClass = selectClassForMember(
          classesByType,
          spec.section,
          spec.age,
        );

        await upsertMemberEnrollment(tx, {
          userId: user.userId,
          classId: selectedClass.class_id,
          yearId: year.year_id,
        });

        summary.classEnrollmentsUpserted += 1;

        const sectionMembers =
          membersBySection.get(spec.section.clubSectionId) ?? [];
        sectionMembers.push(user);
        membersBySection.set(spec.section.clubSectionId, sectionMembers);
      }

      for (const section of sections) {
        const members = membersBySection.get(section.clubSectionId) ?? [];
        await upsertUnits(tx, {
          section,
          members,
          leaders,
          summary,
        });
      }

      // Independent domain seed: the configurable certifications catalog
      // ("Capacitación básica para el personal del Club de Conquistadores").
      // Passing `tx` directly (instead of the outer `prisma`) makes this run
      // inside the same transaction without opening a nested one.
      const certificationSeedReport =
        await seedBasicPathfinderStaffTraining(tx);
      summary.certificationModulesUpserted =
        certificationSeedReport.moduleCount;
      summary.certificationRequirementsUpserted =
        certificationSeedReport.requirementCount;
      summary.certificationComponentsUpserted =
        certificationSeedReport.componentCount;

      if (dryRun) {
        throw new DryRunRollback(summary);
      }

      return summary;
    },
    { timeout: 120_000 },
  );
}

function printSummary(summary: SeedSummary, dryRun: boolean) {
  console.log(
    dryRun
      ? '\n✅ Dry run completed; transaction rolled back.'
      : '\n✅ Core seed completed.',
  );
  console.table(summary);
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has('--help') || args.has('-h')) {
    printHelp();
    return;
  }

  const dryRun = args.has('--dry-run');
  const connectionString = process.env.DATABASE_URL;
  assertDevelopmentDatabase(connectionString);

  const { prisma, disconnect } = createPrismaClient(connectionString!);

  try {
    const summary = await seedCore(prisma, dryRun);
    printSummary(summary, dryRun);
  } catch (error) {
    if (error instanceof DryRunRollback) {
      printSummary(error.summary, true);
      return;
    }

    console.error('\n❌ Core seed failed.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await disconnect();
  }
}

void main();
