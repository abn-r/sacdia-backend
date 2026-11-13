import { Test } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { ClassEnrollmentWriter } from './class-enrollment-writer.service';

const USER_ID = 'user-writer';
const CLASS_ID = 20;
const YEAR_ID = 2026;

function makeTx() {
  return {
    classes: {
      findUnique: jest.fn().mockResolvedValue({ asset_code: 'CQ-01' }),
    },
    enrollments: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
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

  it('does not adopt a historical certificate row as an operational enrollment', async () => {
    tx.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 15,
      active: true,
      record_kind: 'HISTORICAL_CERTIFICATE',
    });

    await expect(
      writer.upsert(tx as never, {
        userId: USER_ID,
        classId: CLASS_ID,
        ecclesiasticalYearId: YEAR_ID,
        crossType: false,
        ifExists: 'return',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CLASS_ALREADY_ENROLLED });
    expect(tx.enrollments.update).not.toHaveBeenCalled();
    expect(tx.enrollments.create).not.toHaveBeenCalled();
  });

  it('does not create a second Guía Mayor enrollment', async () => {
    tx.enrollments.findUnique.mockResolvedValue(null);
    tx.classes.findUnique.mockResolvedValue({ asset_code: 'GM-01' });
    tx.enrollments.findFirst.mockResolvedValue({ enrollment_id: 15 });

    await expect(
      writer.upsert(tx as never, {
        userId: USER_ID,
        classId: CLASS_ID,
        ecclesiasticalYearId: YEAR_ID,
        crossType: false,
        ifExists: 'return',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CLASS_ALREADY_ENROLLED });
    expect(tx.enrollments.create).not.toHaveBeenCalled();
  });

  describe('carryForward (multi-year classes)', () => {
    const OPEN = {
      enrollment_id: 77,
      user_id: USER_ID,
      class_id: CLASS_ID,
      ecclesiastical_year_id: 2025,
      duration_start_year_id: null,
      active: true,
      record_kind: 'OPERATIONAL',
      cross_type_enrollment: false,
    };

    it('moves the same row into the new year and pins the duration start year', async () => {
      tx.enrollments.findUnique.mockResolvedValue(OPEN);

      const result = await writer.carryForward(tx as never, {
        enrollmentId: 77,
        toYearId: YEAR_ID,
      });

      expect(result).toEqual({ enrollment_id: 77, carried: true });
      expect(tx.enrollments.update).toHaveBeenCalledWith({
        where: { enrollment_id: 77 },
        data: { ecclesiastical_year_id: YEAR_ID, duration_start_year_id: 2025 },
      });
      expect(tx.enrollments.create).not.toHaveBeenCalled();
    });

    it('keeps an existing duration start year on later carries', async () => {
      tx.enrollments.findUnique.mockResolvedValue({
        ...OPEN,
        ecclesiastical_year_id: 2025,
        duration_start_year_id: 2024,
      });

      await writer.carryForward(tx as never, {
        enrollmentId: 77,
        toYearId: YEAR_ID,
      });

      expect(tx.enrollments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            ecclesiastical_year_id: YEAR_ID,
            duration_start_year_id: 2024,
          },
        }),
      );
    });

    it('is idempotent when the enrollment is already in the target year', async () => {
      tx.enrollments.findUnique.mockResolvedValue({
        ...OPEN,
        ecclesiastical_year_id: YEAR_ID,
      });

      const result = await writer.carryForward(tx as never, {
        enrollmentId: 77,
        toYearId: YEAR_ID,
      });

      expect(result).toEqual({ enrollment_id: 77, carried: false });
      expect(tx.enrollments.update).not.toHaveBeenCalled();
    });

    it('does not move it when the user already holds the regular slot of the target year', async () => {
      tx.enrollments.findUnique.mockResolvedValue(OPEN);
      tx.enrollments.findFirst.mockResolvedValue({ enrollment_id: 90 });

      const result = await writer.carryForward(tx as never, {
        enrollmentId: 77,
        toYearId: YEAR_ID,
      });

      expect(result).toEqual({ enrollment_id: 90, carried: false });
      expect(tx.enrollments.update).not.toHaveBeenCalled();
    });

    it('refuses historical-certificate or inactive rows', async () => {
      tx.enrollments.findUnique.mockResolvedValue({
        ...OPEN,
        record_kind: 'HISTORICAL_CERTIFICATE',
      });

      await expect(
        writer.carryForward(tx as never, {
          enrollmentId: 77,
          toYearId: YEAR_ID,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CLASS_ENROLLMENT_NOT_FOUND });
    });
  });

  it('re-opening GM-01 ignores an EXPIRED previous row but not a live one', async () => {
    tx.classes.findUnique.mockResolvedValue({ asset_code: 'GM-01' });
    tx.enrollments.findUnique.mockResolvedValue(null);
    tx.enrollments.create.mockResolvedValue({ enrollment_id: 88 });

    await writer.upsert(tx as never, {
      userId: USER_ID,
      classId: CLASS_ID,
      ecclesiasticalYearId: YEAR_ID,
      crossType: false,
      ifExists: 'return',
    });

    expect(tx.enrollments.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        investiture_status: { not: 'EXPIRED' },
      }),
      select: { enrollment_id: true },
    });
  });
});
