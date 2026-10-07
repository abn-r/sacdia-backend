const SPANISH_MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

const MAX_PART_LENGTH = 60;

export function slugMonthlyReportNamePart(
  value: string | null | undefined,
  fallback: string,
): string {
  const normalized = (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const trimmed = normalized.slice(0, MAX_PART_LENGTH).replace(/-+$/g, '');

  return trimmed || fallback;
}

const QUARTER_LABELS = [
  '1er-trimestre',
  '2do-trimestre',
  '3er-trimestre',
  '4to-trimestre',
] as const;

export function slugClubTypeList(
  types: Array<string | null | undefined> | null | undefined,
): string {
  const slugs = [
    ...new Set(
      (types ?? [])
        .map((type) => slugMonthlyReportNamePart(type, ''))
        .filter((type) => type.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right, 'es'));
  const joined = slugs.join('-').slice(0, 80).replace(/-+$/g, '');

  return joined || 'sin-tipo';
}

export function buildMonthlyReportDownloadFilename(input: {
  clubName?: string | null;
  clubType?: string | null;
  month: number;
  year: number;
}): string {
  const club = slugMonthlyReportNamePart(input.clubName, 'sin-club');
  const type = slugMonthlyReportNamePart(input.clubType, 'sin-tipo');
  const monthName =
    SPANISH_MONTHS[input.month - 1] ?? String(input.month).padStart(2, '0');
  const year = Number.isInteger(input.year) ? String(input.year) : 'sin-anio';

  return `informe-mensual-${club}-${type}-${monthName}-${year}.pdf`;
}

export function buildQuarterlyReportDownloadFilename(input: {
  clubName?: string | null;
  clubTypes?: Array<string | null | undefined> | null;
  quarter: number;
  year: number;
}): string {
  const club = slugMonthlyReportNamePart(input.clubName, 'sin-club');
  const type = slugClubTypeList(input.clubTypes);
  const quarter =
    QUARTER_LABELS[input.quarter - 1] ?? `t${String(input.quarter)}`;
  const year = Number.isInteger(input.year) ? String(input.year) : 'sin-anio';

  return `informe-trimestral-${club}-${type}-${quarter}-${year}.pdf`;
}

export function buildAnnualReportDownloadFilename(input: {
  clubName?: string | null;
  clubTypes?: Array<string | null | undefined> | null;
  yearLabel?: string | null;
}): string {
  const club = slugMonthlyReportNamePart(input.clubName, 'sin-club');
  const type = slugClubTypeList(input.clubTypes);
  const period = slugMonthlyReportNamePart(input.yearLabel, 'sin-anio');

  return `informe-anual-${club}-${type}-${period}.pdf`;
}

export function monthlyReportContentDisposition(filename: string): string {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
