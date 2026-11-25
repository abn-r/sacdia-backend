/**
 * Minimal evaluator for the Prisma `where` shapes the territorial scope
 * builders emit (`clubsWhereForActor`, `clubSectionScopeWhere`,
 * `ReviewerScopeService.sectionsWhere`). It lets a spec assert that a REAL
 * where-clause accepts or rejects a concrete club section, instead of echoing
 * the expected clause back.
 *
 * Supported: AND / OR, `club_section_id` (number or `{ in }`), `clubs` /
 * `clubs.is`, `local_field_id`, `local_fields.union_id`,
 * `local_fields.unions.division_id`. Anything else throws so an unsupported
 * shape never passes silently.
 */
export type TestClubSection = {
  club_section_id: number;
  club: {
    local_field_id: number;
    union_id: number;
    division_id: number;
  };
};

type Where = Record<string, unknown>;

export function clubMatches(
  where: Where | undefined,
  club: TestClubSection['club'],
): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case 'local_field_id':
        return club.local_field_id === value;
      case 'local_fields': {
        const nested = value as Where;
        return Object.entries(nested).every(([k, v]) => {
          if (k === 'union_id') return club.union_id === v;
          if (k === 'unions') {
            const unions = v as Where;
            return Object.entries(unions).every(([uk, uv]) => {
              if (uk === 'division_id') return club.division_id === uv;
              throw new Error(`Unsupported unions filter: ${uk}`);
            });
          }
          throw new Error(`Unsupported local_fields filter: ${k}`);
        });
      }
      case 'AND':
        return (value as Where[]).every((w) => clubMatches(w, club));
      case 'OR':
        return (value as Where[]).some((w) => clubMatches(w, club));
      default:
        throw new Error(`Unsupported clubs filter: ${key}`);
    }
  });
}

export function sectionMatches(
  where: Where | undefined,
  section: TestClubSection,
): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case 'club_section_id': {
        if (typeof value === 'number') return section.club_section_id === value;
        const list = (value as { in: number[] }).in;
        return list.includes(section.club_section_id);
      }
      case 'clubs': {
        const clubsWhere = (value as { is?: Where }).is ?? (value as Where);
        return clubMatches(clubsWhere, section.club);
      }
      case 'AND':
        return (value as Where[]).every((w) => sectionMatches(w, section));
      case 'OR':
        return (value as Where[]).some((w) => sectionMatches(w, section));
      default:
        throw new Error(`Unsupported club_sections filter: ${key}`);
    }
  });
}
