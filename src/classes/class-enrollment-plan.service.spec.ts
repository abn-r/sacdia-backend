import { ErrorCode } from '../common/errors/error-codes';
import { ClassEnrollmentPlanService } from './class-enrollment-plan.service';

describe('ClassEnrollmentPlanService', () => {
  const yearStart = new Date('2027-01-01T00:00:00.000Z');
  const progression = {
    resolveNext: jest.fn(),
    resolvePredecessor: jest.fn(),
    resolveTransition: jest.fn(),
  };
  const service = new ClassEnrollmentPlanService(progression as any);

  const row = (
    enrollmentId: number,
    classId: number,
    enrollmentDate = new Date('2026-06-01T00:00:00.000Z'),
  ) => ({
    enrollment_id: enrollmentId,
    class_id: classId,
    enrollment_date: enrollmentDate,
    ecclesiastical_year: { start_date: new Date('2026-01-01') },
  });

  const tx = (candidates: ReturnType<typeof row>[]) =>
    ({
      enrollments: {
        findMany: jest.fn().mockResolvedValue(candidates),
      },
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    progression.resolveNext.mockResolvedValue(null);
    progression.resolvePredecessor.mockResolvedValue(null);
    progression.resolveTransition.mockResolvedValue('SAME_TRACK');
  });

  it('selects only the canonical predecessor and ignores a newer unrelated GM class', async () => {
    const prisma = tx([
      row(300, 14, new Date('2026-09-01')),
      row(200, 13, new Date('2026-05-01')),
    ]);
    progression.resolveNext.mockImplementation(
      (_tx: unknown, classId: number) =>
        Promise.resolve(classId === 13 ? { class_id: 15 } : null),
    );

    await expect(
      service.resolveSource(prisma, {
        userId: 'user-1',
        targetClassId: 15,
        targetYearStart: yearStart,
      }),
    ).resolves.toMatchObject({
      source_enrollment_id: 200,
      source_class_id: 13,
    });
    expect(prisma.enrollments.findMany.mock.calls[0][0].where).toEqual({
      user_id: 'user-1',
      ecclesiastical_year: { start_date: { lt: yearStart } },
    });
  });

  it('uses a total order and deterministically selects the latest matching enrollment', async () => {
    const prisma = tx([row(42, 9), row(41, 9)]);
    progression.resolveNext.mockResolvedValue({ class_id: 10 });

    const plan = await service.resolveSource(prisma, {
      userId: 'user-1',
      targetClassId: 10,
      targetYearStart: yearStart,
    });

    expect(plan.source_enrollment_id).toBe(42);
    expect(prisma.enrollments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { ecclesiastical_year: { start_date: 'desc' } },
          { enrollment_date: 'desc' },
          { enrollment_id: 'desc' },
        ],
      }),
    );
  });

  it('fails closed when different predecessor classes can reach the target', async () => {
    const prisma = tx([row(20, 9), row(19, 6)]);
    progression.resolveNext.mockResolvedValue({ class_id: 10 });

    await expect(
      service.resolveSource(prisma, {
        userId: 'user-1',
        targetClassId: 10,
        targetYearStart: yearStart,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CLASS_ENROLLMENT_AMBIGUOUS,
    });
  });

  it('rejects a target with history but no canonical predecessor enrollment', async () => {
    await expect(
      service.resolveSource(tx([row(20, 8)]), {
        userId: 'user-1',
        targetClassId: 10,
        targetYearStart: yearStart,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CLASS_LEVEL_TOO_HIGH });
  });

  it('returns a source-less plan only after validating first enrollment configuration', async () => {
    const prisma = tx([]);

    await expect(
      service.resolveSource(prisma, {
        userId: 'user-1',
        targetClassId: 10,
        targetYearStart: yearStart,
      }),
    ).resolves.toEqual({
      source_enrollment_id: null,
      source_class_id: null,
      target_class_id: 10,
      transition_kind: null,
    });
    expect(progression.resolvePredecessor).toHaveBeenCalledWith(
      prisma,
      10,
      yearStart,
    );
  });
});
