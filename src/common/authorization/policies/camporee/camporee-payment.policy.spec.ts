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
import { CamporeePaymentPolicy } from './camporee-payment.policy';

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';

describe('CamporeePaymentPolicy', () => {
  const build = (
    payment: unknown,
    canAccess: boolean,
    rows: { local?: unknown; union?: unknown } = {},
  ) => {
    const prisma = {
      camporee_payments: { findUnique: jest.fn().mockResolvedValue(payment) },
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
    return new CamporeePaymentPolicy(
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
      { type: 'camporee_payment', idParam: 'paymentId' },
      { params: { paymentId: PAYMENT_ID } },
    );
  const member = (
    camporee_id: number | null,
    union_camporee_id: number | null,
  ) => ({
    camporee_member: { camporee_id, union_camporee_id },
  });

  it('handles the camporee_payment resource type', () => {
    expect(build(member(7, null), true).type).toBe('camporee_payment');
  });

  it('throws 404 when the payment does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      status: 404,
      code: ErrorCode.CAMPOREE_PAYMENT_NOT_FOUND,
    });
  });

  it('local branch: allows through the hierarchy scope', async () => {
    await expect(
      build(member(7, null), true, { local: camporeeRow }).resolve(ctx()),
    ).resolves.toBe(true);
  });

  it('local branch: denies with GUARD_CLUB_SCOPE_REQUIRED', async () => {
    await expect(
      build(member(7, null), false, { local: camporeeRow }).resolve(ctx()),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });

  it('union branch: allows through the hierarchy scope', async () => {
    await expect(
      build(member(null, 4), true, { union: unionRow }).resolve(ctx()),
    ).resolves.toBe(true);
  });

  it('union branch: denies with GUARD_CLUB_SCOPE_REQUIRED', async () => {
    await expect(
      build(member(null, 4), false, { union: unionRow }).resolve(ctx()),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });

  it('denies when the member has neither camporee', async () => {
    await expect(
      build(member(null, null), true).resolve(ctx()),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });
});
