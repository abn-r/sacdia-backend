import { AppForbiddenException } from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import type {
  AuthorizationContextService,
  ResolvedAuthorizationProfile,
} from '../../../services/authorization-context.service';

export async function assertClubAccess(
  authorizationContext: AuthorizationContextService,
  userId: string,
  resolved: ResolvedAuthorizationProfile,
  clubId: number,
): Promise<void> {
  // Checked first because it needs no DB: a member of the club passes
  // without the territorial hierarchy lookup inside canManageClub.
  const activeClubScope = resolved.authorization.effective.scope.club;
  if (activeClubScope && activeClubScope.club.club_id === clubId) {
    return;
  }

  if (await authorizationContext.canManageClub(userId, clubId, resolved)) {
    return;
  }

  throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
}
