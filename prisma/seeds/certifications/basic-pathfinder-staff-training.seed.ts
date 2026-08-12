/**
 * Idempotent seed for the certification:
 * "Capacitación básica para el personal del Club de Conquistadores"
 *
 * Source of truth: docs/plans/2026-08-05-configurable-certifications-engine-implementation-plan.md
 * (Task 9, Step 2 — 8 módulos / 19 requisitos principales mapeados del PDF funcional).
 *
 * Design notes:
 * - Exported as a pure function so it can run either inside its own transaction
 *   (standalone / tests with a full client) or inside an already-open
 *   transaction (e.g. `prisma/seeds/core.ts`, which passes its `tx`).
 * - `classes.Guía Mayor` is resolved by FK (never by hardcoded id) because the
 *   INVESTED_CLASS eligibility rule must always reference `class_id`. This is
 *   the one load-bearing lookup: the whole certification is gated on it, so a
 *   missing class throws instead of silently seeding a broken eligibility rule.
 * - Honors ("Contabilidad", "Anti-bullying I") are looked up by name but are
 *   NOT load-bearing: if missing, the seed does not crash. It reports the gap
 *   and falls back to a TEXT_RESPONSE component so every requirement still has
 *   at least one component (keeps the version internally consistent/publishable
 *   even in a dev DB that hasn't imported the honors catalog yet).
 * - The same lookup-or-fallback treatment is applied to the `activity_types`
 *   catalog for the two "actividades" linked to the Christian-values module,
 *   since that catalog is also environment-dependent.
 * - This module intentionally never imports PrismaClient/PrismaService: it
 *   depends only on a small structural interface (`SeedExecutionClient`) so it
 *   is trivial to fake in unit tests without a real database.
 */
import {
  parseComponentInput,
  parseEligibilityRuleInput,
  type ComponentInput,
  type EligibilityRuleInput,
} from '../../../src/certifications/definitions/certification-configuration.parsers';

const SEED_ERROR_PREFIX = 'SEED_BASIC_PATHFINDER_STAFF_TRAINING';

export const CERTIFICATION_NAME =
  'Capacitación básica para el personal del Club de Conquistadores';

const CERTIFICATION_DESCRIPTION =
  'Capacitación básica requerida para el personal (directiva y consejería) del ' +
  'Club de Conquistadores. Cubre estilos de enseñanza y aprendizaje, atención a ' +
  'necesidades especiales, valores cristianos, objetivos de investidura, ' +
  'aplicaciones prácticas, enseñanza de honores y disciplina del club.';

const MIN_DURATION_MONTHS = 12;
const MAX_DURATION_MONTHS = 24;

const GUIA_MAYOR_CLASS_NAME = 'Guía Mayor';

const HONOR_CANDIDATES = {
  CONTABILIDAD: ['Contabilidad'],
  ANTI_BULLYING_I: [
    'Anti-bullying I',
    'Anti-Bullying I',
    'Antibullying I',
    'Anti Bullying I',
  ],
} as const;

const ACTIVITY_TYPE_CANDIDATES = [
  'Actividad espiritual',
  'Servicio comunitario',
  'Actividad social',
] as const;

export const ALLOWED_EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

// ============================================================================
// Minimal structural client contract (kept intentionally small and untyped-ish
// so both a real Prisma client/transaction and a hand-rolled fake satisfy it).
// ============================================================================

export type SeedClassRow = { class_id: number; name: string };
export type SeedHonorRow = { honor_id: number; name: string };
export type SeedActivityTypeRow = { activity_type_id: number; name: string };
export type SeedCertificationRow = {
  certification_id: number;
  name: string;
};
export type SeedCertificationVersionRow = {
  certification_version_id: number;
  certification_id: number;
  version_number: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
};
export type SeedEligibilityRuleRow = {
  eligibility_rule_id: number;
  certification_version_id: number;
  rule_type: EligibilityRuleInput['rule_type'];
};
export type SeedModuleRow = { module_id: number; name: string };
export type SeedSectionRow = { section_id: number; name: string };
export type SeedComponentRow = { component_id: number; label: string };

export type SeedExecutionClient = {
  classes: {
    findFirst(args: unknown): Promise<SeedClassRow | null>;
  };
  honors: {
    findFirst(args: unknown): Promise<SeedHonorRow | null>;
  };
  activity_types: {
    findFirst(args: unknown): Promise<SeedActivityTypeRow | null>;
  };
  certifications: {
    findFirst(args: unknown): Promise<SeedCertificationRow | null>;
    create(args: unknown): Promise<SeedCertificationRow>;
    update(args: unknown): Promise<SeedCertificationRow>;
  };
  certification_versions: {
    findFirst(args: unknown): Promise<SeedCertificationVersionRow | null>;
    create(args: unknown): Promise<SeedCertificationVersionRow>;
    update(args: unknown): Promise<SeedCertificationVersionRow>;
  };
  certification_eligibility_rules: {
    findFirst(args: unknown): Promise<SeedEligibilityRuleRow | null>;
    create(args: unknown): Promise<SeedEligibilityRuleRow>;
    update(args: unknown): Promise<SeedEligibilityRuleRow>;
  };
  certification_modules: {
    findFirst(args: unknown): Promise<SeedModuleRow | null>;
    create(args: unknown): Promise<SeedModuleRow>;
    update(args: unknown): Promise<SeedModuleRow>;
  };
  certification_sections: {
    findFirst(args: unknown): Promise<SeedSectionRow | null>;
    create(args: unknown): Promise<SeedSectionRow>;
    update(args: unknown): Promise<SeedSectionRow>;
  };
  certification_requirement_components: {
    findFirst(args: unknown): Promise<SeedComponentRow | null>;
    create(args: unknown): Promise<SeedComponentRow>;
    update(args: unknown): Promise<SeedComponentRow>;
  };
};

export type SeedTransactionalClient = SeedExecutionClient & {
  $transaction<T>(fn: (tx: SeedExecutionClient) => Promise<T>): Promise<T>;
};

function hasTransactionSupport(
  client: SeedExecutionClient | SeedTransactionalClient,
): client is SeedTransactionalClient {
  return typeof (client as SeedTransactionalClient).$transaction === 'function';
}

export interface SeedReport {
  certificationId: number;
  certificationVersionId: number;
  versionStatus: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  wasNewlyPublished: boolean;
  guiaMayorClassId: number;
  guiaMayorClassResolvedBy: 'exact' | 'fuzzy';
  eligibilityRuleCount: number;
  moduleCount: number;
  requirementCount: number;
  componentCount: number;
  skippedHonors: string[];
  skippedActivityTypes: string[];
}

function emptyReport(): Omit<
  SeedReport,
  | 'certificationId'
  | 'certificationVersionId'
  | 'versionStatus'
  | 'guiaMayorClassId'
  | 'guiaMayorClassResolvedBy'
> {
  return {
    wasNewlyPublished: false,
    eligibilityRuleCount: 0,
    moduleCount: 0,
    requirementCount: 0,
    componentCount: 0,
    skippedHonors: [],
    skippedActivityTypes: [],
  };
}

// ============================================================================
// Lookups
// ============================================================================

async function resolveGuiaMayorClass(
  tx: SeedExecutionClient,
): Promise<{ row: SeedClassRow; resolvedBy: 'exact' | 'fuzzy' }> {
  const exact = await tx.classes.findFirst({
    where: { name: GUIA_MAYOR_CLASS_NAME, active: true },
  });
  if (exact) {
    return { row: exact, resolvedBy: 'exact' };
  }

  const fuzzy = await tx.classes.findFirst({
    where: { name: { contains: GUIA_MAYOR_CLASS_NAME }, active: true },
    orderBy: { class_id: 'asc' },
  });
  if (fuzzy) {
    return { row: fuzzy, resolvedBy: 'fuzzy' };
  }

  throw new Error(
    `${SEED_ERROR_PREFIX}: required class "${GUIA_MAYOR_CLASS_NAME}" (or similar) was not ` +
      'found in the classes catalog. The INVESTED_CLASS eligibility rule cannot be seeded ' +
      'without it — this certification is load-bearing on Guía Mayor investiture, so the seed ' +
      'refuses to continue rather than publish a broken eligibility rule.',
  );
}

async function resolveHonorByCandidates(
  tx: SeedExecutionClient,
  candidateNames: readonly string[],
): Promise<SeedHonorRow | null> {
  for (const name of candidateNames) {
    const honor = await tx.honors.findFirst({ where: { name, active: true } });
    if (honor) {
      return honor;
    }
  }
  return null;
}

async function resolveActivityType(
  tx: SeedExecutionClient,
  candidateNames: readonly string[],
): Promise<SeedActivityTypeRow | null> {
  for (const name of candidateNames) {
    const activityType = await tx.activity_types.findFirst({
      where: { name, active: true },
    });
    if (activityType) {
      return activityType;
    }
  }
  return tx.activity_types.findFirst({ where: { active: true } });
}

// ============================================================================
// Component builders (return unparsed ComponentInput; validated centrally via
// parseComponentInput right before persistence, same parser the admin
// definitions API uses so the seed can never write configuration the runtime
// would reject).
// ============================================================================

function textResponse(params: {
  label: string;
  instructions: string;
  minLength?: number;
  maxLength?: number;
}): ComponentInput {
  return {
    component_type: 'TEXT_RESPONSE',
    label: params.label,
    instructions: params.instructions,
    configuration: {
      min_length: params.minLength ?? 20,
      ...(params.maxLength !== undefined
        ? { max_length: params.maxLength }
        : {}),
    },
  };
}

function fileEvidence(params: {
  label: string;
  instructions: string;
  maxFiles?: number;
}): ComponentInput {
  return {
    component_type: 'FILE_EVIDENCE',
    label: params.label,
    instructions: params.instructions,
    configuration: {
      allowed_mime_types: [...ALLOWED_EVIDENCE_MIME_TYPES],
      max_files: params.maxFiles ?? 1,
    },
  };
}

function attestation(params: {
  label: string;
  instructions: string;
  statement: string;
}): ComponentInput {
  return {
    component_type: 'ATTESTATION',
    label: params.label,
    instructions: params.instructions,
    configuration: { statement: params.statement },
  };
}

async function honorOrFallbackComponent(
  tx: SeedExecutionClient,
  report: ReturnType<typeof emptyReport>,
  params: {
    label: string;
    instructions: string;
    candidateNames: readonly string[];
  },
): Promise<ComponentInput> {
  const honor = await resolveHonorByCandidates(tx, params.candidateNames);
  if (honor) {
    return {
      component_type: 'LINKED_HONOR',
      label: params.label,
      instructions: params.instructions,
      honor_id: honor.honor_id,
    };
  }

  report.skippedHonors.push(
    `${params.label} (buscado por nombre: ${params.candidateNames.join(', ')})`,
  );
  return textResponse({
    label: params.label,
    instructions:
      `${params.instructions} [Honor no encontrado en el catálogo del entorno; se solicita ` +
      'evidencia narrativa mientras se registra el honor correspondiente.]',
    minLength: 30,
  });
}

async function activityOrFallbackComponent(
  tx: SeedExecutionClient,
  report: ReturnType<typeof emptyReport>,
  params: { label: string; instructions: string },
): Promise<ComponentInput> {
  const activityType = await resolveActivityType(tx, ACTIVITY_TYPE_CANDIDATES);
  if (activityType) {
    return {
      component_type: 'LINKED_ACTIVITY',
      label: params.label,
      instructions: params.instructions,
      activity_type_id: activityType.activity_type_id,
    };
  }

  report.skippedActivityTypes.push(params.label);
  return textResponse({
    label: params.label,
    instructions:
      `${params.instructions} [No hay tipos de actividad activos en el catálogo del entorno; ` +
      'se solicita evidencia narrativa mientras se registra el catálogo de actividades.]',
    minLength: 30,
  });
}

// ============================================================================
// Module/section tree definition (8 modules → 19 requirements)
// ============================================================================

type SectionSpec = {
  name: string;
  description?: string | null;
  instructions?: string | null;
  components: ComponentInput[];
};

type ModuleSpec = {
  name: string;
  description?: string | null;
  sections: SectionSpec[];
};

async function buildModuleDefinitions(
  tx: SeedExecutionClient,
  report: ReturnType<typeof emptyReport>,
): Promise<ModuleSpec[]> {
  return [
    {
      name: 'Estilos de enseñanza',
      description:
        'Comprensión y aplicación de los principales estilos de enseñanza usados en el club.',
      sections: [
        {
          name: 'Cuadro comparativo de estilos de enseñanza',
          instructions:
            'Elaborar un cuadro comparativo de los principales estilos de enseñanza aplicables al Club de Conquistadores.',
          components: [
            textResponse({
              label: 'Cuadro comparativo',
              instructions:
                'Describir y comparar al menos tres estilos de enseñanza, sus ventajas y contextos de uso.',
              minLength: 100,
            }),
          ],
        },
        {
          name: 'Honor relacionado con estilos de enseñanza',
          instructions:
            'Cursar y reportar un honor relacionado con estilos de enseñanza en el contexto de club.',
          components: [
            textResponse({
              label: 'Honor cursado',
              instructions:
                'Indicar el nombre del honor cursado relacionado con estilos de enseñanza y describir brevemente lo aprendido.',
              minLength: 30,
            }),
          ],
        },
      ],
    },
    {
      name: 'Estilos de aprendizaje',
      description:
        'Identificación de los estilos de aprendizaje de los miembros del club.',
      sections: [
        {
          name: 'Evaluación escrita de estilos de aprendizaje',
          instructions:
            'Responder la evaluación escrita sobre estilos de aprendizaje.',
          components: [
            textResponse({
              label: 'Evaluación escrita',
              instructions:
                'Responder por escrito la evaluación sobre estilos de aprendizaje (visual, auditivo, kinestésico, etc.).',
              minLength: 100,
            }),
          ],
        },
      ],
    },
    {
      name: 'Necesidades especiales',
      description:
        'Atención a miembros con necesidades especiales dentro del club.',
      sections: [
        {
          name: 'Honor de necesidades especiales',
          instructions:
            'Cursar y reportar un honor relacionado con la atención a necesidades especiales.',
          components: [
            textResponse({
              label: 'Honor cursado',
              instructions:
                'Indicar el nombre del honor cursado relacionado con necesidades especiales y describir brevemente lo aprendido.',
              minLength: 30,
            }),
          ],
        },
        {
          name: 'Plan adaptado',
          instructions:
            'Elaborar un plan adaptado para un miembro del club con necesidades especiales.',
          components: [
            fileEvidence({
              label: 'Plan adaptado',
              instructions:
                'Adjuntar el plan adaptado elaborado para un miembro con necesidades especiales (imagen o PDF).',
              maxFiles: 1,
            }),
          ],
        },
        {
          name: 'Informe de entrevista',
          instructions:
            'Realizar una entrevista relacionada con necesidades especiales y documentar los hallazgos.',
          components: [
            fileEvidence({
              label: 'Informe de entrevista',
              instructions:
                'Adjuntar el informe de la entrevista realizada (imagen o PDF).',
              maxFiles: 1,
            }),
          ],
        },
      ],
    },
    {
      name: 'Valores cristianos',
      description: 'Enseñanza y práctica de valores cristianos en el club.',
      sections: [
        {
          name: 'Análisis de valores cristianos',
          instructions:
            'Elaborar un análisis sobre la enseñanza de valores cristianos en el club.',
          components: [
            textResponse({
              label: 'Análisis',
              instructions:
                'Redactar un análisis sobre cómo se enseñan y viven los valores cristianos en el club.',
              minLength: 150,
            }),
          ],
        },
        {
          name: 'Actividades de valores cristianos',
          instructions:
            'Realizar y vincular dos actividades que demuestren la enseñanza de valores cristianos.',
          components: [
            await activityOrFallbackComponent(tx, report, {
              label: 'Actividad 1',
              instructions:
                'Vincular la primera actividad realizada que demuestre la enseñanza de valores cristianos.',
            }),
            await activityOrFallbackComponent(tx, report, {
              label: 'Actividad 2',
              instructions:
                'Vincular la segunda actividad realizada que demuestre la enseñanza de valores cristianos.',
            }),
          ],
        },
      ],
    },
    {
      name: 'Objetivos de investidura',
      description:
        'Comprensión de los objetivos de la investidura de clases progresivas.',
      sections: [
        {
          name: 'Ensayo sobre objetivos de investidura',
          instructions:
            'Redactar un ensayo sobre los objetivos de la investidura en el club.',
          components: [
            textResponse({
              label: 'Ensayo',
              instructions:
                'Redactar un ensayo sobre la importancia y los objetivos de la investidura de clases progresivas.',
              minLength: 200,
            }),
          ],
        },
        {
          name: 'Métodos para alcanzar los objetivos de investidura',
          instructions:
            'Describir tres métodos distintos para ayudar a los miembros a alcanzar los objetivos de investidura.',
          components: [
            textResponse({
              label: 'Método 1',
              instructions: 'Describir el primer método utilizado.',
              minLength: 30,
            }),
            textResponse({
              label: 'Método 2',
              instructions: 'Describir el segundo método utilizado.',
              minLength: 30,
            }),
            textResponse({
              label: 'Método 3',
              instructions: 'Describir el tercer método utilizado.',
              minLength: 30,
            }),
          ],
        },
      ],
    },
    {
      name: 'Aplicaciones prácticas',
      description:
        'Planeación y ejecución de aplicaciones prácticas en el club.',
      sections: [
        {
          name: 'Plan anual de aplicaciones prácticas',
          instructions:
            'Elaborar el plan anual de aplicaciones prácticas del club.',
          components: [
            textResponse({
              label: 'Plan anual',
              instructions:
                'Elaborar el plan anual de aplicaciones prácticas del club, incluyendo actividades y responsables.',
              minLength: 150,
            }),
          ],
        },
        {
          name: 'Presentación o evidencia de aplicación práctica',
          instructions:
            'Presentar o adjuntar evidencia de una aplicación práctica realizada con el club.',
          components: [
            fileEvidence({
              label: 'Presentación o evidencia',
              instructions:
                'Adjuntar la presentación o evidencia de la aplicación práctica realizada (imagen o PDF).',
              maxFiles: 3,
            }),
          ],
        },
        {
          name: 'Honor de Contabilidad',
          instructions: 'Cursar el honor de Contabilidad.',
          components: [
            await honorOrFallbackComponent(tx, report, {
              label: 'Honor de Contabilidad',
              instructions: 'Vincular el honor de Contabilidad cursado.',
              candidateNames: HONOR_CANDIDATES.CONTABILIDAD,
            }),
          ],
        },
      ],
    },
    {
      name: 'Enseñanza de honores',
      description: 'Metodología para la enseñanza de honores dentro del club.',
      sections: [
        {
          name: 'Síntesis de enseñanza de honores',
          instructions:
            'Elaborar una síntesis sobre la metodología de enseñanza de honores en el club.',
          components: [
            textResponse({
              label: 'Síntesis',
              instructions:
                'Redactar una síntesis sobre la metodología recomendada para enseñar honores en el club.',
              minLength: 150,
            }),
          ],
        },
        {
          name: 'Enseñanza de un honor nuevo',
          instructions:
            'Enseñar un honor nuevo (no cursado previamente) a un grupo del club.',
          components: [
            textResponse({
              label: 'Descripción de la enseñanza',
              instructions:
                'Describir el honor nuevo enseñado, la planeación realizada y el grupo al que se impartió.',
              minLength: 100,
            }),
            fileEvidence({
              label: 'Evidencia de la enseñanza',
              instructions:
                'Adjuntar evidencia de la sesión de enseñanza del honor nuevo (imagen o PDF).',
              maxFiles: 3,
            }),
          ],
        },
      ],
    },
    {
      name: 'Disciplina',
      description:
        'Manejo de la disciplina y protección de los miembros del club.',
      sections: [
        {
          name: 'Honor Anti-bullying I',
          instructions: 'Cursar el honor Anti-bullying I.',
          components: [
            await honorOrFallbackComponent(tx, report, {
              label: 'Honor Anti-bullying I',
              instructions: 'Vincular el honor Anti-bullying I cursado.',
              candidateNames: HONOR_CANDIDATES.ANTI_BULLYING_I,
            }),
          ],
        },
        {
          name: 'Plan de comportamiento',
          instructions:
            'Elaborar un plan de comportamiento y disciplina para el club.',
          components: [
            fileEvidence({
              label: 'Plan de comportamiento',
              instructions:
                'Adjuntar el plan de comportamiento elaborado (imagen o PDF).',
              maxFiles: 1,
            }),
          ],
        },
        {
          name: 'Diez reglas de disciplina del club',
          instructions:
            'Redactar diez reglas de disciplina aplicables al club.',
          components: [
            textResponse({
              label: 'Diez reglas',
              instructions:
                'Redactar las diez reglas de disciplina propuestas para el club.',
              minLength: 100,
            }),
          ],
        },
        {
          name: 'Constancia de base de datos de miembros y padres',
          instructions:
            'Confirmar el uso de la base de datos institucional de miembros y padres del club.',
          components: [
            attestation({
              label: 'Constancia de base de datos',
              instructions:
                'Esta constancia referencia los datos protegidos de SACDIA; no se generan ni ' +
                'aceptan planillas descargables con datos de menores (Invariante 12 del motor de certificaciones).',
              statement:
                'Confirmo que utilicé la base de datos institucional de SACDIA para consultar los ' +
                'datos de miembros y padres del club, sin exportar ni compartir planillas con datos ' +
                'de menores fuera del sistema.',
            }),
          ],
        },
      ],
    },
  ];
}

// ============================================================================
// Persistence helpers (manual find-then-create/update — mirrors the
// idempotent-upsert convention already used across prisma/seeds/core.ts).
// ============================================================================

async function upsertCertification(
  tx: SeedExecutionClient,
): Promise<SeedCertificationRow> {
  const existing = await tx.certifications.findFirst({
    where: { name: CERTIFICATION_NAME },
  });
  const data = {
    name: CERTIFICATION_NAME,
    description: CERTIFICATION_DESCRIPTION,
    active: true,
  };

  if (existing) {
    return tx.certifications.update({
      where: { certification_id: existing.certification_id },
      data,
    });
  }
  return tx.certifications.create({ data });
}

async function findOrCreateDraftVersion(
  tx: SeedExecutionClient,
  certificationId: number,
): Promise<SeedCertificationVersionRow> {
  const existing = await tx.certification_versions.findFirst({
    where: { certification_id: certificationId, version_number: 1 },
  });

  const metadata = {
    title: CERTIFICATION_NAME,
    description: CERTIFICATION_DESCRIPTION,
    min_duration_months: MIN_DURATION_MONTHS,
    max_duration_months: MAX_DURATION_MONTHS,
  };

  if (!existing) {
    return tx.certification_versions.create({
      data: {
        certification_id: certificationId,
        version_number: 1,
        status: 'DRAFT',
        ...metadata,
      },
    });
  }

  if (existing.status === 'DRAFT') {
    // Safe to refresh metadata: DRAFT versions are mutable and the
    // immutability trigger only guards PUBLISHED/RETIRED rows.
    return tx.certification_versions.update({
      where: { certification_version_id: existing.certification_version_id },
      data: metadata,
    });
  }

  // Already PUBLISHED/RETIRED: leave the version row untouched so we never
  // trip the `prevent_immutable_certification_version_mutation` trigger.
  return existing;
}

async function upsertEligibilityRule(
  tx: SeedExecutionClient,
  certificationVersionId: number,
  parsed: ReturnType<typeof parseEligibilityRuleInput>,
): Promise<SeedEligibilityRuleRow> {
  const existing = await tx.certification_eligibility_rules.findFirst({
    where: {
      certification_version_id: certificationVersionId,
      rule_type: parsed.rule_type,
    },
  });

  const data = {
    certification_version_id: certificationVersionId,
    rule_type: parsed.rule_type,
    configuration: parsed.configuration,
    class_id: parsed.class_id,
    club_type_id: parsed.club_type_id,
    role_id: parsed.role_id,
    sort_order: parsed.sort_order,
    active: true,
  };

  if (existing) {
    return tx.certification_eligibility_rules.update({
      where: { eligibility_rule_id: existing.eligibility_rule_id },
      data,
    });
  }
  return tx.certification_eligibility_rules.create({ data });
}

async function upsertModule(
  tx: SeedExecutionClient,
  certificationId: number,
  certificationVersionId: number,
  spec: { name: string; description: string | null; sortOrder: number },
): Promise<SeedModuleRow> {
  const existing = await tx.certification_modules.findFirst({
    where: {
      certification_version_id: certificationVersionId,
      name: spec.name,
    },
  });

  const data = {
    certification_id: certificationId,
    certification_version_id: certificationVersionId,
    name: spec.name,
    description: spec.description,
    sort_order: spec.sortOrder,
    active: true,
  };

  if (existing) {
    return tx.certification_modules.update({
      where: { module_id: existing.module_id },
      data,
    });
  }
  return tx.certification_modules.create({ data });
}

async function upsertSection(
  tx: SeedExecutionClient,
  moduleId: number,
  spec: {
    name: string;
    description: string | null;
    instructions: string | null;
    sortOrder: number;
  },
): Promise<SeedSectionRow> {
  const existing = await tx.certification_sections.findFirst({
    where: { module_id: moduleId, name: spec.name },
  });

  const data = {
    module_id: moduleId,
    name: spec.name,
    description: spec.description,
    instructions: spec.instructions,
    sort_order: spec.sortOrder,
    required: true,
    active: true,
  };

  if (existing) {
    return tx.certification_sections.update({
      where: { section_id: existing.section_id },
      data,
    });
  }
  return tx.certification_sections.create({ data });
}

async function upsertComponent(
  tx: SeedExecutionClient,
  sectionId: number,
  parsed: ReturnType<typeof parseComponentInput>,
): Promise<SeedComponentRow> {
  const existing = await tx.certification_requirement_components.findFirst({
    where: { section_id: sectionId, label: parsed.label },
  });

  const data = {
    section_id: sectionId,
    component_type: parsed.component_type,
    label: parsed.label,
    instructions: parsed.instructions,
    configuration: parsed.configuration,
    sort_order: parsed.sort_order,
    required: parsed.required,
    honor_id: parsed.honor_id,
    activity_type_id: parsed.activity_type_id,
    active: true,
  };

  if (existing) {
    return tx.certification_requirement_components.update({
      where: { component_id: existing.component_id },
      data,
    });
  }
  return tx.certification_requirement_components.create({ data });
}

// ============================================================================
// Orchestration
// ============================================================================

async function runSeed(tx: SeedExecutionClient): Promise<SeedReport> {
  const report = emptyReport();

  const { row: guiaMayorClass, resolvedBy } = await resolveGuiaMayorClass(tx);

  const certification = await upsertCertification(tx);
  let version = await findOrCreateDraftVersion(
    tx,
    certification.certification_id,
  );
  const shouldSeedTreeAndPublish = version.status === 'DRAFT';

  const eligibilityInputs: EligibilityRuleInput[] = [
    { rule_type: 'MIN_AGE', configuration: { min_age: 18 } },
    { rule_type: 'BAPTIZED' },
    { rule_type: 'INVESTED_CLASS', class_id: guiaMayorClass.class_id },
  ];

  for (const [index, input] of eligibilityInputs.entries()) {
    const parsed = parseEligibilityRuleInput(input, index);
    await upsertEligibilityRule(tx, version.certification_version_id, parsed);
    report.eligibilityRuleCount += 1;
  }

  const moduleDefinitions = await buildModuleDefinitions(tx, report);

  for (const [moduleIndex, moduleSpec] of moduleDefinitions.entries()) {
    const moduleRow = await upsertModule(
      tx,
      certification.certification_id,
      version.certification_version_id,
      {
        name: moduleSpec.name,
        description: moduleSpec.description ?? null,
        sortOrder: moduleIndex,
      },
    );
    report.moduleCount += 1;

    for (const [sectionIndex, sectionSpec] of moduleSpec.sections.entries()) {
      const sectionRow = await upsertSection(tx, moduleRow.module_id, {
        name: sectionSpec.name,
        description: sectionSpec.description ?? null,
        instructions: sectionSpec.instructions ?? null,
        sortOrder: sectionIndex,
      });
      report.requirementCount += 1;

      for (const [
        componentIndex,
        componentInput,
      ] of sectionSpec.components.entries()) {
        const parsedComponent = parseComponentInput(
          componentInput,
          componentIndex,
        );
        await upsertComponent(tx, sectionRow.section_id, parsedComponent);
        report.componentCount += 1;
      }
    }
  }

  if (shouldSeedTreeAndPublish) {
    if (report.eligibilityRuleCount === 0 || report.moduleCount === 0) {
      throw new Error(
        `${SEED_ERROR_PREFIX}: refusing to publish an incomplete certification definition.`,
      );
    }

    version = await tx.certification_versions.update({
      where: { certification_version_id: version.certification_version_id },
      data: { status: 'PUBLISHED', published_at: new Date(), active: true },
    });
    report.wasNewlyPublished = true;
  }

  return {
    certificationId: certification.certification_id,
    certificationVersionId: version.certification_version_id,
    versionStatus: version.status,
    guiaMayorClassId: guiaMayorClass.class_id,
    guiaMayorClassResolvedBy: resolvedBy,
    ...report,
  };
}

/**
 * Seeds (idempotently) the "Capacitación básica para el personal del Club de
 * Conquistadores" certification: identity, published version 1, eligibility
 * rules, and the full 8-module / 19-requirement tree.
 *
 * Accepts either a full client (and opens its own transaction) or an
 * already-open transaction client (e.g. the `tx` passed by
 * `prisma/seeds/core.ts`), so it composes cleanly with other seeds without
 * nesting transactions.
 */
export async function seedBasicPathfinderStaffTraining(
  prisma: SeedExecutionClient | SeedTransactionalClient,
): Promise<SeedReport> {
  if (hasTransactionSupport(prisma)) {
    return prisma.$transaction((tx) => runSeed(tx));
  }
  return runSeed(prisma);
}
