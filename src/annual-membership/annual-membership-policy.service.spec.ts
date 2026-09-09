import { Test, TestingModule } from '@nestjs/testing';
import { AnnualMembershipPolicyService } from './annual-membership-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/errors/error-codes';

const YEAR_ID_CURRENT = 2026;
const CURRENT_YEAR = {
  year_id: YEAR_ID_CURRENT,
  start_date: new Date('2026-01-01'),
  end_date: new Date('2026-12-31'),
  active: true,
};

const CONQUISTADORES_TYPE_ID = 10;
const GM_TYPE_ID = 12;
const CQ_SECTION_ID = 101;
const GM_SECTION_ID = 201;
const OTHER_GM_SECTION_ID = 301;
const CLUB_ID = 500;
const OTHER_CLUB_ID = 600;
const MEMBER_ROLE_ID = 'r-member-uuid';
const DIRECTOR_ROLE_ID = 'r-director-uuid';
const USER_ID = 'user-returned-uuid';
const GM_CLASS_ID = 999;

function makePrismaMock() {
  return {
    club_types: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    club_role_assignments: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    club_transfer_requests: {
      findFirst: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    classes: {
      findMany: jest.fn(),
    },
    enrollments: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
}

describe('AnnualMembershipPolicyService', () => {
  let service: AnnualMembershipPolicyService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualMembershipPolicyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AnnualMembershipPolicyService);

    prisma.club_types.findMany.mockResolvedValue([
      { club_type_id: CONQUISTADORES_TYPE_ID, name: 'Conquistadores' },
      { club_type_id: GM_TYPE_ID, name: 'Guías Mayores' },
    ]);
    prisma.club_types.findFirst.mockResolvedValue({
      club_type_id: GM_TYPE_ID,
      name: 'Guías Mayores',
    });
    prisma.roles.findFirst.mockImplementation(async (args: { where?: { role_name?: string } }) => {
      if (args?.where?.role_name === 'member') {
        return { role_id: MEMBER_ROLE_ID };
      }
      if (args?.where?.role_name === 'director') {
        return { role_id: DIRECTOR_ROLE_ID };
      }
      return null;
    });
    prisma.classes.findMany.mockResolvedValue([{ class_id: GM_CLASS_ID }]);
  });

  afterEach(() => jest.clearAllMocks());

  describe('A02 – CQ return without prior GM row resolves GM base', () => {
    it('resolveBase uses GM of the same club when source is AV/CQ', async () => {
      prisma.club_sections.findUnique.mockResolvedValue({
        club_section_id: CQ_SECTION_ID,
        main_club_id: CLUB_ID,
        club_type_id: CONQUISTADORES_TYPE_ID,
        active: true,
      });
      prisma.club_sections.findFirst.mockResolvedValue({
        club_section_id: GM_SECTION_ID,
        main_club_id: CLUB_ID,
        club_type_id: GM_TYPE_ID,
        active: true,
      });
      prisma.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'INVESTIDO',
      });

      const base = await service.resolveBase(prisma as never, USER_ID, {
        sourceClubId: CLUB_ID,
        sourceSectionId: CQ_SECTION_ID,
      });

      expect(base).toEqual(
        expect.objectContaining({
          clubId: CLUB_ID,
          baseSectionId: GM_SECTION_ID,
        }),
      );
    });

    it('ensureNotEnrolled + listNotEnrolled include the returned user without a prior-year GM CRA', async () => {
      prisma.club_role_assignments.findFirst.mockResolvedValue(null);
      prisma.club_role_assignments.create.mockResolvedValue({
        assignment_id: 'new-not-enrolled',
        user_id: USER_ID,
        status: 'inactive',
      });
      prisma.club_role_assignments.findMany.mockResolvedValue([
        {
          user_id: USER_ID,
          users: { name: 'Luis', paternal_last_name: 'Pérez', maternal_last_name: 'Soto' },
          roles: { role_name: 'member' },
        },
      ]);

      await service.ensureNotEnrolled(
        prisma as never,
        USER_ID,
        GM_SECTION_ID,
        CURRENT_YEAR,
      );

      expect(prisma.club_role_assignments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: USER_ID,
            role_id: MEMBER_ROLE_ID,
            club_section_id: GM_SECTION_ID,
            ecclesiastical_year_id: YEAR_ID_CURRENT,
            status: 'inactive',
            active: true,
          }),
        }),
      );
      expect(prisma.enrollments.create).not.toHaveBeenCalled();

      const listed = await service.listNotEnrolled(
        prisma as never,
        GM_SECTION_ID,
        YEAR_ID_CURRENT,
      );
      expect(listed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ user_id: USER_ID }),
        ]),
      );
    });
  });

  describe('A09 – unresolved base is explicit', () => {
    it('throws ANNUAL_MEMBERSHIP_BASE_UNRESOLVED when GM section is disabled', async () => {
      prisma.club_sections.findUnique.mockResolvedValue({
        club_section_id: CQ_SECTION_ID,
        main_club_id: CLUB_ID,
        club_type_id: CONQUISTADORES_TYPE_ID,
        active: true,
      });
      prisma.club_sections.findFirst.mockResolvedValue({
        club_section_id: GM_SECTION_ID,
        main_club_id: CLUB_ID,
        club_type_id: GM_TYPE_ID,
        active: false,
      });
      prisma.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'INVESTIDO',
      });

      await expect(
        service.resolveBase(prisma as never, USER_ID, {
          sourceClubId: CLUB_ID,
          sourceSectionId: CQ_SECTION_ID,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED,
      });
      expect(prisma.club_role_assignments.create).not.toHaveBeenCalled();
    });

    it('throws ANNUAL_MEMBERSHIP_BASE_UNRESOLVED when more than one candidate base exists', async () => {
      prisma.club_transfer_requests.findFirst.mockResolvedValue(null);
      prisma.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: 'a1',
          club_section_id: GM_SECTION_ID,
          status: 'inactive',
          club_sections: {
            club_section_id: GM_SECTION_ID,
            main_club_id: CLUB_ID,
            active: true,
            club_types: { name: 'Guías Mayores' },
          },
        },
        {
          assignment_id: 'a2',
          club_section_id: OTHER_GM_SECTION_ID,
          status: 'active',
          club_sections: {
            club_section_id: OTHER_GM_SECTION_ID,
            main_club_id: OTHER_CLUB_ID,
            active: true,
            club_types: { name: 'Guías Mayores' },
          },
        },
      ]);

      await expect(
        service.resolveBase(prisma as never, USER_ID),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED,
      });
    });

    it('does not invent a club from GM-01 investiture alone', async () => {
      prisma.club_transfer_requests.findFirst.mockResolvedValue(null);
      prisma.club_role_assignments.findMany.mockResolvedValue([]);
      prisma.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'INVESTIDO',
      });

      await expect(
        service.resolveBase(prisma as never, USER_ID),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED,
      });
    });
  });

  describe('A09/A10 – rejected request and transferred membership', () => {
    it('does not use a rejected request as base', async () => {
      prisma.club_transfer_requests.findFirst.mockResolvedValue(null);
      prisma.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: 'rejected',
          club_section_id: GM_SECTION_ID,
          status: 'rejected',
          club_sections: {
            club_section_id: GM_SECTION_ID,
            main_club_id: CLUB_ID,
            active: true,
            club_types: { name: 'Guías Mayores' },
          },
        },
      ]);

      await expect(
        service.resolveBase(prisma as never, USER_ID),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED,
      });
    });

    it('uses the approved transfer destination, not the old club', async () => {
      prisma.club_transfer_requests.findFirst.mockResolvedValue({
        to_section_id: OTHER_GM_SECTION_ID,
        to_section: {
          club_section_id: OTHER_GM_SECTION_ID,
          main_club_id: OTHER_CLUB_ID,
          active: true,
          club_type_id: GM_TYPE_ID,
          club_types: { name: 'Guías Mayores' },
        },
      });

      const base = await service.resolveBase(prisma as never, USER_ID);

      expect(base.baseSectionId).toBe(OTHER_GM_SECTION_ID);
      expect(base.clubId).toBe(OTHER_CLUB_ID);
    });
  });

  describe('A10 – history and future assignments stay intact', () => {
    it('does not rewrite an ended historical assignment to represent not-enrolled', async () => {
      prisma.club_role_assignments.findFirst.mockResolvedValue(null);
      prisma.club_role_assignments.create.mockResolvedValue({
        assignment_id: 'new-not-enrolled',
      });

      await service.ensureNotEnrolled(
        prisma as never,
        USER_ID,
        GM_SECTION_ID,
        CURRENT_YEAR,
      );

      expect(prisma.club_role_assignments.update).not.toHaveBeenCalled();
      expect(prisma.club_role_assignments.updateMany).not.toHaveBeenCalled();
      expect(prisma.club_role_assignments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ecclesiastical_year_id: YEAR_ID_CURRENT,
            club_section_id: GM_SECTION_ID,
            status: 'inactive',
          }),
        }),
      );
    });

    it('reactivates only a current-year member inactive row, never a previous-year row', async () => {
      prisma.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'current-inactive',
        user_id: USER_ID,
        role_id: MEMBER_ROLE_ID,
        club_section_id: GM_SECTION_ID,
        ecclesiastical_year_id: YEAR_ID_CURRENT,
        status: 'inactive',
        active: true,
      });

      const result = await service.ensureNotEnrolled(
        prisma as never,
        USER_ID,
        GM_SECTION_ID,
        CURRENT_YEAR,
      );

      expect(result.assignment_id).toBe('current-inactive');
      expect(prisma.club_role_assignments.create).not.toHaveBeenCalled();
      expect(prisma.club_role_assignments.update).not.toHaveBeenCalled();
    });

    it('does not create a member row when the user already has an operational GM director', async () => {
      prisma.club_role_assignments.findFirst.mockImplementation(
        async (args: { where?: { role_id?: string; status?: unknown } }) => {
          if (args?.where?.role_id === DIRECTOR_ROLE_ID) {
            return { assignment_id: 'gm-director-2026', status: 'active' };
          }
          return null;
        },
      );

      const result = await service.ensureNotEnrolled(
        prisma as never,
        USER_ID,
        GM_SECTION_ID,
        CURRENT_YEAR,
      );

      expect(result.created).toBe(false);
      expect(prisma.club_role_assignments.create).not.toHaveBeenCalled();
    });

    it('does not skip member creation for leftover designated director', async () => {
      prisma.roles.findFirst.mockImplementation(
        async (args: { where?: { role_name?: string } }) => {
          if (args?.where?.role_name === 'director') {
            return { role_id: DIRECTOR_ROLE_ID };
          }
          return { role_id: MEMBER_ROLE_ID };
        },
      );
      prisma.club_role_assignments.findFirst.mockImplementation(
        async (args: {
          where?: { role_id?: string; status?: string | { in?: string[] } };
        }) => {
          if (args?.where?.role_id === DIRECTOR_ROLE_ID) {
            expect(args.where.status).toBe('active');
            return null;
          }
          return null;
        },
      );
      prisma.club_role_assignments.create.mockResolvedValue({
        assignment_id: 'new-not-enrolled',
      });

      const result = await service.ensureNotEnrolled(
        prisma as never,
        USER_ID,
        GM_SECTION_ID,
        CURRENT_YEAR,
      );

      expect(result.created).toBe(true);
      expect(prisma.club_role_assignments.create).toHaveBeenCalled();
    });
  });

  describe('legacy dry-run', () => {
    it('reports duplicates and designated rows without mutating', async () => {
      prisma.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: 'dup-1',
          user_id: USER_ID,
          club_section_id: GM_SECTION_ID,
          ecclesiastical_year_id: YEAR_ID_CURRENT,
          status: 'active',
        },
        {
          assignment_id: 'dup-2',
          user_id: USER_ID,
          club_section_id: GM_SECTION_ID,
          ecclesiastical_year_id: YEAR_ID_CURRENT,
          status: 'inactive',
        },
      ]);

      const report = await service.reportLegacyConflicts(prisma as never);

      expect(report.duplicateMemberGroups.length).toBeGreaterThan(0);
      expect(prisma.club_role_assignments.update).not.toHaveBeenCalled();
      expect(prisma.club_role_assignments.updateMany).not.toHaveBeenCalled();
    });
  });
});
