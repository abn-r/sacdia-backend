import { ClubEnrollmentReviewService } from './club-enrollment-review.service';
import { CLUB_ENROLLMENT_REVIEW_PERMISSION } from './club-enrollments.constants';
import { ReviewerScopeService } from '../common/authorization/reviewer-scope.service';
import { ErrorCode } from '../common/errors/error-codes';
import { actorProfile } from '../common/testing/actor-scope.fixture';
import {
  sectionMatches,
  type TestClubSection,
} from '../common/testing/territory-where.testing';

/**
 * B8 (union-division-app-surface): club enrollment review (function 1). An
 * out-of-territory enrollment is invisible in the queue and answers 404 on
 * approve/reject (S2.3); a client `local_field_id` filter can only narrow.
 *
 * Real code under test: ClubEnrollmentReviewService + ReviewerScopeService.
 * Doubles: Prisma, authorization profile, coordination, year catalog.
 * `club_sections.count` evaluates the REAL where-clause against a section
 * table.
 *
 * Enforcing code:
 * - channels per role: common/authorization/reviewer-scope.service.ts:97-121
 *   (Union at :98-108, Division at :110-120)
 * - queue where: club-enrollments/club-enrollment-review.service.ts:380-387
 * - decision gate (404): club-enrollments/club-enrollment-review.service.ts:216-223
 */

const SECTIONS: Record<number, TestClubSection> = {
  1001: {
    club_section_id: 1001,
    club: { local_field_id: 71, union_id: 3, division_id: 1 },
  },
  1002: {
    club_section_id: 1002,
    club: { local_field_id: 72, union_id: 4, division_id: 1 },
  },
  1003: {
    club_section_id: 1003,
    club: { local_field_id: 73, union_id: 5, division_id: 2 },
  },
};

const PERMS = [CLUB_ENROLLMENT_REVIEW_PERMISSION];

const unionActor = () =>
  actorProfile({
    userId: 'union-1',
    globalRoles: [{ roleName: 'director-union', permissions: PERMS }],
    territory: { union: { id: 3 }, division: { id: 1 } },
  });
const divisionActor = () =>
  actorProfile({
    userId: 'division-1',
    globalRoles: [{ roleName: 'assistant-dia', permissions: PERMS }],
    territory: { division: { id: 1 } },
  });
const unconfiguredUnionActor = () =>
  actorProfile({
    userId: 'union-2',
    globalRoles: [{ roleName: 'director-union', permissions: PERMS }],
    territory: {},
  });

describe('ClubEnrollmentReviewService territory coverage (union-division-app-surface B8)', () => {
  let profile: ReturnType<typeof actorProfile>;
  let prisma: any;
  let service: ClubEnrollmentReviewService;

  beforeEach(() => {
    profile = unionActor();
    prisma = {
      club_sections: {
        count: jest.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            const clauses = (where.AND as Record<string, unknown>[]) ?? [];
            const target = clauses.find((c) => 'club_section_id' in c) as {
              club_section_id: number;
            };
            const section = SECTIONS[target.club_section_id];
            return section && sectionMatches(where, section) ? 1 : 0;
          },
        ),
      },
      club_role_assignments: { count: jest.fn().mockResolvedValue(0) },
      club_enrollments: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
    };
    const authorizationContext = {
      resolveUserAuthorization: jest.fn(async () => profile),
    };
    const reviewerScope = new ReviewerScopeService(
      prisma,
      authorizationContext as never,
      {
        getEffectiveCoordinatorSectionIds: jest.fn().mockResolvedValue([]),
      } as never,
      { getCurrentYear: jest.fn().mockResolvedValue({ year_id: 7 }) } as never,
    );
    service = new ClubEnrollmentReviewService(
      prisma,
      reviewerScope,
      {
        getCurrentEcclesiasticalYear: jest
          .fn()
          .mockResolvedValue({ ecclesiastical_year_id: 7 }),
      } as never,
      {} as never,
      {} as never,
      { notifySafe: jest.fn() } as never,
      { now: () => new Date('2026-06-01T12:00:00Z') },
    );
  });

  /** Sections whose enrollments the queue where-clause lets through. */
  const visibleSectionIds = () => {
    const where = prisma.club_enrollments.findMany.mock.calls.at(-1)[0]
      .where as { AND: Array<{ AND: Array<Record<string, unknown>> }> };
    const items = where.AND[0].AND;
    return Object.values(SECTIONS)
      .filter((section) =>
        items.every((item) =>
          'club_section' in item
            ? sectionMatches(
                item.club_section as Record<string, unknown>,
                section,
              )
            : true,
        ),
      )
      .map((section) => section.club_section_id)
      .sort();
  };

  describe('queue (S2.1, S2.2, S2.3)', () => {
    it('Union 3 sees only the sections of union 3', async () => {
      await service.findQueue('union-1', {});

      expect(visibleSectionIds()).toEqual([1001]);
    });

    it('Division 1 sees every union of its division and none of division 2', async () => {
      profile = divisionActor();

      await service.findQueue('division-1', {});

      expect(visibleSectionIds()).toEqual([1001, 1002]);
    });

    it('a client local_field_id of another union narrows to nothing, never widens', async () => {
      await service.findQueue('union-1', { local_field_id: 73 });

      expect(visibleSectionIds()).toEqual([]);
    });

    it('a client local_field_id inside the territory narrows to that field', async () => {
      profile = divisionActor();

      await service.findQueue('division-1', { local_field_id: 72 });

      expect(visibleSectionIds()).toEqual([1002]);
    });

    it('the per-status counts query uses the same territorial base (no cross-territory counts)', async () => {
      await service.findQueue('union-1', {});

      const groupWhere = prisma.club_enrollments.groupBy.mock.calls[0][0]
        .where as { AND: Array<Record<string, unknown>> };
      const scoped = groupWhere.AND.find((c) => 'club_section' in c)!
        .club_section as Record<string, unknown>;
      expect(sectionMatches(scoped, SECTIONS[1001])).toBe(true);
      expect(sectionMatches(scoped, SECTIONS[1002])).toBe(false);
    });
  });

  describe('decisions (S2.3)', () => {
    const enrollmentIn = (sectionId: number) => ({
      club_enrollment_id: 'e-1',
      club_section_id: sectionId,
      ecclesiastical_year_id: 7,
      // Not pending: a request that passes the scope gate stops with 409.
      status: 'rejected',
      director_id: null,
      created_by: 'creator-1',
      club_section: { main_club_id: 1 },
    });

    it.each([
      ['approve', 1002],
      ['reject', 1003],
    ] as const)(
      'Union 3: %s of an enrollment in section %s answers 404 and changes nothing',
      async (action, sectionId) => {
        prisma.club_enrollments.findUnique.mockResolvedValue(
          enrollmentIn(sectionId),
        );

        const run =
          action === 'approve'
            ? service.approve('union-1', 'e-1')
            : service.reject('union-1', 'e-1', { reason: 'x' });

        await expect(run).rejects.toMatchObject({
          status: 404,
          code: ErrorCode.CE_ENROLLMENT_NOT_FOUND,
        });
        expect(prisma.club_role_assignments.count).not.toHaveBeenCalled();
      },
    );

    it('Union 3 passes the scope gate for its own section (stops later with 409, not 404)', async () => {
      prisma.club_enrollments.findUnique.mockResolvedValue(enrollmentIn(1001));

      await expect(service.approve('union-1', 'e-1')).rejects.toMatchObject({
        code: ErrorCode.CE_ENROLLMENT_NOT_PENDING,
      });
    });

    it('Division 1 passes for section 1002 (other union, same division) and is rejected for 1003', async () => {
      profile = divisionActor();

      prisma.club_enrollments.findUnique.mockResolvedValue(enrollmentIn(1002));
      await expect(service.approve('division-1', 'e-1')).rejects.toMatchObject({
        code: ErrorCode.CE_ENROLLMENT_NOT_PENDING,
      });

      prisma.club_enrollments.findUnique.mockResolvedValue(enrollmentIn(1003));
      await expect(service.approve('division-1', 'e-1')).rejects.toMatchObject({
        status: 404,
        code: ErrorCode.CE_ENROLLMENT_NOT_FOUND,
      });
    });
  });

  describe('unconfigured territory (fail closed)', () => {
    // NOTE: the 403 ADMIN_USER_SCOPE_MISSING expectation of R1.5 does NOT hold
    // for this service (the Union role without a union id yields NO channel,
    // reviewer-scope.service.ts:98-108, so the result is empty / 404). That
    // gap is reported separately; these tests only prove nothing leaks.
    beforeEach(() => {
      profile = unconfiguredUnionActor();
    });

    it('the queue matches no section at all', async () => {
      await service.findQueue('union-2', {});

      expect(visibleSectionIds()).toEqual([]);
    });

    it('a decision on any section answers 404', async () => {
      prisma.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: 'e-1',
        club_section_id: 1001,
        ecclesiastical_year_id: 7,
        status: 'pending_validation',
        director_id: null,
        created_by: 'creator-1',
        club_section: { main_club_id: 1 },
      });

      await expect(service.approve('union-2', 'e-1')).rejects.toMatchObject({
        status: 404,
        code: ErrorCode.CE_ENROLLMENT_NOT_FOUND,
      });
    });
  });
});
