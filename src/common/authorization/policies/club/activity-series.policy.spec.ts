import { ErrorCode } from '../../../errors/error-codes';
import type { PolicyContext } from '../resource-policy';
import { InstanceScopeValidator } from '../scope/instance-scope';
import { ActivitySeriesPolicy } from './activity-series.policy';

const section = { club_section_id: 5, main_club_id: 10, club_type_id: 2 };
const single = {
  is_joint: false,
  club_id: 10,
  club_section_id: 5,
  club_sections: section,
  activity_series_sections: [{ club_section_id: 5 }],
};
const joint = {
  ...single,
  is_joint: true,
  activity_series_sections: [{ club_section_id: 5 }, { club_section_id: 6 }],
};

describe('ActivitySeriesPolicy', () => {
  const build = (found: unknown, canManage: boolean) => {
    const prisma = {
      activity_series: { findUnique: jest.fn().mockResolvedValue(found) },
    } as any;
    const authorizationContext = {
      canManageClub: jest.fn().mockResolvedValue(canManage),
    } as any;
    return new ActivitySeriesPolicy(
      prisma,
      new InstanceScopeValidator(prisma, authorizationContext),
    );
  };
  const ctx = (activeSectionId?: number): PolicyContext => ({
    userId: 'user-1',
    request: { params: { seriesId: '4' } },
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
    resource: { type: 'activity_series' },
  });

  it('handles the activity_series resource type', () => {
    expect(build(single, true).type).toBe('activity_series');
  });

  it('throws 404 when the series does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      code: ErrorCode.ACTIVITY_SERIES_NOT_FOUND,
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
