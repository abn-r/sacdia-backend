import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthorizationContextService } from '../../common/services/authorization-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { UnitsController } from '../units.controller';
import {
  UnitWeeklyRecordWriter,
  UnitWeeklyRecordWriterGuard,
} from './unit-weekly-record-writer.guard';

const CAPTAIN = '11111111-1111-4111-8111-111111111111';
const SECRETARY = '22222222-2222-4222-8222-222222222222';
const ADVISOR = '33333333-3333-4333-8333-333333333333';
const SUBSTITUTE = '44444444-4444-4444-8444-444444444444';
const OTHER_LEADER = '55555555-5555-4555-8555-555555555555';
const DIRECTOR = '66666666-6666-4666-8666-666666666666';
const MEMBER = '77777777-7777-4777-8777-777777777777';

type UnitRow = {
  unit_id: number;
  active: boolean;
  main_club_id: number;
  captain_id: string;
  secretary_id: string;
  advisor_id: string;
  substitute_advisor_id: string | null;
};

/**
 * In-memory `units` table. `findFirst` evaluates the same `where` shape the
 * guard sends, so the tests exercise the real filter (active, club, leader
 * columns) and not just "findFirst was called".
 */
function buildPrisma(rows: UnitRow[]) {
  const findFirst = jest.fn(async ({ where }: any) => {
    return (
      rows.find((row) => {
        if (row.unit_id !== where.unit_id) return false;
        if (where.active !== undefined && row.active !== where.active)
          return false;
        if (
          where.club_sections?.main_club_id !== undefined &&
          row.main_club_id !== where.club_sections.main_club_id
        )
          return false;
        return (where.OR as Array<Record<string, string>>).some((clause) =>
          Object.entries(clause).every(
            ([column, value]) => (row as any)[column] === value,
          ),
        );
      }) ?? null
    );
  });
  return { units: { findFirst } } as unknown as PrismaService & {
    units: { findFirst: jest.Mock };
  };
}

describe('UnitWeeklyRecordWriterGuard', () => {
  const CLUB_ID = 7;
  const UNIT_ID = 100;
  const OTHER_UNIT_ID = 101;
  const OTHER_CLUB_UNIT_ID = 200;
  const INACTIVE_UNIT_ID = 300;

  const rows: UnitRow[] = [
    {
      unit_id: UNIT_ID,
      active: true,
      main_club_id: CLUB_ID,
      captain_id: CAPTAIN,
      secretary_id: SECRETARY,
      advisor_id: ADVISOR,
      substitute_advisor_id: SUBSTITUTE,
    },
    {
      unit_id: OTHER_UNIT_ID,
      active: true,
      main_club_id: CLUB_ID,
      captain_id: OTHER_LEADER,
      secretary_id: OTHER_LEADER,
      advisor_id: OTHER_LEADER,
      substitute_advisor_id: null,
    },
    {
      unit_id: OTHER_CLUB_UNIT_ID,
      active: true,
      main_club_id: 8,
      captain_id: CAPTAIN,
      secretary_id: SECRETARY,
      advisor_id: ADVISOR,
      substitute_advisor_id: SUBSTITUTE,
    },
    {
      unit_id: INACTIVE_UNIT_ID,
      active: false,
      main_club_id: CLUB_ID,
      captain_id: CAPTAIN,
      secretary_id: SECRETARY,
      advisor_id: ADVISOR,
      substitute_advisor_id: SUBSTITUTE,
    },
  ];

  let prisma: ReturnType<typeof buildPrisma>;
  const resolveUserAuthorization = jest.fn();
  let guard: UnitWeeklyRecordWriterGuard;

  const profile = (permissions: string[]) => ({
    authorization: { effective: { permissions } },
  });

  const contextFor = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as any;

  const requestFor = (
    userId: string | undefined,
    permissions: string[] | null,
    params: Record<string, string> = {
      clubId: String(CLUB_ID),
      unitId: String(UNIT_ID),
    },
  ) => ({
    user: userId ? { sub: userId } : undefined,
    params,
    ...(permissions ? { authorizationProfile: profile(permissions) } : {}),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrisma(rows);
    guard = new UnitWeeklyRecordWriterGuard(
      { resolveUserAuthorization } as unknown as AuthorizationContextService,
      prisma,
    );
  });

  describe('callers with units:update', () => {
    it('passes without touching the units table', async () => {
      await expect(
        guard.canActivate(
          contextFor(requestFor(DIRECTOR, ['units:read', 'units:update'])),
        ),
      ).resolves.toBe(true);
      expect(prisma.units.findFirst).not.toHaveBeenCalled();
    });

    it('passes with units:update alone (no units:read)', async () => {
      await expect(
        guard.canActivate(contextFor(requestFor(DIRECTOR, ['units:update']))),
      ).resolves.toBe(true);
    });

    it('passes even when the unit does not exist (the service answers 404 as before)', async () => {
      await expect(
        guard.canActivate(
          contextFor(
            requestFor(DIRECTOR, ['units:update'], {
              clubId: String(CLUB_ID),
              unitId: '999',
            }),
          ),
        ),
      ).resolves.toBe(true);
    });
  });

  describe('unit leaders holding only units:read', () => {
    it.each([
      ['captain', CAPTAIN],
      ['secretary', SECRETARY],
      ['advisor', ADVISOR],
      ['substitute advisor', SUBSTITUTE],
    ])('lets the %s of the unit through', async (_role, userId) => {
      await expect(
        guard.canActivate(contextFor(requestFor(userId, ['units:read']))),
      ).resolves.toBe(true);
      expect(prisma.units.findFirst).toHaveBeenCalledTimes(1);
    });

    it('filters by unit, active flag, route club and the four leader columns', async () => {
      await guard.canActivate(contextFor(requestFor(CAPTAIN, ['units:read'])));

      expect(prisma.units.findFirst).toHaveBeenCalledWith({
        where: {
          unit_id: UNIT_ID,
          active: true,
          club_sections: { main_club_id: CLUB_ID },
          OR: [
            { captain_id: CAPTAIN },
            { secretary_id: CAPTAIN },
            { advisor_id: CAPTAIN },
            { substitute_advisor_id: CAPTAIN },
          ],
        },
        select: { unit_id: true },
      });
    });

    it('resolves the profile itself when PermissionsGuard did not attach one', async () => {
      resolveUserAuthorization.mockResolvedValueOnce(profile(['units:read']));

      await expect(
        guard.canActivate(contextFor(requestFor(CAPTAIN, null))),
      ).resolves.toBe(true);
      expect(resolveUserAuthorization).toHaveBeenCalledWith(CAPTAIN);
    });
  });

  describe('everyone else is denied with GUARD_PERMISSION_DENIED', () => {
    const denied = { code: ErrorCode.GUARD_PERMISSION_DENIED };

    it('denies a member with units:read who leads a DIFFERENT unit of the same club', async () => {
      await expect(
        guard.canActivate(contextFor(requestFor(OTHER_LEADER, ['units:read']))),
      ).rejects.toMatchObject(denied);
    });

    it('denies a plain member who leads nothing', async () => {
      await expect(
        guard.canActivate(contextFor(requestFor(MEMBER, ['units:read']))),
      ).rejects.toMatchObject(denied);
    });

    it('denies a leader of a unit that belongs to a different club than :clubId', async () => {
      await expect(
        guard.canActivate(
          contextFor(
            requestFor(CAPTAIN, ['units:read'], {
              clubId: String(CLUB_ID),
              unitId: String(OTHER_CLUB_UNIT_ID),
            }),
          ),
        ),
      ).rejects.toMatchObject(denied);
    });

    it('denies the leader of a unit when the route points to another club', async () => {
      await expect(
        guard.canActivate(
          contextFor(
            requestFor(CAPTAIN, ['units:read'], {
              clubId: '8',
              unitId: String(UNIT_ID),
            }),
          ),
        ),
      ).rejects.toMatchObject(denied);
    });

    it.each([
      ['captain', CAPTAIN],
      ['secretary', SECRETARY],
      ['advisor', ADVISOR],
      ['substitute advisor', SUBSTITUTE],
    ])('denies the %s of an INACTIVE unit', async (_role, userId) => {
      await expect(
        guard.canActivate(
          contextFor(
            requestFor(userId, ['units:read'], {
              clubId: String(CLUB_ID),
              unitId: String(INACTIVE_UNIT_ID),
            }),
          ),
        ),
      ).rejects.toMatchObject(denied);
    });

    it('denies a non-existent unit', async () => {
      await expect(
        guard.canActivate(
          contextFor(
            requestFor(CAPTAIN, ['units:read'], {
              clubId: String(CLUB_ID),
              unitId: '999',
            }),
          ),
        ),
      ).rejects.toMatchObject(denied);
    });

    it.each([
      ['non numeric unitId', { clubId: '7', unitId: 'abc' }],
      ['partially numeric unitId', { clubId: '7', unitId: '100abc' }],
      ['zero clubId', { clubId: '0', unitId: '100' }],
      ['missing params', {}],
    ])('denies %s without querying', async (_label, params) => {
      await expect(
        guard.canActivate(
          contextFor(requestFor(CAPTAIN, ['units:read'], params)),
        ),
      ).rejects.toMatchObject(denied);
      expect(prisma.units.findFirst).not.toHaveBeenCalled();
    });

    it('does not treat units:create / units:delete as units:update', async () => {
      await expect(
        guard.canActivate(
          contextFor(
            requestFor(MEMBER, ['units:read', 'units:create', 'units:delete']),
          ),
        ),
      ).rejects.toMatchObject(denied);
    });

    it('rejects an unauthenticated request', async () => {
      await expect(
        guard.canActivate(contextFor(requestFor(undefined, ['units:update']))),
      ).rejects.toMatchObject({
        code: ErrorCode.GUARD_USER_NOT_AUTHENTICATED,
      });
    });
  });
});

describe('UnitsController permission metadata', () => {
  const reflector = new Reflector();
  const proto = UnitsController.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const requirementOf = (method: string) =>
    reflector.get(PERMISSIONS_KEY, proto[method]);
  const guardsOf = (method: string): unknown[] =>
    Reflect.getMetadata(GUARDS_METADATA, proto[method]) ?? [];

  it.each([
    'createWeeklyRecord',
    'bulkUpsertWeeklyRecords',
    'updateWeeklyRecord',
  ])(
    '%s accepts units:update OR units:read and adds the leader guard',
    (method) => {
      expect(requirementOf(method)).toEqual({
        permissions: ['units:update', 'units:read'],
        mode: 'any',
      });
      expect(guardsOf(method)).toContain(UnitWeeklyRecordWriterGuard);
    },
  );

  it.each([
    ['create', 'units:create'],
    ['update', 'units:update'],
    ['remove', 'units:delete'],
    ['addMember', 'units:update'],
    ['removeMember', 'units:update'],
  ])(
    'unit CRUD %s still requires only %s and has no leader guard',
    (method, permission) => {
      expect(requirementOf(method)).toEqual({
        permissions: [permission],
        mode: 'all',
      });
      expect(guardsOf(method)).not.toContain(UnitWeeklyRecordWriterGuard);
    },
  );

  it.each(['findByClub', 'findOne', 'findWeeklyRecords'])(
    'read endpoint %s is unchanged (units:read)',
    (method) => {
      expect(requirementOf(method)).toEqual({
        permissions: ['units:read'],
        mode: 'all',
      });
    },
  );

  it('the decorator is only attached to the three weekly-record writes', () => {
    const decorated = Object.getOwnPropertyNames(UnitsController.prototype)
      .filter((name) => name !== 'constructor')
      .filter((name) => guardsOf(name).includes(UnitWeeklyRecordWriterGuard));
    expect(decorated.sort()).toEqual(
      [
        'bulkUpsertWeeklyRecords',
        'createWeeklyRecord',
        'updateWeeklyRecord',
      ].sort(),
    );
  });

  it('exposes a factory that returns a decorator', () => {
    expect(typeof UnitWeeklyRecordWriter()).toBe('function');
  });
});
