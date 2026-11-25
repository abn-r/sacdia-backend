import { RequestsService } from './requests.service';
import { ActorSectionScopeService } from '../coordination/actor-section-scope.service';
import { ErrorCode } from '../common/errors/error-codes';
import {
  actorProfile,
  TERRITORIAL_PERMISSIONS,
} from '../common/testing/actor-scope.fixture';
import {
  sectionMatches,
  type TestClubSection,
} from '../common/testing/territory-where.testing';

/**
 * B8 (union-division-app-surface): transfers / role-assignment requests reject
 * out-of-territory targets for a club-less Union or Division supervisor
 * (S5.3) and fail closed when the territory is unconfigured (R1.5).
 *
 * Real code under test: RequestsService + ActorSectionScopeService +
 * buildActorSectionScope + clubsWhereForActor. Doubles: Prisma, the
 * authorization profile source and coordination. `club_sections.count` is
 * answered by evaluating the REAL where-clause against a fixed section table,
 * so a wrong clause shows up as a wrong answer.
 *
 * Enforcing code:
 * - scope build: common/authorization/actor-section-scope.ts:95-123
 *   (unconfigured -> ADMIN_USER_SCOPE_MISSING at :107-109)
 * - transfer review/read: requests/requests.service.ts:253-262 (review),
 *   :445-476 (list), :546-548 (by id)
 * - assignment review/read: requests/requests.service.ts:812-821 (review),
 *   :1020-1035 (list), :1114-1124 (by id)
 */

// Division 1 = unions 3 and 4. Division 2 = union 5.
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

const unionActor = () =>
  actorProfile({
    userId: 'union-1',
    globalRoles: [
      { roleName: 'director-union', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: { union: { id: 3 }, division: { id: 1 } },
  });
const divisionActor = () =>
  actorProfile({
    userId: 'division-1',
    globalRoles: [
      { roleName: 'director-dia', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: { division: { id: 1 } },
  });
const unconfiguredUnionActor = () =>
  actorProfile({
    userId: 'union-2',
    globalRoles: [
      { roleName: 'assistant-union', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: {},
  });

describe('RequestsService territory coverage (union-division-app-surface B8)', () => {
  let profile: ReturnType<typeof actorProfile>;
  let prisma: any;
  let service: RequestsService;

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
      club_transfer_requests: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      role_assignment_requests: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const authorizationContext = {
      resolveUserAuthorization: jest.fn(async () => profile),
    };
    const coordination = {
      getEffectiveCoordinatorSectionIds: jest.fn().mockResolvedValue([]),
    };
    const actorSectionScope = new ActorSectionScopeService(
      prisma,
      authorizationContext as never,
      coordination as never,
    );
    service = new RequestsService(
      prisma,
      { notifySafe: jest.fn() } as never,
      authorizationContext as never,
      {} as never,
      actorSectionScope,
    );
  });

  // A request already reviewed passes the scope gate and then stops with 409.
  // That distinguishes "scope accepted" from "scope rejected" (404) without
  // running the approval transaction.
  const transferRow = (toSectionId: number) => ({
    transfer_request_id: 'tr-1',
    user_id: 'member-9',
    from_section_id: 1001,
    to_section_id: toSectionId,
    status: 'approved',
    user: { user_id: 'member-9', name: 'M' },
  });
  const assignmentRow = (sectionId: number) => ({
    request_id: 'ar-1',
    user_id: 'member-9',
    requested_by: 'member-8',
    club_section_id: sectionId,
    status: 'approved',
  });

  describe('transfer review (S5.1, S5.2, S5.3)', () => {
    it.each([
      ['Union 3', unionActor, 1001, true],
      ['Union 3', unionActor, 1002, false],
      ['Union 3', unionActor, 1003, false],
      ['Division 1', divisionActor, 1001, true],
      ['Division 1', divisionActor, 1002, true],
      ['Division 1', divisionActor, 1003, false],
    ] as const)(
      '%s reviewing a transfer into section %s -> inside=%s',
      async (_label, actor, toSection, inside) => {
        profile = actor();
        prisma.club_transfer_requests.findUnique.mockResolvedValue(
          transferRow(toSection),
        );

        const run = service.reviewTransfer(
          'tr-1',
          profile.profile.user_id,
          'approved',
        );

        if (inside) {
          await expect(run).rejects.toMatchObject({
            code: ErrorCode.REQUEST_TRANSFER_ALREADY_REVIEWED,
          });
        } else {
          await expect(run).rejects.toMatchObject({
            status: 404,
            code: ErrorCode.REQUEST_TRANSFER_NOT_FOUND,
          });
        }
      },
    );
  });

  describe('role-assignment review (S5.1, S5.2, S5.3)', () => {
    it.each([
      ['Union 3', unionActor, 1001, true],
      ['Union 3', unionActor, 1002, false],
      ['Division 1', divisionActor, 1002, true],
      ['Division 1', divisionActor, 1003, false],
    ] as const)(
      '%s reviewing an assignment request in section %s -> inside=%s',
      async (_label, actor, sectionId, inside) => {
        profile = actor();
        prisma.role_assignment_requests.findUnique.mockResolvedValue(
          assignmentRow(sectionId),
        );

        const run = service.reviewAssignment(
          'ar-1',
          profile.profile.user_id,
          'approved',
        );

        if (inside) {
          await expect(run).rejects.toMatchObject({
            code: ErrorCode.REQUEST_ASSIGNMENT_ALREADY_REVIEWED,
          });
        } else {
          await expect(run).rejects.toMatchObject({
            status: 404,
            code: ErrorCode.REQUEST_ASSIGNMENT_NOT_FOUND,
          });
        }
      },
    );
  });

  describe('reads by id', () => {
    it('a Union actor cannot read a transfer between two sections of another union (404)', async () => {
      prisma.club_transfer_requests.findUnique.mockResolvedValue({
        ...transferRow(1002),
        from_section_id: 1002,
      });

      await expect(
        service.getTransferRequest('tr-1', 'union-1'),
      ).rejects.toMatchObject({
        status: 404,
        code: ErrorCode.REQUEST_TRANSFER_NOT_FOUND,
      });
    });

    it('a Division actor reads a transfer inside its division but not one of another division', async () => {
      profile = divisionActor();
      prisma.club_transfer_requests.findUnique.mockResolvedValueOnce({
        ...transferRow(1002),
        from_section_id: 1002,
      });
      await expect(
        service.getTransferRequest('tr-1', 'division-1'),
      ).resolves.toMatchObject({ transfer_request_id: 'tr-1' });

      prisma.club_transfer_requests.findUnique.mockResolvedValueOnce({
        ...transferRow(1003),
        from_section_id: 1003,
      });
      await expect(
        service.getTransferRequest('tr-1', 'division-1'),
      ).rejects.toMatchObject({ code: ErrorCode.REQUEST_TRANSFER_NOT_FOUND });
    });

    it('a Union actor cannot read an assignment request of another union (404)', async () => {
      prisma.role_assignment_requests.findUnique.mockResolvedValue(
        assignmentRow(1002),
      );

      await expect(
        service.getAssignmentRequest('ar-1', 'union-1'),
      ).rejects.toMatchObject({
        status: 404,
        code: ErrorCode.REQUEST_ASSIGNMENT_NOT_FOUND,
      });
    });
  });

  describe('lists: the where-clause is territorial and a client section filter cannot widen it', () => {
    it('transfer list: the visibility clause matches own-union sections only', async () => {
      await service.getTransferRequests({
        userId: 'union-1',
        status: 'pending',
      });

      const where = prisma.club_transfer_requests.findMany.mock.calls[0][0]
        .where as {
        OR: Array<Record<string, unknown>>;
        status: string;
      };
      expect(where.status).toBe('pending');
      const toSection = where.OR.find((c) => 'to_section' in c)!
        .to_section as Record<string, unknown>;
      expect(sectionMatches(toSection, SECTIONS[1001])).toBe(true);
      expect(sectionMatches(toSection, SECTIONS[1002])).toBe(false);
      expect(sectionMatches(toSection, SECTIONS[1003])).toBe(false);
    });

    it('transfer list: a Division actor sees its whole division and nothing else', async () => {
      profile = divisionActor();

      await service.getTransferRequests({ userId: 'division-1' });

      const where = prisma.club_transfer_requests.findMany.mock.calls[0][0]
        .where as { OR: Array<Record<string, unknown>> };
      const fromSection = where.OR.find((c) => 'from_section' in c)!
        .from_section as Record<string, unknown>;
      expect(sectionMatches(fromSection, SECTIONS[1001])).toBe(true);
      expect(sectionMatches(fromSection, SECTIONS[1002])).toBe(true);
      expect(sectionMatches(fromSection, SECTIONS[1003])).toBe(false);
    });

    it('transfer list: asking for a section of another union is rejected, not widened (403)', async () => {
      await expect(
        service.getTransferRequests({ userId: 'union-1', sectionId: 1002 }),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      expect(prisma.club_transfer_requests.findMany).not.toHaveBeenCalled();
    });

    it('assignment list: the visibility clause matches own-union sections only, even with a client section filter', async () => {
      await service.getAssignmentRequests({
        actorId: 'union-1',
        sectionId: 1002,
      });

      const where = prisma.role_assignment_requests.findMany.mock.calls[0][0]
        .where as {
        OR: Array<Record<string, unknown>>;
        club_section_id: number;
      };
      // The client filter is ANDed with visibility: section 1002 is requested
      // but the visibility clause still excludes it, so the result is empty.
      expect(where.club_section_id).toBe(1002);
      const visible = where.OR.find((c) => 'club_section' in c)!
        .club_section as Record<string, unknown>;
      expect(sectionMatches(visible, SECTIONS[1002])).toBe(false);
      expect(sectionMatches(visible, SECTIONS[1001])).toBe(true);
    });
  });

  describe('unconfigured territory (R1.5, S1.7)', () => {
    beforeEach(() => {
      profile = unconfiguredUnionActor();
    });

    it('transfer list answers 403 ADMIN_USER_SCOPE_MISSING', async () => {
      await expect(
        service.getTransferRequests({ userId: 'union-2' }),
      ).rejects.toMatchObject({
        status: 403,
        code: ErrorCode.ADMIN_USER_SCOPE_MISSING,
      });
    });

    it('assignment list answers 403 ADMIN_USER_SCOPE_MISSING', async () => {
      await expect(
        service.getAssignmentRequests({ actorId: 'union-2' }),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });

    it('transfer review answers 403 ADMIN_USER_SCOPE_MISSING', async () => {
      prisma.club_transfer_requests.findUnique.mockResolvedValue(
        transferRow(1001),
      );

      await expect(
        service.reviewTransfer('tr-1', 'union-2', 'approved'),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });

    it('assignment review answers 403 ADMIN_USER_SCOPE_MISSING', async () => {
      prisma.role_assignment_requests.findUnique.mockResolvedValue(
        assignmentRow(1001),
      );

      await expect(
        service.reviewAssignment('ar-1', 'union-2', 'approved'),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });
  });
});
