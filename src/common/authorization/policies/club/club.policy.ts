import type { AuthorizationContextService } from '../../../services/authorization-context.service';
import { getRequestValue, getRequiredNumericValue } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import { assertClubAccess } from '../scope/club-access';

export class ClubPolicy implements ResourcePolicy<'club'> {
  readonly type = 'club' as const;

  constructor(
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  async resolve({
    userId,
    request,
    resolved,
    resource,
  }: PolicyContext): Promise<boolean> {
    const clubId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.clubIdParam ?? 'clubId'),
      'Club ID not found in request',
    );

    await assertClubAccess(this.authorizationContext, userId, resolved, clubId);
    return true;
  }
}
