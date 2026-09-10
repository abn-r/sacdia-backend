import { Test } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { ClassEnrollmentPolicyService } from './class-enrollment-policy.service';

const USER_ID = 'user-class-policy';
const CLASS_ID = 20;
const PREV_CLASS_ID = 19;
const OTHER_TYPE_CLASS_ID = 50;
const YEAR = {
  year_id: 2026,
  start_date: new Date('2026-01-01'),
  end_date: new Date('2026-12-31'),
};

function makePrisma() {
  return {
    classes: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    class_prerequisites: {
      findMany: jest.fn(),
    },
    enrollments: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
  };
}

describe('ClassEnrollmentPolicyService', () => {
  let service: ClassEnrollmentPolicyService;
  let prisma: ReturnType<typeof makePrisma>;
  let ecclesiasticalYear: { getCurrentYear: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    ecclesiasticalYear = {
      getCurrentYear: jest.fn().mockResolvedValue(YEAR),
    };

    const module = await Test.createTestingModule({
      providers: [
        ClassEnrollmentPolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: EcclesiasticalYearService, useValue: ecclesiasticalYear },
      ],
    }).compile();

    service = module.get(ClassEnrollmentPolicyService);

    prisma.classes.findUnique.mockResolvedValue({
      class_id: CLASS_ID,
      club_type_id: 2,
      display_order: 4,
      active: true,
      minimum_age: 10,
      requires_invested_gm: false,
      max_duration_years: 1,
      available_from_year: null,
      available_until_year: null,
    });
    prisma.class_prerequisites.findMany.mockResolvedValue([]);
    prisma.users.findUnique.mockResolvedValue({
      birthday: new Date('2010-01-01'),
    });
    prisma.classes.findFirst.mockResolvedValue({
      class_id: PREV_CLASS_ID,
      display_order: 3,
      club_type_id: 2,
    });
  });

  it('A12 annual mode skips investiture of the immediate previous class in the same type', async () => {
    prisma.class_prerequisites.findMany.mockResolvedValue([
      {
        prerequisite_class_id: PREV_CLASS_ID,
        prerequisite: { class_id: PREV_CLASS_ID, club_type_id: 2, display_order: 3 },
      },
    ]);
    prisma.enrollments.findMany.mockResolvedValue([]);

    const decision = await service.evaluate(prisma as never, {
      userId: USER_ID,
      classId: CLASS_ID,
      year: YEAR,
      mode: 'annual',
    });

    expect(decision).toEqual({ kind: 'ok' });
  });

  it('A12 still blocks an independent prerequisite from another type', async () => {
    prisma.class_prerequisites.findMany.mockResolvedValue([
      {
        prerequisite_class_id: OTHER_TYPE_CLASS_ID,
        prerequisite: {
          class_id: OTHER_TYPE_CLASS_ID,
          club_type_id: 3,
          display_order: 1,
        },
      },
    ]);
    prisma.enrollments.findMany.mockResolvedValue([]);

    const decision = await service.evaluate(prisma as never, {
      userId: USER_ID,
      classId: CLASS_ID,
      year: YEAR,
      mode: 'annual',
    });

    expect(decision).toEqual({
      kind: 'policy_blocked',
      code: ErrorCode.CLASS_PREREQUISITE_NOT_MET,
    });
  });

  it('keeps requires_invested_gm as an independent control', async () => {
    prisma.classes.findUnique.mockResolvedValue({
      class_id: CLASS_ID,
      club_type_id: 2,
      display_order: 4,
      active: true,
      minimum_age: 10,
      requires_invested_gm: true,
      max_duration_years: 1,
      available_from_year: null,
      available_until_year: null,
    });
    prisma.enrollments.findFirst.mockResolvedValue(null);

    const decision = await service.evaluate(prisma as never, {
      userId: USER_ID,
      classId: CLASS_ID,
      year: YEAR,
      mode: 'annual',
    });

    expect(decision).toEqual({
      kind: 'policy_blocked',
      code: ErrorCode.CLASS_GM_INVESTITURE_REQUIRED,
    });
  });

  it('D02 blocks GM multi-year classes until the rule is defined', async () => {
    prisma.classes.findUnique.mockResolvedValue({
      class_id: CLASS_ID,
      club_type_id: 3,
      display_order: 1,
      active: true,
      minimum_age: 16,
      requires_invested_gm: false,
      max_duration_years: 2,
      available_from_year: null,
      available_until_year: null,
    });

    const decision = await service.evaluate(prisma as never, {
      userId: USER_ID,
      classId: CLASS_ID,
      year: YEAR,
      mode: 'annual',
    });

    expect(decision).toEqual({
      kind: 'configuration_error',
      code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
    });
  });

  it('A13 rejects writes against a non-current ecclesiastical year even for the owner', async () => {
    ecclesiasticalYear.getCurrentYear.mockResolvedValue(YEAR);

    await expect(service.assertOperationalYearWrite(2025)).rejects.toMatchObject({
      code: ErrorCode.CLASS_PROGRESS_YEAR_NOT_OPERATIONAL,
    });
  });

  it('A13 allows writes for the current year', async () => {
    await expect(service.assertOperationalYearWrite(2026)).resolves.toBeUndefined();
  });
});
