/**
 * Folder Templates Seed Script — T-B1-1 (annual-folders-ownership-rework)
 *
 * Seeds union-owned draft folder templates for each club_type × ecclesiastical_year
 * pair using the first active union (IOMU, union_id=20) as owner.
 *
 * Includes the canonical sections for each club type, mirroring the
 * pre-migration data that was truncated during M1. Templates are intentionally
 * inactive: annual ranking configuration is now the source of truth for the
 * annual evidence folder point budget, so these drafts must be adjusted and
 * published through the admin once their section sum matches the ranking budget.
 *
 * Idempotent: uses upsert logic via findFirst + create guard.
 *
 * Usage:
 *   npx tsx prisma/seeds/folder-templates.seed.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Section definitions per club type
// ---------------------------------------------------------------------------

const SECTIONS_BY_CLUB_TYPE: Record<
  number,
  Array<{
    name: string;
    description?: string;
    order: number;
    required: boolean;
    max_points: number;
    minimum_points: number;
  }>
> = {
  // Aventureros (club_type_id = 1)
  1: [
    {
      name: 'Actas de reuniones regulares',
      order: 1,
      required: true,
      max_points: 80,
      minimum_points: 40,
    },
    {
      name: 'Registro de actividades infantiles',
      order: 2,
      required: true,
      max_points: 80,
      minimum_points: 40,
    },
    {
      name: 'Evidencia de proyectos manuales',
      order: 3,
      required: true,
      max_points: 60,
      minimum_points: 30,
    },
    {
      name: 'Actividades de desarrollo espiritual',
      order: 4,
      required: true,
      max_points: 60,
      minimum_points: 30,
    },
    {
      name: 'Registro de especialidades completadas',
      order: 5,
      required: false,
      max_points: 80,
      minimum_points: 0,
    },
    {
      name: 'Documentación administrativa',
      order: 6,
      required: true,
      max_points: 40,
      minimum_points: 20,
    },
    {
      name: 'Actividades recreativas y deportivas',
      order: 7,
      required: false,
      max_points: 40,
      minimum_points: 0,
    },
  ],
  // Conquistadores (club_type_id = 2)
  2: [
    {
      name: 'Actas de reuniones regulares',
      order: 1,
      required: true,
      max_points: 80,
      minimum_points: 40,
    },
    {
      name: 'Registro de campamentos y excursiones',
      order: 2,
      required: true,
      max_points: 100,
      minimum_points: 50,
    },
    {
      name: 'Evidencia de servicio comunitario',
      order: 3,
      required: true,
      max_points: 80,
      minimum_points: 40,
    },
    {
      name: 'Actividades de desarrollo espiritual',
      order: 4,
      required: true,
      max_points: 60,
      minimum_points: 30,
    },
    {
      name: 'Registro de especialidades completadas',
      order: 5,
      required: false,
      max_points: 80,
      minimum_points: 0,
    },
    {
      name: 'Documentación administrativa',
      order: 6,
      required: true,
      max_points: 50,
      minimum_points: 25,
    },
    {
      name: 'Actividades recreativas y deportivas',
      order: 7,
      required: false,
      max_points: 50,
      minimum_points: 0,
    },
  ],
  // Guías Mayores (club_type_id = 3) — matches pre-migration data exactly
  3: [
    {
      name: 'Actas de reuniones regulares',
      order: 1,
      required: true,
      max_points: 80,
      minimum_points: 40,
    },
    {
      name: 'Registro de campamentos y excursiones',
      order: 2,
      required: true,
      max_points: 100,
      minimum_points: 50,
    },
    {
      name: 'Evidencia de servicio comunitario',
      order: 3,
      required: true,
      max_points: 80,
      minimum_points: 40,
    },
    {
      name: 'Actividades de desarrollo espiritual',
      order: 4,
      required: true,
      max_points: 60,
      minimum_points: 30,
    },
    {
      name: 'Registro de especialidades completadas',
      order: 5,
      required: false,
      max_points: 80,
      minimum_points: 0,
    },
    {
      name: 'Documentación administrativa',
      order: 6,
      required: true,
      max_points: 50,
      minimum_points: 25,
    },
    {
      name: 'Actividades recreativas y deportivas',
      order: 7,
      required: false,
      max_points: 50,
      minimum_points: 0,
    },
  ],
};

const CLUB_TYPE_NAMES: Record<number, string> = {
  1: 'Aventureros',
  2: 'Conquistadores',
  3: 'Guías Mayores',
};

// ---------------------------------------------------------------------------
// Main seed
// ---------------------------------------------------------------------------

async function main() {
  console.log('Seeding folder_templates (union-owned drafts)…');

  // Resolve active union (IOMU, union_id=20) — fail fast if missing
  const union = await prisma.unions.findFirst({
    where: { active: true },
    orderBy: { union_id: 'asc' },
  });
  if (!union)
    throw new Error(
      'No active union found. Seed requires at least one active union.',
    );

  // Resolve all active club types
  const clubTypes = await prisma.club_types.findMany({
    where: { active: true },
    orderBy: { club_type_id: 'asc' },
  });
  if (clubTypes.length === 0) throw new Error('No active club types found.');

  // Resolve all ecclesiastical years
  const years = await prisma.ecclesiastical_years.findMany({
    orderBy: { year_id: 'asc' },
  });
  if (years.length === 0) throw new Error('No ecclesiastical years found.');

  let templatesCreated = 0;
  let sectionsCreated = 0;

  for (const year of years) {
    for (const clubType of clubTypes) {
      // Idempotency check: skip if union-owned template already exists for this pair
      const exists = await prisma.folder_templates.findFirst({
        where: {
          club_type_id: clubType.club_type_id,
          ecclesiastical_year_id: year.year_id,
          owner_union_id: union.union_id,
        },
      });

      if (exists) {
        console.log(
          `  SKIP: template already exists for club_type=${clubType.club_type_id} year=${year.year_id} union=${union.union_id}`,
        );
        continue;
      }

      const clubTypeName =
        CLUB_TYPE_NAMES[clubType.club_type_id] ??
        `Tipo ${clubType.club_type_id}`;
      const yearLabel = `${year.start_date.getFullYear()}`;
      const templateName = `Carpeta de Evidencias ${clubTypeName} ${yearLabel}`;

      const sections = SECTIONS_BY_CLUB_TYPE[clubType.club_type_id] ?? [];

      const template = await prisma.folder_templates.create({
        data: {
          name: templateName,
          club_type_id: clubType.club_type_id,
          ecclesiastical_year_id: year.year_id,
          owner_union_id: union.union_id,
          active: false,
          minimum_points: 250,
          sections: {
            create: sections.map((s) => ({
              name: s.name,
              description: s.description ?? null,
              order: s.order,
              required: s.required,
              max_points: s.max_points,
              minimum_points: s.minimum_points,
            })),
          },
        },
        include: { sections: true },
      });

      templatesCreated++;
      sectionsCreated += template.sections.length;
      console.log(
        `  CREATED DRAFT: ${templateName} (${template.sections.length} sections)`,
      );
    }
  }

  console.log(
    `\nSeed complete: ${templatesCreated} templates, ${sectionsCreated} sections created.`,
  );
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
