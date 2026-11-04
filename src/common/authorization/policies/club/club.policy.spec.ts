import { ErrorCode } from '../../../errors/error-codes';
import type { PolicyContext } from '../resource-policy';
import { ClubPolicy } from './club.policy';

describe('ClubPolicy', () => {
  const build = (canManage: boolean) => {
    const authorizationContext = {
      canManageClub: jest.fn().mockResolvedValue(canManage),
    } as any;
    return new ClubPolicy(authorizationContext);
  };
  const ctx = (params: object, activeClubId?: number): PolicyContext => ({
    userId: 'user-1',
    request: { params },
    resolved: {
      authorization: {
        effective: {
          scope: {
            club: activeClubId ? { club: { club_id: activeClubId } } : null,
          },
        },
      },
    } as any,
    requirement: { permissions: ['x:y'], mode: 'all' },
    resource: { type: 'club' },
  });

  it('handles the club resource type', () => {
    expect(build(false).type).toBe('club');
  });

  it('allows a member of the requested club without a hierarchy lookup', async () => {
    await expect(build(false).resolve(ctx({ clubId: '10' }, 10))).resolves.toBe(
      true,
    );
  });

  it('allows when the actor can manage the club', async () => {
    await expect(build(true).resolve(ctx({ clubId: '10' }))).resolves.toBe(
      true,
    );
  });

  it('denies with GUARD_CLUB_SCOPE_REQUIRED otherwise', async () => {
    await expect(
      build(false).resolve(ctx({ clubId: '10' })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  it('denies when the club id is missing', async () => {
    await expect(build(true).resolve(ctx({}))).rejects.toMatchObject({
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });
});
