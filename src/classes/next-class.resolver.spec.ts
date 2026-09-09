import { NextClassResolver } from './next-class.resolver';
import { PrismaService } from '../prisma/prisma.service';
import { AppNotFoundException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

function makeMock() {
  return {
    club_sections: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    enrollments: {
      findMany: jest.fn(),
    },
    classes: {
      findFirst: jest.fn(),
    },
    club_types: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    ecclesiastical_years: {
      findUnique: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

const USER_ID = 'user-abc';
const YEAR_ID = 2026;
const TARGET_YEAR = {
  year_id: YEAR_ID,
  start_date: new Date('2026-01-01'),
  end_date: new Date('2026-12-31'),
};

const AV_TYPE_ID = 1;
const CQ_TYPE_ID = 2;
const GM_TYPE_ID = 3;

const SECTION_AV = { club_section_id: 10, main_club_id: 99, club_type_id: AV_TYPE_ID };
const SECTION_CQ = { club_section_id: 20, main_club_id: 99, club_type_id: CQ_TYPE_ID };
const SECTION_GM = { club_section_id: 30, main_club_id: 99, club_type_id: GM_TYPE_ID };

const AV_TYPE = { club_type_id: AV_TYPE_ID, name: 'Aventureros' };
const CQ_TYPE = { club_type_id: CQ_TYPE_ID, name: 'Conquistadores' };
const GM_TYPE = { club_type_id: GM_TYPE_ID, name: 'Guías Mayores' };

const CLASS_AV_16 = { class_id: 116, display_order: 16, club_type_id: AV_TYPE_ID };
const CLASS_AV_17 = { class_id: 117, display_order: 17, club_type_id: AV_TYPE_ID };
const CLASS_AV_18 = { class_id: 118, display_order: 18, club_type_id: AV_TYPE_ID };
const CLASS_CQ_1 = { class_id: 201, display_order: 1, club_type_id: CQ_TYPE_ID };
const CLASS_CQ_3 = { class_id: 203, display_order: 3, club_type_id: CQ_TYPE_ID };
const CLASS_CQ_4 = { class_id: 204, display_order: 4, club_type_id: CQ_TYPE_ID };
const CLASS_GM_8 = { class_id: 308, display_order: 8, club_type_id: GM_TYPE_ID };

const PRIOR_YEAR = {
  year_id: 2025,
  start_date: new Date('2025-01-01'),
  end_date: new Date('2025-12-31'),
};

const mkEnrollment = (
  cls: typeof CLASS_AV_16,
  extras?: { investiture_status?: string; cross_type_enrollment?: boolean; year?: typeof PRIOR_YEAR },
) => ({
  enrollment_id: 1,
  user_id: USER_ID,
  investiture_status: extras?.investiture_status ?? 'IN_PROGRESS',
  cross_type_enrollment: extras?.cross_type_enrollment ?? false,
  classes: cls,
  ecclesiastical_year: extras?.year ?? PRIOR_YEAR,
});

describe('NextClassResolver', () => {
  let resolver: NextClassResolver;
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    mock = makeMock();
    resolver = new NextClassResolver(mock);
    (mock.ecclesiastical_years.findUnique as jest.Mock).mockResolvedValue(TARGET_YEAR);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('T1 — returns class 17 from prior-period history, not display_order+1 arithmetic', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(SECTION_AV);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([mkEnrollment(CLASS_AV_16)]);
    (mock.classes.findFirst as jest.Mock).mockResolvedValue(CLASS_AV_17);

    const result = await resolver.resolve(USER_ID, SECTION_AV.club_section_id, YEAR_ID);

    expect(mock.enrollments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: USER_ID,
          cross_type_enrollment: false,
          classes: { club_type_id: AV_TYPE_ID },
          ecclesiastical_year: { end_date: { lt: TARGET_YEAR.start_date } },
        }),
      }),
    );
    expect(mock.classes.findFirst).toHaveBeenCalledWith({
      where: { club_type_id: AV_TYPE_ID, display_order: { gt: 16 }, active: true },
      orderBy: { display_order: 'asc' },
      select: { class_id: true, display_order: true, club_type_id: true },
    });
    expect(result).toMatchObject({
      kind: 'next_class',
      class_id: CLASS_AV_17.class_id,
      crossed_type: false,
      club_section_id: SECTION_AV.club_section_id,
    });
  });

  it('A12 — uninvested prior class still advances to the next catalog class', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(SECTION_AV);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([
      mkEnrollment(CLASS_AV_16, { investiture_status: 'IN_PROGRESS' }),
    ]);
    (mock.classes.findFirst as jest.Mock).mockResolvedValue(CLASS_AV_17);

    const result = await resolver.resolve(USER_ID, SECTION_AV.club_section_id, YEAR_ID);

    expect(result.kind).toBe('next_class');
    if (result.kind === 'next_class') {
      expect(result.class_id).toBe(CLASS_AV_17.class_id);
    }
  });

  it('excludes future and cross-type history from the last regular class', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(SECTION_AV);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([
      mkEnrollment(CLASS_AV_16),
    ]);
    (mock.classes.findFirst as jest.Mock).mockResolvedValue(CLASS_AV_17);

    await resolver.resolve(USER_ID, SECTION_AV.club_section_id, YEAR_ID);

    expect(mock.enrollments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cross_type_enrollment: false,
          ecclesiastical_year: { end_date: { lt: TARGET_YEAR.start_date } },
        }),
      }),
    );
  });

  it('uses the next existing catalog class when display_order has a gap', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(SECTION_AV);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([mkEnrollment(CLASS_AV_16)]);
    (mock.classes.findFirst as jest.Mock).mockResolvedValue(CLASS_AV_18);

    const result = await resolver.resolve(USER_ID, SECTION_AV.club_section_id, YEAR_ID);

    expect(result).toMatchObject({ kind: 'next_class', class_id: CLASS_AV_18.class_id });
  });

  it('T2 — class 18 is not chosen when 17 exists', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(SECTION_AV);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([mkEnrollment(CLASS_AV_16)]);
    (mock.classes.findFirst as jest.Mock).mockResolvedValue(CLASS_AV_17);

    const result = await resolver.resolve(USER_ID, SECTION_AV.club_section_id, YEAR_ID);

    expect(result).toMatchObject({ kind: 'next_class', class_id: CLASS_AV_17.class_id });
    expect(result).not.toMatchObject({ class_id: CLASS_AV_18.class_id });
  });

  it('D02 — exhausted AV catalog is configuration_error, not silent CQ enrollment', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(SECTION_AV);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([mkEnrollment(CLASS_AV_16)]);
    (mock.classes.findFirst as jest.Mock).mockResolvedValue(null);
    (mock.club_types.findUnique as jest.Mock).mockResolvedValue(AV_TYPE);
    (mock.club_types.findFirst as jest.Mock).mockResolvedValue(CQ_TYPE);
    (mock.club_sections.findFirst as jest.Mock).mockResolvedValue(SECTION_CQ);

    const result = await resolver.resolve(USER_ID, SECTION_AV.club_section_id, YEAR_ID);

    expect(result).toEqual({
      kind: 'configuration_error',
      code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
    });
  });

  it('T4 — same-type CQ 3 → 4 stays in the origin section', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(SECTION_CQ);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([mkEnrollment(CLASS_CQ_3)]);
    (mock.classes.findFirst as jest.Mock).mockResolvedValue(CLASS_CQ_4);

    const result = await resolver.resolve(USER_ID, SECTION_CQ.club_section_id, YEAR_ID);

    expect(result).toMatchObject({
      kind: 'next_class',
      class_id: CLASS_CQ_4.class_id,
      club_section_id: SECTION_CQ.club_section_id,
      crossed_type: false,
    });
  });

  it('T5 — no prior regular enrollment returns the first class of the section type', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(SECTION_AV);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([]);
    (mock.classes.findFirst as jest.Mock).mockResolvedValue(CLASS_AV_16);

    const result = await resolver.resolve(USER_ID, SECTION_AV.club_section_id, YEAR_ID);

    expect(mock.classes.findFirst).toHaveBeenCalledWith({
      where: { club_type_id: AV_TYPE_ID, active: true },
      orderBy: { display_order: 'asc' },
      select: { class_id: true, display_order: true, club_type_id: true },
    });
    expect(result).toMatchObject({
      kind: 'next_class',
      class_id: CLASS_AV_16.class_id,
      club_section_id: SECTION_AV.club_section_id,
    });
  });

  it('T6 — missing fromSection throws CLUB_SECTION_NOT_FOUND', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(resolver.resolve(USER_ID, 999, YEAR_ID)).rejects.toBeInstanceOf(
      AppNotFoundException,
    );
  });

  it('missing catalog class is configuration_error, not end of trajectory', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(SECTION_AV);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([]);
    (mock.classes.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await resolver.resolve(USER_ID, SECTION_AV.club_section_id, YEAR_ID);

    expect(result).toEqual({
      kind: 'configuration_error',
      code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
    });
  });

  it('D02 — last GM class is configuration_error, not no_class_required', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(SECTION_GM);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([mkEnrollment(CLASS_GM_8)]);
    (mock.classes.findFirst as jest.Mock).mockResolvedValue(null);
    (mock.club_types.findUnique as jest.Mock).mockResolvedValue(GM_TYPE);

    const result = await resolver.resolve(USER_ID, SECTION_GM.club_section_id, YEAR_ID);

    expect(result).toEqual({
      kind: 'configuration_error',
      code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
    });
    expect(mock.club_types.findFirst).not.toHaveBeenCalled();
  });

  it('T9 — resolver is read-only', async () => {
    (mock.club_sections.findUnique as jest.Mock).mockResolvedValue(SECTION_AV);
    (mock.enrollments.findMany as jest.Mock).mockResolvedValue([mkEnrollment(CLASS_AV_16)]);
    (mock.classes.findFirst as jest.Mock).mockResolvedValue(CLASS_AV_17);

    await resolver.resolve(USER_ID, SECTION_AV.club_section_id, YEAR_ID);

    expect(Object.keys(mock.enrollments)).toEqual(['findMany']);
  });
});
