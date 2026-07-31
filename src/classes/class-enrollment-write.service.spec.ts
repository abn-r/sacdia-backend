import { ErrorCode } from '../common/errors/error-codes';
import { ClassEnrollmentWriteService } from './class-enrollment-write.service';

describe('ClassEnrollmentWriteService', () => {
  const targetYear = {
    year_id: 2027,
    start_date: new Date('2027-01-01T00:00:00.000Z'),
    end_date: new Date('2027-12-31T23:59:59.999Z'),
  };
  const targetClass = {
    class_id: 10,
    club_type_id: 2,
    active: true,
    available_from_year: null,
    available_until_year: null,
  };
  const plan = {
    source_enrollment_id: 90,
    source_class_id: 9,
    target_class_id: 10,
    transition_kind: 'SAME_TRACK' as const,
  };

  const setup = () => {
    const order: string[] = [];
    const tx = {
      $executeRaw: jest.fn().mockImplementation(async () => {
        order.push('lock');
        return 1;
      }),
      ecclesiastical_years: {
        findUnique: jest.fn().mockImplementation(async () => {
          order.push('year');
          return targetYear;
        }),
      },
      classes: {
        findUnique: jest.fn().mockImplementation(async () => {
          order.push('target');
          return targetClass;
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const planner = {
      resolveSource: jest.fn().mockImplementation(async () => {
        order.push('plan');
        return plan;
      }),
    };
    const service = new ClassEnrollmentWriteService(
      prisma as never,
      planner as never,
    );
    return { order, planner, prisma, service, tx };
  };

  it('locks a deterministic pool before revalidating target and planning', async () => {
    const { order, planner, prisma, service, tx } = setup();
    const write = jest.fn().mockImplementation(async () => {
      order.push('write');
      return { enrollment_id: 44 };
    });

    await expect(
      service.execute(
        {
          userId: '00000000-0000-4000-8000-000000000001',
          targetClassId: 10,
          ecclesiasticalYearId: 2027,
          poolClubTypeIds: [2, 1, 2],
        },
        write,
      ),
    ).resolves.toEqual({ enrollment_id: 44 });

    expect(order).toEqual(['lock', 'year', 'target', 'plan', 'write']);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    const lock = tx.$executeRaw.mock.calls[0][0];
    expect((lock.strings ?? []).join('?')).toContain(
      'pg_advisory_xact_lock(hashtextextended(',
    );
    expect(lock.values).toEqual([
      'class-enrollment:00000000-0000-4000-8000-000000000001:2027:pool:1,2',
    ]);
    expect(planner.resolveSource).toHaveBeenCalledWith(tx, {
      userId: '00000000-0000-4000-8000-000000000001',
      targetClassId: 10,
      targetYearStart: targetYear.start_date,
    });
    expect(write).toHaveBeenCalledWith({
      tx,
      plan,
      targetClass,
      targetYear,
    });
  });

  it('fails closed when the target is outside the declared pool', async () => {
    const { planner, service } = setup();

    await expect(
      service.execute(
        {
          userId: '00000000-0000-4000-8000-000000000001',
          targetClassId: 10,
          ecclesiasticalYearId: 2027,
          poolClubTypeIds: [1, 3],
        },
        jest.fn(),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CLASS_PROGRESSION_CONFIG_INVALID,
    });
    expect(planner.resolveSource).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...targetClass, active: false }, ErrorCode.CLASS_NOT_FOUND],
    [
      {
        ...targetClass,
        available_from_year: {
          start_date: new Date('2028-01-01T00:00:00.000Z'),
        },
      },
      ErrorCode.CLASS_NOT_AVAILABLE_FOR_YEAR,
    ],
  ])('rejects an invalid destination before planning', async (row, code) => {
    const { planner, service, tx } = setup();
    tx.classes.findUnique.mockResolvedValueOnce(row);

    await expect(
      service.execute(
        {
          userId: '00000000-0000-4000-8000-000000000001',
          targetClassId: 10,
          ecclesiasticalYearId: 2027,
          poolClubTypeIds: [2],
        },
        jest.fn(),
      ),
    ).rejects.toMatchObject({ code });
    expect(planner.resolveSource).not.toHaveBeenCalled();
  });

  it.each([
    ['P2002', ErrorCode.CLASS_ALREADY_ENROLLED],
    ['P2034', ErrorCode.INVESTITURE_CONCURRENT_UPDATE],
  ])('maps %s to %s', async (prismaCode, domainCode) => {
    const { prisma, service } = setup();
    prisma.$transaction.mockRejectedValueOnce({ code: prismaCode });

    await expect(
      service.execute(
        {
          userId: '00000000-0000-4000-8000-000000000001',
          targetClassId: 10,
          ecclesiasticalYearId: 2027,
          poolClubTypeIds: [2],
        },
        jest.fn(),
      ),
    ).rejects.toMatchObject({ code: domainCode });
  });
});
