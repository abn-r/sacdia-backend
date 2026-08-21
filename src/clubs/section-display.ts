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

/**
 * JA cycle rank used to pick the member's identity club type.
 * Guías Mayores (2) > Conquistadores (1) > Aventureros (0).
 * Unknown names return -1.
 */
export function clubTypeCycleRank(
  clubTypeName: string | null | undefined,
): number {
  const normalized = clubTypeName?.trim().toLowerCase() ?? '';
  if (
    normalized.includes('guia') ||
    normalized.includes('guía') ||
    normalized.includes('master guide')
  ) {
    return 2;
  }
  if (
    normalized.includes('conquistador') ||
    normalized.includes('pathfinder')
  ) {
    return 1;
  }
  if (
    normalized.includes('aventurer') ||
    normalized.includes('adventurer')
  ) {
    return 0;
  }
  return -1;
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
