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
