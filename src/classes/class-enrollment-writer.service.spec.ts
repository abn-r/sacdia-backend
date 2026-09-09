import { Test } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { ClassEnrollmentWriter } from './class-enrollment-writer.service';

const USER_ID = 'user-writer';
const CLASS_ID = 20;
const YEAR_ID = 2026;

function makeTx() {
  return {
    enrollments: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    class_section_progress: {
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    club_role_assignments: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('ClassEnrollmentWriter', () => {
  let writer: ClassEnrollmentWriter;
  let tx: ReturnType<typeof makeTx>;

  beforeEach(async () => {
    tx = makeTx();
    const module = await Test.createTestingModule({
      providers: [
        ClassEnrollmentWriter,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    writer = module.get(ClassEnrollmentWriter);
  });

  it('creates a new enrollment with empty progress and never writes club membership', async () => {
    tx.enrollments.findUnique.mockResolvedValue(null);
    tx.enrollments.create.mockResolvedValue({
      enrollment_id: 77,
      user_id: USER_ID,
      class_id: CLASS_ID,
      ecclesiastical_year_id: YEAR_ID,
      cross_type_enrollment: false,
    });

    const result = await writer.upsert(tx as never, {
      userId: USER_ID,
      classId: CLASS_ID,
      ecclesiasticalYearId: YEAR_ID,
      crossType: false,
      ifExists: 'return',
    });

    expect(result).toEqual({ enrollment_id: 77, created: true });
    expect(tx.enrollments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: USER_ID,
          class_id: CLASS_ID,
          ecclesiastical_year_id: YEAR_ID,
          cross_type_enrollment: false,
        }),
      }),
    );
    expect(tx.club_role_assignments.create).not.toHaveBeenCalled();
    expect(tx.class_section_progress.deleteMany).not.toHaveBeenCalled();
  });

  it('A11 retry returns the existing enrollment and does not wipe progress', async () => {
    tx.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 77,
      active: true,
      cross_type_enrollment: false,
    });
    tx.class_section_progress.findMany.mockResolvedValue([
      { section_progress_id: 1, score: 80 },
    ]);

    const result = await writer.upsert(tx as never, {
      userId: USER_ID,
      classId: CLASS_ID,
      ecclesiasticalYearId: YEAR_ID,
      crossType: false,
      ifExists: 'return',
    });

    expect(result).toEqual({ enrollment_id: 77, created: false });
    expect(tx.enrollments.create).not.toHaveBeenCalled();
    expect(tx.class_section_progress.deleteMany).not.toHaveBeenCalled();
  });

  it('A14 cross-type enrollments stay marked and still do not create AV/CQ membership', async () => {
    tx.enrollments.findUnique.mockResolvedValue(null);
    tx.enrollments.create.mockResolvedValue({
      enrollment_id: 88,
      cross_type_enrollment: true,
    });

    const result = await writer.upsert(tx as never, {
      userId: USER_ID,
      classId: CLASS_ID,
      ecclesiasticalYearId: YEAR_ID,
      crossType: true,
      ifExists: 'return',
    });

    expect(result.enrollment_id).toBe(88);
    expect(tx.enrollments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cross_type_enrollment: true }),
      }),
    );
    expect(tx.club_role_assignments.create).not.toHaveBeenCalled();
  });

  it('explicit enroll conflicts when the row already exists', async () => {
    tx.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 77,
      active: true,
    });

    await expect(
      writer.upsert(tx as never, {
        userId: USER_ID,
        classId: CLASS_ID,
        ecclesiasticalYearId: YEAR_ID,
        crossType: false,
        ifExists: 'conflict',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CLASS_ALREADY_ENROLLED });
  });
});
