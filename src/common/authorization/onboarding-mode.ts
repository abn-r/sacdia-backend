import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import { buildCapabilityContext, CAPABILITY_DEFINITIONS } from './capabilities';

/**
 * How a user goes through the post-registration onboarding. Derived on every
 * read, never stored (see `OnboardingModeService`).
 *
 * - `club`: the three steps (photo, personal info, club selection).
 * - `club_exempt`: no club, but the app serves them a club-less surface
 *   (`app.clubless_surface`): two steps.
 * - `panel_only`: a global role other than `user` with no app surface: no
 *   steps; their function lives in the web panel.
 */
export const ONBOARDING_MODES = ['club', 'club_exempt', 'panel_only'] as const;
export type OnboardingMode = (typeof ONBOARDING_MODES)[number];

/**
 * Pure and ordered (first match wins):
 *  1. a visible club assignment -> `club`. "Visible" is every entry of
 *     `grants.club_assignments` (active, pending, inactive, expired); a
 *     `designated` assignment never reaches that array.
 *  2. `app.clubless_surface` -> `club_exempt`.
 *  3. `admin_panel.access` (a global role other than `user`) -> `panel_only`.
 *  4. otherwise -> `club`: a self-registered member with only the `user` role
 *     still has to choose a club, so rule 3 must never see them.
 *
 * Pass the FULLY resolved profile, not the one `stripClubContext` produces:
 * stripping the club context would make teens and accounts of unknown age look
 * club-less.
 */
export function computeOnboardingMode(
  fullyResolved: ResolvedAuthorizationProfile,
): OnboardingMode {
  const clubAssignments =
    (
      fullyResolved.authorization as
        Partial<ResolvedAuthorizationProfile['authorization']> | undefined
    )?.grants?.club_assignments ?? [];
  if (clubAssignments.length > 0) {
    return 'club';
  }

  const ctx = buildCapabilityContext(fullyResolved);
  if (CAPABILITY_DEFINITIONS['app.clubless_surface'](ctx)) {
    return 'club_exempt';
  }
  if (CAPABILITY_DEFINITIONS['admin_panel.access'](ctx)) {
    return 'panel_only';
  }
  return 'club';
}
