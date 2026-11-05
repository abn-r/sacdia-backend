import { isTargetUserInActorScope } from './target-user-scope';

const TARGET = '11111111-1111-4111-8111-111111111123';

const resolvedFor = (
  roles: string[],
  global: Record<string, { id: number }> = {},
  rolePermissions: string[] = ['users:read_detail'],
) =>
  ({
    authorization: {
      grants: {
        global_roles: roles.map((role_name) => ({
          role_name,
          permissions: rolePermissions,
        })),
        club_assignments: [],
      },
      active_assignment: { assignment_id: null },
      effective: { permissions: rolePermissions, scope: { global } },
    },
  }) as any;

describe('isTargetUserInActorScope', () => {
  const prisma = {
    users: { count: jest.fn() },
    club_role_assignments: { findMany: jest.fn() },
    coordinator_assignments: { findFirst: jest.fn(), findMany: jest.fn() },
    club_sections: { findFirst: jest.fn(), findMany: jest.fn() },
    coordination_zone_districts: { findMany: jest.fn() },
  };
  const memberScope = {
    effectiveAssignmentForScope: jest.fn().mockResolvedValue({
      active: true,
    }),
  };
  const check = (resolved: any) =>
    isTargetUserInActorScope(
      { prisma: prisma as any, memberScope },
      'actor-1',
      resolved,
      TARGET,
    );

  beforeEach(() => jest.clearAllMocks());

  it('lets super-admin act on anyone without a query', async () => {
    await expect(check(resolvedFor(['super-admin']))).resolves.toBe(true);
    expect(prisma.users.count).not.toHaveBeenCalled();
  });

  it('checks the target against the local field of local field leadership', async () => {
    prisma.users.count.mockResolvedValue(1);
    await expect(
      check(resolvedFor(['director-lf'], { local_field: { id: 4 } })),
    ).resolves.toBe(true);
    expect(memberScope.effectiveAssignmentForScope).toHaveBeenCalledWith({
      level: 'local_field',
      localFieldId: 4,
    });
    const where = prisma.users.count.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ user_id: TARGET });
  });

  it('denies a target outside the territory', async () => {
    prisma.users.count.mockResolvedValue(0);
    await expect(
      check(resolvedFor(['director-union'], { union: { id: 20 } })),
    ).resolves.toBe(false);
  });

  it('denies a territorial role without territory', async () => {
    await expect(check(resolvedFor(['director-lf']))).resolves.toBe(false);
    expect(prisma.users.count).not.toHaveBeenCalled();
  });

  it('keeps a pastor to the local field of their global scope', async () => {
    prisma.users.count.mockResolvedValue(1);
    await expect(
      check(resolvedFor(['pastor'], { local_field: { id: 4 } })),
    ).resolves.toBe(true);
    expect(memberScope.effectiveAssignmentForScope).toHaveBeenCalledWith({
      level: 'local_field',
      localFieldId: 4,
    });
  });

  it('lets a coordinator act only on members of a covered section', async () => {
    prisma.club_role_assignments.findMany.mockResolvedValue([
      { club_section_id: 7 },
    ]);
    prisma.club_sections.findFirst.mockResolvedValue(null);

    await expect(check(resolvedFor(['coordinator']))).resolves.toBe(false);
    expect(prisma.club_role_assignments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: TARGET }),
      }),
    );
  });

  it('denies a coordinator when the target has no section', async () => {
    prisma.club_role_assignments.findMany.mockResolvedValue([]);
    await expect(check(resolvedFor(['zone-coordinator']))).resolves.toBe(false);
  });
  describe('edge cases', () => {
    it.each(['admin', 'assistant-admin'])(
      'treats %s as one admin scope: union first',
      async (role) => {
        prisma.users.count.mockResolvedValue(1);
        await expect(
          check(
            resolvedFor([role], {
              union: { id: 20 },
              local_field: { id: 4 },
              division: { id: 2 },
            }),
          ),
        ).resolves.toBe(true);
        expect(memberScope.effectiveAssignmentForScope).toHaveBeenCalledWith(
          expect.objectContaining({ level: 'union', unionId: 20 }),
        );
      },
    );

    it.each(['admin', 'assistant-admin'])(
      'denies %s without any territory configured',
      async (role) => {
        await expect(check(resolvedFor([role]))).resolves.toBe(false);
        expect(prisma.users.count).not.toHaveBeenCalled();
      },
    );

    it('denies a pastor without a global local field', async () => {
      await expect(check(resolvedFor(['pastor']))).resolves.toBe(false);
      expect(prisma.users.count).not.toHaveBeenCalled();
    });

    it('reads a pastor local field given as numeric string and padded role', async () => {
      prisma.users.count.mockResolvedValue(1);
      await expect(
        check(resolvedFor([' Pastor '], { local_field: { id: '4' as any } })),
      ).resolves.toBe(true);
      expect(memberScope.effectiveAssignmentForScope).toHaveBeenCalledWith({
        level: 'local_field',
        localFieldId: 4,
      });
    });

    it('ignores a pastor local field that is not a positive id', async () => {
      await expect(
        check(resolvedFor(['pastor'], { local_field: { id: 0 } })),
      ).resolves.toBe(false);
    });

    it('does not treat a coordinator role without permissions as coordinator', async () => {
      await expect(check(resolvedFor(['coordinator'], {}, []))).resolves.toBe(
        false,
      );
      expect(prisma.club_role_assignments.findMany).not.toHaveBeenCalled();
    });

    it('gives no territory to an actor with only club roles', async () => {
      const resolved = resolvedFor([]);
      resolved.authorization.grants.club_assignments = [
        { assignment_id: 'a1', role_name: 'director' },
      ];
      await expect(check(resolved)).resolves.toBe(false);
      expect(prisma.users.count).not.toHaveBeenCalled();
    });

    it('lets super-admin win over any other global role', async () => {
      await expect(
        check(resolvedFor(['director-lf', 'super-admin', 'coordinator'])),
      ).resolves.toBe(true);
      expect(prisma.users.count).not.toHaveBeenCalled();
    });

    it('falls through to the coordinator path when territory misses', async () => {
      prisma.users.count.mockResolvedValue(0);
      prisma.club_role_assignments.findMany.mockResolvedValue([]);
      await expect(
        check(
          resolvedFor(['director-lf', 'coordinator'], {
            local_field: { id: 4 },
          }),
        ),
      ).resolves.toBe(false);
      expect(prisma.users.count).toHaveBeenCalled();
      expect(prisma.club_role_assignments.findMany).toHaveBeenCalled();
    });
  });
});
