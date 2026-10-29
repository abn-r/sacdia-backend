/**
 * Club roles listed as the "directiva" in monthly, quarterly and annual
 * reports, in display order. Names match `roles.role_name`.
 */
export const CLUB_DIRECTIVA_ROLES = [
  'director',
  'deputy-director',
  'secretary',
  'secretary-treasurer',
  'treasurer',
] as const;

/** Sort key for a directiva role; unknown roles go last. */
export function directivaRoleOrder(role: string): number {
  const index = (CLUB_DIRECTIVA_ROLES as readonly string[]).indexOf(role);
  return index === -1 ? CLUB_DIRECTIVA_ROLES.length : index;
}

/** Spanish labels for the directiva roles, as the admin panel shows them. */
export const CLUB_DIRECTIVA_ROLE_LABELS_ES: Record<string, string> = {
  director: 'Director',
  'deputy-director': 'Subdirector',
  secretary: 'Secretario',
  'secretary-treasurer': 'Secretario tesorero',
  treasurer: 'Tesorero',
};

/** Label for a directiva role; unknown roles fall back to the raw slug. */
export function directivaRoleLabel(role: string): string {
  return CLUB_DIRECTIVA_ROLE_LABELS_ES[role] ?? role;
}
