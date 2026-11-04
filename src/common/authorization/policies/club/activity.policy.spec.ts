import { ErrorCode } from '../../../errors/error-codes';
import type { PolicyContext } from '../resource-policy';
import { InstanceScopeValidator } from '../scope/instance-scope';
import { ActivityPolicy } from './activity.policy';

const section = { club_section_id: 5, main_club_id: 10, club_type_id: 2 };
const single = {
  is_joint: false,
  club_section_id: 5,
  club_sections: section,
  activity_instances: [],
};
const joint = {
  is_joint: true,
  club_section_id: 5,
  club_sections: section,
  activity_instances: [{ club_section_id: 5 }, { club_section_id: 6 }],
};

describe('ActivityPolicy', () => {
  const build = (found: unknown, canManage: boolean) => {
    const prisma = {
      activities: { findUnique: jest.fn().mockResolvedValue(found) },
    } as any;
    const authorizationContext = {
      canManageClub: jest.fn().mockResolvedValue(canManage),
    } as any;
    return new ActivityPolicy(
      prisma,
      new InstanceScopeValidator(prisma, authorizationContext),
    );
  };
  const ctx = (activeSectionId?: number): PolicyContext => ({
    userId: 'user-1',
    request: { params: { activityId: '7' } },
    resolved: {
      authorization: {
        effective: {
          scope: {
            club: activeSectionId
              ? {
                  club: { club_id: 10 },
                  section: { club_section_id: activeSectionId },
                }
              : null,
          },
        },
      },
    } as any,
    requirement: { permissions: ['x:y'], mode: 'all' },
    resource: { type: 'activity' },
  });

  it('handles the activity resource type', () => {
    expect(build(single, true).type).toBe('activity');
  });

  it('throws 404 when the activity does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      code: ErrorCode.ACTIVITY_NOT_FOUND,
    });
  });

  it('allows when the actor can manage the club', async () => {
    await expect(build(single, true).resolve(ctx())).resolves.toBe(true);
  });

  it('denies with GUARD_CLUB_SCOPE_REQUIRED otherwise', async () => {
    await expect(build(single, false).resolve(ctx())).rejects.toMatchObject({
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });

  it('joint: allows a participating active section', async () => {
    await expect(build(joint, false).resolve(ctx(6))).resolves.toBe(true);
  });

  it('joint: denies a non-participating active section', async () => {
    await expect(build(joint, false).resolve(ctx(9))).rejects.toMatchObject({
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });
});
