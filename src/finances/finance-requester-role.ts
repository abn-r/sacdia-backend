import { ClubRole, GlobalRole } from '../common/authorization/roles';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';

const CLUB_ROLE_LABELS: Record<string, string> = {
  [ClubRole.DIRECTOR]: 'Director(a)',
  [ClubRole.DEPUTY_DIRECTOR]: 'Subdirector(a)',
  [ClubRole.SECRETARY]: 'Secretario(a)',
  [ClubRole.TREASURER]: 'Tesorero(a)',
  [ClubRole.SECRETARY_TREASURER]: 'Secretario(a) tesorero(a)',
  [ClubRole.COUNSELOR]: 'Consejero(a)',
  [ClubRole.INSTRUCTOR]: 'Instructor(a)',
  [ClubRole.MEMBER]: 'Miembro',
};

/** Most to least powerful: the first one the user holds is the one shown. */
const GLOBAL_ROLE_LABELS: ReadonlyArray<readonly [string, string]> = [
  [GlobalRole.SUPER_ADMIN, 'Superadministrador'],
  [GlobalRole.ADMIN, 'Administrador'],
  [GlobalRole.ASSISTANT_ADMIN, 'Asistente de administración'],
  [GlobalRole.DIRECTOR_DIA, 'Director(a) de División'],
  [GlobalRole.ASSISTANT_DIA, 'Asistente de División'],
  [GlobalRole.DIRECTOR_UNION, 'Director(a) de Unión'],
  [GlobalRole.ASSISTANT_UNION, 'Asistente de Unión'],
  [GlobalRole.DIRECTOR_LF, 'Director(a) de Campo local'],
  [GlobalRole.ASSISTANT_LF, 'Asistente de Campo local'],
  [GlobalRole.GENERAL_COORDINATOR, 'Coordinador(a) general'],
  [GlobalRole.ZONE_COORDINATOR, 'Coordinador(a) de zona'],
  [GlobalRole.COORDINATOR, 'Coordinador(a)'],
  [GlobalRole.PASTOR, 'Pastor'],
];

/**
 * Spanish label of the role the requester acts with on this club: the club
 * role of the active assignment when it belongs to the exported club,
 * otherwise their strongest global role, otherwise the club role of any other
 * club. `null` when nothing meaningful applies (the base `user` role).
 */
export function requesterRoleLabel(
  authorization: AuthorizationSnapshot | undefined,
  clubId: number,
): string | null {
  if (!authorization) return null;
  const club = authorization.effective?.scope?.club ?? null;
  if (club && club.club.club_id === clubId) {
    return CLUB_ROLE_LABELS[club.role_name] ?? null;
  }
  const held = new Set(
    (authorization.grants?.global_roles ?? []).map((g) => g.role_name),
  );
  for (const [role, label] of GLOBAL_ROLE_LABELS) {
    if (held.has(role)) return label;
  }
  return club ? (CLUB_ROLE_LABELS[club.role_name] ?? null) : null;
}
