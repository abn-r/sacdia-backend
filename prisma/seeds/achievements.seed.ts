/**
 * Achievement Seed Script — Phase 8.2
 *
 * Seeds the initial achievement categories and achievements across all
 * 5 types (THRESHOLD, STREAK, COLLECTION, MILESTONE, COMPOUND) and all
 * tiers (BRONZE → DIAMOND). Fully idempotent via upsert on name uniqueness.
 *
 * Usage:
 *   npx tsx prisma/seeds/achievements.seed.ts
 *
 * ⚠️  Achievements that use `class.completed` will not unlock automatically
 *     until that event is emitted from classes.service.ts.
 */

import 'dotenv/config';
import { PrismaClient, achievement_type, achievement_tier, achievement_scope } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Category definitions
// ---------------------------------------------------------------------------

const CATEGORIES = [
  {
    name: 'Progresión',
    description: 'Logros relacionados con la finalización de clases e investiduras',
    icon: 'graduation-cap',
    display_order: 1,
  },
  {
    name: 'Especialidades',
    description: 'Logros relacionados con honores y especialidades obtenidas',
    icon: 'award',
    display_order: 2,
  },
  {
    name: 'Asistencia',
    description: 'Logros basados en la asistencia a actividades del club',
    icon: 'calendar-check',
    display_order: 3,
  },
  {
    name: 'Exploración',
    description: 'Logros relacionados con la participación en camporees y eventos',
    icon: 'compass',
    display_order: 4,
  },
  {
    name: 'Liderazgo',
    description: 'Logros relacionados con roles de liderazgo y reconocimientos',
    icon: 'users',
    display_order: 5,
  },
  {
    name: 'Dedicación',
    description: 'Logros de racha y compromiso a largo plazo',
    icon: 'flame',
    display_order: 6,
  },
] as const;

// ---------------------------------------------------------------------------
// Achievement definitions (minimal interface for building the data)
// ---------------------------------------------------------------------------

interface AchievementSeed {
  name: string;
  description: string;
  categoryName: string;
  type: achievement_type;
  tier: achievement_tier;
  points: number;
  criteria: object;
  secret?: boolean;
  repeatable?: boolean;
  scope?: achievement_scope;
  /** Name of the prerequisite achievement (resolved after categories upserted) */
  prerequisiteName?: string;
}

const ACHIEVEMENTS: AchievementSeed[] = [
  // ── THRESHOLD: Progresión — Aventureros ──────────────────────────────────
  {
    name: 'Primer Paso',
    description: 'Inscríbete en tu primera clase del club.',
    categoryName: 'Progresión',
    type: 'THRESHOLD',
    tier: 'BRONZE',
    points: 10,
    criteria: { event: 'class.started', operator: 'gte', target: 1 },
  },
  {
    name: 'Primera Investidura Aventurero',
    description: 'Completa tu primera investidura como Aventurero.',
    categoryName: 'Progresión',
    type: 'THRESHOLD',
    tier: 'BRONZE',
    points: 20,
    criteria: { event: 'class.completed', operator: 'gte', target: 1, filters: { club_type_id: 1 } },
  },
  {
    name: 'Aventurero Avanzado',
    description: 'Completa 3 investiduras como Aventurero.',
    categoryName: 'Progresión',
    type: 'THRESHOLD',
    tier: 'SILVER',
    points: 40,
    criteria: { event: 'class.completed', operator: 'gte', target: 3, filters: { club_type_id: 1 } },
    prerequisiteName: 'Primera Investidura Aventurero',
  },
  {
    name: 'Aventurero Completo',
    description: 'Completa las 6 investiduras de Aventureros.',
    categoryName: 'Progresión',
    type: 'THRESHOLD',
    tier: 'GOLD',
    points: 75,
    criteria: { event: 'class.completed', operator: 'gte', target: 6, filters: { club_type_id: 1 } },
    prerequisiteName: 'Aventurero Avanzado',
  },

  // ── THRESHOLD: Progresión — Conquistadores ────────────────────────────────
  {
    name: 'Primera Investidura Conquistador',
    description: 'Completa tu primera investidura como Conquistador.',
    categoryName: 'Progresión',
    type: 'THRESHOLD',
    tier: 'BRONZE',
    points: 20,
    criteria: { event: 'class.completed', operator: 'gte', target: 1, filters: { club_type_id: 2 } },
  },
  {
    name: 'Conquistador Avanzado',
    description: 'Completa 3 investiduras como Conquistador.',
    categoryName: 'Progresión',
    type: 'THRESHOLD',
    tier: 'SILVER',
    points: 40,
    criteria: { event: 'class.completed', operator: 'gte', target: 3, filters: { club_type_id: 2 } },
    prerequisiteName: 'Primera Investidura Conquistador',
  },
  {
    name: 'Conquistador Completo',
    description: 'Completa las 6 investiduras de Conquistadores.',
    categoryName: 'Progresión',
    type: 'THRESHOLD',
    tier: 'GOLD',
    points: 75,
    criteria: { event: 'class.completed', operator: 'gte', target: 6, filters: { club_type_id: 2 } },
    prerequisiteName: 'Conquistador Avanzado',
  },

  // ── THRESHOLD: Progresión — Guías Mayores ─────────────────────────────────
  {
    name: 'Guía Mayor Investido',
    description: 'Completa la investidura de Guía Mayor.',
    categoryName: 'Progresión',
    type: 'THRESHOLD',
    tier: 'PLATINUM',
    points: 100,
    criteria: { event: 'class.completed', operator: 'gte', target: 1, filters: { club_type_id: 3 } },
  },

  // ── COMPOUND: Progresión — Transiciones ───────────────────────────────────
  {
    name: 'De Aventurero a Conquistador',
    description:
      'Completaste todas las investiduras de Aventureros e iniciaste tu camino como Conquistador.',
    categoryName: 'Progresión',
    type: 'COMPOUND',
    tier: 'GOLD',
    points: 60,
    criteria: {
      logic: 'AND',
      conditions: [
        { event: 'class.completed', operator: 'gte', target: 6, filters: { club_type_id: 1 } },
        { event: 'class.completed', operator: 'gte', target: 1, filters: { club_type_id: 2 } },
      ],
    },
    prerequisiteName: 'Aventurero Completo',
  },
  {
    name: 'De Conquistador a Guía Mayor',
    description:
      'Completaste todas las investiduras de Conquistadores e iniciaste tu camino como Guía Mayor.',
    categoryName: 'Progresión',
    type: 'COMPOUND',
    tier: 'PLATINUM',
    points: 100,
    criteria: {
      logic: 'AND',
      conditions: [
        { event: 'class.completed', operator: 'gte', target: 6, filters: { club_type_id: 2 } },
        { event: 'class.completed', operator: 'gte', target: 1, filters: { club_type_id: 3 } },
      ],
    },
    prerequisiteName: 'Conquistador Completo',
  },

  // ── THRESHOLD: Especialidades ─────────────────────────────────────────────
  {
    name: 'Primer Honor',
    description: 'Valida tu primer honor o especialidad en el club.',
    categoryName: 'Especialidades',
    type: 'THRESHOLD',
    tier: 'BRONZE',
    points: 10,
    criteria: { event: 'honor.validated', operator: 'gte', target: 1 },
  },
  {
    name: 'Coleccionista',
    description: 'Valida 15 honores o especialidades.',
    categoryName: 'Especialidades',
    type: 'THRESHOLD',
    tier: 'SILVER',
    points: 25,
    criteria: { event: 'honor.validated', operator: 'gte', target: 15 },
  },
  {
    name: 'Maestro de Especialidades',
    description: 'Valida 30 honores o especialidades.',
    categoryName: 'Especialidades',
    type: 'THRESHOLD',
    tier: 'GOLD',
    points: 50,
    criteria: { event: 'honor.validated', operator: 'gte', target: 30 },
  },

  // ── COLLECTION: Especialidades ────────────────────────────────────────────
  {
    name: 'Explorador de Categorías',
    description: 'Obtén honores en al menos 3 categorías distintas de especialidades.',
    categoryName: 'Especialidades',
    type: 'COLLECTION',
    tier: 'SILVER',
    points: 30,
    criteria: {
      event: 'honor.validated',
      operator: 'distinct_count',
      distinct_field: 'category_id',
      target: 3,
    },
  },
  {
    name: 'Diversificado',
    description: 'Obtén honores en al menos 5 categorías distintas de especialidades.',
    categoryName: 'Especialidades',
    type: 'COLLECTION',
    tier: 'GOLD',
    points: 50,
    criteria: {
      event: 'honor.validated',
      operator: 'distinct_count',
      distinct_field: 'category_id',
      target: 5,
    },
  },

  // ── THRESHOLD: Asistencia ─────────────────────────────────────────────────
  {
    name: 'Primera Actividad',
    description: 'Asiste a tu primera actividad del club.',
    categoryName: 'Asistencia',
    type: 'THRESHOLD',
    tier: 'BRONZE',
    points: 10,
    criteria: { event: 'activity.attended', operator: 'gte', target: 1 },
  },
  {
    name: 'Participante Activo',
    description: 'Asiste a 10 actividades del club.',
    categoryName: 'Asistencia',
    type: 'THRESHOLD',
    tier: 'SILVER',
    points: 25,
    criteria: { event: 'activity.attended', operator: 'gte', target: 10 },
  },

  // ── THRESHOLD: Exploración ────────────────────────────────────────────────
  {
    name: 'Primer Camporee',
    description: 'Participa en tu primer camporee.',
    categoryName: 'Exploración',
    type: 'THRESHOLD',
    tier: 'BRONZE',
    points: 15,
    criteria: { event: 'camporee.participated', operator: 'gte', target: 1 },
  },
  {
    name: 'Veterano de Camporees',
    description: 'Participa en 5 camporees. Requiere haber completado "Primer Camporee".',
    categoryName: 'Exploración',
    type: 'THRESHOLD',
    tier: 'SILVER',
    points: 35,
    criteria: { event: 'camporee.participated', operator: 'gte', target: 5 },
    prerequisiteName: 'Primer Camporee',
  },

  // ── COMPOUND: Exploración ─────────────────────────────────────────────────
  {
    name: 'Explorador Total',
    description:
      'Obtén 5 honores, participa en 1 camporee y asiste a 20 actividades. El máximo explorador del club.',
    categoryName: 'Exploración',
    type: 'COMPOUND',
    tier: 'PLATINUM',
    points: 100,
    criteria: {
      logic: 'AND',
      conditions: [
        { event: 'honor.validated', operator: 'gte', target: 5 },
        { event: 'camporee.participated', operator: 'gte', target: 1 },
        { event: 'activity.attended', operator: 'gte', target: 20 },
      ],
    },
  },

  // ── MILESTONE: Liderazgo ──────────────────────────────────────────────────
  {
    name: 'Miembro del Mes',
    description: 'Sé reconocido como Miembro del Mes por tu club.',
    categoryName: 'Liderazgo',
    type: 'MILESTONE',
    tier: 'GOLD',
    points: 50,
    criteria: {
      event: 'member_of_month.awarded',
      field: 'awarded',
      operator: 'eq',
      target: true,
    },
  },

  // ── STREAK: Dedicación ────────────────────────────────────────────────────
  {
    name: 'Fiel',
    description: 'Asiste a actividades durante 4 semanas consecutivas.',
    categoryName: 'Dedicación',
    type: 'STREAK',
    tier: 'SILVER',
    points: 30,
    criteria: {
      event: 'activity.attended',
      operator: 'streak',
      target: 4,
      streak_unit: 'week',
    },
  },
  {
    name: 'Inquebrantable',
    description: 'Asiste a actividades durante 8 semanas consecutivas.',
    categoryName: 'Dedicación',
    type: 'STREAK',
    tier: 'GOLD',
    points: 60,
    criteria: {
      event: 'activity.attended',
      operator: 'streak',
      target: 8,
      streak_unit: 'week',
    },
  },
  {
    name: 'Leyenda',
    description: 'Asiste a actividades durante 16 semanas consecutivas sin faltar.',
    categoryName: 'Dedicación',
    type: 'STREAK',
    tier: 'PLATINUM',
    points: 100,
    criteria: {
      event: 'activity.attended',
      operator: 'streak',
      target: 16,
      streak_unit: 'week',
    },
  },

  // ── SECRET COMPOUND: Dedicación — Máximo logro ────────────────────────────
  {
    name: 'Leyenda Viviente',
    description:
      'El logro secreto supremo. Obtén 10 honores, mantén una racha de 16 semanas y participa en 2 camporees.',
    categoryName: 'Dedicación',
    type: 'COMPOUND',
    tier: 'DIAMOND',
    points: 200,
    secret: true,
    criteria: {
      logic: 'AND',
      conditions: [
        { event: 'honor.validated', operator: 'gte', target: 10 },
        { event: 'activity.attended', operator: 'streak', target: 16, streak_unit: 'week' },
        { event: 'camporee.participated', operator: 'gte', target: 2 },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Seeding achievement categories...');

  // Upsert categories and build a name → ID map
  const categoryIdMap = new Map<string, number>();

  for (const cat of CATEGORIES) {
    const upserted = await prisma.achievement_categories.upsert({
      where: { name: cat.name },
      create: {
        name: cat.name,
        description: cat.description,
        icon: cat.icon,
        display_order: cat.display_order,
        active: true,
      },
      update: {
        description: cat.description,
        icon: cat.icon,
        display_order: cat.display_order,
      },
    });
    categoryIdMap.set(cat.name, upserted.achievement_category_id);
    console.log(`  [category] ${cat.name} → id=${upserted.achievement_category_id}`);
  }

  console.log('Seeding achievements...');

  // First pass: upsert all achievements WITHOUT prerequisite_id
  const achievementIdMap = new Map<string, number>();

  for (const ach of ACHIEVEMENTS) {
    const categoryId = categoryIdMap.get(ach.categoryName);
    if (!categoryId) {
      throw new Error(`Category not found: "${ach.categoryName}" for achievement "${ach.name}"`);
    }

    const upserted = await prisma.achievements.upsert({
      where: { name: ach.name },
      create: {
        name: ach.name,
        description: ach.description,
        category_id: categoryId,
        type: ach.type,
        tier: ach.tier,
        scope: ach.scope ?? 'GLOBAL',
        points: ach.points,
        criteria: ach.criteria,
        secret: ach.secret ?? false,
        repeatable: ach.repeatable ?? false,
        active: true,
        // prerequisite_id set in second pass
      },
      update: {
        description: ach.description,
        category_id: categoryId,
        type: ach.type,
        tier: ach.tier,
        points: ach.points,
        criteria: ach.criteria,
        secret: ach.secret ?? false,
        // Do NOT overwrite prerequisite_id here — handled in second pass
      },
    });

    achievementIdMap.set(ach.name, upserted.achievement_id);
    console.log(`  [achievement] ${ach.name} (${ach.type}/${ach.tier}) → id=${upserted.achievement_id}`);
  }

  // Second pass: wire prerequisite_id for chain achievements
  const withPrerequisites = ACHIEVEMENTS.filter((a) => a.prerequisiteName != null);

  for (const ach of withPrerequisites) {
    const id = achievementIdMap.get(ach.name);
    const prerequisiteId = achievementIdMap.get(ach.prerequisiteName!);

    if (!id || !prerequisiteId) {
      console.warn(
        `  [warning] Could not wire prerequisite for "${ach.name}" → "${ach.prerequisiteName}"`,
      );
      continue;
    }

    await prisma.achievements.update({
      where: { achievement_id: id },
      data: { prerequisite_id: prerequisiteId },
    });

    console.log(
      `  [chain] "${ach.name}" (id=${id}) ← prerequisite "${ach.prerequisiteName}" (id=${prerequisiteId})`,
    );
  }

  console.log(`Done. Seeded ${CATEGORIES.length} categories and ${ACHIEVEMENTS.length} achievements.`);
}

main()
  .catch((e) => {
    console.error('Error during achievement seed:');
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
