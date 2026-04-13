/**
 * Honor Requirements Seed Script
 *
 * Reads index.csv and markdown files from docs/working/honors-especialidades/
 * to populate the honor_requirements table.
 *
 * Usage:
 *   npx tsx prisma/seeds/honor-requirements.seed.ts           # seed DB
 *   npx tsx prisma/seeds/honor-requirements.seed.ts --dry-run  # report only, no inserts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────

const DOCS_BASE = path.resolve(
  __dirname,
  '../../../docs/working/honors-especialidades',
);
const CSV_PATH = path.join(DOCS_BASE, 'index.csv');
const MD_DIR = path.join(DOCS_BASE, 'md');
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Manual slug → DB honor_id mapping ──────────────────────────────────────
// Covers encoding artifacts, naming differences, ADRA suffixes, roman vs arabic
// numerals, and DB typos that prevent automatic normalization matching.

const SLUG_TO_HONOR_ID: Record<string, number> = {
  // ADRA-suffixed (DB names don't include "ADRA")
  'alfabetizacion-adra': 221, // Alfabetización
  'auxilio-de-las-catastrofes-adra': 222, // Auxilio de las Catástrofes
  'auxilio-de-las-catastrofes-avanzado-adra': 223, // Auxilio de las Catástrofes - Avanzado
  'ayuda-alimenticia-adra': 224, // Ayuda Alimenticia
  'desarrollo-comunitario-adra': 225, // Desarrollo Comunitario
  'evaluacion-comunitaria-adra': 226, // Evaluación Comunitaria
  'reasentamiento-refugiados-adra': 227, // Reasentamiento de Refugiados
  'resolucion-conflictos-adra': 228, // Resolución de Conflictos
  'servicio-comunitario-adra': 229, // Servicio Comunitario

  // Arabic numerals in CSV → Roman numerals in DB
  'campamento-1': 25, // Campamento I
  'campamento-2': 26, // Campamento II
  'campamento-3': 27, // Campamento III
  'campamento-4': 28, // Campamento IV
  'natacion-1': 86, // Natación I
  'natacion-1-avanzado': 87, // Natación I - Avanzado
  'natacion-2': 88, // Natación II
  'natacion-3': 89, // Natación III
  'natacin-3-avanzado': 90, // Natación III - Avanzado
  'reptiles-1': 563, // Reptiles (DB has no number)
  'computacion-i': 152, // Computación I - Básico
  'computacion-ii': 153, // Computación II - Intermedio
  'computacion-iii': 154, // Computación III - Regular
  'computacion-iv': 155, // Computación IV - Avanzado
  'computacion-v': 156, // Computación V - Especializado

  // Encoding artifacts in CSV (mangled accented chars)
  'cetceos': 479, // Cetáceos
  'ciclismo-en-montaa': 35, // Ciclismo en Montaña
  'citologa': 484, // Citología
  'climatologa': 485, // Climatología
  'climatologa-avanzado': 486, // Climatología - Avanzado
  'construccin-de-canoas': 40, // Construcción de Canoas
  'crustceos': 494, // Crustáceos
  'energa-renovable': 501, // Energía Renovable
  'geocaching-geolgico': 69, // Geocaching Geológico
  'geocaching-geolgico-avanzado': 70, // Geocaching Geológico - Avanzado
  'gramneas': 670, // Gramíneas
  'liquenes-hepticas-y-musgos': 525, // Líquenes, Hepáticas y Musgos
  'loros-y-cacatas': 528, // Loros y Cacatúas
  'molsucos-terrestres-y-de-agua-dulce': 540, // Moluscos Terrestres y de Agua Dulce
  'orientacin-con-gps': 97, // Orientación con GPS
  'tiendas-de-campaa': 128, // Tiendas de Campaña
  'poriferos-y-canidarios': 558, // Poróferos y Canidarios (DB also has typo)

  // Name differences (CSV title ≠ DB name)
  'aves-de-rapinia': 465, // Aves de Rapiña
  'aves-de-rapinia-avanzado': 466, // Aves de Rapiña - Avanzado
  'cria-de-ovejas': 8, // Cría de Cvejas (DB typo)
  'cuidado-de-ninios': 386, // Cuidado de Niños
  'ensenianza': 173, // Enseñanza
  'escalada-en-roca': 51, // Escalada
  'escalada-en-roca-avanazado': 52, // Escalada - Avanzado
  'estudio-biblico-en-grupo-pequenio': 392, // Estudio Bíblico en Grupo Pequeño
  'estudio-biblico-en-grupo-pequenio-avanzado': 393, // Estudio Bíblico en Grupo Pequeño - Avanzado
  'frutas-pequenias': 10, // Frutas Pequeñas
  'geocaching': 67, // Geocaching (Búsqueda por GPS)
  'interprete-de-lenguaje-de-senias': 185, // Intérprete de Lenguaje de Señas
  'lapidario': 289, // Lapidación
  'montanias': 541, // Montañas
  'motores-pequenios': 194, // Motores Pequeños
  'pesca-islenia': 15, // Pesca Isleña
  'reanimacion-cardiopulmonar': 601, // Reanimación Cardiopulmonar (RCP)
  'codigo-semaforo': 151, // Código de Semáforo
  'tejido-anudado': 325, // Teñido Anudado
  'tejido-anudado-avanzado': 326, // Teñido Anudado - Avanzado
  'trabajos-de-fieltro': 331, // Trabajos en Fieltro
  'trabajos-de-jabon': 332, // Trabajos en Jabón
  'trabajos-de-jabon-avanzado': 333, // Trabajos en Jabón - Avanzado
  'sangre-y-defensas-y-del-cuerpo': 605, // Sangre y Defensas del Cuerpo
  'trabajos-en-madera-man': 334, // Trabajos en Madera - Manualidad
  'trabajos-en-madera-voc': 219, // Trabajos en Madera
  'zarzos-ja': 575, // Zarzos
  'eva': 268, // E.V.A. (Etilvinilacetato)

  // Concatenated numbers in CSV (e.g., "hongos1", "semillas1")
  'conservacion-ambiental1': 489, // Conservación Ambiental
  'hongos1': 518, // Hongos
  'odonatos1': 544, // Odonatos
  'semillas1': 567, // Semillas

  // Modelado de Papel — no exact match in DB, closest is "Modelo de Papel" (id 293)
  'modelado-de-papel': 293, // Modelo de Papel
};

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Lowercase, strip accents/diacritics, remove non-alphanumeric except spaces,
 * collapse whitespace.
 */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Same as normalize but also removes common Spanish stopwords.
 * Used as a second-pass fuzzy match.
 */
const STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'en',
  'y',
  'el',
  'con',
  'a',
]);

function normalizeLoose(s: string): string {
  return normalize(s)
    .split(' ')
    .filter((w) => !STOPWORDS.has(w))
    .join(' ');
}

// ─── CSV Parsing ─────────────────────────────────────────────────────────────

interface CsvEntry {
  slug: string;
  title: string;
  level: number;
  requirementsDetected: number;
  mdPath: string;
}

function parseCsv(csvPath: string): CsvEntry[] {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  // Header: slug,title,level,requirements_detected,pdf,md,raw_txt,error
  const entries: CsvEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV split — no quoted fields in this dataset
    const parts = line.split(',');
    const slug = parts[0]?.trim();
    const title = parts[1]?.trim();
    const level = parseInt(parts[2]?.trim() || '0', 10);
    const requirementsDetected = parseInt(parts[3]?.trim() || '0', 10);

    if (!slug || !title) continue;

    const mdPath = path.join(MD_DIR, `${slug}.md`);
    entries.push({ slug, title, level, requirementsDetected, mdPath });
  }

  return entries;
}

// ─── Markdown Parsing ────────────────────────────────────────────────────────

interface ParsedRequirement {
  requirementNumber: number;
  text: string;
  hasSubItems: boolean;
}

function parseRequirements(mdContent: string): ParsedRequirement[] {
  const requirements: ParsedRequirement[] = [];

  // Extract everything after "## Requisitos detectados" and before the next "##" or EOF
  const sectionMatch = mdContent.match(
    /## Requisitos detectados\s*\n([\s\S]*?)(?=\n## |\n---|$)/,
  );
  if (!sectionMatch) return requirements;

  const section = sectionMatch[1];

  // Match lines starting with N. text (numbered list)
  const lineRegex = /^(\d+)\.\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = lineRegex.exec(section)) !== null) {
    const reqNum = parseInt(match[1], 10);
    const text = match[2].trim();

    // Skip empty or whitespace-only requirement texts
    if (!text) continue;

    // Detect sub-items: a. b. c. ... h. or roman i. ii. iii. iv. v. vi. patterns
    const hasSubItems =
      /\b[a-h]\.\s/i.test(text) ||
      /\b(?:i{1,3}|iv|vi{0,3}|v)\.\s/i.test(text);

    requirements.push({ requirementNumber: reqNum, text, hasSubItems });
  }

  return requirements;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Honor Requirements Seed Script ===`);
  console.log(`    Mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'LIVE SEED'}\n`);

  // Init Prisma
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // 1. Parse CSV
    console.log(`[CSV] Reading: ${CSV_PATH}`);
    const csvEntries = parseCsv(CSV_PATH);
    console.log(`[CSV] Found ${csvEntries.length} entries\n`);

    // 2. Query all honors from DB, build normalized name -> honor_id maps
    const dbHonors = await prisma.honors.findMany({
      select: { honor_id: true, name: true },
    });
    console.log(`[DB]  Found ${dbHonors.length} honors in database\n`);

    // Exact normalized map + loose (stopwords removed) map
    const exactMap = new Map<string, { honor_id: number; name: string }>();
    const looseMap = new Map<string, { honor_id: number; name: string }>();

    for (const h of dbHonors) {
      const exact = normalize(h.name);
      const loose = normalizeLoose(h.name);
      // First entry wins (handles the 2 known dupes)
      if (!exactMap.has(exact)) exactMap.set(exact, h);
      if (!looseMap.has(loose)) looseMap.set(loose, h);
    }

    // 3. Process each CSV entry
    let totalMatched = 0;
    let totalUnmatched = 0;
    let totalRequirementsInserted = 0;
    let countMismatches = 0;
    let manualMatches = 0;
    const unmatchedEntries: {
      slug: string;
      csvTitle: string;
      normalizedTitle: string;
    }[] = [];
    const allRequirements: {
      honor_id: number;
      requirement_number: number;
      requirement_text: string;
      has_sub_items: boolean;
      needs_review: boolean;
    }[] = [];

    for (const entry of csvEntries) {
      const normalizedTitle = normalize(entry.title);
      const looseTitle = normalizeLoose(entry.title);

      // Match strategy (in order):
      // 1. Manual slug mapping (encoding issues, naming differences)
      // 2. Exact normalized name match
      // 3. Loose normalized match (stopwords removed)
      let honorId: number | undefined;
      let matchSource = '';

      if (SLUG_TO_HONOR_ID[entry.slug] !== undefined) {
        honorId = SLUG_TO_HONOR_ID[entry.slug];
        matchSource = 'manual';
        manualMatches++;
      } else {
        const exactHit = exactMap.get(normalizedTitle);
        if (exactHit) {
          honorId = exactHit.honor_id;
          matchSource = 'exact';
        } else {
          const looseHit = looseMap.get(looseTitle);
          if (looseHit) {
            honorId = looseHit.honor_id;
            matchSource = 'loose';
          }
        }
      }

      if (honorId === undefined) {
        totalUnmatched++;
        unmatchedEntries.push({
          slug: entry.slug,
          csvTitle: entry.title,
          normalizedTitle,
        });
        continue;
      }

      totalMatched++;

      // Read .md file
      if (!fs.existsSync(entry.mdPath)) {
        console.warn(`   [WARN] Missing .md file: ${entry.mdPath}`);
        continue;
      }

      const mdContent = fs.readFileSync(entry.mdPath, 'utf-8');
      if (!mdContent.trim()) {
        console.warn(
          `   [WARN] Empty .md file: ${entry.mdPath}`,
        );
        continue;
      }

      const requirements = parseRequirements(mdContent);

      // Cross-validate parsed count vs CSV requirements_detected
      if (requirements.length !== entry.requirementsDetected) {
        countMismatches++;
        if (DRY_RUN) {
          console.log(
            `   [MISMATCH] ${entry.slug}: CSV=${entry.requirementsDetected}, parsed=${requirements.length} (match: ${matchSource})`,
          );
        }
      }

      // Build requirement rows
      for (const req of requirements) {
        allRequirements.push({
          honor_id: honorId,
          requirement_number: req.requirementNumber,
          requirement_text: req.text,
          has_sub_items: req.hasSubItems,
          needs_review: true,
        });
      }
    }

    // 4. Report
    console.log(`\n--- Summary ---`);
    console.log(`   CSV entries:          ${csvEntries.length}`);
    console.log(`   Matched to DB:        ${totalMatched}`);
    console.log(
      `     - exact:            ${totalMatched - manualMatches}`,
    );
    console.log(`     - manual mapping:   ${manualMatches}`);
    console.log(`   Unmatched:            ${totalUnmatched}`);
    console.log(`   Count mismatches:     ${countMismatches}`);
    console.log(`   Total requirements:   ${allRequirements.length}`);

    if (unmatchedEntries.length > 0) {
      console.log(`\n[UNMATCHED] ${unmatchedEntries.length} honors:`);
      for (const u of unmatchedEntries) {
        console.log(
          `   - ${u.slug} (csv: "${u.csvTitle}", normalized: "${u.normalizedTitle}")`,
        );
      }

      // Save unmatched to JSON for later review
      const unmatchedPath = path.join(__dirname, 'unmatched.json');
      fs.writeFileSync(
        unmatchedPath,
        JSON.stringify(unmatchedEntries, null, 2),
      );
      console.log(`\n   Saved unmatched list to: ${unmatchedPath}`);
    }

    // 5. Insert (unless dry-run)
    if (DRY_RUN) {
      console.log(`\n[DONE] Dry run complete. No data was inserted.\n`);
    } else {
      if (allRequirements.length === 0) {
        console.log(`\n[WARN] No requirements to insert.\n`);
      } else {
        console.log(
          `\n[INSERT] Inserting ${allRequirements.length} requirements...`,
        );

        const result = await prisma.honor_requirements.createMany({
          data: allRequirements,
          skipDuplicates: true,
        });

        totalRequirementsInserted = result.count;
        console.log(
          `   Inserted: ${totalRequirementsInserted} (skipped duplicates: ${allRequirements.length - totalRequirementsInserted})`,
        );
        console.log(`\n[DONE] Seed complete.\n`);
      }
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
