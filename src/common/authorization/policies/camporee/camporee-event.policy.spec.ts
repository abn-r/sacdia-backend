import { ErrorCode } from '../../../errors/error-codes';
import {
  CamporeeScopeLoader,
  TerritoryScopeValidator,
} from '../scope/territory-scope';
import {
  buildAuthorizationContext,
  buildCtx,
  buildHierarchy,
  camporeeRow,
  unionRow,
} from '../scope/territory-scope.testing';
import { CamporeeEventPolicy } from './camporee-event.policy';

describe('CamporeeEventPolicy', () => {
  const build = (
    event: unknown,
    canAccess: boolean,
    rows: { local?: unknown; union?: unknown } = {},
  ) => {
    const prisma = {
      camporee_events: { findUnique: jest.fn().mockResolvedValue(event) },
      local_camporees: {
        findUnique: jest.fn().mockResolvedValue(rows.local ?? null),
      },
      union_camporees: {
        findUnique: jest.fn().mockResolvedValue(rows.union ?? null),
      },
      union_camporee_local_fields: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;
    const hierarchy = buildHierarchy();
    return new CamporeeEventPolicy(
      prisma,
      new TerritoryScopeValidator(
        buildAuthorizationContext(canAccess),
        prisma,
        hierarchy,
      ),
      new CamporeeScopeLoader(prisma, hierarchy),
    );
  };
  const ctx = () =>
    buildCtx(
      { type: 'camporee_event', idParam: 'eventId' },
      { params: { eventId: '5' } },
    );
  const localEvent = { local_camporee_id: 7, union_camporee_id: null };
  const unionEvent = { local_camporee_id: null, union_camporee_id: 4 };

  it('handles the camporee_event resource type', () => {
    expect(build(localEvent, true).type).toBe('camporee_event');
  });

  it('throws 404 when the event does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      status: 404,
      code: ErrorCode.CAMPOREE_EVENT_NOT_FOUND,
    });
  });

  it('local branch: allows through the hierarchy scope', async () => {
    await expect(
      build(localEvent, true, { local: camporeeRow }).resolve(ctx()),
    ).resolves.toBe(true);
  });

  it('local branch: denies with GUARD_CLUB_SCOPE_REQUIRED', async () => {
    await expect(
      build(localEvent, false, { local: camporeeRow }).resolve(ctx()),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });

  it('union branch: allows through the hierarchy scope', async () => {
    await expect(
      build(unionEvent, true, { union: unionRow }).resolve(ctx()),
    ).resolves.toBe(true);
  });

  it('union branch: denies with GUARD_CLUB_SCOPE_REQUIRED', async () => {
    await expect(
      build(unionEvent, false, { union: unionRow }).resolve(ctx()),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });
});
