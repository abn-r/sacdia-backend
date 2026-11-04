import { ErrorCode } from '../../../errors/error-codes';
import {
  CamporeeScopeLoader,
  TerritoryScopeValidator,
} from '../scope/territory-scope';
import {
  buildAuthorizationContext,
  buildCtx,
  buildHierarchy,
  unionRow,
} from '../scope/territory-scope.testing';
import { UnionCamporeePolicy } from './union-camporee.policy';

describe('UnionCamporeePolicy', () => {
  const build = (found: unknown, canAccess: boolean) => {
    const prisma = {
      union_camporees: { findUnique: jest.fn().mockResolvedValue(found) },
      union_camporee_local_fields: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;
    const hierarchy = buildHierarchy();
    return new UnionCamporeePolicy(
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
      { type: 'union_camporee', idParam: 'unionCamporeeId' },
      { params: { unionCamporeeId: '4' } },
    );

  it('handles the union_camporee resource type', () => {
    expect(build(unionRow, true).type).toBe('union_camporee');
  });

  it('throws 404 when the union camporee does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      status: 404,
      code: ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND,
    });
  });

  it('allows when the actor can access the hierarchy scope', async () => {
    await expect(build(unionRow, true).resolve(ctx())).resolves.toBe(true);
  });

  it('denies with GUARD_CLUB_SCOPE_REQUIRED otherwise', async () => {
    await expect(build(unionRow, false).resolve(ctx())).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });
});
