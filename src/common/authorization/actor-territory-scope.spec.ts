import { ErrorCode } from '../errors/error-codes';
import { TestingClock } from '../clock/testing-clock';
import { TemporalContextFactory } from '../clock/temporal-context.factory';
import { ZonedBusinessTimeService } from '../clock/zoned-business-time.service';
import { ClubAssignmentEffectivityPolicy } from './club-assignment-effectivity.policy';
import { LocalFieldTimezoneResolver } from './local-field-timezone.resolver';
import type { AuthorizationSnapshot } from '../services/authorization-context.service';
import {
  actorCanAccessHierarchyScope,
  assertCatalogFiltersInCountry,
  assertCatalogFiltersInRecorte,
  assertLocalFieldInActorScope,
  clubsWhereForActor,
  isMemberInLocalField,
  localFieldsWhereForActor,
  memberInDivisionWhere,
  memberInLocalFieldWhere,
  memberInUnionWhere,
  resolveActorCatalogCountryId,
  resolveActorCatalogRecorte,
  resolveActorTerritoryScope,
  usersWhereForActor,
} from './actor-territory-scope';

function snapshot(options: {
  role: string;
  localFieldId?: number | string;
  unionId?: number | string;
  divisionId?: number | string;
  countryId?: number | string;
}): AuthorizationSnapshot {
  return {
    grants: {
      global_roles: [
        {
          role_name: options.role,
          permissions: [],
          scope: {},
        },
      ],
      club_assignments: [],
      direct_permissions: [],
    },
    active_assignment: { assignment_id: null },
    effective: {
      permissions: [],
      scope: {
        global: {
          ...(options.divisionId === undefined
            ? {}
            : { division: { id: options.divisionId, name: 'DIA' } }),
          ...(options.countryId === undefined
            ? {}
            : { country: { id: options.countryId, name: 'México' } }),
          ...(options.unionId === undefined
            ? {}
            : { union: { id: options.unionId, name: 'Unión' } }),
          ...(options.localFieldId === undefined
            ? {}
            : { local_field: { id: options.localFieldId, name: 'Campo' } }),
        },
        club: null,
      },
    },
  };
}

describe('resolveActorTerritoryScope', () => {
  it('returns all for super-admin even with a home local_field', () => {
    expect(
      resolveActorTerritoryScope(
        snapshot({
          role: 'super-admin',
          localFieldId: 9,
          unionId: 2,
          divisionId: 1,
        }),
      ),
    ).toEqual({ level: 'all' });
  });

  it('keeps director-union at union when home local_field_id is set', () => {
    expect(
      resolveActorTerritoryScope(
        snapshot({
          role: 'director-union',
          localFieldId: 9,
          unionId: 2,
          divisionId: 1,
        }),
      ),
    ).toMatchObject({
      level: 'union',
      unionId: 2,
      localFieldId: 9,
      divisionId: 1,
    });
  });

  it('keeps assistant-union at union when home local_field_id is set', () => {
    expect(
      resolveActorTerritoryScope(
        snapshot({
          role: 'assistant-union',
          localFieldId: 4,
          unionId: 8,
        }),
      ),
    ).toMatchObject({ level: 'union', unionId: 8, localFieldId: 4 });
  });

  it('resolves director-lf to that local field', () => {
    expect(
      resolveActorTerritoryScope(
        snapshot({
          role: 'director-lf',
          localFieldId: 9,
          unionId: 2,
          divisionId: 1,
        }),
      ),
    ).toMatchObject({
      level: 'local_field',
      localFieldId: 9,
    });
  });

  it('resolves director-dia to division even with union and local_field ids', () => {
    expect(
      resolveActorTerritoryScope(
        snapshot({
          role: 'director-dia',
          localFieldId: 9,
          unionId: 2,
          divisionId: 1,
        }),
      ),
    ).toMatchObject({
      level: 'division',
      divisionId: 1,
    });
  });

  it('lets admin union win over home local_field', () => {
    expect(
      resolveActorTerritoryScope(
        snapshot({
          role: 'admin',
          localFieldId: 9,
          unionId: 2,
        }),
      ),
    ).toMatchObject({ level: 'union', unionId: 2 });
  });

  it('scopes admin to local_field when no union id is present', () => {
    expect(
      resolveActorTerritoryScope(
        snapshot({
          role: 'assistant-admin',
          localFieldId: 9,
        }),
      ),
    ).toMatchObject({ level: 'local_field', localFieldId: 9 });
  });

  it('coerces string territorial ids', () => {
    expect(
      resolveActorTerritoryScope(
        snapshot({
          role: 'director-lf',
          localFieldId: '12',
        }),
      ),
    ).toMatchObject({ level: 'local_field', localFieldId: 12 });
  });

  it('returns open for coordinators and club-only actors', () => {
    expect(
      resolveActorTerritoryScope(
        snapshot({ role: 'coordinator', localFieldId: 7 }),
      ),
    ).toEqual({ level: 'open' });
    expect(resolveActorTerritoryScope(undefined)).toEqual({ level: 'open' });
  });

  // Coordinator authority is per club_section (coordinator_assignments), not a
  // union / local field: PermissionsGuard resolves it only on routes that opt
  // in with `coordinatorSections`. Teaching this resolver a coordinator
  // territory would widen canManageClub (club management, finances, director
  // designation) for every coordinator.
  it.each(['coordinator', 'zone-coordinator', 'general-coordinator'])(
    'keeps %s open even with a full home territory',
    (role) => {
      expect(
        resolveActorTerritoryScope(
          snapshot({ role, localFieldId: 7, unionId: 3, divisionId: 1 }),
        ),
      ).toEqual({ level: 'open' });
    },
  );

  it('returns unconfigured when a territorial role has no required id', () => {
    expect(
      resolveActorTerritoryScope(snapshot({ role: 'director-union' })),
    ).toEqual({ level: 'unconfigured' });
    expect(resolveActorTerritoryScope(snapshot({ role: 'admin' }))).toEqual({
      level: 'unconfigured',
    });
  });
});

describe('clubsWhereForActor / localFieldsWhereForActor', () => {
  it('builds union and division prisma filters', () => {
    expect(clubsWhereForActor({ level: 'union', unionId: 2 })).toEqual({
      local_fields: { union_id: 2 },
    });
    expect(clubsWhereForActor({ level: 'division', divisionId: 1 })).toEqual({
      local_fields: { unions: { division_id: 1 } },
    });
    expect(
      localFieldsWhereForActor({ level: 'local_field', localFieldId: 9 }),
    ).toEqual({ local_field_id: 9 });
  });

  it('does not recorte open or all actors', () => {
    expect(clubsWhereForActor({ level: 'open' })).toEqual({});
    expect(clubsWhereForActor({ level: 'all' })).toEqual({});
  });

  it('rejects unconfigured operational where builders', () => {
    expect(() => clubsWhereForActor({ level: 'unconfigured' })).toThrow();
    try {
      clubsWhereForActor({ level: 'unconfigured' });
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    }
  });
});

describe('actorCanAccessHierarchyScope', () => {
  it('lets director-union reach another local field in the same union', () => {
    const actor = resolveActorTerritoryScope(
      snapshot({
        role: 'director-union',
        localFieldId: 9,
        unionId: 2,
      }),
    );

    expect(
      actorCanAccessHierarchyScope(actor, {
        union_id: 2,
        local_field_id: 99,
      }),
    ).toBe(true);
    expect(
      actorCanAccessHierarchyScope(actor, {
        union_id: 3,
        local_field_id: 9,
      }),
    ).toBe(false);
  });

  it('does not let director-lf leave their field', () => {
    const actor = resolveActorTerritoryScope(
      snapshot({
        role: 'director-lf',
        localFieldId: 9,
        unionId: 2,
      }),
    );

    expect(
      actorCanAccessHierarchyScope(actor, { local_field_id: 9, union_id: 2 }),
    ).toBe(true);
    expect(
      actorCanAccessHierarchyScope(actor, { local_field_id: 10, union_id: 2 }),
    ).toBe(false);
  });

  it('keeps coordinators out of hierarchy writes', () => {
    expect(
      actorCanAccessHierarchyScope({ level: 'open' }, { local_field_id: 7 }),
    ).toBe(false);
  });
});

describe('assertLocalFieldInActorScope', () => {
  it('403s when a union actor targets a field outside the union', async () => {
    const prisma = {
      local_fields: {
        findUnique: jest.fn().mockResolvedValue({
          local_field_id: 10,
          union_id: 3,
          unions: { division_id: 1 },
        }),
      },
    };

    await expect(
      assertLocalFieldInActorScope(prisma as never, 10, {
        level: 'union',
        unionId: 2,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });

  it('allows a union actor to target a child local field', async () => {
    const prisma = {
      local_fields: {
        findUnique: jest.fn().mockResolvedValue({
          local_field_id: 10,
          union_id: 2,
          unions: { division_id: 1 },
        }),
      },
    };

    await expect(
      assertLocalFieldInActorScope(prisma as never, 10, {
        level: 'union',
        unionId: 2,
      }),
    ).resolves.toBeUndefined();
  });

  it('403s a local-field actor without revealing whether the other field exists', async () => {
    const prisma = {
      local_fields: { findUnique: jest.fn() },
    };

    await expect(
      assertLocalFieldInActorScope(prisma as never, 99, {
        level: 'local_field',
        localFieldId: 9,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    expect(prisma.local_fields.findUnique).not.toHaveBeenCalled();
  });
});

describe('resolveActorCatalogCountryId', () => {
  it('does not recorte open, all, or missing actors', async () => {
    const prisma = {
      local_fields: { findUnique: jest.fn() },
      unions: { findUnique: jest.fn() },
    };

    await expect(
      resolveActorCatalogCountryId(prisma as never, undefined),
    ).resolves.toBeUndefined();
    await expect(
      resolveActorCatalogCountryId(
        prisma as never,
        snapshot({ role: 'coordinator', countryId: 52 }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      resolveActorCatalogCountryId(
        prisma as never,
        snapshot({
          role: 'super-admin',
          countryId: 52,
          localFieldId: 9,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(prisma.local_fields.findUnique).not.toHaveBeenCalled();
    expect(prisma.unions.findUnique).not.toHaveBeenCalled();
  });

  it('uses snapshot country for director-union with a home field', async () => {
    const prisma = {
      local_fields: { findUnique: jest.fn() },
      unions: { findUnique: jest.fn() },
    };

    await expect(
      resolveActorCatalogCountryId(
        prisma as never,
        snapshot({
          role: 'director-union',
          unionId: 2,
          localFieldId: 9,
          countryId: 52,
        }),
      ),
    ).resolves.toBe(52);
    expect(prisma.unions.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the union country when the snapshot has none', async () => {
    const prisma = {
      local_fields: { findUnique: jest.fn() },
      unions: {
        findUnique: jest.fn().mockResolvedValue({ country_id: 52 }),
      },
    };

    await expect(
      resolveActorCatalogCountryId(
        prisma as never,
        snapshot({ role: 'director-union', unionId: 2, localFieldId: 9 }),
      ),
    ).resolves.toBe(52);
    expect(prisma.unions.findUnique).toHaveBeenCalledWith({
      where: { union_id: 2 },
      select: { country_id: true },
    });
  });

  it('falls back to the field union country for director-lf', async () => {
    const prisma = {
      local_fields: {
        findUnique: jest.fn().mockResolvedValue({
          unions: { country_id: 52 },
        }),
      },
      unions: { findUnique: jest.fn() },
    };

    await expect(
      resolveActorCatalogCountryId(
        prisma as never,
        snapshot({ role: 'director-lf', localFieldId: 9, unionId: 2 }),
      ),
    ).resolves.toBe(52);
  });

  it('fail-closes territorial roles without a resolvable country', async () => {
    const prisma = {
      local_fields: { findUnique: jest.fn() },
      unions: { findUnique: jest.fn() },
    };

    await expect(
      resolveActorCatalogCountryId(
        prisma as never,
        snapshot({ role: 'director-union' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    await expect(
      resolveActorCatalogCountryId(
        prisma as never,
        snapshot({ role: 'director-dia', divisionId: 1 }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
  });
});

describe('resolveActorCatalogRecorte', () => {
  const prisma = {
    local_fields: { findUnique: jest.fn() },
    unions: { findUnique: jest.fn().mockResolvedValue({ country_id: 52 }) },
  };

  it('recortes division leadership to its division, not a country', async () => {
    for (const role of ['director-dia', 'assistant-dia']) {
      await expect(
        resolveActorCatalogRecorte(
          prisma as never,
          snapshot({ role, divisionId: 1, countryId: 52 }),
        ),
      ).resolves.toEqual({ divisionId: 1 });
    }
  });

  it('keeps the country recorte for union leadership', async () => {
    await expect(
      resolveActorCatalogRecorte(
        prisma as never,
        snapshot({ role: 'director-union', unionId: 2 }),
      ),
    ).resolves.toEqual({ countryId: 52 });
  });

  it('does not recorte super-admin and still fails closed without a division', async () => {
    await expect(
      resolveActorCatalogRecorte(
        prisma as never,
        snapshot({ role: 'super-admin' }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      resolveActorCatalogRecorte(
        prisma as never,
        snapshot({ role: 'director-dia' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
  });
});

describe('assertCatalogFiltersInRecorte for a division', () => {
  const prisma = {
    unions: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    local_fields: { findUnique: jest.fn() },
    districts: { findUnique: jest.fn() },
  };
  const recorte = { divisionId: 1 };

  it('accepts filters inside the division', async () => {
    prisma.unions.findFirst.mockResolvedValue({ union_id: 4 });
    prisma.unions.findUnique.mockResolvedValue({ division_id: 1 });
    prisma.local_fields.findUnique.mockResolvedValue({
      unions: { division_id: 1 },
    });

    await expect(
      assertCatalogFiltersInRecorte(prisma as never, recorte, {
        divisionId: 1,
        countryId: 61,
        unionId: 4,
        localFieldId: 9,
      }),
    ).resolves.toBeUndefined();
  });

  it('403s another division, a union outside it, or a local field outside it', async () => {
    await expect(
      assertCatalogFiltersInRecorte(prisma as never, recorte, {
        divisionId: 2,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });

    prisma.unions.findUnique.mockResolvedValue({ division_id: 2 });
    await expect(
      assertCatalogFiltersInRecorte(prisma as never, recorte, { unionId: 2 }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });

    prisma.local_fields.findUnique.mockResolvedValue({
      unions: { division_id: 2 },
    });
    await expect(
      assertCatalogFiltersInRecorte(prisma as never, recorte, {
        localFieldId: 10,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });
});

describe('assertCatalogFiltersInCountry', () => {
  it('403s a country query outside the actor country', async () => {
    await expect(
      assertCatalogFiltersInCountry(
        { unions: {}, local_fields: {}, districts: {} } as never,
        52,
        { countryId: 99 },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });

  it('403s a union from another country without leaking existence', async () => {
    const prisma = {
      unions: {
        findUnique: jest.fn().mockResolvedValue({ country_id: 1 }),
      },
      local_fields: { findUnique: jest.fn() },
      districts: { findUnique: jest.fn() },
    };

    await expect(
      assertCatalogFiltersInCountry(prisma as never, 52, { unionId: 8 }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });

  it('allows a local field that belongs to the actor country', async () => {
    const prisma = {
      unions: { findUnique: jest.fn(), findFirst: jest.fn() },
      local_fields: {
        findUnique: jest.fn().mockResolvedValue({
          unions: { country_id: 52 },
        }),
      },
      districts: { findUnique: jest.fn() },
    };

    await expect(
      assertCatalogFiltersInCountry(prisma as never, 52, { localFieldId: 9 }),
    ).resolves.toBeUndefined();
  });

  it('403s a missing division-country pair', async () => {
    const prisma = {
      unions: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      local_fields: { findUnique: jest.fn() },
      districts: { findUnique: jest.fn() },
    };

    await expect(
      assertCatalogFiltersInCountry(prisma as never, 52, { divisionId: 2 }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });
});

describe('member-centric territory scope', () => {
  // Predicado canónico de vigencia (misma fuente que usan los servicios).
  const zoned = new ZonedBusinessTimeService();
  const policy = new ClubAssignmentEffectivityPolicy(zoned);
  const effective = policy.toPrismaWhere(
    new TemporalContextFactory(
      new TestingClock(new Date('2026-10-28T12:00:00.000Z')),
      zoned,
    ).forLocalField({
      local_field_id: 5,
      timezone: new LocalFieldTimezoneResolver({} as never).assertTimezone(
        'America/Mexico_City',
      ),
    }),
  );
  const viaClub = (clubs: object) => ({
    club_role_assignments: { some: { ...effective, club_sections: { clubs } } },
  });

  it('the club path carries the canonical effectivity predicate: status "active" only, bounded by start/end/expires', () => {
    expect(effective.status).toBe('active');
    expect(effective.active).toBe(true);
    expect(effective.start_date).toEqual({ lte: expect.any(Date) });
    const clause = memberInLocalFieldWhere(5, effective).OR?.[1] as {
      club_role_assignments: { some: Record<string, unknown> };
    };
    // designated / pending / rejected / ended / expired never satisfy it.
    expect(clause.club_role_assignments.some.status).toBe('active');
    expect(clause.club_role_assignments.some).not.toHaveProperty('status.in');
    expect(clause.club_role_assignments.some.AND).toEqual(effective.AND);
  });

  it('memberInLocalFieldWhere = own row OR effective club role in the field', () => {
    expect(memberInLocalFieldWhere(5, effective)).toEqual({
      OR: [{ local_field_id: 5 }, viaClub({ local_field_id: 5 })],
    });
  });

  it('memberInUnionWhere = own union OR own field in union OR club role in union', () => {
    expect(memberInUnionWhere(2, effective)).toEqual({
      OR: [
        { union_id: 2 },
        { local_fields: { union_id: 2 } },
        viaClub({ local_fields: { union_id: 2 } }),
      ],
    });
  });

  it('memberInDivisionWhere = own union OR own field OR club role in division', () => {
    expect(memberInDivisionWhere(1, effective)).toEqual({
      OR: [
        { unions: { division_id: 1 } },
        { local_fields: { unions: { division_id: 1 } } },
        viaClub({ local_fields: { unions: { division_id: 1 } } }),
      ],
    });
  });

  it('usersWhereForActor maps every scope level', () => {
    expect(usersWhereForActor({ level: 'all' }, effective)).toEqual({});
    expect(usersWhereForActor({ level: 'open' }, effective)).toEqual({});
    expect(
      usersWhereForActor({ level: 'local_field', localFieldId: 5 }, effective),
    ).toEqual(memberInLocalFieldWhere(5, effective));
    expect(
      usersWhereForActor({ level: 'union', unionId: 2 }, effective),
    ).toEqual(memberInUnionWhere(2, effective));
    expect(
      usersWhereForActor({ level: 'division', divisionId: 1 }, effective),
    ).toEqual(memberInDivisionWhere(1, effective));
    expect(() =>
      usersWhereForActor({ level: 'unconfigured' }, effective),
    ).toThrow();
  });

  it('isMemberInLocalField counts users matching the member filter when the own row does not match', async () => {
    const count = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const findUnique = jest.fn().mockResolvedValue({ local_field_id: null });
    const prisma = { users: { count, findUnique } } as never;

    await expect(
      isMemberInLocalField(prisma, 'u-1', 5, effective),
    ).resolves.toBe(true);
    await expect(
      isMemberInLocalField(prisma, 'u-1', 5, effective),
    ).resolves.toBe(false);
    expect(count).toHaveBeenCalledWith({
      where: {
        AND: [{ user_id: 'u-1' }, memberInLocalFieldWhere(5, effective)],
      },
    });
  });

  it('isMemberInLocalField short-circuits on the own user row, loaded or given', async () => {
    const count = jest.fn();
    const findUnique = jest.fn().mockResolvedValue({ local_field_id: 5 });
    const prisma = { users: { count, findUnique } } as never;

    await expect(
      isMemberInLocalField(prisma, 'u-1', 5, effective),
    ).resolves.toBe(true);
    await expect(
      isMemberInLocalField(prisma, 'u-1', 5, effective, 5),
    ).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
  });

  it('isMemberInLocalField with a given non-matching own field skips the row lookup', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const findUnique = jest.fn();
    const prisma = { users: { count, findUnique } } as never;

    await expect(
      isMemberInLocalField(prisma, 'u-1', 5, effective, 9),
    ).resolves.toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledTimes(1);
  });
});
