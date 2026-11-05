import { coordinator_assignment_type } from '@prisma/client';
import { CoordinationService } from './coordination.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('CoordinationService', () => {
  const prisma = {
    local_fields: { findUnique: jest.fn() },
    users: { findUnique: jest.fn(), findMany: jest.fn() },
    club_sections: { findUnique: jest.fn(), findMany: jest.fn() },
    club_role_assignments: { findFirst: jest.fn() },
    coordinator_assignments: { create: jest.fn(), findFirst: jest.fn() },
  };

  const authorizationContext = {
    resolveUserAuthorization: jest.fn(),
    canAccessHierarchyScope: jest.fn(),
  };

  const hierarchy = {
    resolveCurrent: jest.fn(),
  };

  const actorWith = (...roles: string[]) => ({
    authorization: {
      grants: {
        global_roles: roles.map((role_name) => ({
          role_name,
          permissions: [],
          scope: {},
        })),
      },
    },
  });

  let service: CoordinationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CoordinationService(
      prisma as any,
      authorizationContext as any,
      hierarchy as any,
    );
  });

  it('rejects an assignment when the user is director of the same club_section', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValue(
      actorWith('director-lf'),
    );
    authorizationContext.canAccessHierarchyScope.mockReturnValue(true);
    hierarchy.resolveCurrent.mockResolvedValue({ local_field_id: 10 });
    prisma.local_fields.findUnique.mockResolvedValue({ local_field_id: 10 });
    prisma.users.findUnique.mockResolvedValue({
      user_id: '11111111-1111-1111-1111-111111111111',
      users_roles: [{ role_id: '22222222-2222-2222-2222-222222222222' }],
    });
    prisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: 99,
      clubs: { local_field_id: 10 },
    });
    prisma.club_sections.findMany.mockResolvedValue([{ club_section_id: 99 }]);
    prisma.club_role_assignments.findFirst.mockResolvedValue({
      club_section_id: 99,
    });

    await expect(
      service.createAssignment('actor-user-id', 10, {
        user_id: '11111111-1111-1111-1111-111111111111',
        assignment_type: coordinator_assignment_type.SECTION,
        club_section_id: 99,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.RECORD_CONFLICT });

    expect(prisma.coordinator_assignments.create).not.toHaveBeenCalled();
  });

  function stubManageAccess() {
    authorizationContext.resolveUserAuthorization.mockResolvedValue(
      actorWith('director-lf'),
    );
    authorizationContext.canAccessHierarchyScope.mockReturnValue(true);
    hierarchy.resolveCurrent.mockResolvedValue({ local_field_id: 10 });
    prisma.local_fields.findUnique.mockResolvedValue({ local_field_id: 10 });
  }

  it('dry-runs a GENERAL backfill without writing', async () => {
    stubManageAccess();
    prisma.coordinator_assignments.findFirst.mockResolvedValue(null);
    prisma.users.findMany.mockResolvedValue([
      {
        user_id: '11111111-1111-1111-1111-111111111111',
        email: 'coord@example.com',
        name: 'Ana',
        paternal_last_name: 'Lopez',
        maternal_last_name: null,
        created_at: new Date('2024-01-01'),
        users_roles: [{ roles: { role_name: 'coordinator' } }],
      },
    ]);
    prisma.club_sections.findMany.mockResolvedValue([
      { club_section_id: 1 },
      { club_section_id: 2 },
    ]);
    prisma.club_role_assignments.findFirst.mockResolvedValue(null);

    const result = await service.backfillLegacyAssignments(
      'actor-user-id',
      10,
      true,
    );

    expect(result.dry_run).toBe(true);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.assignment_id).toBeNull();
    expect(result.created[0]?.user_id).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(prisma.coordinator_assignments.create).not.toHaveBeenCalled();
  });

  it('skips a director candidate and selects the next coordinator', async () => {
    stubManageAccess();
    prisma.coordinator_assignments.findFirst.mockResolvedValue(null);
    prisma.users.findMany.mockResolvedValue([
      {
        user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        email: 'director@example.com',
        name: 'Luis',
        paternal_last_name: null,
        maternal_last_name: null,
        created_at: new Date('2023-01-01'),
        users_roles: [{ roles: { role_name: 'general-coordinator' } }],
      },
      {
        user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        email: 'coord@example.com',
        name: 'Marta',
        paternal_last_name: null,
        maternal_last_name: null,
        created_at: new Date('2024-01-01'),
        users_roles: [{ roles: { role_name: 'coordinator' } }],
      },
    ]);
    prisma.club_sections.findMany.mockResolvedValue([{ club_section_id: 7 }]);
    prisma.club_role_assignments.findFirst.mockImplementation(
      ({ where }: { where: { user_id: string } }) => {
        if (where.user_id === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') {
          return Promise.resolve({ club_section_id: 7 });
        }
        return Promise.resolve(null);
      },
    );

    const result = await service.backfillLegacyAssignments(
      'actor-user-id',
      10,
      true,
    );

    expect(result.created).toEqual([
      expect.objectContaining({
        user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        role_name: 'coordinator',
      }),
    ]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        reason: 'director_conflict',
      }),
    ]);
  });

  it('does not create a second GENERAL when one already exists', async () => {
    stubManageAccess();
    prisma.coordinator_assignments.findFirst.mockImplementation(
      (args: { where?: { assignment_type?: string; user_id?: string } }) => {
        if (
          args.where?.assignment_type === coordinator_assignment_type.GENERAL
        ) {
          return Promise.resolve({
            assignment_id: 'existing-general',
            user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          });
        }
        return Promise.resolve(null);
      },
    );
    prisma.users.findMany.mockResolvedValue([
      {
        user_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        email: 'other@example.com',
        name: 'Paz',
        paternal_last_name: null,
        maternal_last_name: null,
        created_at: new Date('2024-01-01'),
        users_roles: [{ roles: { role_name: 'coordinator' } }],
      },
    ]);
    prisma.club_sections.findMany.mockResolvedValue([{ club_section_id: 3 }]);
    prisma.club_role_assignments.findFirst.mockResolvedValue(null);

    const result = await service.backfillLegacyAssignments(
      'actor-user-id',
      10,
      false,
    );

    expect(result.existing_general?.assignment_id).toBe('existing-general');
    expect(result.created).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe('general_slot_taken');
    expect(prisma.coordinator_assignments.create).not.toHaveBeenCalled();
  });

  describe('writes are the local field job', () => {
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['createZone', () => service.createZone('actor', 10, { name: 'Z' })],
      ['updateZone', () => service.updateZone('actor', 1, { name: 'Z' })],
      [
        'assignDistrictToZone',
        () => service.assignDistrictToZone('actor', 1, 2),
      ],
      [
        'removeDistrictFromZone',
        () => service.removeDistrictFromZone('actor', 1, 2),
      ],
      [
        'createAssignment',
        () =>
          service.createAssignment('actor', 10, {
            user_id: '11111111-1111-1111-1111-111111111111',
            assignment_type: coordinator_assignment_type.GENERAL,
          }),
      ],
      ['updateAssignment', () => service.updateAssignment('actor', 'a-1', {})],
      [
        'backfillLegacyAssignments',
        () => service.backfillLegacyAssignments('actor', 10),
      ],
    ];

    beforeEach(() => {
      authorizationContext.canAccessHierarchyScope.mockReturnValue(true);
      hierarchy.resolveCurrent.mockResolvedValue({ local_field_id: 10 });
      (prisma as any).coordination_zones = {
        findUnique: jest
          .fn()
          .mockResolvedValue({ zone_id: 1, local_field_id: 10 }),
      };
      (prisma.coordinator_assignments as any).findUnique = jest
        .fn()
        .mockResolvedValue({ assignment_id: 'a-1', local_field_id: 10 });
    });

    it.each(calls)(
      '%s rejects union and division roles with GUARD_PERMISSION_DENIED even when their territory covers the field',
      async (_name, call) => {
        for (const role of [
          'director-union',
          'assistant-union',
          'director-dia',
          'assistant-dia',
        ]) {
          authorizationContext.resolveUserAuthorization.mockResolvedValue(
            actorWith(role),
          );
          await expect(call()).rejects.toMatchObject({
            code: ErrorCode.GUARD_PERMISSION_DENIED,
          });
        }
        expect(hierarchy.resolveCurrent).not.toHaveBeenCalled();
      },
    );

    it.each([
      'admin',
      'assistant-admin',
      'super-admin',
      'director-lf',
      'assistant-lf',
    ])(
      'lets %s past the role check and on to the hierarchy check',
      async (role) => {
        authorizationContext.resolveUserAuthorization.mockResolvedValue(
          actorWith(role),
        );
        authorizationContext.canAccessHierarchyScope.mockReturnValue(false);
        await expect(
          service.createZone('actor', 10, { name: 'Z' }),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
        expect(hierarchy.resolveCurrent).toHaveBeenCalledTimes(1);
      },
    );

    it('keeps reads open to a union role whose territory covers the field', async () => {
      authorizationContext.resolveUserAuthorization.mockResolvedValue(
        actorWith('director-union'),
      );
      (prisma as any).coordination_zones.findMany = jest
        .fn()
        .mockResolvedValue([]);
      (prisma.coordinator_assignments as any).findMany = jest
        .fn()
        .mockResolvedValue([]);
      await expect(service.listZones('actor', 10)).resolves.toEqual([]);
      await expect(service.listAssignments('actor', 10)).resolves.toEqual([]);
    });
  });
});
