import { CamporeesService } from './camporees.service';
import { ErrorCode } from '../common/errors/error-codes';
import {
  actorProfile,
  TERRITORIAL_PERMISSIONS,
} from '../common/testing/actor-scope.fixture';

/**
 * B8 (union-division-app-surface): union camporee list (function 3 / 9) is
 * forced to the actor's territory (S4.3, S10.3) and fails closed when the
 * territory is unconfigured (R1.5, S1.7). A client `union_id` filter can
 * narrow but never widen.
 *
 * Real code under test: CamporeesService.findAllUnion ->
 * applyUnionCamporeeScope -> resolveCamporeeAccessScope ->
 * resolveActorTerritoryScope. Doubles: Prisma and the unrelated collaborators.
 *
 * Enforcing code (grep `applyUnionCamporeeScope` / `resolveCamporeeAccessScope`
 * in camporees/camporees.service.ts; findAllUnion starts near line 619): union
 * -> `where.union_id = scope.id`, division -> `where.unions.division_id`,
 * unconfigured -> AppForbiddenException(ADMIN_USER_SCOPE_MISSING).
 */

const unionActor = (unionId = 3) =>
  actorProfile({
    userId: 'union-1',
    globalRoles: [
      { roleName: 'director-union', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: { union: { id: unionId }, division: { id: 1 } },
  });
const divisionActor = () =>
  actorProfile({
    userId: 'division-1',
    globalRoles: [
      { roleName: 'assistant-dia', permissions: TERRITORIAL_PERMISSIONS },
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
const unconfiguredDivisionActor = () =>
  actorProfile({
    userId: 'division-2',
    globalRoles: [
      { roleName: 'director-dia', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: {},
  });

describe('CamporeesService union list territory coverage (union-division-app-surface B8)', () => {
  let prisma: any;
  let service: CamporeesService;

  beforeEach(() => {
    prisma = {
      union_camporees: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    service = new CamporeesService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  const lastWhere = () =>
    prisma.union_camporees.findMany.mock.calls.at(-1)[0].where as Record<
      string,
      any
    >;

  it('Union 3: the list is forced to union 3', async () => {
    await service.findAllUnion({}, undefined, unionActor(3).authorization);

    expect(lastWhere()).toMatchObject({ union_id: 3 });
  });

  it('Union 3: a client union_id of another union is overwritten, never widened (S4.3)', async () => {
    await service.findAllUnion(
      { union_id: 4 },
      undefined,
      unionActor(3).authorization,
    );

    expect(lastWhere().union_id).toBe(3);
    expect(prisma.union_camporees.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ union_id: 3 }),
    });
  });

  it('Division 1: the list is limited to unions of division 1; a client union_id stays ANDed with it', async () => {
    await service.findAllUnion(
      { union_id: 5 },
      undefined,
      divisionActor().authorization,
    );

    const where = lastWhere();
    expect(where.unions).toEqual({ division_id: 1 });
    // union 5 belongs to division 2: both conditions must hold, so no row.
    expect(where.union_id).toBe(5);
  });

  it('unconfigured Union actor: 403 ADMIN_USER_SCOPE_MISSING and no query is run', async () => {
    await expect(
      service.findAllUnion(
        {},
        undefined,
        unconfiguredUnionActor().authorization,
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.ADMIN_USER_SCOPE_MISSING,
    });
    expect(prisma.union_camporees.findMany).not.toHaveBeenCalled();
  });

  it('unconfigured Division actor: 403 ADMIN_USER_SCOPE_MISSING and no query is run', async () => {
    await expect(
      service.findAllUnion(
        {},
        undefined,
        unconfiguredDivisionActor().authorization,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    expect(prisma.union_camporees.findMany).not.toHaveBeenCalled();
  });
});
