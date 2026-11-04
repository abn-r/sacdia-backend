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
} from '../scope/territory-scope.testing';
import { CamporeePolicy } from './camporee.policy';

describe('CamporeePolicy', () => {
  const build = (found: unknown, canAccess: boolean) => {
    const prisma = {
      local_camporees: { findUnique: jest.fn().mockResolvedValue(found) },
    } as any;
    const hierarchy = buildHierarchy();
    return new CamporeePolicy(
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
      { type: 'camporee', idParam: 'camporeeId' },
      { params: { camporeeId: '8' } },
    );

  it('handles the camporee resource type', () => {
    expect(build(camporeeRow, true).type).toBe('camporee');
  });

  it('throws 404 when the camporee does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      status: 404,
      code: ErrorCode.CAMPOREE_NOT_FOUND,
    });
  });

  it('allows when the actor can access the hierarchy scope', async () => {
    await expect(build(camporeeRow, true).resolve(ctx())).resolves.toBe(true);
  });

  it('denies with GUARD_CLUB_SCOPE_REQUIRED otherwise', async () => {
    await expect(
      build(camporeeRow, false).resolve(ctx()),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });
});
