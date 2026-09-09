import { Test, TestingModule } from '@nestjs/testing';
import { AnnualMembershipService } from './annual-membership.service';
import { PrismaService } from '../prisma/prisma.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { NextClassResolver } from '../classes/next-class.resolver';
import { ClassEnrollmentPolicyService } from '../classes/class-enrollment-policy.service';
import { ClassEnrollmentWriter } from '../classes/class-enrollment-writer.service';
import { AnnualMembershipPolicyService } from './annual-membership-policy.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginationDto } from '../common/dto/pagination.dto';

const YEAR_ID_CURRENT = 2026;
const CURRENT_YEAR = {
  year_id: YEAR_ID_CURRENT,
  start_date: new Date('2026-01-01'),
  end_date: new Date('2026-12-31'),
  active: true,
};

const SECTION_ID = 101;
const GM_SECTION_ID = 301;
const CQ_SECTION_ID = 101;
const MAIN_CLUB_ID = 500;
const MEMBER_ROLE_ID = 'r-member-uuid';
const DIRECTOR_ROLE_ID = 'r-director-uuid';

const USER_A = 'user-a-uuid';
const USER_RETURNED = 'user-returned-from-cq-uuid';
const USER_SKIP_YEAR = 'user-skip-year-uuid';
const USER_DIRECTOR_OTHER = 'user-director-other-section-uuid';
const ACTOR_ID = 'actor-gm-director-uuid';

function makePrismaMock() {
  return {
    club_sections: {
      findUnique: jest.fn(),
    },
    club_role_assignments: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
    },
    enrollments: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

describe('AnnualMembershipService', () => {
  let service: AnnualMembershipService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let nextClassResolver: { resolve: jest.Mock };
  let classPolicy: { evaluate: jest.Mock };
  let classWriter: { upsert: jest.Mock };
  let membershipPolicy: {
    listNotEnrolled: jest.Mock;
    ensureNotEnrolled: jest.Mock;
    resolveBase: jest.Mock;
  };
  let authContextVersion: { bumpMany: jest.Mock };
  let authContext: { invalidateUserAuthorizationCache: jest.Mock };
  let auditLogs: { recordEvent: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    nextClassResolver = {
      resolve: jest.fn().mockResolvedValue({
        kind: 'next_class',
        class_id: 42,
        display_order: 1,
        club_type_id: 3,
        club_section_id: GM_SECTION_ID,
        ecclesiastical_year_id: YEAR_ID_CURRENT,
        crossed_type: false,
      }),
    };
    classPolicy = { evaluate: jest.fn().mockResolvedValue({ kind: 'ok' }) };
    classWriter = {
      upsert: jest.fn().mockResolvedValue({ enrollment_id: 99, created: true }),
    };
    membershipPolicy = {
      listNotEnrolled: jest.fn().mockResolvedValue([]),
      ensureNotEnrolled: jest.fn().mockResolvedValue({
        assignment_id: 'inactive-row',
        created: false,
      }),
      resolveBase: jest.fn().mockResolvedValue({
        clubId: MAIN_CLUB_ID,
        baseSectionId: GM_SECTION_ID,
        clubTypeName: 'Guías Mayores',
      }),
    };
    authContextVersion = { bumpMany: jest.fn().mockResolvedValue(1) };
    authContext = {
      invalidateUserAuthorizationCache: jest.fn().mockResolvedValue(undefined),
    };
    auditLogs = { recordEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualMembershipService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: EcclesiasticalYearService,
          useValue: { getCurrentYear: jest.fn().mockResolvedValue(CURRENT_YEAR) },
        },
        { provide: AuthorizationContextVersionService, useValue: authContextVersion },
        { provide: AuthorizationContextService, useValue: authContext },
        { provide: NextClassResolver, useValue: nextClassResolver },
        { provide: ClassEnrollmentPolicyService, useValue: classPolicy },
        { provide: ClassEnrollmentWriter, useValue: classWriter },
        { provide: AnnualMembershipPolicyService, useValue: membershipPolicy },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();

    service = module.get(AnnualMembershipService);

    prisma.$transaction.mockImplementation(
      (cb: (tx: typeof prisma) => unknown) => cb(prisma),
    );
    prisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: GM_SECTION_ID,
      main_club_id: MAIN_CLUB_ID,
      active: true,
    });
    prisma.roles.findFirst.mockImplementation(async (args: { where?: { role_name?: string } }) => {
      if (args?.where?.role_name === 'director') {
        return { role_id: DIRECTOR_ROLE_ID };
      }
      return { role_id: MEMBER_ROLE_ID };
    });
  });

  afterEach(() => jest.clearAllMocks());

  function pagination(page = 1, limit = 20): PaginationDto {
    const dto = new PaginationDto();
    dto.page = page;
    dto.limit = limit;
    return dto;
  }

  describe('listContinuations — current-year not-enrolled (A02/A03)', () => {
    it('A02 GET includes returned CQ user from policy even without a prior-year GM row', async () => {
      membershipPolicy.listNotEnrolled.mockResolvedValue([
        { user_id: USER_RETURNED, name: 'Luis Pérez Soto' },
      ]);
      prisma.club_role_assignments.findMany.mockResolvedValue([]);

      const result = await service.listContinuations(GM_SECTION_ID, pagination());

      expect(membershipPolicy.listNotEnrolled).toHaveBeenCalledWith(
        expect.anything(),
        GM_SECTION_ID,
        YEAR_ID_CURRENT,
      );
      expect(result.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            user_id: USER_RETURNED,
            name: 'Luis Pérez Soto',
            base_section_id: GM_SECTION_ID,
            ecclesiastical_year_id: YEAR_ID_CURRENT,
            annual_status: 'not_enrolled',
            eligibility: 'eligible',
            blocked_reason: null,
            suggested_class: { status: 'resolved', class_id: 42 },
          }),
        ]),
      );
      expect(result.meta.total).toBe(1);
    });

    it('does not query a previous ecclesiastical year as the list source', async () => {
      membershipPolicy.listNotEnrolled.mockResolvedValue([]);
      prisma.club_role_assignments.findMany.mockResolvedValue([]);

      await service.listContinuations(GM_SECTION_ID, pagination());

      expect(prisma).not.toHaveProperty('ecclesiastical_years');
    });

    it('A03 GET includes a skip-year member with valid belonging even if last CRA is ended and active=false', async () => {
      membershipPolicy.listNotEnrolled.mockResolvedValue([]);
      prisma.club_role_assignments.findMany.mockResolvedValue([
        {
          user_id: USER_SKIP_YEAR,
          status: 'ended',
          active: false,
          ecclesiastical_year_id: 2024,
          users: { name: 'Marta', paternal_last_name: 'Díaz', maternal_last_name: 'Ruiz' },
          roles: { role_name: 'member' },
        },
      ]);
      membershipPolicy.resolveBase.mockResolvedValue({
        clubId: MAIN_CLUB_ID,
        baseSectionId: GM_SECTION_ID,
        clubTypeName: 'Guías Mayores',
      });

      const result = await service.listContinuations(GM_SECTION_ID, pagination());

      expect(result.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            user_id: USER_SKIP_YEAR,
            annual_status: 'not_enrolled',
            eligibility: 'eligible',
          }),
        ]),
      );
    });

    it('does not treat an active director in another section as already enrolled here', async () => {
      membershipPolicy.listNotEnrolled.mockResolvedValue([
        { user_id: USER_DIRECTOR_OTHER, name: 'Ana Directora CQ' },
      ]);
      prisma.club_role_assignments.findMany.mockResolvedValue([
        {
          user_id: USER_DIRECTOR_OTHER,
          status: 'active',
          active: true,
          ecclesiastical_year_id: YEAR_ID_CURRENT,
          club_section_id: CQ_SECTION_ID,
          users: { name: 'Ana', paternal_last_name: 'Directora', maternal_last_name: 'CQ' },
          roles: { role_name: 'director' },
        },
      ]);

      const result = await service.listContinuations(GM_SECTION_ID, pagination());

      expect(result.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            user_id: USER_DIRECTOR_OTHER,
            annual_status: 'not_enrolled',
            eligibility: 'eligible',
          }),
        ]),
      );
    });

    it('applies page/limit and name search', async () => {
      membershipPolicy.listNotEnrolled.mockResolvedValue([
        { user_id: USER_A, name: 'Ana López' },
        { user_id: USER_RETURNED, name: 'Luis Pérez Soto' },
      ]);
      prisma.club_role_assignments.findMany.mockResolvedValue([]);

      const result = await service.listContinuations(
        GM_SECTION_ID,
        pagination(1, 1),
        'luis',
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].user_id).toBe(USER_RETURNED);
      expect(result.meta.total).toBe(1);
      expect(result.meta.limit).toBe(1);
    });
  });

  describe('continueUsers — directive enrollment (A02/A03/A11)', () => {
    it('A02 POST activates current-year member inactive and does not reject a returned user without prior GM row', async () => {
      prisma.club_role_assignments.findFirst.mockResolvedValueOnce({
        assignment_id: 'gm-not-enrolled-2026',
        user_id: USER_RETURNED,
        status: 'inactive',
        role_id: MEMBER_ROLE_ID,
      });

      const result = await service.continueUsers(
        GM_SECTION_ID,
        [USER_RETURNED],
        ACTOR_ID,
      );

      expect(result.results).toEqual([
        expect.objectContaining({
          user_id: USER_RETURNED,
          outcome: 'enrolled',
          club_section_id: GM_SECTION_ID,
          ecclesiastical_year_id: YEAR_ID_CURRENT,
          enrollment_id: 99,
          error_code: null,
        }),
      ]);
      expect(prisma.club_role_assignments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assignment_id: 'gm-not-enrolled-2026' },
          data: expect.objectContaining({ status: 'active' }),
        }),
      );
      expect(prisma.club_role_assignments.create).not.toHaveBeenCalled();
      expect(nextClassResolver.resolve).toHaveBeenCalledWith(
        USER_RETURNED,
        GM_SECTION_ID,
        YEAR_ID_CURRENT,
      );
      expect(classPolicy.evaluate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: USER_RETURNED,
          classId: 42,
          mode: 'annual',
        }),
      );
      expect(classWriter.upsert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: USER_RETURNED,
          classId: 42,
          ecclesiasticalYearId: YEAR_ID_CURRENT,
          crossType: false,
          ifExists: 'return',
        }),
      );
      expect(prisma.enrollments.create).not.toHaveBeenCalled();
      expect(auditLogs.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_user_id: ACTOR_ID,
          entity_id: USER_RETURNED,
          action: 'ANNUAL_ENROLL',
        }),
      );
    });

    it('A11 retry of an already active member in the destination section is already_enrolled', async () => {
      prisma.club_role_assignments.findFirst.mockResolvedValueOnce({
        assignment_id: 'already-member',
        user_id: USER_RETURNED,
        status: 'active',
        role_id: MEMBER_ROLE_ID,
      });

      const result = await service.continueUsers(
        GM_SECTION_ID,
        [USER_RETURNED],
        ACTOR_ID,
      );

      expect(result.results[0].outcome).toBe('already_enrolled');
      expect(prisma.club_role_assignments.update).not.toHaveBeenCalled();
      expect(nextClassResolver.resolve).not.toHaveBeenCalled();
      expect(classWriter.upsert).not.toHaveBeenCalled();
    });

    it('A11 does not treat a director cargo in another section as already_enrolled here', async () => {
      prisma.club_role_assignments.findFirst.mockImplementation(
        async (args: {
          where?: {
            role_id?: string;
            club_section_id?: number;
            status?: string | { in?: string[] };
          };
        }) => {
          if (args?.where?.role_id === MEMBER_ROLE_ID) {
            return {
              assignment_id: 'gm-inactive',
              status: 'inactive',
              role_id: MEMBER_ROLE_ID,
            };
          }
          return null;
        },
      );

      const result = await service.continueUsers(
        GM_SECTION_ID,
        [USER_DIRECTOR_OTHER],
        ACTOR_ID,
      );

      expect(result.results[0].outcome).toBe('enrolled');
      expect(prisma.club_role_assignments.update).toHaveBeenCalled();
    });

    it('preserves an operational director in the destination section without creating member', async () => {
      prisma.club_role_assignments.findFirst.mockImplementation(
        async (args: { where?: { role_id?: string } }) => {
          if (args?.where?.role_id === DIRECTOR_ROLE_ID) {
            return { assignment_id: 'gm-director', status: 'active' };
          }
          return null;
        },
      );

      const result = await service.continueUsers(
        GM_SECTION_ID,
        [USER_RETURNED],
        ACTOR_ID,
      );

      expect(result.results[0].outcome).toBe('already_enrolled');
      expect(prisma.club_role_assignments.create).not.toHaveBeenCalled();
      expect(prisma.club_role_assignments.update).not.toHaveBeenCalled();
    });

    it('A11 transaction failure yields failed for that user and does not invalidate auth cache', async () => {
      prisma.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'gm-inactive',
        status: 'inactive',
        role_id: MEMBER_ROLE_ID,
      });
      prisma.$transaction.mockRejectedValueOnce(new Error('class writer boom'));

      const result = await service.continueUsers(
        GM_SECTION_ID,
        [USER_RETURNED],
        ACTOR_ID,
      );

      expect(result.results[0]).toEqual(
        expect.objectContaining({
          user_id: USER_RETURNED,
          outcome: 'failed',
        }),
      );
      expect(authContext.invalidateUserAuthorizationCache).not.toHaveBeenCalled();
    });

    it('returns per-user outcomes and does not abort the batch', async () => {
      prisma.club_role_assignments.findFirst.mockImplementation(
        async (args: { where?: { user_id?: string; role_id?: string } }) => {
          if (args?.where?.role_id === MEMBER_ROLE_ID && args.where.user_id === USER_A) {
            return { assignment_id: 'a-inactive', status: 'inactive', role_id: MEMBER_ROLE_ID };
          }
          if (args?.where?.role_id === MEMBER_ROLE_ID && args.where.user_id === USER_RETURNED) {
            return { assignment_id: 'already', status: 'active', role_id: MEMBER_ROLE_ID };
          }
          return null;
        },
      );

      const result = await service.continueUsers(
        GM_SECTION_ID,
        [USER_A, USER_RETURNED, USER_A],
        ACTOR_ID,
      );

      expect(result.results).toHaveLength(2);
      expect(result.results.map((row) => row.user_id)).toEqual([USER_A, USER_RETURNED]);
      expect(result.results[0].outcome).toBe('enrolled');
      expect(result.results[1].outcome).toBe('already_enrolled');
    });

    it('does not enroll a pending first-time request via annual continuation', async () => {
      prisma.club_role_assignments.findFirst.mockImplementation(
        async (args: {
          where?: { status?: string | { in?: string[] }; role_id?: string };
        }) => {
          const statusIn =
            typeof args?.where?.status === 'object' ? args.where.status.in : undefined;
          if (statusIn?.includes('pending') || statusIn?.includes('rejected')) {
            return { assignment_id: 'pending-row', status: 'pending' };
          }
          return null;
        },
      );

      const result = await service.continueUsers(GM_SECTION_ID, [USER_A], ACTOR_ID);

      expect(result.results[0].outcome).toBe('blocked');
      expect(prisma.club_role_assignments.update).not.toHaveBeenCalled();
    });

    it('does not inject ClassesService', () => {
      expect('classesService' in service).toBe(false);
    });

    it('A11/A12 enrolls next class in the same transaction and returns enrollment_id', async () => {
      prisma.club_role_assignments.findFirst.mockResolvedValueOnce({
        assignment_id: 'gm-not-enrolled-2026',
        user_id: USER_RETURNED,
        status: 'inactive',
        role_id: MEMBER_ROLE_ID,
      });

      const result = await service.continueUsers(
        GM_SECTION_ID,
        [USER_RETURNED],
        ACTOR_ID,
      );

      expect(result.results[0]).toMatchObject({
        outcome: 'enrolled',
        enrollment_id: 99,
      });
      expect(classWriter.upsert).toHaveBeenCalled();
    });

    it('A11 D02 configuration_error rolls back via throw and maps to blocked', async () => {
      prisma.club_role_assignments.findFirst.mockResolvedValueOnce({
        assignment_id: 'gm-not-enrolled-2026',
        status: 'inactive',
        role_id: MEMBER_ROLE_ID,
      });
      nextClassResolver.resolve.mockResolvedValue({
        kind: 'configuration_error',
        code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
      });

      const result = await service.continueUsers(
        GM_SECTION_ID,
        [USER_RETURNED],
        ACTOR_ID,
      );

      expect(result.results[0]).toMatchObject({
        outcome: 'blocked',
        enrollment_id: null,
        error_code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
      });
      expect(classWriter.upsert).not.toHaveBeenCalled();
    });

    it('A11 next class in another section is blocked without writing enrollment', async () => {
      prisma.club_role_assignments.findFirst.mockResolvedValueOnce({
        assignment_id: 'gm-not-enrolled-2026',
        status: 'inactive',
        role_id: MEMBER_ROLE_ID,
      });
      nextClassResolver.resolve.mockResolvedValue({
        kind: 'next_class',
        class_id: 42,
        display_order: 1,
        club_type_id: 1,
        club_section_id: CQ_SECTION_ID,
        ecclesiastical_year_id: YEAR_ID_CURRENT,
        crossed_type: false,
      });

      const result = await service.continueUsers(
        GM_SECTION_ID,
        [USER_RETURNED],
        ACTOR_ID,
      );

      expect(result.results[0]).toMatchObject({
        outcome: 'blocked',
        error_code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
      });
      expect(classWriter.upsert).not.toHaveBeenCalled();
    });

    it('A12 independent prerequisite failure is blocked', async () => {
      prisma.club_role_assignments.findFirst.mockResolvedValueOnce({
        assignment_id: 'gm-not-enrolled-2026',
        status: 'inactive',
        role_id: MEMBER_ROLE_ID,
      });
      classPolicy.evaluate.mockResolvedValue({
        kind: 'policy_blocked',
        code: ErrorCode.CLASS_PREREQUISITE_NOT_MET,
      });

      const result = await service.continueUsers(
        GM_SECTION_ID,
        [USER_RETURNED],
        ACTOR_ID,
      );

      expect(result.results[0]).toMatchObject({
        outcome: 'blocked',
        error_code: ErrorCode.CLASS_PREREQUISITE_NOT_MET,
      });
      expect(classWriter.upsert).not.toHaveBeenCalled();
    });

    it('A11 writer failure yields failed and does not treat it as blocked', async () => {
      prisma.club_role_assignments.findFirst.mockResolvedValueOnce({
        assignment_id: 'gm-not-enrolled-2026',
        status: 'inactive',
        role_id: MEMBER_ROLE_ID,
      });
      classWriter.upsert.mockRejectedValueOnce(new Error('unique boom'));

      const result = await service.continueUsers(
        GM_SECTION_ID,
        [USER_RETURNED],
        ACTOR_ID,
      );

      expect(result.results[0].outcome).toBe('failed');
      expect(authContext.invalidateUserAuthorizationCache).not.toHaveBeenCalled();
    });

    it('GET surfaces configuration_error as suggested_class blocked', async () => {
      membershipPolicy.listNotEnrolled.mockResolvedValue([
        { user_id: USER_RETURNED, name: 'Luis Pérez Soto' },
      ]);
      prisma.club_role_assignments.findMany.mockResolvedValue([]);
      nextClassResolver.resolve.mockResolvedValue({
        kind: 'configuration_error',
        code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
      });

      const result = await service.listContinuations(GM_SECTION_ID, pagination());

      expect(result.data[0].suggested_class).toEqual({
        status: 'blocked',
        code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
      });
    });
  });

  describe('annualEnroll — D01 blocked (A15)', () => {
    it('throws ANNUAL_ENROLL_REQUIRES_DIRECTIVE and writes nothing', async () => {
      await expect(service.annualEnroll(USER_A)).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_ENROLL_REQUIRES_DIRECTIVE,
      });

      expect(prisma.club_role_assignments.findFirst).not.toHaveBeenCalled();
      expect(prisma.club_role_assignments.create).not.toHaveBeenCalled();
      expect(prisma.club_role_assignments.update).not.toHaveBeenCalled();
      expect(prisma.enrollments.create).not.toHaveBeenCalled();
      expect(authContext.invalidateUserAuthorizationCache).not.toHaveBeenCalled();
    });
  });
});
