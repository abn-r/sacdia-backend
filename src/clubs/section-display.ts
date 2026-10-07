/**
 * Canonical labels for club sections.
 *
 * Sections are typed slots of the parent club (Aventureros, Conquistadores,
 * Guías Mayores). They have no own name. Callers must never read a
 * `club_sections.name` column.
 */

export function clubTypeSectionName(
  clubTypeName: string | null | undefined,
): string | null {
  const type = clubTypeName?.trim();
  return type ? type : null;
}

export type ClubTypeIdentity = {
  club_type_id?: number | null;
  name?: string | null;
  label?: string | null;
  slug?: string | null;
  code?: string | null;
};

function normalizeClubTypeToken(value: string | null | undefined): string {
  return (
    value
      ?.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  );
}

/**
 * JA cycle rank used to pick the member's identity club type.
 * Guías Mayores (2) > Conquistadores (1) > Aventureros (0).
 * Unknown names return -1.
 */
export function clubTypeCycleRank(
  clubTypeName: string | null | undefined,
): number {
  const normalized = normalizeClubTypeToken(clubTypeName);
  if (
    normalized.includes('guia') ||
    normalized.includes('master guide') ||
    normalized.includes('master guild')
  ) {
    return 2;
  }
  if (
    normalized.includes('conquistador') ||
    normalized.includes('pathfinder')
  ) {
    return 1;
  }
  if (normalized.includes('aventurer') || normalized.includes('adventurer')) {
    return 0;
  }
  return -1;
}

export type SectionKind = 'AV' | 'CQ' | 'GM' | 'UNKNOWN';

/** Maps a club type name to its JA cycle kind. Unknown names yield UNKNOWN. */
export function clubTypeSectionKind(
  clubTypeName: string | null | undefined,
): SectionKind {
  switch (clubTypeCycleRank(clubTypeName)) {
    case 0:
      return 'AV';
    case 1:
      return 'CQ';
    case 2:
      return 'GM';
    default:
      return 'UNKNOWN';
  }
}

/** True for Aventureros or Conquistadores sections. */
export function isAvCqClubType(
  clubTypeName: string | null | undefined,
): boolean {
  const kind = clubTypeSectionKind(clubTypeName);
  return kind === 'AV' || kind === 'CQ';
}

/**
 * Detects Guías Mayores from catalog name/slug/code.
 * Never key off numeric `club_type_id` — seed ids are not a contract.
 */
export function isMasterGuidesClubType(item: ClubTypeIdentity): boolean {
  return [item.name, item.label, item.slug, item.code].some(
    (token) => clubTypeCycleRank(token) === 2,
  );
}

export function findMasterGuidesClubTypeId(
  items: readonly ClubTypeIdentity[],
): number | null {
  for (const item of items) {
    if (!isMasterGuidesClubType(item)) continue;
    const id = item.club_type_id;
    if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
      return id;
    }
  }
  return null;
}

export function clubSectionDisplayLabel(
  clubName: string | null | undefined,
  clubTypeName: string | null | undefined,
): string {
  const club = clubName?.trim() ?? '';
  const type = clubTypeName?.trim() ?? '';
  if (club && type) {
    return `${club} · ${type}`;
  }
  return club || type;
}
