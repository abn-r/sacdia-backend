import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  LEGACY_LOCK_RELEASE_COMMENT,
  LegacyLockReleaseService,
} from './legacy-lock-release.service';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const rows = [
  {
    enrollment_id: 1,
    user_id: 'u1',
    class_id: 3,
    ecclesiastical_year_id: 9,
    investiture_status: 'CLUB_APPROVED',
  },
  {
    enrollment_id: 2,
    user_id: 'u2',
    class_id: 3,
    ecclesiastical_year_id: 9,
    investiture_status: 'APPROVED',
  },
];

function build(pendingIds: number[] = [], updatedCount = 1) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    investiture_authorization_people: {
      findFirst: jest.fn(({ where }: { where: { enrollment_id: number } }) =>
        Promise.resolve(
          pendingIds.includes(where.enrollment_id) ? { person_id: 'p' } : null,
        ),
      ),
    },
    enrollments: {
      updateMany: jest.fn().mockResolvedValue({ count: updatedCount }),
    },
    investiture_validation_history: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    enrollments: { findMany: jest.fn().mockResolvedValue(rows) },
    investiture_authorization_people: tx.investiture_authorization_people,
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const policy = { assert: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new LegacyLockReleaseService(prisma as never, policy as never),
    prisma,
    tx,
    policy,
  };
}

describe('LegacyLockReleaseService', () => {
  it('refuses anyone but super-admin before reading', async () => {
    const { service, prisma, policy } = build();
    policy.assert.mockRejectedValue(
      new AppForbiddenException(ErrorCode.SUPER_ADMIN_WRITE_REQUIRED),
    );
    await expect(service.release(ACTOR, {})).rejects.toMatchObject({
      code: ErrorCode.SUPER_ADMIN_WRITE_REQUIRED,
    });
    expect(prisma.enrollments.findMany).not.toHaveBeenCalled();
  });

  it('only looks at locked operational rows that are not invested, with no active filter', async () => {
    const { service, prisma } = build();
    await service.release(ACTOR, {});
    expect(prisma.enrollments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          locked_for_validation: true,
          record_kind: 'OPERATIONAL',
          investiture_status: { not: 'INVESTIDO' },
        },
        orderBy: { enrollment_id: 'asc' },
      }),
    );
  });

  it('is a dry run by default and writes nothing', async () => {
    const { service, prisma } = build([2]);
    await expect(service.release(ACTOR, {})).resolves.toEqual({
      dry_run: true,
      candidates: rows,
      skipped_pending: [2],
      released: [],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('releases without a pending person, keeps the status and audits each row', async () => {
    const { service, tx } = build([2]);
    const result = await service.release(ACTOR, { dry_run: false });

    expect(result).toEqual({
      dry_run: false,
      candidates: rows,
      skipped_pending: [2],
      released: [1],
    });
    expect(tx.enrollments.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.enrollments.updateMany).toHaveBeenCalledWith({
      where: {
        enrollment_id: 1,
        locked_for_validation: true,
        record_kind: 'OPERATIONAL',
        investiture_status: { not: 'INVESTIDO' },
      },
      data: { locked_for_validation: false },
    });
    expect(tx.investiture_validation_history.create).toHaveBeenCalledWith({
      data: {
        enrollment_id: 1,
        action: 'LEGACY_LOCK_RELEASED',
        performed_by: ACTOR,
        comments: LEGACY_LOCK_RELEASE_COMMENT,
      },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('does not audit a row that changed under the lock', async () => {
    const { service, tx } = build([], 0);
    const result = await service.release(ACTOR, { dry_run: false });
    expect(result.released).toEqual([]);
    expect(tx.investiture_validation_history.create).not.toHaveBeenCalled();
  });
});
