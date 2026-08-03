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
    formative_program_type: 'STANDARD' as const,
    available_from_year: null,
    available_until_year: null,
  };
  const plan = {
    source_enrollment_id: 90,
    source_class_id: 9,
    target_class_id: 10,
    transition_kind: 'SAME_TRACK' as const,
  };
  const params = {
    userId: '00000000-0000-4000-8000-000000000001',
    targetClassId: 10,
    ecclesiasticalYearId: 2027,
    poolClubTypeIds: [2],
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
      enrollments: { findUnique: jest.fn() },
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
  it('canonicalizes UUID casing before locking and planning', async () => {
    const { order, planner, prisma, service, tx } = setup();
    const write = jest.fn().mockImplementation(async () => {
      order.push('write');
      return { enrollment_id: 44 };
    });
    await expect(
      service.execute(
        {
          ...params,
          userId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
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
      'class-enrollment:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:2027:pool:1,2',
    ]);
    expect(planner.resolveSource).toHaveBeenCalledWith(tx, {
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
  it('rejects an invalid UUID before opening a transaction', async () => {
    const { prisma, service } = setup();
    await expect(
      service.execute({ ...params, userId: 'not-a-uuid' }, jest.fn()),
    ).rejects.toMatchObject({
      code: ErrorCode.CLASS_PROGRESSION_CONFIG_INVALID,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('fails closed when the target is outside the declared pool', async () => {
    const { planner, service } = setup();
    await expect(
      service.execute({ ...params, poolClubTypeIds: [1, 3] }, jest.fn()),
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
    await expect(service.execute(params, jest.fn())).rejects.toMatchObject({
      code,
    });
    expect(planner.resolveSource).not.toHaveBeenCalled();
  });

  it.each([
    [
      {
        code: 'P2002',
        meta: { target: ['user_id', 'class_id', 'ecclesiastical_year_id'] },
      },
      ErrorCode.CLASS_ALREADY_ENROLLED,
    ],
    [
      {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            cause: {
              constraint: {
                fields: ['user_id', 'class_id', 'ecclesiastical_year_id'],
              },
            },
          },
        },
      },
      ErrorCode.CLASS_ALREADY_ENROLLED,
    ],
    [{ code: 'P2034' }, ErrorCode.INVESTITURE_CONCURRENT_UPDATE],
  ])(
    'maps the exact persistence conflict to %s',
    async (failure, domainCode) => {
      const { prisma, service } = setup();
      prisma.$transaction.mockRejectedValueOnce(failure);
      await expect(service.execute(params, jest.fn())).rejects.toMatchObject({
        code: domainCode,
      });
    },
  );

  it('propagates P2002 from another constraint without a winner lookup', async () => {
    const { prisma, service } = setup();
    const failure = { code: 'P2002', meta: { target: ['validated_by'] } };
    prisma.$transaction.mockRejectedValueOnce(failure);
    await expect(service.execute(params, jest.fn())).rejects.toBe(failure);
    expect(prisma.enrollments.findUnique).not.toHaveBeenCalled();
  });

  it.each([[{ enrollment_id: 44 }], [null]])(
    'maps metadata-free P2002 only when the exact winner is %p',
    async (winner) => {
      const { prisma, service } = setup();
      const failure = { code: 'P2002' };
      prisma.$transaction.mockRejectedValueOnce(failure);
      prisma.enrollments.findUnique.mockResolvedValueOnce(winner);
      const result = service.execute(params, jest.fn());
      if (winner) {
        await expect(result).rejects.toMatchObject({
          code: ErrorCode.CLASS_ALREADY_ENROLLED,
        });
      } else {
        await expect(result).rejects.toBe(failure);
      }
    },
  );

  const programCapacityFailure = (detail: string) =>
    Object.assign(new Error('Raw query failed'), {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: { code: '23514', detail },
        },
      },
    });

  it.each([
    ['STANDARD', ErrorCode.CLASS_MAX_AVENTU_CONQUIS_ACTIVE],
    ['GUIDE_MAJOR', ErrorCode.CLASS_MAX_GM_ACTIVE],
  ])(
    'maps only the marked %s capacity failure to its stable conflict',
    async (formativeProgramType, domainCode) => {
      const { service, tx } = setup();
      tx.classes.findUnique.mockResolvedValueOnce({
        ...targetClass,
        formative_program_type: formativeProgramType,
      });

      await expect(
        service.execute(params, async () =>
          Promise.reject(
            programCapacityFailure('SACDIA_ENROLLMENT_PROGRAM_CAPACITY'),
          ),
        ),
      ).rejects.toMatchObject({
        response: { code: domainCode, statusCode: 409 },
      });
    },
  );

  it('passes through an unmarked CHECK failure', async () => {
    const { service, tx } = setup();
    tx.classes.findUnique.mockResolvedValueOnce({
      ...targetClass,
      formative_program_type: 'STANDARD',
    });
    const failure = programCapacityFailure('another CHECK failed');

    await expect(
      service.execute(params, async () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });

  it('passes through a marked CHECK unless Prisma reports P2010', async () => {
    const { service } = setup();
    const failure = Object.assign(
      programCapacityFailure('SACDIA_ENROLLMENT_PROGRAM_CAPACITY'),
      { code: 'P2004' },
    );

    await expect(
      service.execute(params, async () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });
});
