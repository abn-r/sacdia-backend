/**
 * Honor Requirements Re-scan Script
 *
 * Re-scans extracted markdowns with improved parsing for:
 * - Hierarchical sub-items (a. b. c. under numbered items)
 * - Choice groups ("elegir N de los siguientes")
 * - Evidence classification (verb analysis)
 * - Reference text extraction (tables, lists)
 *
 * Usage:
 *   npx tsx prisma/seeds/honor-requirements-rescan.seed.ts              # dry-run (default)
 *   npx tsx prisma/seeds/honor-requirements-rescan.seed.ts --apply      # apply changes
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
const DRY_RUN = !process.argv.includes('--apply');

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
  const entries: CsvEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

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

// ─── Evidence Classification ─────────────────────────────────────────────────

/**
 * Verbs that indicate a practical task requiring physical evidence.
 * Matched against the first verb found in the requirement text (after stripping
 * leading articles, conjunctions, and adverbs).
 */
const PRACTICAL_VERBS = new Set([
  'construir',
  'construye',
  'construir',
  'construya',
  'construir',
  'construyan',
  'demostrar',
  'demuestra',
  'demostrar',
  'demuestre',
  'demuestren',
  'hacer',
  'haz',
  'haga',
  'hagan',
  'preparar',
  'prepara',
  'prepare',
  'preparen',
  'crear',
  'crea',
  'cree',
  'creen',
  'diseñar',
  'diseña',
  'diseñe',
  'diseñen',
  'cocinar',
  'cocina',
  'cocine',
  'cocinen',
  'plantar',
  'planta',
  'plante',
  'planten',
  'dibujar',
  'dibuja',
  'dibuje',
  'dibujen',
  'pintar',
  'pinta',
  'pinte',
  'pinten',
  'fabricar',
  'fabrica',
  'fabrique',
  'fabriquen',
  'coser',
  'cose',
  'cosa',
  'cosan',
  'tejer',
  'teje',
  'teja',
  'tejan',
  'modelar',
  'modela',
  'modele',
  'modelen',
  'armar',
  'arma',
  'arme',
  'armen',
  'montar',
  'monta',
  'monte',
  'monten',
  'recolectar',
  'recolecta',
  'recolecte',
  'recolecten',
  'coleccionar',
  'colecciona',
  'coleccione',
  'coleccionen',
  'fotografiar',
  'fotografía',
  'fotografíe',
  'filmar',
  'filma',
  'filme',
  'filmen',
  'grabar',
  'graba',
  'grabe',
  'graben',
  'presentar',
  'presenta',
  'presente',
  'presenten',
  'realizar',
  'realiza',
  'realice',
  'realicen',
  'elaborar',
  'elabora',
  'elabore',
  'elaboren',
  'desarrollar',
  'desarrolla',
  'desarrolle',
  'desarrollen',
  'ejecutar',
  'ejecuta',
  'ejecute',
  'ejecuten',
  'completar',
  'completa',
  'complete',
  'completen',
  'organizar',
  'organiza',
  'organice',
  'organicen',
  'instalar',
  'instala',
  'instale',
  'instalen',
  'montar',
  'cultivar',
  'cultiva',
  'cultive',
  'cultiven',
  'sembrar',
  'siembra',
  'siembre',
  'siembren',
  'colectar',
  'colecta',
  'colecte',
  'colecten',
  'verter',
  'vierte',
  'vierta',
  'viertan',
  'establecer',
  'establece',
  'establezca',
  'establezcan',
  'escribir',
  'escribe',
  'escriba',
  'escriban',
  'redactar',
  'redacta',
  'redacte',
  'redacten',
  'sellar',
  'sella',
  'selle',
  'sellen',
  'montar',
  'volar',
  'vuela',
  'vuele',
  'vuelen',
]);

const THEORETICAL_VERBS = new Set([
  'definir',
  'define',
  'defina',
  'definan',
  'explicar',
  'explica',
  'explique',
  'expliquen',
  'describir',
  'describe',
  'describa',
  'describan',
  'enumerar',
  'enumera',
  'enumere',
  'enumeren',
  'listar',
  'lista',
  'liste',
  'listen',
  'mencionar',
  'menciona',
  'mencione',
  'mencionen',
  'identificar',
  'identifica',
  'identifique',
  'identifiquen',
  'nombrar',
  'nombra',
  'nombre',
  'nombren',
  'conocer',
  'conoce',
  'conozca',
  'conozcan',
  'saber',
  'sabe',
  'sepa',
  'sepan',
  'estudiar',
  'estudia',
  'estudie',
  'estudien',
  'leer',
  'lee',
  'lea',
  'lean',
  'memorizar',
  'memoriza',
  'memorice',
  'memoricen',
  'recitar',
  'recita',
  'recite',
  'reciten',
  'investigar',
  'investiga',
  'investigue',
  'investiguen',
  'comparar',
  'compara',
  'compare',
  'comparen',
  'discutir',
  'discute',
  'discuta',
  'discutan',
  'analizar',
  'analiza',
  'analice',
  'analicen',
  'dialogar',
  'dialoga',
  'dialogue',
  'dialoguen',
  'conversar',
  'conversa',
  'converse',
  'conversen',
  'citar',
  'cita',
  'cite',
  'citen',
  'diferenciar',
  'diferencia',
  'diferencie',
  'diferencien',
  'contestar',
  'contesta',
  'conteste',
  'contesten',
  'responder',
  'responde',
  'responda',
  'respondan',
]);

/**
 * Classify a requirement as requiring evidence or not, based on verb analysis.
 * Checks the first word(s) of the text (normalized) against practical/theoretical
 * verb sets. Returns false (not classified) if no match is found.
 */
function classifyRequiresEvidence(text: string): boolean {
  // Normalize: lowercase, strip accents
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  // Extract first few words to find the leading verb
  const words = normalized.split(/\s+/);

  // Check first 3 words to allow for leading qualifiers ("al menos", etc.)
  for (let i = 0; i < Math.min(3, words.length); i++) {
    const word = words[i].replace(/[^a-z]/g, '');
    if (PRACTICAL_VERBS.has(word)) return true;
    if (THEORETICAL_VERBS.has(word)) return false;
  }

  // Default to false (theoretical/unknown)
  return false;
}

// ─── Choice Group Detection ───────────────────────────────────────────────────

/**
 * Detect if a requirement text describes a choice group ("choose N of the following").
 * Returns { isChoiceGroup: true, choiceMin: N } or { isChoiceGroup: false }.
 */
function detectChoiceGroup(text: string): { isChoiceGroup: boolean; choiceMin: number | null } {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // Patterns: "de los siguientes", "al menos N de", "completar N de",
  //           "elegir N", "realizar N de", "escoger N", "N de los siguientes"
  const patterns: Array<{ re: RegExp; groupIdx: number }> = [
    // "al menos 2 de los siguientes" / "al menos 2 de"
    { re: /al\s+menos\s+(\d+)\s+de/, groupIdx: 1 },
    // "completar 3 de" / "completar al menos 3"
    { re: /completar\s+(?:al\s+menos\s+)?(\d+)/, groupIdx: 1 },
    // "elegir 2 de" / "elegir al menos 2"
    { re: /elegir\s+(?:al\s+menos\s+)?(\d+)/, groupIdx: 1 },
    // "escoger 2 de" / "escoger al menos 2"
    { re: /escoger\s+(?:al\s+menos\s+)?(\d+)/, groupIdx: 1 },
    // "realizar 3 de los siguientes"
    { re: /realizar\s+(?:al\s+menos\s+)?(\d+)\s+de/, groupIdx: 1 },
    // "hacer 2 de los siguientes"
    { re: /hacer\s+(?:al\s+menos\s+)?(\d+)\s+de\s+los\s+siguientes/, groupIdx: 1 },
    // "N de los siguientes" (any N at start of phrase)
    { re: /(\d+)\s+de\s+los\s+siguientes/, groupIdx: 1 },
    // "de los siguientes" without explicit count → assume min=1
    { re: /de\s+los\s+siguientes/, groupIdx: -1 },
    // "uno de los" → min=1
    { re: /uno\s+de\s+los/, groupIdx: -1 },
    // "por lo menos N" (general phrase)
    { re: /por\s+lo\s+menos\s+(\d+)/, groupIdx: 1 },
  ];

  for (const { re, groupIdx } of patterns) {
    const match = re.exec(normalized);
    if (match) {
      const choiceMin = groupIdx >= 1 ? parseInt(match[groupIdx], 10) : 1;
      return { isChoiceGroup: true, choiceMin: isNaN(choiceMin) ? 1 : choiceMin };
    }
  }

  return { isChoiceGroup: false, choiceMin: null };
}

// ─── Reference Text Extraction ────────────────────────────────────────────────

/**
 * Detect if text contains embedded reference material (tables, charts, lists).
 *
 * Reference text indicators found in these markdowns:
 * - Inline markdown tables: contains "|"
 * - Cartel/chart references: "Cartel #N", "(Usar el Cartel"
 * - Inline lists after colons that enumerate items without sub-item letters
 * - Long blocks of capitalized terms separated by spaces (extracted table data)
 *
 * Strategy: split on the first occurrence of a reference boundary marker,
 * return { mainText, referenceText }.
 */
function extractReferenceText(text: string): { mainText: string; referenceText: string | null } {
  // Pattern 1: Inline markdown table — text contains "|...|"
  const pipeIdx = text.indexOf('|');
  if (pipeIdx !== -1) {
    // The reference starts at the pipe
    const mainText = text.slice(0, pipeIdx).trim();
    const referenceText = text.slice(pipeIdx).trim();
    if (mainText.length > 0 && referenceText.length > 10) {
      return { mainText, referenceText };
    }
  }

  // Pattern 2: Cartel references — "(Completar el Cartel", "(Usar el Cartel", "Cartel #"
  const cartelMatch = /\((?:Completar|Usar)\s+el\s+Cartel\b|\bCartel\s+#/i.exec(text);
  if (cartelMatch) {
    const splitIdx = cartelMatch.index;
    // Find the start of the parenthesis or "Cartel" keyword
    const mainText = text.slice(0, splitIdx).trim();
    const referenceText = text.slice(splitIdx).trim();
    if (mainText.length > 5 && referenceText.length > 5) {
      return { mainText, referenceText };
    }
  }

  // Pattern 3: A colon followed by a long block of capitalized/enumerated terms.
  // Heuristic: if the text after the last sentence-ending colon is more than 60 chars
  // and contains ≥3 capitalized tokens, treat it as reference text.
  const colonIdx = text.lastIndexOf(':');
  if (colonIdx !== -1 && colonIdx < text.length - 60) {
    const afterColon = text.slice(colonIdx + 1).trim();
    // Count capitalized words (first letter uppercase after normalization)
    const capitalizedWords = afterColon
      .split(/\s+/)
      .filter((w) => w.length > 1 && /^[A-ZÁÉÍÓÚÑÜ]/.test(w));
    if (capitalizedWords.length >= 3) {
      const mainText = text.slice(0, colonIdx + 1).trim();
      return { mainText, referenceText: afterColon };
    }
  }

  return { mainText: text, referenceText: null };
}

// ─── Inline Sub-item Parsing ──────────────────────────────────────────────────

/**
 * Parsed sub-item from inline text (a. Text b. Text ...)
 */
interface ParsedSubItem {
  label: string; // "a", "b", "c", "i", "ii", ...
  text: string;
}

/**
 * Extract inline sub-items from requirement text.
 *
 * The markdown format stores everything on a single line, so sub-items appear
 * as "a. Text b. Text c. Text" embedded inline.
 *
 * Handles:
 *   - Lettered sub-items: a. b. c. ... z.
 *   - Roman numeral sub-items: i. ii. iii. iv. v. vi. vii. viii. ix. x.
 *
 * Returns the sub-items and the text that precedes the first sub-item
 * (the "parent" instruction text).
 */
function extractSubItems(text: string): { parentText: string; subItems: ParsedSubItem[] } {
  // Sub-item pattern: word boundary + letter/roman + period + space
  // We need to be careful not to match things like "e.g." or "i.e."
  // Strategy: find all occurrences of " a. ", " b. ", " i. ", " ii. " etc.
  // that look like a list (sequential, not isolated abbreviations)

  // First pass: find all candidate split points
  // Pattern matches: " a. " " b. " ... " z. " " i. " " ii. " " iii. " " iv. " " v. " " vi. " " vii. " " viii. " " ix. " " x. "
  const subItemRe =
    /\s+([a-z]|i{1,3}|iv|vi{0,3}|ix|x)\.\s+/gi;

  interface Candidate {
    index: number;
    label: string;
    fullMatch: string;
  }

  const candidates: Candidate[] = [];
  let m: RegExpExecArray | null;

  while ((m = subItemRe.exec(text)) !== null) {
    candidates.push({
      index: m.index,
      label: m[1].toLowerCase(),
      fullMatch: m[0],
    });
  }

  if (candidates.length < 2) {
    // Need at least 2 sub-items to be considered a real list
    // (a single "a." could be an abbreviation or isolated item)
    return { parentText: text, subItems: [] };
  }

  // Validate sequencing — sub-items should be in order (a, b, c or i, ii, iii)
  // This prevents matching random "a." abbreviations in prose
  const letterOrder = 'abcdefghijklmnopqrstuvwxyz';
  const romanOrder = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

  function isRoman(label: string): boolean {
    return romanOrder.includes(label.toLowerCase());
  }

  function letterIndex(label: string): number {
    return letterOrder.indexOf(label.toLowerCase());
  }

  function romanIndex(label: string): number {
    return romanOrder.indexOf(label.toLowerCase());
  }

  // Check if candidates form a valid sequence (allow gaps of at most 1)
  function isValidSequence(items: Candidate[]): boolean {
    if (items.length < 2) return false;

    const allRoman = items.every((c) => isRoman(c.label));
    const allLetter = items.every((c) => !isRoman(c.label) || c.label === 'i');

    if (allRoman) {
      for (let idx = 1; idx < items.length; idx++) {
        const prev = romanIndex(items[idx - 1].label);
        const curr = romanIndex(items[idx].label);
        if (curr <= prev || curr - prev > 2) return false;
      }
      return true;
    }

    if (allLetter) {
      for (let idx = 1; idx < items.length; idx++) {
        const prev = letterIndex(items[idx - 1].label);
        const curr = letterIndex(items[idx].label);
        if (curr <= prev || curr - prev > 2) return false;
      }
      return true;
    }

    // Mixed — accept as valid if there are at least 2
    return items.length >= 2;
  }

  if (!isValidSequence(candidates)) {
    return { parentText: text, subItems: [] };
  }

  // Split the text at candidate boundaries
  const firstCandidateStart = candidates[0].index;
  const parentText = text.slice(0, firstCandidateStart).trim();

  const subItems: ParsedSubItem[] = [];

  for (let idx = 0; idx < candidates.length; idx++) {
    const startOfContent =
      candidates[idx].index + candidates[idx].fullMatch.length;
    const endOfContent =
      idx + 1 < candidates.length ? candidates[idx + 1].index : text.length;

    const subText = text.slice(startOfContent, endOfContent).trim();
    subItems.push({
      label: candidates[idx].label,
      text: subText,
    });
  }

  return { parentText, subItems };
}

// ─── Parsed Requirement (rich) ────────────────────────────────────────────────

interface RichRequirement {
  requirementNumber: number;
  displayLabel: string; // "1", "2", ... for top-level
  requirementText: string;
  referenceText: string | null;
  hasSubItems: boolean;
  isChoiceGroup: boolean;
  choiceMin: number | null;
  requiresEvidence: boolean;
  subItems: Array<{
    label: string; // "a", "b", "c"
    text: string;
    referenceText: string | null;
    requiresEvidence: boolean;
  }>;
}

// ─── Markdown Parsing (rich) ──────────────────────────────────────────────────

function parseRequirementsRich(mdContent: string): RichRequirement[] {
  const requirements: RichRequirement[] = [];

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
    const rawText = match[2].trim();

    if (!rawText) continue;

    // 1. Extract sub-items from inline text
    const { parentText, subItems } = extractSubItems(rawText);

    // 2. Extract reference text from parent
    const { mainText: cleanParentText, referenceText: parentRefText } =
      extractReferenceText(parentText);

    // 3. Classify evidence for parent
    const parentRequiresEvidence = classifyRequiresEvidence(cleanParentText);

    // 4. Detect choice group from parent text
    const { isChoiceGroup, choiceMin } = detectChoiceGroup(cleanParentText);

    // 5. Process sub-items
    const richSubItems = subItems.map((si) => {
      const { mainText: siText, referenceText: siRef } = extractReferenceText(si.text);
      return {
        label: si.label,
        text: siText,
        referenceText: siRef,
        requiresEvidence: classifyRequiresEvidence(siText),
      };
    });

    requirements.push({
      requirementNumber: reqNum,
      displayLabel: String(reqNum),
      requirementText: cleanParentText,
      referenceText: parentRefText,
      hasSubItems: richSubItems.length > 0,
      isChoiceGroup,
      choiceMin,
      requiresEvidence: parentRequiresEvidence,
      subItems: richSubItems,
    });
  }

  return requirements;
}

// ─── DB Row Types ─────────────────────────────────────────────────────────────

interface DbRequirement {
  requirement_id: number;
  honor_id: number;
  parent_id: number | null;
  requirement_number: number;
  display_label: string | null;
  requirement_text: string;
  reference_text: string | null;
  has_sub_items: boolean;
  is_choice_group: boolean;
  choice_min: number | null;
  requires_evidence: boolean;
  needs_review: boolean;
}

// ─── Change Tracking ─────────────────────────────────────────────────────────

interface RequirementUpdate {
  requirement_id: number;
  honor_id: number;
  requirement_number: number;
  changes: Record<string, { from: unknown; to: unknown }>;
}

interface SubItemInsert {
  honor_id: number;
  parent_requirement_id: number;
  parent_requirement_number: number;
  label: string;
  text: string;
  reference_text: string | null;
  requires_evidence: boolean;
}

// ─── Comparison Logic ─────────────────────────────────────────────────────────

/**
 * Compare a parsed rich requirement against the existing DB row and collect
 * the fields that differ.
 */
function diffRequirement(
  parsed: RichRequirement,
  dbRow: DbRequirement,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  function check<T>(field: string, dbVal: T, parsedVal: T): void {
    if (dbVal !== parsedVal) {
      changes[field] = { from: dbVal, to: parsedVal };
    }
  }

  check('display_label', dbRow.display_label, parsed.displayLabel);
  check('has_sub_items', dbRow.has_sub_items, parsed.hasSubItems);
  check('is_choice_group', dbRow.is_choice_group, parsed.isChoiceGroup);
  check('choice_min', dbRow.choice_min, parsed.choiceMin);
  check('requires_evidence', dbRow.requires_evidence, parsed.requiresEvidence);

  // Only update reference_text if the parsed value is non-null and differs
  if (parsed.referenceText !== null) {
    check('reference_text', dbRow.reference_text, parsed.referenceText);
  }

  return changes;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Honor Requirements Re-scan Script ===`);
  console.log(`    Mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'APPLY (writing to DB)'}\n`);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  // Stats
  let totalHonorsProcessed = 0;
  let totalHonorsSkipped = 0;
  let totalHonorsUnmatched = 0;
  let totalUpdates = 0;
  let totalNewSubItems = 0;
  let totalFieldChanges = 0;
  let totalAppliedUpdates = 0;
  let totalAppliedInserts = 0;
  let totalSkippedInserts = 0;

  const allUpdates: RequirementUpdate[] = [];
  const allSubItemInserts: SubItemInsert[] = [];

  try {
    // 1. Parse CSV
    console.log(`[CSV] Reading: ${CSV_PATH}`);
    const csvEntries = parseCsv(CSV_PATH);
    console.log(`[CSV] Found ${csvEntries.length} entries\n`);

    // 2. Query all honors from DB — build matching maps
    const dbHonors = await prisma.honors.findMany({
      select: { honor_id: true, name: true },
    });
    console.log(`[DB]  Found ${dbHonors.length} honors in database\n`);

    const exactMap = new Map<string, { honor_id: number; name: string }>();
    const looseMap = new Map<string, { honor_id: number; name: string }>();

    for (const h of dbHonors) {
      const exact = normalize(h.name);
      const loose = normalizeLoose(h.name);
      if (!exactMap.has(exact)) exactMap.set(exact, h);
      if (!looseMap.has(loose)) looseMap.set(loose, h);
    }

    // 3. Process each CSV entry
    for (const entry of csvEntries) {
      // --- Honor matching (3-tier) ---
      const normalizedTitle = normalize(entry.title);
      const looseTitle = normalizeLoose(entry.title);

      let honorId: number | undefined;

      if (SLUG_TO_HONOR_ID[entry.slug] !== undefined) {
        honorId = SLUG_TO_HONOR_ID[entry.slug];
      } else {
        const exactHit = exactMap.get(normalizedTitle);
        if (exactHit) {
          honorId = exactHit.honor_id;
        } else {
          const looseHit = looseMap.get(looseTitle);
          if (looseHit) honorId = looseHit.honor_id;
        }
      }

      if (honorId === undefined) {
        totalHonorsUnmatched++;
        continue;
      }

      // --- Read markdown ---
      if (!fs.existsSync(entry.mdPath)) {
        totalHonorsSkipped++;
        continue;
      }

      const mdContent = fs.readFileSync(entry.mdPath, 'utf-8');
      if (!mdContent.trim()) {
        totalHonorsSkipped++;
        continue;
      }

      // --- Parse with rich parser ---
      const parsedReqs = parseRequirementsRich(mdContent);
      if (parsedReqs.length === 0) {
        totalHonorsSkipped++;
        continue;
      }

      totalHonorsProcessed++;

      // --- Query existing DB requirements for this honor ---
      const dbRows = (await prisma.honor_requirements.findMany({
        where: { honor_id: honorId, parent_id: null },
        select: {
          requirement_id: true,
          honor_id: true,
          parent_id: true,
          requirement_number: true,
          display_label: true,
          requirement_text: true,
          reference_text: true,
          has_sub_items: true,
          is_choice_group: true,
          choice_min: true,
          requires_evidence: true,
          needs_review: true,
        },
      })) as DbRequirement[];

      // Build lookup: requirement_number → DB row
      const dbByNumber = new Map<number, DbRequirement>();
      for (const row of dbRows) {
        dbByNumber.set(row.requirement_number, row);
      }

      // --- Diff each parsed requirement ---
      for (const parsed of parsedReqs) {
        const dbRow = dbByNumber.get(parsed.requirementNumber);

        if (!dbRow) {
          // No matching DB row — skip (original seeder should have inserted it)
          continue;
        }

        // Check for field differences
        const changes = diffRequirement(parsed, dbRow);
        if (Object.keys(changes).length > 0) {
          totalUpdates++;
          totalFieldChanges += Object.keys(changes).length;
          allUpdates.push({
            requirement_id: dbRow.requirement_id,
            honor_id: honorId,
            requirement_number: parsed.requirementNumber,
            changes,
          });
        }

        // Check for sub-items that need to be inserted
        if (parsed.subItems.length > 0) {
          // Query existing sub-items for this parent
          const existingSubItems = await prisma.honor_requirements.findMany({
            where: { parent_id: dbRow.requirement_id },
            select: { display_label: true },
          });
          const existingLabels = new Set(existingSubItems.map((si) => si.display_label));

          for (const si of parsed.subItems) {
            if (!existingLabels.has(si.label)) {
              totalNewSubItems++;
              allSubItemInserts.push({
                honor_id: honorId,
                parent_requirement_id: dbRow.requirement_id,
                parent_requirement_number: parsed.requirementNumber,
                label: si.label,
                text: si.text,
                reference_text: si.referenceText,
                requires_evidence: si.requiresEvidence,
              });
            }
          }
        }
      }
    }

    // 4. Print detailed diff report
    if (allUpdates.length > 0) {
      console.log(`\n--- Field Updates (sample, first 20) ---`);
      const sample = allUpdates.slice(0, 20);
      for (const u of sample) {
        console.log(
          `   [UPDATE] honor_id=${u.honor_id} req#${u.requirement_number} (id=${u.requirement_id})`,
        );
        for (const [field, { from, to }] of Object.entries(u.changes)) {
          console.log(`      ${field}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
        }
      }
      if (allUpdates.length > 20) {
        console.log(`   ... and ${allUpdates.length - 20} more updates`);
      }
    }

    if (allSubItemInserts.length > 0) {
      console.log(`\n--- New Sub-items to Insert (sample, first 20) ---`);
      const sample = allSubItemInserts.slice(0, 20);
      for (const si of sample) {
        console.log(
          `   [INSERT] honor_id=${si.honor_id} parent_req#${si.parent_requirement_number} label="${si.label}" text="${si.text.slice(0, 60)}..."`,
        );
      }
      if (allSubItemInserts.length > 20) {
        console.log(`   ... and ${allSubItemInserts.length - 20} more inserts`);
      }
    }

    // 5. Summary
    console.log(`\n--- Summary ---`);
    console.log(`   Honors processed:       ${totalHonorsProcessed}`);
    console.log(`   Honors unmatched:       ${totalHonorsUnmatched}`);
    console.log(`   Honors skipped (no md): ${totalHonorsSkipped}`);
    console.log(`   Requirements to update: ${totalUpdates}`);
    console.log(`   Field changes total:    ${totalFieldChanges}`);
    console.log(`   New sub-items to add:   ${totalNewSubItems}`);

    // 6. Apply changes (if --apply)
    if (DRY_RUN) {
      console.log(`\n[DONE] Dry run complete. No data was written.\n`);
      console.log(`       Re-run with --apply to execute the changes.\n`);
    } else {
      console.log(`\n[APPLY] Executing ${allUpdates.length} updates and ${allSubItemInserts.length} inserts...`);

      // Apply updates in batches of 50 with extended timeout for Neon
      const BATCH_SIZE = 50;
      const TX_TIMEOUT = 30000; // 30s — Neon cold starts can be slow

      for (let i = 0; i < allUpdates.length; i += BATCH_SIZE) {
        const batch = allUpdates.slice(i, i + BATCH_SIZE);

        await prisma.$transaction(
          batch.map((u) => {
            const updateData: Record<string, unknown> = { needs_review: true };
            for (const [field, { to }] of Object.entries(u.changes)) {
              updateData[field] = to;
            }
            return prisma.honor_requirements.update({
              where: { requirement_id: u.requirement_id },
              data: updateData as Parameters<typeof prisma.honor_requirements.update>[0]['data'],
            });
          }),
          { timeout: TX_TIMEOUT },
        );

        totalAppliedUpdates += batch.length;
        process.stdout.write(
          `\r   Updates applied: ${totalAppliedUpdates}/${allUpdates.length}`,
        );
      }

      if (allUpdates.length > 0) console.log();

      // Insert new sub-items (idempotent — skips duplicates)
      for (const si of allSubItemInserts) {
        // Use a stable synthetic requirement_number: parent * 1000 + label_index
        const labelOrder = 'abcdefghijklmnopqrstuvwxyz';
        const labelIdx = labelOrder.indexOf(si.label.toLowerCase());

        // For roman numerals (i, ii, iii, iv, v, vi), use 100-based offset
        const romanOrder = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
        const romanIdx = romanOrder.indexOf(si.label.toLowerCase());

        let subOffset: number;
        if (romanIdx >= 0) {
          subOffset = 100 + romanIdx + 1; // i=101, ii=102, etc.
        } else if (labelIdx >= 0) {
          subOffset = labelIdx + 1; // a=1, b=2, etc.
        } else {
          // Fallback: count existing siblings
          const existingCount = await prisma.honor_requirements.count({
            where: { honor_id: si.honor_id, parent_id: si.parent_requirement_id },
          });
          subOffset = existingCount + 1;
        }

        const syntheticNumber = si.parent_requirement_number * 1000 + subOffset;

        // Upsert: skip if already exists with this (honor_id, requirement_number)
        const existing = await prisma.honor_requirements.findFirst({
          where: {
            honor_id: si.honor_id,
            requirement_number: syntheticNumber,
          },
        });

        if (!existing) {
          await prisma.honor_requirements.create({
            data: {
              honor_id: si.honor_id,
              parent_id: si.parent_requirement_id,
              requirement_number: syntheticNumber,
              display_label: si.label,
              requirement_text: si.text,
              reference_text: si.reference_text,
              has_sub_items: false,
              is_choice_group: false,
              choice_min: null,
              requires_evidence: si.requires_evidence,
              needs_review: true,
            },
          });
          totalAppliedInserts++;
        } else {
          totalSkippedInserts++;
        }

        process.stdout.write(
          `\r   Inserts: ${totalAppliedInserts} new, ${totalSkippedInserts} skipped / ${allSubItemInserts.length} total`,
        );
      }

      if (allSubItemInserts.length > 0) console.log();

      console.log(`\n--- Apply Results ---`);
      console.log(`   Requirements updated: ${totalAppliedUpdates}`);
      console.log(`   Sub-items inserted:   ${totalAppliedInserts}`);
      console.log(`\n[DONE] Re-scan complete.\n`);
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
