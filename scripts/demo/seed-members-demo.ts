/**
 * seed-members-demo.ts
 *
 * DEV-ONLY demo data for the Members screens of the Flutter app, in the
 * Aventureros section of the active club of `director-club@sacdia.com`
 * (the section is resolved through the director's active `director` role
 * assignment; nothing is hardcoded).
 *
 * HOW TO RUN
 * ----------
 * Nothing happens without a mode flag (prints the usage and exits):
 *   npx tsx scripts/demo/seed-members-demo.ts
 *
 * Dry-run (default once a mode is chosen: reads the DB, prints the plan, writes NOTHING):
 *   npx tsx scripts/demo/seed-members-demo.ts --demo
 *   npx tsx scripts/demo/seed-members-demo.ts --cleanup
 *
 * Write (mode flag AND --apply):
 *   npx tsx scripts/demo/seed-members-demo.ts --demo --apply
 *   npx tsx scripts/demo/seed-members-demo.ts --cleanup --apply
 *
 * WHAT --demo CREATES (all idempotent: user ids are deterministic UUIDs, so a
 * second run updates in place and never duplicates)
 * ---------------------------------------------------------------------------
 * A) 10 enrolled children spread over the Aventureros classes (+ a verified
 *    external guardian each) and 4 adult staff (deputy-director, secretary,
 *    treasurer, counselor), respecting role_slot_limits. The staff are
 *    GM-eligible (club model: only a Guía Mayor holds service roles in AV/CQ),
 *    so each one ALSO gets a `member` row (active) in the club's Guías Mayores
 *    section and a GM-01 enrollment (IN_PROGRESS, active, current year), next
 *    to the staff role row in the Aventureros section.
 * B) Pending join requests, one per state the app distinguishes:
 *    1 adult with own account; 2 minor, consent VERIFIED; 3 minor, consent
 *    pending, form uploaded by the guardian; 4 minor under CLUB CUSTODY, form
 *    uploaded by the director (four-eyes => viewer_verify_block=self_custodian);
 *    5 minor, pending, no form, two guardians; 6 minor, pending, no form, one
 *    guardian, requested 20 days ago.
 * C) Existing pending requests of that section whose user has EMPTY names get
 *    realistic names (only when all name fields are blank). The originals are
 *    backed up in <tmpdir>/sacdia-demo-av-renames.json so --cleanup reverts them.
 *
 * MARKING: adults/guardians use demo.av.<slug>@sacdia.test. Children are
 * dependents and MUST keep email NULL (users.email is null for minors without
 * an account), so they are identified by their deterministic UUID. There is no
 * is_test_data column on users, and guardianships MUST stay is_test_data=false
 * (the consent resolver ignores test rows), so ids are the only marker.
 *
 * Photos: users.user_image accepts an absolute URL; the API only signs values
 * that point into the USER_PROFILES bucket and returns anything else untouched.
 * randomuser.me URLs are stored directly (nothing is uploaded for photos).
 *
 * Consent forms (PDF) are generated here with pdfkit and uploaded through the
 * backend's own R2FileStorageService to R2_BUCKET_GUARDIANSHIP_EVIDENCE, with
 * the same key shape as GuardianEvidenceService ({prefix}/{guardianshipId}/{uuid}.pdf).
 *
 * SAFETY: refuses NODE_ENV=production and any DATABASE_URL that does not contain
 * the Neon DEVELOPMENT endpoint id. The host (no credentials) is printed first.
 */

import { createHash, randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { StorageBucketAlias } from '../../src/common/services/file-storage.service';
import { R2FileStorageService } from '../../src/common/services/r2-file-storage.service';

const DEV_ENDPOINT_ID = 'ep-rough-hill-anztwk76';
const PROD_ENDPOINT_ID = 'ep-dark-thunder-anpobd36';
const DIRECTOR_EMAIL = 'director-club@sacdia.com';
const CLUB_TYPE_NAME = 'Aventureros';
const GM_CLUB_TYPE_NAME = 'Guías Mayores';
const GM_CLASS_ASSET_CODE = 'GM-01';
const EMAIL_DOMAIN = 'sacdia.test';
const UUID_NAMESPACE = 'sacdia-demo-av-members:v1';
const RENAMES_FILE = join(tmpdir(), 'sacdia-demo-av-renames.json');
const BASE_TIMEOUT_DAYS = 8;
const CONSENT_PENDING_TIMEOUT_DAYS = 30;
const EVIDENCE_ENVS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_GUARDIANSHIP_EVIDENCE',
] as const;

export interface DemoOptions {
  demo: boolean;
  cleanup: boolean;
  apply: boolean;
}

export function parseDemoArgs(args: string[]): DemoOptions {
  const options: DemoOptions = { demo: false, cleanup: false, apply: false };
  for (const arg of args) {
    if (arg === '--demo') options.demo = true;
    else if (arg === '--cleanup') options.cleanup = true;
    else if (arg === '--apply') options.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.demo && options.cleanup) {
    throw new Error('Pass --demo OR --cleanup, not both.');
  }
  return options;
}

// ---------------------------------------------------------------------------
// Deterministic ids and small helpers
// ---------------------------------------------------------------------------

/** UUID (v5-shaped) derived from a stable key: same key, same id, every run. */
function uuidFor(key: string): string {
  const h = createHash('sha1').update(`${UUID_NAMESPACE}:${key}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

function daysAgo(days: number, hour = 10): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

const isBlank = (v: string | null | undefined) => !v || v.trim() === '';

const kidPhoto = (n: number) =>
  `https://randomuser.me/api/portraits/lego/${n}.jpg`;
const womanPhoto = (n: number) =>
  `https://randomuser.me/api/portraits/women/${n}.jpg`;
const manPhoto = (n: number) =>
  `https://randomuser.me/api/portraits/men/${n}.jpg`;

// ---------------------------------------------------------------------------
// The demo catalog (static plan; the DB only tells which rows already exist)
// ---------------------------------------------------------------------------

type Gender = 'Masculino' | 'Femenino';

interface PersonSpec {
  key: string;
  name: string;
  pat: string;
  mat: string;
  gender: Gender;
  /** Children: age on 2026-11-10 (birthday already happened this year). Adults: birth year. */
  age?: number;
  birthYear?: number;
  month: number; // 0-based
  day: number;
  photo: string | null;
  dependent: boolean;
}

const kid = (
  key: string,
  name: string,
  pat: string,
  mat: string,
  gender: Gender,
  age: number,
  month: number,
  day: number,
  photo: string | null,
): PersonSpec => ({
  key,
  name,
  pat,
  mat,
  gender,
  age,
  month,
  day,
  photo,
  dependent: true,
});

const adult = (
  key: string,
  name: string,
  pat: string,
  mat: string,
  gender: Gender,
  birthYear: number,
  month: number,
  day: number,
  photo: string | null,
): PersonSpec => ({
  key,
  name,
  pat,
  mat,
  gender,
  birthYear,
  month,
  day,
  photo,
  dependent: false,
});

/** Birthday as a UTC date (users.birthday is @db.Date). */
function birthdayOf(p: PersonSpec): Date {
  const year = p.age !== undefined ? 2026 - p.age : (p.birthYear as number);
  return new Date(Date.UTC(year, p.month, p.day));
}

function emailOf(p: PersonSpec): string | null {
  return p.dependent ? null : `demo.av.${p.key}@${EMAIL_DOMAIN}`;
}

// A) enrolled children: class name as in the catalog, fallback age if the
// catalog has no minimum_age.
interface MemberKid {
  person: PersonSpec;
  className: string;
  guardianName: string;
  guardianRel: 'Madre' | 'Padre';
}

const MEMBER_KIDS: MemberKid[] = [
  {
    person: kid('mem-santiago', 'Santiago', 'Ramírez', 'Torres', 'Masculino', 4, 2, 14, kidPhoto(0)),
    className: 'Corderitos',
    guardianName: 'Lucía Torres Vega',
    guardianRel: 'Madre',
  },
  {
    person: kid('mem-valentina', 'Valentina', 'Cruz', 'Mendoza', 'Femenino', 4, 6, 3, kidPhoto(1)),
    className: 'Corderitos',
    guardianName: 'Ernesto Cruz Lara',
    guardianRel: 'Padre',
  },
  {
    person: kid('mem-mateo', 'Mateo', 'Hernández', 'Salas', 'Masculino', 5, 0, 21, kidPhoto(2)),
    className: 'Aves Madrugadoras',
    guardianName: 'Rocío Salas Pérez',
    guardianRel: 'Madre',
  },
  {
    person: kid('mem-camila', 'Camila', 'Flores', 'Ortega', 'Femenino', 5, 7, 9, kidPhoto(3)),
    className: 'Aves Madrugadoras',
    guardianName: 'Alberto Flores Díaz',
    guardianRel: 'Padre',
  },
  {
    person: kid('mem-emiliano', 'Emiliano', 'Vargas', 'Ruiz', 'Masculino', 6, 4, 27, kidPhoto(4)),
    className: 'Abejitas Industriosas',
    guardianName: 'Karla Ruiz Medina',
    guardianRel: 'Madre',
  },
  {
    person: kid('mem-sofia', 'Sofía', 'Morales', 'Castillo', 'Femenino', 6, 9, 1, kidPhoto(5)),
    className: 'Abejitas Industriosas',
    guardianName: 'Raúl Morales Ponce',
    guardianRel: 'Padre',
  },
  {
    person: kid('mem-leonardo', 'Leonardo', 'Jiménez', 'Rojas', 'Masculino', 7, 1, 8, kidPhoto(6)),
    className: 'Rayos de Sol',
    guardianName: 'Adriana Rojas Campos',
    guardianRel: 'Madre',
  },
  {
    person: kid('mem-isabella', 'Isabella', 'Reyes', 'Navarro', 'Femenino', 8, 5, 19, kidPhoto(7)),
    className: 'Constructores',
    guardianName: 'Marco Reyes Soto',
    guardianRel: 'Padre',
  },
  {
    person: kid('mem-gael', 'Gael', 'Domínguez', 'Pineda', 'Masculino', 8, 8, 30, kidPhoto(8)),
    className: 'Constructores',
    guardianName: 'Paola Pineda Luna',
    guardianRel: 'Madre',
  },
  {
    // No photo on purpose: initials fallback.
    person: kid('mem-regina', 'Regina', 'Aguilar', 'Lara', 'Femenino', 9, 3, 12, null),
    className: 'Manos Ayudadoras',
    guardianName: 'Sergio Aguilar Mora',
    guardianRel: 'Padre',
  },
];

interface StaffSpec {
  person: PersonSpec;
  role: 'deputy-director' | 'secretary' | 'treasurer' | 'counselor';
}

const STAFF: StaffSpec[] = [
  {
    person: adult('staff-laura', 'Laura', 'Gómez', 'Fuentes', 'Femenino', 1987, 3, 5, womanPhoto(44)),
    role: 'deputy-director',
  },
  {
    person: adult('staff-ricardo', 'Ricardo', 'Paredes', 'Luna', 'Masculino', 1984, 10, 17, manPhoto(32)),
    role: 'secretary',
  },
  {
    person: adult('staff-marta', 'Marta Elena', 'Solís', 'Ibarra', 'Femenino', 1990, 6, 23, womanPhoto(68)),
    role: 'treasurer',
  },
  {
    person: adult('staff-andres', 'Andrés', 'Cabrera', 'Montes', 'Masculino', 1992, 1, 11, manPhoto(75)),
    role: 'counselor',
  },
];

// B) applicants
const ADULT_APPLICANT = adult('req1-jorge', 'Jorge Luis', 'Benítez', 'Arce', 'Masculino', 1991, 4, 2, manPhoto(52));

const KID2 = kid('req2-diego', 'Diego', 'Ortiz', 'Mejía', 'Masculino', 6, 2, 25, kidPhoto(3));
const GUARD2 = adult('req2-patricia', 'Patricia', 'Mejía', 'Soto', 'Femenino', 1989, 7, 14, womanPhoto(21));

const KID3 = kid('req3-ximena', 'Ximena', 'Salazar', 'Peña', 'Femenino', 7, 5, 6, kidPhoto(6));
const GUARD3 = adult('req3-fernando', 'Fernando', 'Salazar', 'Ochoa', 'Masculino', 1986, 8, 29, manPhoto(14));

const KID4 = kid('req4-tadeo', 'Tadeo', 'Núñez', 'Quiroz', 'Masculino', 5, 1, 18, kidPhoto(9));

const KID5 = kid('req5-renata', 'Renata', 'Campos', 'Valdez', 'Femenino', 8, 6, 10, kidPhoto(1));
const GUARD5_MOTHER = adult('req5-claudia', 'Claudia', 'Valdez', 'Ríos', 'Femenino', 1988, 0, 16, womanPhoto(33));
const GUARD5_FATHER = adult('req5-hector', 'Héctor', 'Campos', 'Beltrán', 'Masculino', 1985, 9, 4, manPhoto(61));

// No photo on purpose: initials fallback.
const KID6 = kid('req6-bruno', 'Bruno', 'Esquivel', 'Cano', 'Masculino', 4, 3, 22, null);
const GUARD6 = adult('req6-gabriela', 'Gabriela', 'Cano', 'Duarte', 'Femenino', 1993, 10, 8, womanPhoto(57));

/** Names for the existing blank-name requests (C), by dependent / adult. */
const BLANK_FIX_KIDS: Array<[string, string, string]> = [
  ['Thiago', 'Mendoza', 'Gil'],
  ['Mía', 'Rangel', 'Solano'],
  ['Dante', 'Cervantes', 'Ayala'],
  ['Alba', 'Trejo', 'Orozco'],
  ['Joaquín', 'Bravo', 'Montoya'],
  ['Luna', 'Escobar', 'Prieto'],
];
const BLANK_FIX_ADULTS: Array<[string, string, string]> = [
  ['Natalia', 'Herrera', 'Villalobos'],
  ['Óscar', 'Fuentes', 'Barrera'],
  ['Elisa', 'Montiel', 'Cordero'],
  ['Iván', 'Quintero', 'Salgado'],
];

// ---------------------------------------------------------------------------
// Plan model
// ---------------------------------------------------------------------------

interface PlanUser {
  id: string;
  spec: PersonSpec;
  email: string | null;
  birthday: Date;
  label: string;
}

interface PlanAssignment {
  id: string;
  userId: string;
  userLabel: string;
  role: string;
  status: 'active' | 'pending';
  createdAt: Date;
  expiresAt: Date | null;
  note: string;
  /** 'gm' = the club's Guías Mayores section; default = the AV section. */
  section?: 'gm';
}

interface PlanEnrollment {
  userId: string;
  userLabel: string;
  className: string;
  /** true = the GM-01 class of the catalog (resolved by asset_code). */
  gm?: true;
}

interface PlanGuardianship {
  id: string;
  dependentId: string;
  dependentLabel: string;
  guardianId: string | null;
  guardianLabel: string;
  externalName: string | null;
  externalPhone: string | null;
  relationship: 'Madre' | 'Padre' | null;
  isPrimary: boolean;
  custody: boolean;
  status: 'pending' | 'verified';
  verifiedAt: Date | null;
  verificationMethod: string | null;
  createdAt: Date;
}

interface PlanEvidence {
  guardianshipId: string;
  childLabel: string;
  guardianLabel: string;
  uploadedByKey: 'director' | string; // user id of the uploader or 'director'
  uploadedByLabel: string;
  uploadedAt: Date;
}

interface Plan {
  users: PlanUser[];
  dependents: Array<{ userId: string; label: string; createdBy: 'director' }>;
  assignments: PlanAssignment[];
  enrollments: PlanEnrollment[];
  guardianships: PlanGuardianship[];
  evidences: PlanEvidence[];
  stateLabels: Array<{ state: string; who: string; expect: string }>;
}

const fullName = (p: PersonSpec) => `${p.name} ${p.pat} ${p.mat}`;

function buildPlan(directorId: string, yearStart: Date): Plan {
  const users: PlanUser[] = [];
  const dependents: Plan['dependents'] = [];
  const assignments: PlanAssignment[] = [];
  const enrollments: PlanEnrollment[] = [];
  const guardianships: PlanGuardianship[] = [];
  const evidences: PlanEvidence[] = [];
  const stateLabels: Plan['stateLabels'] = [];

  void yearStart;
  const addUser = (spec: PersonSpec): PlanUser => {
    const u: PlanUser = {
      id: uuidFor(`user:${spec.key}`),
      spec,
      email: emailOf(spec),
      birthday: birthdayOf(spec),
      label: fullName(spec),
    };
    users.push(u);
    if (spec.dependent) {
      dependents.push({ userId: u.id, label: u.label, createdBy: 'director' });
    }
    return u;
  };

  // A) members
  for (const m of MEMBER_KIDS) {
    const u = addUser(m.person);
    assignments.push({
      id: uuidFor(`assign:${m.person.key}:member`),
      userId: u.id,
      userLabel: u.label,
      role: 'member',
      status: 'active',
      createdAt: daysAgo(60),
      expiresAt: null,
      note: `Miembro, clase ${m.className}`,
    });
    enrollments.push({ userId: u.id, userLabel: u.label, className: m.className });
    guardianships.push({
      id: uuidFor(`gs:${m.person.key}:ext`),
      dependentId: u.id,
      dependentLabel: u.label,
      guardianId: null,
      guardianLabel: `${m.guardianName} (externo, ${m.guardianRel})`,
      externalName: m.guardianName,
      externalPhone: '5512345678',
      relationship: m.guardianRel,
      isPrimary: true,
      custody: false,
      status: 'verified',
      verifiedAt: daysAgo(58),
      verificationMethod: 'director_paper_form',
      createdAt: daysAgo(60),
    });
  }
  for (const s of STAFF) {
    const u = addUser(s.person);
    assignments.push({
      id: uuidFor(`assign:${s.person.key}:${s.role}`),
      userId: u.id,
      userLabel: u.label,
      role: s.role,
      status: 'active',
      createdAt: daysAgo(90),
      expiresAt: null,
      note: `Staff: ${s.role}`,
    });
    // Service roles in AV are only valid for a GM-eligible person: member of
    // the club's GM section + an active GM-01 enrollment.
    assignments.push({
      id: uuidFor(`assign:${s.person.key}:member:gm`),
      userId: u.id,
      userLabel: u.label,
      role: 'member',
      status: 'active',
      createdAt: daysAgo(90),
      expiresAt: null,
      note: 'Miembro de Guías Mayores (staff elegible a GM)',
      section: 'gm',
    });
    enrollments.push({
      userId: u.id,
      userLabel: u.label,
      className: GM_CLASS_ASSET_CODE,
      gm: true,
    });
  }

  const pendingAssignment = (
    u: PlanUser,
    createdAt: Date,
    expiresAt: Date,
    note: string,
  ) =>
    assignments.push({
      id: uuidFor(`assign:${u.spec.key}:member:pending`),
      userId: u.id,
      userLabel: u.label,
      role: 'member',
      status: 'pending',
      createdAt,
      expiresAt,
      note,
    });

  // B1) adult with own account
  {
    const u = addUser(ADULT_APPLICANT);
    const created = daysAgo(3);
    pendingAssignment(u, created, addDays(created, BASE_TIMEOUT_DAYS), 'Solicitud pendiente');
    stateLabels.push({
      state: '1',
      who: u.label,
      expect: 'consent=null (adulto) -> «Listas para aprobar»',
    });
  }

  // B2) minor, consent VERIFIED
  {
    const child = addUser(KID2);
    const g = addUser(GUARD2);
    const created = daysAgo(6);
    const verifiedAt = daysAgo(2);
    pendingAssignment(child, created, addDays(verifiedAt, BASE_TIMEOUT_DAYS), 'Solicitud pendiente, consentimiento verificado');
    const gsId = uuidFor('gs:req2-diego:patricia');
    guardianships.push({
      id: gsId,
      dependentId: child.id,
      dependentLabel: child.label,
      guardianId: g.id,
      guardianLabel: g.label,
      externalName: null,
      externalPhone: null,
      relationship: 'Madre',
      isPrimary: true,
      custody: false,
      status: 'verified',
      verifiedAt,
      verificationMethod: 'director_paper_form',
      createdAt: created,
    });
    evidences.push({
      guardianshipId: gsId,
      childLabel: child.label,
      guardianLabel: g.label,
      uploadedByKey: g.id,
      uploadedByLabel: g.label,
      uploadedAt: daysAgo(5),
    });
    stateLabels.push({
      state: '2',
      who: child.label,
      expect: 'consent.status=verified, guardian_linked=true -> «Listas para aprobar»',
    });
  }

  // B3) minor, pending, form uploaded by the guardian
  {
    const child = addUser(KID3);
    const g = addUser(GUARD3);
    const created = daysAgo(5);
    pendingAssignment(child, created, addDays(created, CONSENT_PENDING_TIMEOUT_DAYS), 'Solicitud pendiente, ficha subida por el tutor');
    const gsId = uuidFor('gs:req3-ximena:fernando');
    guardianships.push({
      id: gsId,
      dependentId: child.id,
      dependentLabel: child.label,
      guardianId: g.id,
      guardianLabel: g.label,
      externalName: null,
      externalPhone: null,
      relationship: 'Padre',
      isPrimary: true,
      custody: false,
      status: 'pending',
      verifiedAt: null,
      verificationMethod: null,
      createdAt: created,
    });
    evidences.push({
      guardianshipId: gsId,
      childLabel: child.label,
      guardianLabel: g.label,
      uploadedByKey: g.id,
      uploadedByLabel: g.label,
      uploadedAt: daysAgo(2),
    });
    stateLabels.push({
      state: '3',
      who: child.label,
      expect:
        'consent pending, evidence_uploaded=true, viewer_can_verify=true -> «Revisa la ficha del tutor»',
    });
  }

  // B4) minor under CLUB CUSTODY, form uploaded by the director
  {
    const child = addUser(KID4);
    const created = daysAgo(4);
    pendingAssignment(child, created, addDays(created, CONSENT_PENDING_TIMEOUT_DAYS), 'Solicitud pendiente, custodia del club');
    const gsId = uuidFor('gs:req4-tadeo:custody');
    guardianships.push({
      id: gsId,
      dependentId: child.id,
      dependentLabel: child.label,
      guardianId: null,
      guardianLabel: 'Club (custodia)',
      externalName: null,
      externalPhone: null,
      relationship: null,
      isPrimary: true,
      custody: true,
      status: 'pending',
      verifiedAt: null,
      verificationMethod: null,
      createdAt: created,
    });
    evidences.push({
      guardianshipId: gsId,
      childLabel: child.label,
      guardianLabel: 'Tutor legal (ficha recogida por el director)',
      uploadedByKey: 'director',
      uploadedByLabel: `${DIRECTOR_EMAIL} (director)`,
      uploadedAt: daysAgo(1),
    });
    stateLabels.push({
      state: '4',
      who: child.label,
      expect:
        'custodia: guardian_linked=false, evidence_uploaded=true, viewer_can_verify=false, viewer_verify_block=self_custodian (uploader y creador del perfil = director) -> «Entregar a la familia»',
    });
  }

  // B5) minor, pending, no form, two guardians
  {
    const child = addUser(KID5);
    const mother = addUser(GUARD5_MOTHER);
    const father = addUser(GUARD5_FATHER);
    const created = daysAgo(9);
    pendingAssignment(child, created, addDays(created, CONSENT_PENDING_TIMEOUT_DAYS), 'Solicitud pendiente, sin ficha, dos tutores');
    guardianships.push({
      id: uuidFor('gs:req5-renata:claudia'),
      dependentId: child.id,
      dependentLabel: child.label,
      guardianId: mother.id,
      guardianLabel: mother.label,
      externalName: null,
      externalPhone: null,
      relationship: 'Madre',
      isPrimary: true,
      custody: false,
      status: 'pending',
      verifiedAt: null,
      verificationMethod: null,
      createdAt: created,
    });
    guardianships.push({
      id: uuidFor('gs:req5-renata:hector'),
      dependentId: child.id,
      dependentLabel: child.label,
      guardianId: father.id,
      guardianLabel: father.label,
      externalName: null,
      externalPhone: null,
      relationship: 'Padre',
      isPrimary: false,
      custody: false,
      status: 'pending',
      verifiedAt: null,
      verificationMethod: null,
      createdAt: addDays(created, 1),
    });
    stateLabels.push({
      state: '5',
      who: child.label,
      expect:
        'consent pending, evidence_uploaded=false, 2 guardians (Madre primaria, Padre) -> «Esperando al tutor»',
    });
  }

  // B6) minor, pending, no form, one guardian, 20 days ago
  {
    const child = addUser(KID6);
    const g = addUser(GUARD6);
    const created = daysAgo(20);
    pendingAssignment(child, created, addDays(created, CONSENT_PENDING_TIMEOUT_DAYS), 'Solicitud pendiente hace 20 dias, sin ficha');
    guardianships.push({
      id: uuidFor('gs:req6-bruno:gabriela'),
      dependentId: child.id,
      dependentLabel: child.label,
      guardianId: g.id,
      guardianLabel: g.label,
      externalName: null,
      externalPhone: null,
      relationship: 'Madre',
      isPrimary: true,
      custody: false,
      status: 'pending',
      verifiedAt: null,
      verificationMethod: null,
      createdAt: created,
    });
    stateLabels.push({
      state: '6',
      who: child.label,
      expect:
        'consent pending, sin ficha, 1 tutor, solicitud de hace 20 dias (vence en 10) -> «Esperando al tutor»',
    });
  }

  void directorId;
  return { users, dependents, assignments, enrollments, guardianships, evidences, stateLabels };
}

function allDemoUserIds(): string[] {
  const specs: PersonSpec[] = [
    ...MEMBER_KIDS.map((m) => m.person),
    ...STAFF.map((s) => s.person),
    ADULT_APPLICANT,
    KID2,
    GUARD2,
    KID3,
    GUARD3,
    KID4,
    KID5,
    GUARD5_MOTHER,
    GUARD5_FATHER,
    KID6,
    GUARD6,
  ];
  return specs.map((s) => uuidFor(`user:${s.key}`));
}

// ---------------------------------------------------------------------------
// Consent form PDF
// ---------------------------------------------------------------------------

function buildConsentPdf(input: {
  child: string;
  guardian: string;
  club: string;
}): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require('pdfkit') as typeof import('pdfkit');
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(20).text('Ficha de consentimiento — DEMO', {
      align: 'center',
    });
    doc.moveDown(1.5);
    doc.font('Helvetica').fontSize(12);
    doc.text(`Club: ${input.club}`);
    doc.moveDown(0.5);
    doc.text(`Menor: ${input.child}`);
    doc.moveDown(0.5);
    doc.text(`Tutor: ${input.guardian}`);
    doc.moveDown(1.5);
    doc.text(
      'Autorizo la participación del menor en las actividades del club de Aventureros durante el año eclesiástico vigente.',
      { align: 'justify' },
    );
    doc.moveDown(4);
    doc.text('Firma del tutor: ______________________________');
    doc.moveDown(2);
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666666');
    doc.text('Documento generado automáticamente con datos de demostración. No tiene validez.');
    doc.end();
  });
}

// ---------------------------------------------------------------------------
// DB access
// ---------------------------------------------------------------------------

async function createPrisma(databaseUrl: string) {
  const [{ PrismaClient }, { PrismaPg }, pg] = await Promise.all([
    import('@prisma/client'),
    import('@prisma/adapter-pg'),
    import('pg'),
  ]);
  const pool = new pg.default.Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    prisma,
    close: async () => {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}

type Prisma_ = Awaited<ReturnType<typeof createPrisma>>['prisma'];

function assertDevDatabase(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error('Missing required env var: DATABASE_URL');
  if (databaseUrl.includes(PROD_ENDPOINT_ID)) {
    throw new Error('DATABASE_URL points to PRODUCTION. Refusing to run.');
  }
  if (!databaseUrl.includes(DEV_ENDPOINT_ID)) {
    throw new Error(
      `DATABASE_URL does not contain the Neon development endpoint (${DEV_ENDPOINT_ID}). Refusing to run.`,
    );
  }
  let host = '(unparseable)';
  try {
    host = new URL(databaseUrl).host; // host only, never credentials
  } catch {
    /* keep placeholder */
  }
  return host;
}

interface Context {
  directorId: string;
  directorCountryId: number | null;
  directorUnionId: number | null;
  directorLocalFieldId: number | null;
  clubId: number;
  clubName: string;
  sectionId: number;
  clubTypeId: number;
  /** Active Guías Mayores section of the same club (null when it has none). */
  gmSectionId: number | null;
  /** The GM-01 class of the catalog (null when missing). */
  gmClass: { class_id: number; name: string } | null;
  year: { year_id: number; start_date: Date };
  roleIds: Map<string, string>;
  slotFree: Map<string, { max: number | null; others: number }>;
  classes: Map<string, { class_id: number; name: string; minimum_age: number }>;
  relationshipIds: Map<string, string>;
}

async function resolveContext(prisma: Prisma_): Promise<Context> {
  const director = await prisma.users.findUnique({
    where: { email: DIRECTOR_EMAIL },
    select: {
      user_id: true,
      country_id: true,
      union_id: true,
      local_field_id: true,
      users_pr: { select: { active_club_assignment_id: true } },
    },
  });
  if (!director) throw new Error(`Director ${DIRECTOR_EMAIL} not found.`);

  const today = new Date();
  const year =
    (await prisma.ecclesiastical_years.findFirst({
      where: { start_date: { lte: today }, end_date: { gte: today } },
      orderBy: { start_date: 'desc' },
      select: { year_id: true, start_date: true },
    })) ??
    (await prisma.ecclesiastical_years.findFirst({
      where: { active: true },
      orderBy: { start_date: 'desc' },
      select: { year_id: true, start_date: true },
    }));
  if (!year) throw new Error('No current ecclesiastical year found.');

  const assignments = await prisma.club_role_assignments.findMany({
    where: {
      user_id: director.user_id,
      active: true,
      status: 'active',
      ecclesiastical_year_id: year.year_id,
      roles: { role_name: 'director', role_category: 'CLUB' },
    },
    select: {
      assignment_id: true,
      club_section_id: true,
      club_sections: {
        select: {
          club_section_id: true,
          club_type_id: true,
          main_club_id: true,
          club_types: { select: { name: true } },
          clubs: { select: { club_id: true, name: true } },
        },
      },
    },
  });
  if (assignments.length === 0) {
    throw new Error('The director has no active director assignment this year.');
  }
  const preferred = director.users_pr?.active_club_assignment_id;
  const chosen =
    assignments.find((a) => a.assignment_id === preferred) ??
    assignments.find((a) => a.club_sections?.club_types.name === CLUB_TYPE_NAME);
  const section = chosen?.club_sections;
  if (!chosen || !section || !section.clubs) {
    throw new Error('Could not resolve the director section.');
  }
  if (section.club_types.name !== CLUB_TYPE_NAME) {
    throw new Error(
      `Active section is "${section.club_types.name}", expected "${CLUB_TYPE_NAME}". Refusing to run.`,
    );
  }

  const roleNames = ['member', 'deputy-director', 'secretary', 'treasurer', 'counselor'];
  const roles = await prisma.roles.findMany({
    where: { role_name: { in: roleNames }, role_category: 'CLUB', active: true },
    select: { role_id: true, role_name: true, role_slot_limits: { select: { max_per_section: true } } },
  });
  const roleIds = new Map(roles.map((r) => [r.role_name, r.role_id]));
  const slotFree = new Map<string, { max: number | null; others: number }>();
  for (const r of roles) {
    const others = await prisma.club_role_assignments.count({
      where: {
        club_section_id: section.club_section_id,
        ecclesiastical_year_id: year.year_id,
        role_id: r.role_id,
        active: true,
        status: { in: ['active', 'designated'] },
        user_id: { notIn: allDemoUserIds() },
      },
    });
    slotFree.set(r.role_name, {
      max: r.role_slot_limits?.max_per_section ?? null,
      others,
    });
  }

  const classRows = await prisma.classes.findMany({
    where: { club_type_id: section.club_type_id, active: true },
    select: { class_id: true, name: true, minimum_age: true },
  });
  const classes = new Map(classRows.map((c) => [fold(c.name), c]));

  const gmSection = await prisma.club_sections.findFirst({
    where: {
      main_club_id: section.clubs.club_id,
      active: true,
      club_types: { name: GM_CLUB_TYPE_NAME },
    },
    select: { club_section_id: true },
  });
  const gmClass = await prisma.classes.findUnique({
    where: { asset_code: GM_CLASS_ASSET_CODE },
    select: { class_id: true, name: true },
  });

  const rels = await prisma.relationship_types.findMany({
    where: { name: { in: ['Madre', 'Padre'] } },
    select: { relationship_type_id: true, name: true },
  });

  return {
    directorId: director.user_id,
    directorCountryId: director.country_id,
    directorUnionId: director.union_id,
    directorLocalFieldId: director.local_field_id,
    clubId: section.clubs.club_id,
    clubName: section.clubs.name,
    sectionId: section.club_section_id,
    clubTypeId: section.club_type_id,
    gmSectionId: gmSection?.club_section_id ?? null,
    gmClass,
    year,
    roleIds,
    slotFree,
    classes,
    relationshipIds: new Map(rels.map((r) => [r.name, r.relationship_type_id])),
  };
}

// ---------------------------------------------------------------------------
// Blank-name requests (C)
// ---------------------------------------------------------------------------

interface BlankFix {
  userId: string;
  assignmentId: string;
  dependent: boolean;
  original: {
    name: string | null;
    paternal_last_name: string | null;
    maternal_last_name: string | null;
    user_image: string | null;
  };
  next: { name: string; pat: string; mat: string; photo: string | null };
}

async function planBlankNames(prisma: Prisma_, ctx: Context): Promise<BlankFix[]> {
  const rows = await prisma.club_role_assignments.findMany({
    where: {
      club_section_id: ctx.sectionId,
      status: 'pending',
      active: true,
      user_id: { notIn: allDemoUserIds() },
    },
    orderBy: { created_at: 'asc' },
    select: {
      assignment_id: true,
      users: {
        select: {
          user_id: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
          user_image: true,
          dependent_profile: {
            select: { user_id: true, frozen_at: true, purged_at: true },
          },
        },
      },
    },
  });
  const fixes: BlankFix[] = [];
  let kidIdx = 0;
  let adultIdx = 0;
  for (const row of rows) {
    const u = row.users;
    if (!u) continue;
    // Frozen or purged dependents stay as they are: a purged record must keep
    // its wiped data (names and photo are gone on purpose).
    if (u.dependent_profile?.frozen_at || u.dependent_profile?.purged_at) {
      continue;
    }
    if (!isBlank(u.name) || !isBlank(u.paternal_last_name) || !isBlank(u.maternal_last_name)) {
      continue;
    }
    const dependent = Boolean(u.dependent_profile);
    const pool = dependent ? BLANK_FIX_KIDS : BLANK_FIX_ADULTS;
    const idx = dependent ? kidIdx++ : adultIdx++;
    const [name, pat, mat] = pool[idx % pool.length];
    const n = (idx * 7 + 11) % (dependent ? 10 : 90);
    const photo = isBlank(u.user_image)
      ? dependent
        ? kidPhoto(n)
        : idx % 2 === 0
          ? womanPhoto(n + 3)
          : manPhoto(n + 3)
      : null;
    fixes.push({
      userId: u.user_id,
      assignmentId: row.assignment_id,
      dependent,
      original: {
        name: u.name,
        paternal_last_name: u.paternal_last_name,
        maternal_last_name: u.maternal_last_name,
        user_image: u.user_image,
      },
      next: { name, pat, mat, photo },
    });
  }
  return fixes;
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

function evidenceConfigMissing(): string[] {
  return EVIDENCE_ENVS.filter((k) => !process.env[k]?.trim());
}

async function runDemo(prisma: Prisma_, apply: boolean): Promise<void> {
  const ctx = await resolveContext(prisma);
  console.log(`Club: ${ctx.clubName} (club_id=${ctx.clubId})`);
  console.log(
    `Section: ${CLUB_TYPE_NAME} club_section_id=${ctx.sectionId}, club_type_id=${ctx.clubTypeId}`,
  );
  console.log(
    `GM section: ${GM_CLUB_TYPE_NAME} club_section_id=${ctx.gmSectionId ?? 'NOT FOUND'}; GM class ${GM_CLASS_ASSET_CODE} class_id=${ctx.gmClass?.class_id ?? 'NOT FOUND'}`,
  );
  console.log(`Ecclesiastical year id: ${ctx.year.year_id}`);
  console.log(`Director: ${DIRECTOR_EMAIL} (${ctx.directorId})`);
  console.log(`Mode: ${apply ? 'APPLY (writes)' : 'DRY-RUN (writes nothing)'}`);

  const plan = buildPlan(ctx.directorId, ctx.year.start_date);
  const blocking: string[] = [];

  const memberRoleId = ctx.roleIds.get('member');
  if (!memberRoleId) blocking.push('CLUB role "member" not found.');
  if (ctx.gmSectionId == null) {
    blocking.push(`No active "${GM_CLUB_TYPE_NAME}" section in club ${ctx.clubId}: the GM staff rows need it.`);
  }
  if (!ctx.gmClass) {
    blocking.push(`Class with asset_code ${GM_CLASS_ASSET_CODE} not found in the catalog.`);
  }

  // Existing rows, for CREATE / EXISTS labels.
  const userIds = plan.users.map((u) => u.id);
  const [existingUsers, existingAssignments, existingGs, existingEvidence, existingEnrollments] =
    await Promise.all([
      prisma.users.findMany({ where: { user_id: { in: userIds } }, select: { user_id: true } }),
      prisma.club_role_assignments.findMany({
        where: { assignment_id: { in: plan.assignments.map((a) => a.id) } },
        select: { assignment_id: true },
      }),
      prisma.guardianships.findMany({
        where: { guardianship_id: { in: plan.guardianships.map((g) => g.id) } },
        select: { guardianship_id: true },
      }),
      prisma.guardianship_consent_evidences.findMany({
        where: {
          guardianship_id: { in: plan.evidences.map((e) => e.guardianshipId) },
          superseded_at: null,
          purged_at: null,
        },
        select: { guardianship_id: true },
      }),
      prisma.enrollments.findMany({
        where: { user_id: { in: userIds }, ecclesiastical_year_id: ctx.year.year_id },
        select: { user_id: true, classes: { select: { name: true } } },
      }),
    ]);
  const hasUser = new Set(existingUsers.map((u) => u.user_id));
  const hasAssign = new Set(existingAssignments.map((a) => a.assignment_id));
  const hasGs = new Set(existingGs.map((g) => g.guardianship_id));
  const hasEvidence = new Set(existingEvidence.map((e) => e.guardianship_id));
  const hasEnrollment = new Set(existingEnrollments.map((e) => e.user_id));
  const gmEnrollmentUserIds = plan.enrollments.filter((e) => e.gm).map((e) => e.userId);
  const hasGmEnrollment = new Set(
    ctx.gmClass
      ? (
          await prisma.enrollments.findMany({
            where: {
              user_id: { in: gmEnrollmentUserIds },
              class_id: ctx.gmClass.class_id,
              ecclesiastical_year_id: ctx.year.year_id,
            },
            select: { user_id: true },
          })
        ).map((e) => e.user_id)
      : [],
  );
  const tag = (exists: boolean) => (exists ? 'UPDATE/EXISTS' : 'CREATE');

  // Staff slot checks.
  const staffSkipped = new Set<string>();
  for (const s of STAFF) {
    const info = ctx.slotFree.get(s.role);
    if (!ctx.roleIds.has(s.role)) {
      staffSkipped.add(s.role);
      blocking.push(`role "${s.role}" not found in the catalog: staff skipped.`);
    } else if (info && info.max !== null && info.others >= info.max) {
      staffSkipped.add(s.role);
    }
  }

  // Classes.
  const classOf = new Map<string, { class_id: number; name: string; minimum_age: number }>();
  const classMissing: string[] = [];
  for (const m of MEMBER_KIDS) {
    const c = ctx.classes.get(fold(m.className));
    if (c) classOf.set(m.className, c);
    else classMissing.push(m.className);
  }

  const evidenceMissing = evidenceConfigMissing();
  const blank = await planBlankNames(prisma, ctx);

  // ---- Print the plan ----------------------------------------------------
  console.log('\n=== A) ENROLLED MEMBERS (role member, status active) ===');
  for (const m of MEMBER_KIDS) {
    const u = plan.users.find((x) => x.spec.key === m.person.key)!;
    const cls = classOf.get(m.className);
    console.log(
      `  [${tag(hasUser.has(u.id))}] ${u.label} | niño/a nacido ${u.birthday.toISOString().slice(0, 10)} | clase ${m.className}${
        cls ? ` (class_id=${cls.class_id}, minimum_age=${cls.minimum_age})` : ' !! NOT IN CATALOG'
      } | foto ${u.spec.photo ? u.spec.photo.split('/portraits/')[1] : 'NINGUNA (iniciales)'} | tutor externo verificado: ${m.guardianName} (${m.guardianRel})`,
    );
  }
  console.log('\n  Staff adultos:');
  for (const s of STAFF) {
    const u = plan.users.find((x) => x.spec.key === s.person.key)!;
    const info = ctx.slotFree.get(s.role);
    const skip = staffSkipped.has(s.role);
    console.log(
      `  [${skip ? 'SKIP' : tag(hasUser.has(u.id))}] ${u.label} <${u.email}> | rol ${s.role} (sección ${ctx.sectionId}) | slots: ${info?.others ?? '?'}/${info?.max ?? 'sin límite'} ocupados por otros${skip ? ' -> SIN CUPO / SIN ROL' : ''} | foto ${s.person.photo?.split('/portraits/')[1]}`,
    );
    const gmAssignId = uuidFor(`assign:${s.person.key}:member:gm`);
    console.log(
      `      [${tag(hasAssign.has(gmAssignId))}] + member active en Guías Mayores (club_section_id=${ctx.gmSectionId ?? '??'}) | [${tag(hasGmEnrollment.has(u.id))}] + inscripción ${GM_CLASS_ASSET_CODE} (class_id=${ctx.gmClass?.class_id ?? '??'}) IN_PROGRESS active año ${ctx.year.year_id}`,
    );
  }
  console.log(
    '\n  NOTA: «No inscrito» NO se puede producir: GET members solo devuelve asignaciones active=true y calcula is_enrolled = member.active (siempre true). Ver reporte.',
  );

  console.log('\n=== B) PENDING JOIN REQUESTS (status pending) ===');
  for (const st of plan.stateLabels) {
    console.log(`  Estado ${st.state}: ${st.who}\n     esperado: ${st.expect}`);
  }
  console.log('\n  Detalle de filas:');
  for (const a of plan.assignments.filter((x) => x.status === 'pending')) {
    console.log(
      `  [${tag(hasAssign.has(a.id))}] club_role_assignments ${a.userLabel} role=member status=pending created_at=${a.createdAt.toISOString()} expires_at=${a.expiresAt?.toISOString()} (${a.note})`,
    );
  }
  for (const g of plan.guardianships) {
    if (g.externalName) continue; // members' external guardians are listed in A
    console.log(
      `  [${tag(hasGs.has(g.id))}] guardianships ${g.dependentLabel} <- ${g.guardianLabel} | primary=${g.isPrimary} custodian=${g.custody} status=${g.status}${g.relationship ? ` rel=${g.relationship}` : ''}${g.verifiedAt ? ` verified_at=${g.verifiedAt.toISOString()} by director` : ''} is_test_data=false`,
    );
  }
  for (const e of plan.evidences) {
    console.log(
      `  [${hasEvidence.has(e.guardianshipId) ? 'EXISTS (no re-upload)' : 'CREATE'}] consent evidence (PDF) ${e.childLabel} | tutor "${e.guardianLabel}" | subida por ${e.uploadedByLabel} | uploaded_at=${e.uploadedAt.toISOString()}`,
    );
  }
  console.log(
    `  Guardian users adultos: ${plan.users
      .filter((u) => /^req\d-(patricia|fernando|claudia|hector|gabriela)$/.test(u.spec.key))
      .map((u) => `${u.label} <${u.email}>`)
      .join('; ')}`,
  );
  console.log(
    `  Dependientes (dependent_profiles, created_by=${DIRECTOR_EMAIL}): ${plan.dependents.length}`,
  );
  console.log(`  Enrollments (clases) a crear/actualizar: ${plan.enrollments.length} (${[...hasEnrollment].length} ya existen este año)`);

  console.log('\n=== C) EXISTING PENDING REQUESTS WITH EMPTY NAMES ===');
  if (blank.length === 0) {
    console.log('  (ninguna con nombre vacío)');
  }
  for (const b of blank) {
    console.log(
      `  assignment ${b.assignmentId} user ${b.userId} ${b.dependent ? '(dependiente)' : '(adulto)'} era: name=${JSON.stringify(b.original.name)} paterno=${JSON.stringify(b.original.paternal_last_name)} materno=${JSON.stringify(b.original.maternal_last_name)} foto=${JSON.stringify(b.original.user_image)} -> ${b.next.name} ${b.next.pat} ${b.next.mat}${b.next.photo ? ` | foto ${b.next.photo.split('/portraits/')[1]}` : ''}`,
    );
  }

  console.log('\n=== CHECKS ===');
  if (classMissing.length) blocking.push(`Classes not found for this club type: ${classMissing.join(', ')}`);
  if (ctx.relationshipIds.size < 2) {
    console.log('  AVISO: relationship_types Madre/Padre incompletos; relationship_type_id quedará NULL en lo que falte.');
  }
  if (evidenceMissing.length) {
    console.log(
      `  !! Config de evidencia R2 FALTANTE: ${evidenceMissing.join(', ')}. --apply NO podrá subir las fichas (estados 2, 3, 4) y abortará antes de escribir.`,
    );
    blocking.push(`Missing R2 env for consent evidence: ${evidenceMissing.join(', ')}`);
  } else {
    console.log(`  Config de evidencia R2 presente (bucket ${'R2_BUCKET_GUARDIANSHIP_EVIDENCE'}).`);
  }
  for (const b of blocking) console.log(`  BLOQUEANTE: ${b}`);

  if (!apply) {
    console.log('\nDry-run terminado. Nada se escribió. Añade --apply para escribir.');
    return;
  }
  if (blocking.length) {
    throw new Error(`Refusing to apply, blocking issues:\n- ${blocking.join('\n- ')}`);
  }

  // ---- APPLY -------------------------------------------------------------
  const ids = {
    member: memberRoleId as string,
  };
  const commonUser = {
    active: true,
    email_verified: true,
    approval_status: 'approved' as const,
    country_id: ctx.directorCountryId,
    union_id: ctx.directorUnionId,
    local_field_id: ctx.directorLocalFieldId,
  };

  await prisma.$transaction(
    async (tx) => {
      for (const u of plan.users) {
        const data = {
          name: u.spec.name,
          paternal_last_name: u.spec.pat,
          maternal_last_name: u.spec.mat,
          gender: u.spec.gender,
          birthday: u.birthday,
          user_image: u.spec.photo,
          ...commonUser,
          access_app: !u.spec.dependent,
          access_panel: false,
        };
        await tx.users.upsert({
          where: { user_id: u.id },
          create: { user_id: u.id, email: u.email, ...data },
          update: data,
        });
      }
      for (const d of plan.dependents) {
        await tx.dependent_profiles.upsert({
          where: { user_id: d.userId },
          create: { user_id: d.userId, created_by_user_id: ctx.directorId },
          update: {},
        });
      }
      for (const a of plan.assignments) {
        if (a.role !== 'member' && staffSkipped.has(a.role)) continue;
        const roleId = a.role === 'member' ? ids.member : (ctx.roleIds.get(a.role) as string);
        await tx.club_role_assignments.upsert({
          where: { assignment_id: a.id },
          create: {
            assignment_id: a.id,
            user_id: a.userId,
            role_id: roleId,
            club_section_id: a.section === 'gm' ? (ctx.gmSectionId as number) : ctx.sectionId,
            ecclesiastical_year_id: ctx.year.year_id,
            start_date: ctx.year.start_date,
            active: true,
            status: a.status,
            expires_at: a.expiresAt,
            created_at: a.createdAt,
          },
          update: { status: a.status, active: true, expires_at: a.expiresAt },
        });
      }
      for (const e of plan.enrollments) {
        const cls = (e.gm ? ctx.gmClass : classOf.get(e.className)) as { class_id: number };
        const existing = await tx.enrollments.findFirst({
          where: {
            user_id: e.userId,
            ecclesiastical_year_id: ctx.year.year_id,
            class_id: cls.class_id,
          },
          select: { enrollment_id: true },
        });
        if (existing) continue;
        await tx.enrollments.create({
          data: {
            user_id: e.userId,
            class_id: cls.class_id,
            ecclesiastical_year_id: ctx.year.year_id,
            investiture_status: 'IN_PROGRESS',
            active: true,
            record_kind: 'OPERATIONAL',
          },
        });
      }
      for (const g of plan.guardianships) {
        const relId = g.relationship ? (ctx.relationshipIds.get(g.relationship) ?? null) : null;
        const data = {
          dependent_user_id: g.dependentId,
          guardian_user_id: g.guardianId,
          is_custodian: g.custody,
          custodian_club_id: g.custody ? ctx.clubId : null,
          relationship_type_id: relId,
          is_primary: g.isPrimary,
          consent_status: g.status,
          verification_method: g.verificationMethod,
          verified_at: g.verifiedAt,
          verified_by_user_id: g.status === 'verified' ? ctx.directorId : null,
          external_name: g.externalName,
          external_phone: g.externalPhone,
          is_test_data: false,
        };
        await tx.guardianships.upsert({
          where: { guardianship_id: g.id },
          create: { guardianship_id: g.id, created_at: g.createdAt, ...data },
          update: data,
        });
      }
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
  console.log('\nFilas base escritas (usuarios, dependientes, asignaciones, clases, tutorias).');

  // Consent forms: upload first, then insert the row (same order as the service).
  const storage = new R2FileStorageService(new ConfigService());
  for (const e of plan.evidences) {
    if (hasEvidence.has(e.guardianshipId)) {
      console.log(`  ficha ya existe para ${e.childLabel}, se omite`);
      continue;
    }
    const pdf = await buildConsentPdf({
      child: e.childLabel,
      guardian: e.guardianLabel,
      club: `${ctx.clubName} · ${CLUB_TYPE_NAME}`,
    });
    const uploaded = await storage.upload(
      StorageBucketAlias.GUARDIANSHIP_EVIDENCE,
      `${e.guardianshipId}/${randomUUID()}.pdf`,
      pdf,
      { contentType: 'application/pdf', overwrite: false },
    );
    await prisma.guardianship_consent_evidences.create({
      data: {
        guardianship_id: e.guardianshipId,
        file_key: uploaded.key,
        content_type: 'application/pdf',
        size_bytes: pdf.length,
        uploaded_by_user_id: e.uploadedByKey === 'director' ? ctx.directorId : e.uploadedByKey,
        uploaded_at: e.uploadedAt,
      },
    });
    console.log(`  ficha subida: ${e.childLabel} (${pdf.length} bytes) key=${uploaded.key}`);
  }

  // C) blank names
  if (blank.length > 0) {
    const backup: BlankFix[] = existsSync(RENAMES_FILE)
      ? (JSON.parse(readFileSync(RENAMES_FILE, 'utf8')) as BlankFix[])
      : [];
    for (const b of blank) {
      if (!backup.some((x) => x.userId === b.userId)) backup.push(b);
    }
    writeFileSync(RENAMES_FILE, JSON.stringify(backup, null, 2));
    for (const b of blank) {
      await prisma.users.updateMany({
        where: {
          user_id: b.userId,
          AND: [
            { OR: [{ name: null }, { name: '' }] },
            { OR: [{ paternal_last_name: null }, { paternal_last_name: '' }] },
            { OR: [{ maternal_last_name: null }, { maternal_last_name: '' }] },
          ],
        },
        data: {
          name: b.next.name,
          paternal_last_name: b.next.pat,
          maternal_last_name: b.next.mat,
          ...(b.next.photo ? { user_image: b.next.photo } : {}),
        },
      });
    }
    console.log(`  nombres arreglados: ${blank.length} (respaldo en ${RENAMES_FILE})`);
  }
  console.log('\nApply terminado.');
}

// ---------------------------------------------------------------------------
// Cleanup mode
// ---------------------------------------------------------------------------

async function runCleanup(prisma: Prisma_, apply: boolean): Promise<void> {
  console.log(`Mode: cleanup ${apply ? 'APPLY (deletes)' : 'DRY-RUN (deletes nothing)'}`);
  const ids = allDemoUserIds();
  const guardianships = await prisma.guardianships.findMany({
    where: {
      OR: [{ dependent_user_id: { in: ids } }, { guardian_user_id: { in: ids } }],
    },
    select: { guardianship_id: true },
  });
  const gsIds = guardianships.map((g) => g.guardianship_id);
  const evidences = await prisma.guardianship_consent_evidences.findMany({
    where: { guardianship_id: { in: gsIds } },
    select: { evidence_id: true, file_key: true },
  });
  const [users, deps, assigns, enrolls] = await Promise.all([
    prisma.users.count({ where: { user_id: { in: ids } } }),
    prisma.dependent_profiles.count({ where: { user_id: { in: ids } } }),
    prisma.club_role_assignments.count({ where: { user_id: { in: ids } } }),
    prisma.enrollments.count({ where: { user_id: { in: ids } } }),
  ]);
  const renames: BlankFix[] = existsSync(RENAMES_FILE)
    ? (JSON.parse(readFileSync(RENAMES_FILE, 'utf8')) as BlankFix[])
    : [];

  console.log(`  consent evidences (rows + R2 objects): ${evidences.length}`);
  for (const e of evidences) console.log(`     ${e.file_key}`);
  console.log(`  guardianships: ${gsIds.length}`);
  console.log(`  enrollments (incl. GM-01 of the staff): ${enrolls}`);
  console.log(`  club_role_assignments (incl. staff roles and GM member rows): ${assigns}`);
  console.log(`  dependent_profiles: ${deps}`);
  console.log(`  users: ${users}`);
  console.log(
    `  blank-name renames to revert: ${renames.length}${existsSync(RENAMES_FILE) ? ` (from ${RENAMES_FILE})` : ' (no backup file: nothing to revert)'}`,
  );
  if (!apply) {
    console.log('\nDry-run terminado. Nada se borró. Añade --apply para borrar.');
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.guardianship_consent_evidences.deleteMany({ where: { guardianship_id: { in: gsIds } } });
      await tx.guardianships.deleteMany({ where: { guardianship_id: { in: gsIds } } });
      await tx.enrollments.deleteMany({ where: { user_id: { in: ids } } });
      await tx.club_role_assignments.deleteMany({ where: { user_id: { in: ids } } });
      await tx.dependent_profiles.deleteMany({ where: { user_id: { in: ids } } });
      await tx.users_pr.deleteMany({ where: { user_id: { in: ids } } });
      await tx.users.deleteMany({ where: { user_id: { in: ids } } });
      for (const r of renames) {
        await tx.users.updateMany({
          where: { user_id: r.userId },
          data: {
            name: r.original.name,
            paternal_last_name: r.original.paternal_last_name,
            maternal_last_name: r.original.maternal_last_name,
            ...(r.next.photo ? { user_image: r.original.user_image } : {}),
          },
        });
      }
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
  console.log('Filas borradas.');

  if (evidences.length > 0) {
    const missing = evidenceConfigMissing();
    if (missing.length) {
      console.log(`AVISO: faltan ${missing.join(', ')}; los objetos R2 NO se borraron: ${evidences.map((e) => e.file_key).join(', ')}`);
    } else {
      const storage = new R2FileStorageService(new ConfigService());
      await storage.deleteMany(
        StorageBucketAlias.GUARDIANSHIP_EVIDENCE,
        evidences.map((e) => e.file_key),
      );
      console.log(`Objetos R2 borrados: ${evidences.length}`);
    }
  }
  if (renames.length > 0) {
    writeFileSync(RENAMES_FILE, '[]');
    console.log('Nombres en blanco restaurados.');
  }
}

// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`seed-members-demo (DEV-ONLY)

Nothing to do. Pick a mode:
  npx tsx scripts/demo/seed-members-demo.ts --demo             dry-run: plan the demo data
  npx tsx scripts/demo/seed-members-demo.ts --demo --apply     write it
  npx tsx scripts/demo/seed-members-demo.ts --cleanup          dry-run: what would be removed
  npx tsx scripts/demo/seed-members-demo.ts --cleanup --apply  remove it
`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-members-demo is dev-only; refusing to run (NODE_ENV=production).');
  }
  const options = parseDemoArgs(process.argv.slice(2));
  if (!options.demo && !options.cleanup) {
    printUsage();
    return;
  }

  await import('dotenv/config');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-members-demo is dev-only; refusing to run (NODE_ENV=production).');
  }
  const host = assertDevDatabase(process.env.DATABASE_URL);
  console.log(`Database host: ${host}`);

  const { prisma, close } = await createPrisma(process.env.DATABASE_URL as string);
  try {
    if (options.demo) await runDemo(prisma, options.apply);
    else await runCleanup(prisma, options.apply);
  } finally {
    await close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
