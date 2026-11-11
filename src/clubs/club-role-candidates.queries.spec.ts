import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { assertServiceRoleAssignable } from './club-role-candidates.queries';

const USER = '11111111-1111-4111-8111-111111111111';

function makeDb(opts: {
  sectionType?: string;
  gmMemberRows?: unknown[];
  heldCount?: number;
  hasGmSection?: boolean;
}) {
  return {
    club_sections: {
      findUnique: jest.fn().mockResolvedValue({
        main_club_id: 10,
        club_types: { name: opts.sectionType ?? 'Aventureros' },
      }),
      findMany: jest
        .fn()
        .mockResolvedValue(
          opts.hasGmSection === false
            ? []
            : [{ club_section_id: 90, club_types: { name: 'Guías Mayores' } }],
        ),
    },
    club_role_assignments: {
      findMany: jest.fn().mockResolvedValue(opts.gmMemberRows ?? []),
      count: jest.fn().mockResolvedValue(opts.heldCount ?? 0),
    },
  };
}

const params = {
  userId: USER,
  roleName: 'counselor',
  clubSectionId: 163,
  assignmentYearId: 4,
  currentYearId: 4,
};

const enrolled = [
  { user_id: USER, ecclesiastical_year_id: 4, status: 'active' },
];

describe('assertServiceRoleAssignable', () => {
  it('skips roles that are not service roles', async () => {
    const db = makeDb({});
    await expect(
      assertServiceRoleAssignable(db as never, {
        ...params,
        roleName: 'member',
      }),
    ).resolves.toBeUndefined();
    expect(db.club_sections.findUnique).not.toHaveBeenCalled();
  });

  it('D1: rejects an AV/CQ service role without an active/pending GM member row this year', async () => {
    const db = makeDb({ gmMemberRows: [] });
    await expect(
      assertServiceRoleAssignable(db as never, params),
    ).rejects.toMatchObject({
      code: ErrorCode.CLUB_ROLE_GM_MEMBERSHIP_REQUIRED,
    });
    const where = db.club_role_assignments.findMany.mock.calls[0][0].where;
    expect(where.club_section_id).toBe(90);
    expect(where.ecclesiastical_year_id).toEqual({ in: [4] });
    expect(where.status).toEqual({ in: ['active', 'pending'] });
    expect(where.user_id).toEqual({ in: [USER] });
  });

  it('D1: rejects when the club has no GM section', async () => {
    const db = makeDb({ hasGmSection: false });
    await expect(
      assertServiceRoleAssignable(db as never, params),
    ).rejects.toBeInstanceOf(AppConflictException);
  });

  it('D4: rejects a second service role (or the same one) in the same section and year', async () => {
    const db = makeDb({ gmMemberRows: enrolled, heldCount: 1 });
    await expect(
      assertServiceRoleAssignable(db as never, params),
    ).rejects.toMatchObject({ code: ErrorCode.CLUB_ROLE_ALREADY_HELD });
    const where = db.club_role_assignments.count.mock.calls[0][0].where;
    expect(where).toMatchObject({
      user_id: USER,
      club_section_id: 163,
      ecclesiastical_year_id: 4,
      active: true,
      status: 'active',
    });
  });

  it('accepts an enrolled person with no role in the section', async () => {
    const db = makeDb({ gmMemberRows: enrolled, heldCount: 0 });
    await expect(
      assertServiceRoleAssignable(db as never, params),
    ).resolves.toBeUndefined();
  });

  it('does not require GM membership in a GM section (only duplicates apply)', async () => {
    const db = makeDb({ sectionType: 'Guías Mayores', heldCount: 0 });
    await expect(
      assertServiceRoleAssignable(db as never, params),
    ).resolves.toBeUndefined();
    expect(db.club_role_assignments.findMany).not.toHaveBeenCalled();
  });
});
