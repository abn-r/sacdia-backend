import { ErrorCode } from '../common/errors/error-codes';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import { PASTOR_ELIGIBLE_USER_WHERE } from '../investiture-requests/investiture-pastor-eligibility';
import { DistrictInvestiturePastorService } from './district-investiture-pastors.service';

const FIELD_ID = 10;
const OTHER_FIELD_ID = 11;
const OUTSIDE_FIELD_ID = 20;
const DISTRICT_ID = 5;
const SAME_UNION_DISTRICT_ID = 6;
const OUTSIDE_DISTRICT_ID = 7;
const CLUB_ID = 100;
const CHURCH_ID = 50;
const DECOY_DISTRICT_ID = 9;
const PASTOR_A = '11111111-1111-4111-8111-111111111111';
const PASTOR_B = '22222222-2222-4222-8222-222222222222';
const PASTOR_C = '33333333-3333-4333-8333-333333333333';
const NOT_PASTOR = '44444444-4444-4444-8444-444444444444';

const PROFILES: Record<
  string,
  {
    name: string | null;
    paternal_last_name: string | null;
    maternal_last_name: string | null;
    email: string;
  }
> = {
  [PASTOR_A]: {
    name: 'Ana',
    paternal_last_name: 'Pérez',
    maternal_last_name: 'Ruiz',
    email: 'ana@pastores.test',
  },
  [PASTOR_B]: {
    name: ' Beto ',
    paternal_last_name: 'Lara',
    maternal_last_name: null,
    email: 'beto@pastores.test',
  },
  [PASTOR_C]: {
    name: null,
    paternal_last_name: null,
    maternal_last_name: null,
    email: 'c@pastores.test',
  },
};

const ANA_VIEW = { user_name: 'Ana Pérez Ruiz', email: 'ana@pastores.test' };
const BETO_VIEW = { user_name: 'Beto Lara', email: 'beto@pastores.test' };
const NAMELESS_VIEW = { user_name: 'Sin nombre', email: 'c@pastores.test' };

function snapshot(options: {
  role: string;
  localFieldId?: number;
  unionId?: number;
  divisionId?: number;
}): AuthorizationSnapshot {
  return {
    grants: {
      global_roles: [{ role_name: options.role, permissions: [], scope: {} }],
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

describe('DistrictInvestiturePastorService', () => {
  const districtsById: Record<
    number,
    { districlub_type_id: number; local_field_id: number }
  > = {
    [DISTRICT_ID]: {
      districlub_type_id: DISTRICT_ID,
      local_field_id: FIELD_ID,
    },
    [SAME_UNION_DISTRICT_ID]: {
      districlub_type_id: SAME_UNION_DISTRICT_ID,
      local_field_id: OTHER_FIELD_ID,
    },
    [OUTSIDE_DISTRICT_ID]: {
      districlub_type_id: OUTSIDE_DISTRICT_ID,
      local_field_id: OUTSIDE_FIELD_ID,
    },
    [DECOY_DISTRICT_ID]: {
      districlub_type_id: DECOY_DISTRICT_ID,
      local_field_id: FIELD_ID,
    },
  };
  const fieldsById: Record<
    number,
    {
      local_field_id: number;
      union_id: number;
      unions: { division_id: number };
    }
  > = {
    [FIELD_ID]: {
      local_field_id: FIELD_ID,
      union_id: 2,
      unions: { division_id: 1 },
    },
    [OTHER_FIELD_ID]: {
      local_field_id: OTHER_FIELD_ID,
      union_id: 2,
      unions: { division_id: 1 },
    },
    [OUTSIDE_FIELD_ID]: {
      local_field_id: OUTSIDE_FIELD_ID,
      union_id: 8,
      unions: { division_id: 1 },
    },
  };

  let rows: Array<{
    districlub_type_id: number;
    user_id: string;
    active: boolean;
    assigned_by_id: string | null;
  }>;
  let quota: { quota_id: number; slots: number } | null;
  let pastors: {
    findMany: jest.Mock;
    count: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    groupBy: jest.Mock;
  };
  let quotaDelegate: { findUnique: jest.Mock; upsert: jest.Mock };
  let users: { findUnique: jest.Mock; findMany: jest.Mock };
  let rolelessUsers: Set<string>;
  let deletedUsers: Set<string>;
  let userFields: Record<string, number | null>;
  let candidateRows: unknown[];
  let clubs: { findUnique: jest.Mock };
  let service: DistrictInvestiturePastorService;

  beforeEach(() => {
    rows = [];
    quota = null;
    const matches = (where: {
      districlub_type_id?: number;
      user_id?: string;
      active?: boolean;
      districlub_type_id_user_id?: {
        districlub_type_id: number;
        user_id: string;
      };
    }) =>
      rows.filter((row) => {
        const districtId =
          where.districlub_type_id_user_id?.districlub_type_id ??
          where.districlub_type_id;
        const userId =
          where.districlub_type_id_user_id?.user_id ?? where.user_id;
        if (districtId !== undefined && row.districlub_type_id !== districtId) {
          return false;
        }
        if (userId !== undefined && row.user_id !== userId) {
          return false;
        }
        if (where.active !== undefined && row.active !== where.active) {
          return false;
        }
        return true;
      });
    pastors = {
      findMany: jest.fn(async ({ where }) => matches(where)),
      count: jest.fn(async ({ where }) => matches(where).length),
      findUnique: jest.fn(async ({ where }) => matches(where)[0] ?? null),
      create: jest.fn(async ({ data }) => {
        rows.push({ ...data, active: data.active ?? true });
        return data;
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = matches(where)[0];
        Object.assign(row, data);
        return row;
      }),
      groupBy: jest.fn(async () => {
        const counts = new Map<number, number>();
        for (const row of rows) {
          if (!row.active) {
            continue;
          }
          counts.set(
            row.districlub_type_id,
            (counts.get(row.districlub_type_id) ?? 0) + 1,
          );
        }
        return [...counts.entries()].map(([districlub_type_id, count]) => ({
          districlub_type_id,
          _count: { user_id: count },
        }));
      }),
    };
    quotaDelegate = {
      findUnique: jest.fn(async () => quota),
      upsert: jest.fn(async ({ create, update }) => {
        quota = {
          quota_id: 1,
          slots: update.slots ?? create.slots,
        };
        return quota;
      }),
    };
    rolelessUsers = new Set([NOT_PASTOR]);
    deletedUsers = new Set();
    candidateRows = [];
    userFields = {
      [NOT_PASTOR]: FIELD_ID,
      [PASTOR_A]: FIELD_ID,
      [PASTOR_B]: FIELD_ID,
      [PASTOR_C]: FIELD_ID,
    };
    users = {
      findUnique: jest.fn(async ({ where }) => {
        if (where.user_id in userFields) {
          return {
            user_id: where.user_id,
            active: true,
            local_field_id: userFields[where.user_id],
          };
        }
        return null;
      }),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { user_id?: { in: string[] } };
        }): Promise<unknown[]> => {
          if (!where.user_id) {
            return candidateRows;
          }
          return where.user_id.in.map((id) => ({
            user_id: id,
            active: !deletedUsers.has(id),
            users_roles: rolelessUsers.has(id)
              ? []
              : [{ user_role_id: 'role-1' }],
            ...(PROFILES[id] ?? {}),
          }));
        },
      ),
    };
    clubs = {
      findUnique: jest.fn(async () => ({
        club_id: CLUB_ID,
        church_id: CHURCH_ID,
        districlub_type_id: DECOY_DISTRICT_ID,
      })),
    };
    const prisma = {
      investiture_pastor_quota: quotaDelegate,
      district_investiture_pastors: pastors,
      districts: {
        findUnique: jest.fn(
          async ({ where }: { where: { districlub_type_id: number } }) =>
            districtsById[where.districlub_type_id] ?? null,
        ),
      },
      local_fields: {
        findUnique: jest.fn(
          async ({ where }: { where: { local_field_id: number } }) =>
            fieldsById[where.local_field_id] ?? null,
        ),
      },
      users,
      clubs,
      churches: {
        findUnique: jest.fn(async () => ({
          church_id: CHURCH_ID,
          districlub_type_id: DISTRICT_ID,
        })),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    };
    service = new DistrictInvestiturePastorService(prisma as never);
  });

  it('reads two slots without inserting a quota row', async () => {
    const view = await service.getQuota(
      snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
    );

    expect(view).toEqual({ slots: 2, configured: false, can_edit: false });
    expect(quotaDelegate.upsert).not.toHaveBeenCalled();
  });

  it('lets only super-admin change the cap for every district', async () => {
    const root = snapshot({ role: 'super-admin' });
    const saved = await service.updateQuota(root, 1, 'root-1');
    expect(saved).toEqual({ slots: 1, configured: true, can_edit: true });

    const field = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
    await service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1');
    await expect(
      service.assign(field, DISTRICT_ID, PASTOR_B, 'user-1'),
    ).rejects.toMatchObject({ code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL });

    const union = snapshot({ role: 'assistant-union', unionId: 2 });
    userFields[PASTOR_B] = OTHER_FIELD_ID;
    userFields[PASTOR_C] = OTHER_FIELD_ID;
    await service.assign(union, SAME_UNION_DISTRICT_ID, PASTOR_C, 'union-1');
    await expect(
      service.assign(union, SAME_UNION_DISTRICT_ID, PASTOR_B, 'union-1'),
    ).rejects.toMatchObject({ code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL });
    expect(rows.filter((row) => row.active)).toHaveLength(2);
  });

  it('rejects a quota below the pastors already assigned and does not rewrite it', async () => {
    const root = snapshot({ role: 'super-admin' });
    await service.updateQuota(root, 2, 'root-1');
    const field = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
    await service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1');
    await service.assign(field, DISTRICT_ID, PASTOR_B, 'user-1');

    await expect(service.updateQuota(root, 1, 'root-1')).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_PASTOR_QUOTA_BELOW_ASSIGNMENTS,
    });
    expect(quota?.slots).toBe(2);
  });

  it('rejects quota edits from the field and does not read the row for admin', async () => {
    await expect(
      service.updateQuota(
        snapshot({ role: 'assistant-lf', localFieldId: FIELD_ID }),
        3,
        'user-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    await expect(
      service.getQuota(snapshot({ role: 'admin', unionId: 2 })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    expect(quotaDelegate.findUnique).not.toHaveBeenCalled();
    expect(quotaDelegate.upsert).not.toHaveBeenCalled();
  });

  it('assigns inside the field or the union and keeps both pastors able to authorize', async () => {
    const field = snapshot({ role: 'assistant-lf', localFieldId: FIELD_ID });
    const first = await service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1');
    const second = await service.assign(
      snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
      DISTRICT_ID,
      PASTOR_B,
      'user-2',
    );

    expect(first).toMatchObject({
      user_id: PASTOR_A,
      can_authorize: true,
      ...ANA_VIEW,
    });
    expect(second).toMatchObject({
      user_id: PASTOR_B,
      can_authorize: true,
      ...BETO_VIEW,
    });
    const listed = await service.list(field, DISTRICT_ID);
    expect(listed.pastors).toEqual([
      {
        districlub_type_id: DISTRICT_ID,
        user_id: PASTOR_A,
        can_authorize: true,
        ...ANA_VIEW,
      },
      {
        districlub_type_id: DISTRICT_ID,
        user_id: PASTOR_B,
        can_authorize: true,
        ...BETO_VIEW,
      },
    ]);
    expect(listed.can_assign).toBe(false);
  });

  it('rejects an extra pastor, a user without the pastor role, and a duplicate', async () => {
    const field = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
    await service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1');
    await service.assign(field, DISTRICT_ID, PASTOR_B, 'user-1');
    await expect(
      service.assign(field, DISTRICT_ID, PASTOR_C, 'user-1'),
    ).rejects.toMatchObject({ code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL });
    await expect(
      service.assign(field, DISTRICT_ID, NOT_PASTOR, 'user-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_PASTOR_ROLE_REQUIRED,
    });
    await expect(
      service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_PASTOR_ALREADY_ASSIGNED,
    });
    expect(rows).toHaveLength(2);
  });

  it('does not assign outside the actor territory and does not read pastors', async () => {
    await expect(
      service.assign(
        snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
        SAME_UNION_DISTRICT_ID,
        PASTOR_A,
        'user-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    await expect(
      service.assign(
        snapshot({ role: 'director-union', unionId: 2 }),
        OUTSIDE_DISTRICT_ID,
        PASTOR_A,
        'union-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    await expect(
      service.assign(
        snapshot({ role: 'super-admin' }),
        DISTRICT_ID,
        PASTOR_A,
        'root-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    await expect(
      service.assign(
        snapshot({ role: 'admin', unionId: 2 }),
        DISTRICT_ID,
        PASTOR_A,
        'admin-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    await expect(
      service.list(
        snapshot({ role: 'director-dia', divisionId: 1 }),
        DISTRICT_ID,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    expect(pastors.findMany).not.toHaveBeenCalled();
    expect(pastors.create).not.toHaveBeenCalled();
  });

  it('lets a union role assign in another field of the same union', async () => {
    const actor = snapshot({
      role: 'director-lf',
      localFieldId: FIELD_ID,
      unionId: 2,
    });
    actor.grants.global_roles.push({
      role_name: 'director-union',
      permissions: [],
      scope: {},
    });

    userFields[PASTOR_A] = OTHER_FIELD_ID;
    const saved = await service.assign(
      actor,
      SAME_UNION_DISTRICT_ID,
      PASTOR_A,
      'user-1',
    );
    expect(saved.can_authorize).toBe(true);
    expect(rows).toHaveLength(1);
  });

  describe('same-field rule', () => {
    const field = () =>
      snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
    const union = () => snapshot({ role: 'director-union', unionId: 2 });

    it('rejects a pastor from another Field of the same union', async () => {
      userFields[PASTOR_A] = OTHER_FIELD_ID;
      await expect(
        service.assign(field(), DISTRICT_ID, PASTOR_A, 'user-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_PASTOR_FIELD_MISMATCH,
      });
      expect(rows).toHaveLength(0);
      expect(pastors.create).not.toHaveBeenCalled();
    });

    it('rejects, even for a union actor, a pastor that is not from the district Field', async () => {
      await expect(
        service.assign(union(), SAME_UNION_DISTRICT_ID, PASTOR_A, 'union-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_PASTOR_FIELD_MISMATCH,
      });
      expect(rows).toHaveLength(0);
    });

    it('rejects a pastor without a Field', async () => {
      userFields[PASTOR_A] = null;
      await expect(
        service.assign(field(), DISTRICT_ID, PASTOR_A, 'user-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_PASTOR_FIELD_MISMATCH,
      });
      expect(rows).toHaveLength(0);
    });

    it('rejects reactivating an inactive assignment whose pastor changed Field', async () => {
      rows.push({
        districlub_type_id: DISTRICT_ID,
        user_id: PASTOR_A,
        active: false,
        assigned_by_id: 'user-0',
      });
      userFields[PASTOR_A] = OTHER_FIELD_ID;
      await expect(
        service.assign(field(), DISTRICT_ID, PASTOR_A, 'user-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_PASTOR_FIELD_MISMATCH,
      });
      expect(rows[0].active).toBe(false);
      expect(pastors.update).not.toHaveBeenCalled();
    });

    it('reactivates an inactive assignment when the pastor is still in the Field', async () => {
      rows.push({
        districlub_type_id: DISTRICT_ID,
        user_id: PASTOR_A,
        active: false,
        assigned_by_id: 'user-0',
      });
      const saved = await service.assign(field(), DISTRICT_ID, PASTOR_A, 'u1');
      expect(saved).toMatchObject({ user_id: PASTOR_A, can_authorize: true });
      expect(rows[0].active).toBe(true);
    });

    it('checks the role before the Field', async () => {
      userFields[NOT_PASTOR] = OTHER_FIELD_ID;
      await expect(
        service.assign(field(), DISTRICT_ID, NOT_PASTOR, 'user-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_PASTOR_ROLE_REQUIRED,
      });
    });
  });

  it('resolves authorizers from the club church, not the club district or the user', async () => {
    const field = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
    await service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1');
    await service.assign(field, DISTRICT_ID, PASTOR_B, 'user-1');
    rows.push({
      districlub_type_id: DECOY_DISTRICT_ID,
      user_id: PASTOR_C,
      active: true,
      assigned_by_id: 'user-1',
    });
    users.findUnique.mockClear();

    const view = await service.authorizersForClub(field, CLUB_ID);

    expect(view).toEqual({
      club_id: CLUB_ID,
      districlub_type_id: DISTRICT_ID,
      resolved_from: 'church',
      authorizers: [
        {
          districlub_type_id: DISTRICT_ID,
          user_id: PASTOR_A,
          can_authorize: true,
          ...ANA_VIEW,
        },
        {
          districlub_type_id: DISTRICT_ID,
          user_id: PASTOR_B,
          can_authorize: true,
          ...BETO_VIEW,
        },
      ],
    });
    expect(clubs.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { club_id: true, church_id: true },
      }),
    );
    expect(users.findUnique).not.toHaveBeenCalled();
  });

  it('frees a slot when an assigner removes a pastor', async () => {
    const field = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
    await service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1');
    await service.assign(field, DISTRICT_ID, PASTOR_B, 'user-1');
    const removed = await service.remove(field, DISTRICT_ID, PASTOR_A);
    expect(removed).toMatchObject({
      user_id: PASTOR_A,
      can_authorize: false,
    });
    await service.assign(field, DISTRICT_ID, PASTOR_C, 'user-1');
    const view = await service.authorizersForClub(field, CLUB_ID);
    expect(view.authorizers.map((pastor) => pastor.user_id)).toEqual([
      PASTOR_B,
      PASTOR_C,
    ]);
  });

  it('falls back to "Sin nombre" for a pastor without name parts', async () => {
    const field = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
    const saved = await service.assign(field, DISTRICT_ID, PASTOR_C, 'user-1');
    expect(saved).toMatchObject(NAMELESS_VIEW);
    const listed = await service.list(field, DISTRICT_ID);
    expect(listed.pastors[0]).toMatchObject(NAMELESS_VIEW);
  });

  it('keeps the name on a removed pastor response', async () => {
    const field = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
    await service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1');
    const removed = await service.remove(field, DISTRICT_ID, PASTOR_A);
    expect(removed).toMatchObject({ can_authorize: false, ...ANA_VIEW });
  });

  describe('searchCandidates', () => {
    const candidate = (id: string) => ({
      user_id: id,
      email: PROFILES[id].email,
      name: PROFILES[id].name,
      paternal_last_name: PROFILES[id].paternal_last_name,
      maternal_last_name: PROFILES[id].maternal_last_name,
    });

    it.each([
      ['director-lf', { localFieldId: FIELD_ID }],
      ['assistant-lf', { localFieldId: FIELD_ID }],
      ['director-union', { unionId: 2 }],
      ['assistant-union', { unionId: 2 }],
    ])('lets %s search and maps the view', async (role, scope) => {
      candidateRows = [candidate(PASTOR_A), candidate(PASTOR_C)];
      const found = await service.searchCandidates(
        snapshot({ role, ...scope }),
        'ana',
      );
      expect(found).toEqual([
        { user_id: PASTOR_A, ...ANA_VIEW },
        { user_id: PASTOR_C, ...NAMELESS_VIEW },
      ]);
    });

    it('uses the single eligibility rule, a case-insensitive contains and a limit of 20', async () => {
      const field = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
      await service.searchCandidates(field, '  Ana Pérez ');
      expect(users.findMany).toHaveBeenCalledTimes(1);
      const args = users.findMany.mock.calls[0][0];
      expect(args.take).toBe(20);
      expect(args.where.AND).toEqual(
        expect.arrayContaining([
          PASTOR_ELIGIBLE_USER_WHERE,
          {
            OR: [
              { name: { contains: 'Ana', mode: 'insensitive' } },
              { paternal_last_name: { contains: 'Ana', mode: 'insensitive' } },
              { maternal_last_name: { contains: 'Ana', mode: 'insensitive' } },
              { email: { contains: 'Ana', mode: 'insensitive' } },
            ],
          },
          {
            OR: [
              { name: { contains: 'Pérez', mode: 'insensitive' } },
              {
                paternal_last_name: { contains: 'Pérez', mode: 'insensitive' },
              },
              {
                maternal_last_name: { contains: 'Pérez', mode: 'insensitive' },
              },
              { email: { contains: 'Pérez', mode: 'insensitive' } },
            ],
          },
        ]),
      );
    });

    it.each([
      ['director-lf', { localFieldId: FIELD_ID }],
      ['assistant-lf', { localFieldId: FIELD_ID }],
    ])(
      'R5 limits %s to pastors whose local field is its own',
      async (role, scope) => {
        await service.searchCandidates(snapshot({ role, ...scope }), 'ana');
        const and = users.findMany.mock.calls[0][0].where.AND;
        expect(and).toContainEqual({ local_field_id: FIELD_ID });
        expect(JSON.stringify(and)).not.toContain('union_id');
      },
    );

    it.each(['director-union', 'assistant-union'])(
      'R5 limits %s to pastors in the local fields of its union',
      async (role) => {
        await service.searchCandidates(snapshot({ role, unionId: 2 }), 'ana');
        const and = users.findMany.mock.calls[0][0].where.AND;
        expect(and).toContainEqual({ local_fields: { union_id: 2 } });
        expect(and).not.toContainEqual({ local_field_id: expect.anything() });
      },
    );

    it.each(['a b', 'ana b', 'a bc', 'ab c d'])(
      'R5 never scans users when a token of "%s" has fewer than 2 characters',
      async (query) => {
        const found = await service.searchCandidates(
          snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
          query,
        );
        expect(found).toEqual([]);
        expect(users.findMany).not.toHaveBeenCalled();
      },
    );

    describe('with districtId', () => {
      it.each(['director-union', 'assistant-union'])(
        'limits %s to the Field of that district, not the whole union',
        async (role) => {
          await service.searchCandidates(
            snapshot({ role, unionId: 2 }),
            'ana',
            SAME_UNION_DISTRICT_ID,
          );
          const and = users.findMany.mock.calls[0][0].where.AND;
          expect(and).toContainEqual({ local_field_id: OTHER_FIELD_ID });
          expect(JSON.stringify(and)).not.toContain('union_id');
          expect(and).toContainEqual(PASTOR_ELIGIBLE_USER_WHERE);
        },
      );

      it('limits a Field role to the district Field', async () => {
        await service.searchCandidates(
          snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
          'ana',
          DISTRICT_ID,
        );
        const and = users.findMany.mock.calls[0][0].where.AND;
        expect(and).toContainEqual({ local_field_id: FIELD_ID });
      });

      it('rejects a district outside the actor territory without reading users', async () => {
        await expect(
          service.searchCandidates(
            snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
            'ana',
            SAME_UNION_DISTRICT_ID,
          ),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
        await expect(
          service.searchCandidates(
            snapshot({ role: 'director-union', unionId: 2 }),
            'ana',
            OUTSIDE_DISTRICT_ID,
          ),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
        expect(users.findMany).not.toHaveBeenCalled();
      });

      it('rejects an unknown district without reading users', async () => {
        await expect(
          service.searchCandidates(
            snapshot({ role: 'director-union', unionId: 2 }),
            'ana',
            9999,
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.INVESTITURE_PASTOR_DISTRICT_NOT_FOUND,
        });
        expect(users.findMany).not.toHaveBeenCalled();
      });

      it('authorizes the district even when the query is too short to scan', async () => {
        await expect(
          service.searchCandidates(
            snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
            ' a ',
            OUTSIDE_DISTRICT_ID,
          ),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      });
    });

    it('escapes LIKE wildcards so "%" and "_" are plain text', async () => {
      await service.searchCandidates(
        snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
        'a_%\\b',
      );
      const args = users.findMany.mock.calls[0][0];
      expect(args.where.AND[2].OR[0]).toEqual({
        name: { contains: 'a\\_\\%\\\\b', mode: 'insensitive' },
      });
    });

    it.each([
      ['admin', {}],
      ['super-admin', {}],
      ['coordinator', {}],
    ])('rejects %s without reading users', async (role, scope) => {
      await expect(
        service.searchCandidates(snapshot({ role, ...scope }), 'ana'),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      expect(users.findMany).not.toHaveBeenCalled();
    });

    it('rejects a union role with no union scope', async () => {
      await expect(
        service.searchCandidates(snapshot({ role: 'director-union' }), 'ana'),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
      expect(users.findMany).not.toHaveBeenCalled();
    });

    it('never scans users for a query shorter than 3 characters after trimming', async () => {
      const found = await service.searchCandidates(
        snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
        ' a ',
      );
      expect(found).toEqual([]);
      expect(users.findMany).not.toHaveBeenCalled();
    });
  });

  it('BC-6 keeps the quota when the global pastor role is gone', async () => {
    const field = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
    await service.updateQuota(snapshot({ role: 'super-admin' }), 1, 'root-1');
    await service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1');
    rolelessUsers.add(PASTOR_A);
    const listed = await service.list(field, DISTRICT_ID);
    expect(listed.pastors).toEqual([
      {
        districlub_type_id: DISTRICT_ID,
        user_id: PASTOR_A,
        can_authorize: false,
        role_missing: true,
        ...ANA_VIEW,
      },
    ]);
    expect(listed.slots).toBe(1);
    const authorizers = await service.authorizersForClub(field, CLUB_ID);
    expect(authorizers.authorizers).toEqual([]);
    await expect(
      service.assign(field, DISTRICT_ID, PASTOR_B, 'user-1'),
    ).rejects.toMatchObject({ code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL });
  });

  it('BCR-6 keeps the quota, marks account_inactive and drops a deleted account from the authorizers', async () => {
    const field = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
    await service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1');
    await service.assign(field, DISTRICT_ID, PASTOR_B, 'user-1');
    deletedUsers.add(PASTOR_A);
    const listed = await service.list(field, DISTRICT_ID);
    expect(listed.pastors).toEqual([
      {
        districlub_type_id: DISTRICT_ID,
        user_id: PASTOR_A,
        can_authorize: false,
        account_inactive: true,
        ...ANA_VIEW,
      },
      {
        districlub_type_id: DISTRICT_ID,
        user_id: PASTOR_B,
        can_authorize: true,
        ...BETO_VIEW,
      },
    ]);
    expect(listed.can_assign).toBe(false);
    const authorizers = await service.authorizersForClub(field, CLUB_ID);
    expect(authorizers.authorizers.map((item) => item.user_id)).toEqual([
      PASTOR_B,
    ]);
    await expect(
      service.assign(field, DISTRICT_ID, PASTOR_C, 'user-1'),
    ).rejects.toMatchObject({ code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL });
  });
});

type RacingRow = {
  districlub_type_id: number;
  user_id: string;
  active: boolean;
  assigned_by_id: string | null;
};

function sqlText(sql: unknown): string {
  if (
    sql &&
    typeof sql === 'object' &&
    'strings' in sql &&
    Array.isArray(sql.strings)
  ) {
    return sql.strings.join('?');
  }
  return String(sql);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRacing(options: {
  quota: { slots: number } | null;
  rows: RacingRow[];
  pause?: 'groupBy' | 'quotaRead';
}) {
  let quota = options.quota
    ? { quota_id: 1, slots: options.quota.slots }
    : null;
  const rows = options.rows.map((row) => ({ ...row }));
  const calls: string[] = [];
  let owner: symbol | null = null;
  const waiters: Array<() => void> = [];
  let paused = false;
  let markEntered: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  let resume: () => void = () => undefined;
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });

  const acquire = (token: symbol) => {
    if (!owner) {
      owner = token;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiters.push(() => {
        owner = token;
        resolve();
      });
    });
  };
  const release = (token: symbol) => {
    if (owner !== token) {
      return;
    }
    owner = null;
    const next = waiters.shift();
    next?.();
  };
  const holdPause = async (point: 'groupBy' | 'quotaRead') => {
    if (options.pause !== point || paused) {
      return;
    }
    paused = true;
    markEntered();
    await resumed;
  };
  const matches = (where: {
    districlub_type_id?: number;
    user_id?: string;
    active?: boolean;
    districlub_type_id_user_id?: {
      districlub_type_id: number;
      user_id: string;
    };
  }) =>
    rows.filter((row) => {
      const districtId =
        where.districlub_type_id_user_id?.districlub_type_id ??
        where.districlub_type_id;
      const userId = where.districlub_type_id_user_id?.user_id ?? where.user_id;
      if (districtId !== undefined && row.districlub_type_id !== districtId) {
        return false;
      }
      if (userId !== undefined && row.user_id !== userId) {
        return false;
      }
      if (where.active !== undefined && row.active !== where.active) {
        return false;
      }
      return true;
    });

  const pastors = {
    findMany: jest.fn(async ({ where }) => matches(where)),
    count: jest.fn(async ({ where }) => {
      calls.push('count');
      return matches(where).length;
    }),
    findUnique: jest.fn(async ({ where }) => matches(where)[0] ?? null),
    create: jest.fn(async ({ data }) => {
      calls.push('create');
      rows.push({ ...data, active: data.active ?? true });
      return data;
    }),
    update: jest.fn(async ({ where, data }) => {
      calls.push('update');
      const row = matches(where)[0];
      Object.assign(row, data);
      return row;
    }),
    groupBy: jest.fn(async () => {
      calls.push('groupBy');
      const counts = new Map<number, number>();
      for (const row of rows) {
        if (!row.active) {
          continue;
        }
        counts.set(
          row.districlub_type_id,
          (counts.get(row.districlub_type_id) ?? 0) + 1,
        );
      }
      const grouped = [...counts.entries()].map(
        ([districlub_type_id, count]) => ({
          districlub_type_id,
          _count: { user_id: count },
        }),
      );
      await holdPause('groupBy');
      return grouped;
    }),
  };
  const quotaDelegate = {
    findUnique: jest.fn(async () => {
      calls.push('quotaRead');
      await holdPause('quotaRead');
      return quota;
    }),
    upsert: jest.fn(async ({ create, update }) => {
      calls.push('upsert');
      quota = { quota_id: 1, slots: update.slots ?? create.slots };
      return quota;
    }),
  };
  const users = {
    findUnique: jest.fn(async ({ where }) => ({
      user_id: where.user_id,
      active: true,
      local_field_id: FIELD_ID,
    })),
    findMany: jest.fn(
      async ({ where }: { where: { user_id: { in: string[] } } }) =>
        where.user_id.in.map((id) => ({
          user_id: id,
          active: true,
          users_roles: [{ user_role_id: 'role-1' }],
        })),
    ),
  };
  const shared = {
    investiture_pastor_quota: quotaDelegate,
    district_investiture_pastors: pastors,
    districts: {
      findUnique: jest.fn(async () => ({ local_field_id: FIELD_ID })),
    },
    local_fields: {
      findUnique: jest.fn(async () => ({ union_id: 2 })),
    },
    users,
  };

  const prisma = {
    ...shared,
    $queryRaw: jest.fn(),
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      const token = Symbol('tx');
      let acquired = false;
      const tx = {
        ...shared,
        $executeRaw: async (sql: unknown) => {
          const text = sqlText(sql);
          if (text.includes('pg_advisory_xact_lock')) {
            calls.push('advisory');
            await acquire(token);
            acquired = true;
          }
          return 0;
        },
        $queryRaw: async (sql: unknown) => {
          const text = sqlText(sql);
          if (text.includes('districts')) {
            calls.push('district');
          }
          return [];
        },
      };
      return fn(tx).finally(() => {
        if (acquired) {
          release(token);
        }
      });
    },
  };

  return {
    service: new DistrictInvestiturePastorService(prisma as never),
    calls,
    rows,
    waitEntered: () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('la operación no llegó al candado')),
          2000,
        );
      });
      return Promise.race([entered, timeout]).finally(() => {
        if (timer) {
          clearTimeout(timer);
        }
      });
    },
    release: resume,
    activeCount: () => rows.filter((row) => row.active).length,
    slots: () => quota?.slots ?? null,
  };
}

describe('cupo y altas comparten el candado', () => {
  const root = snapshot({ role: 'super-admin' });
  const field = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });

  it.each([true, false])(
    'la reducción espera al alta cuando ya hay un pastor (fila de cupo: %s)',
    async (withQuotaRow) => {
      const harness = buildRacing({
        quota: withQuotaRow ? { slots: 2 } : null,
        rows: [
          {
            districlub_type_id: DISTRICT_ID,
            user_id: PASTOR_A,
            active: true,
            assigned_by_id: 'user-1',
          },
        ],
        pause: 'groupBy',
      });
      const lowering = harness.service.updateQuota(root, 1, 'root-1');
      await harness.waitEntered();
      let assignSettled = false;
      const assigning = harness.service
        .assign(field, DISTRICT_ID, PASTOR_B, 'user-1')
        .finally(() => {
          assignSettled = true;
        });
      await delay(80);
      expect(assignSettled).toBe(false);
      harness.release();

      const [lowered, assigned] = await Promise.allSettled([
        lowering,
        assigning,
      ]);
      expect(lowered.status).toBe('fulfilled');
      expect(assigned.status).toBe('rejected');
      if (assigned.status === 'rejected') {
        expect(assigned.reason).toMatchObject({
          code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL,
        });
      }
      expect(harness.activeCount()).toBe(1);
      expect(harness.slots()).toBe(1);
      expect(harness.activeCount()).toBeLessThanOrEqual(harness.slots() ?? 2);
    },
  );

  it.each([true, false])(
    'el alta espera a la reducción a cero cuando no hay pastores (fila de cupo: %s)',
    async (withQuotaRow) => {
      const harness = buildRacing({
        quota: withQuotaRow ? { slots: 2 } : null,
        rows: [],
        pause: 'quotaRead',
      });
      const assigning = harness.service.assign(
        field,
        DISTRICT_ID,
        PASTOR_A,
        'user-1',
      );
      await harness.waitEntered();
      let lowerSettled = false;
      const lowering = harness.service
        .updateQuota(root, 0, 'root-1')
        .finally(() => {
          lowerSettled = true;
        });
      await delay(80);
      expect(lowerSettled).toBe(false);
      harness.release();

      const [assigned, lowered] = await Promise.allSettled([
        assigning,
        lowering,
      ]);
      expect(assigned.status).toBe('fulfilled');
      expect(lowered.status).toBe('rejected');
      if (lowered.status === 'rejected') {
        expect(lowered.reason).toMatchObject({
          code: ErrorCode.INVESTITURE_PASTOR_QUOTA_BELOW_ASSIGNMENTS,
        });
      }
      expect(harness.activeCount()).toBe(1);
      expect(harness.slots()).toBe(withQuotaRow ? 2 : null);
      expect(harness.activeCount()).toBeLessThanOrEqual(harness.slots() ?? 2);
      expect(harness.rows.filter((row) => row.active)).toHaveLength(1);
    },
  );

  it('deja un solo pastor cuando dos altas compiten por el último cupo', async () => {
    const harness = buildRacing({
      quota: { slots: 1 },
      rows: [],
    });
    const results = await Promise.allSettled([
      harness.service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1'),
      harness.service.assign(field, DISTRICT_ID, PASTOR_B, 'user-1'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(
      rejected && rejected.status === 'rejected' ? rejected.reason : null,
    ).toMatchObject({
      code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL,
    });
    expect(harness.activeCount()).toBe(1);
    expect(harness.slots()).toBe(1);
  });

  it('deja un solo pastor cuando una reactivación y un alta compiten por el último cupo', async () => {
    const harness = buildRacing({
      quota: { slots: 1 },
      rows: [
        {
          districlub_type_id: DISTRICT_ID,
          user_id: PASTOR_A,
          active: false,
          assigned_by_id: 'user-1',
        },
      ],
    });
    const results = await Promise.allSettled([
      harness.service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1'),
      harness.service.assign(field, DISTRICT_ID, PASTOR_B, 'user-1'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(
      rejected && rejected.status === 'rejected' ? rejected.reason : null,
    ).toMatchObject({
      code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL,
    });
    expect(harness.activeCount()).toBe(1);
    expect(harness.slots()).toBe(1);
  });

  it('toma el candado antes de contar y antes del bloqueo del distrito', async () => {
    const harness = buildRacing({ quota: null, rows: [] });
    await harness.service.updateQuota(root, 1, 'root-1');
    expect(harness.calls.indexOf('advisory')).toBeGreaterThanOrEqual(0);
    expect(harness.calls.indexOf('advisory')).toBeLessThan(
      harness.calls.indexOf('groupBy'),
    );
    expect(harness.calls.indexOf('groupBy')).toBeLessThan(
      harness.calls.indexOf('upsert'),
    );

    harness.calls.length = 0;
    await harness.service.assign(field, DISTRICT_ID, PASTOR_A, 'user-1');
    expect(harness.calls.indexOf('advisory')).toBeLessThan(
      harness.calls.indexOf('district'),
    );
    expect(harness.calls.indexOf('district')).toBeLessThan(
      harness.calls.indexOf('quotaRead'),
    );
    expect(harness.calls.indexOf('quotaRead')).toBeLessThan(
      harness.calls.indexOf('count'),
    );
  });

  it('la lectura no toma el candado ni inserta la fila', async () => {
    const harness = buildRacing({ quota: null, rows: [] });
    const view = await harness.service.getQuota(field);
    expect(view).toEqual({ slots: 2, configured: false, can_edit: false });
    expect(harness.calls).not.toContain('advisory');
    expect(harness.slots()).toBeNull();
  });
});
