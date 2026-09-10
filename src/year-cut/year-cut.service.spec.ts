import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { YearCutService } from './year-cut.service';
import { PrismaService } from '../prisma/prisma.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { AnnualMembershipPolicyService } from '../annual-membership/annual-membership-policy.service';

const YEAR_ID_PREV = 2025;
const YEAR_ID_CURRENT = 2026;
const YEAR_ID_FUTURE = 2027;

const PREV_YEAR = {
  year_id: YEAR_ID_PREV,
  start_date: new Date('2025-01-01'),
  end_date: new Date('2025-12-31'),
};

const CURRENT_YEAR = {
  year_id: YEAR_ID_CURRENT,
  start_date: new Date('2026-01-01'),
  end_date: new Date('2026-12-31'),
  active: true,
};

const CONQUISTADORES_TYPE_ID = 10;
const GM_TYPE_ID = 12;

const DIRECTOR_ROLE_ID = 'r-director-uuid';
const SECRETARY_ROLE_ID = 'r-secretary-uuid';
const COUNSELOR_ROLE_ID = 'r-counselor-uuid';
const MEMBER_ROLE_ID = 'r-member-uuid';

const USER_CQ_DIRECTOR = 'user-cq-director-uuid';
const USER_SUCCESSOR = 'user-cq-director-b-uuid';
const USER_SECRETARY = 'user-secretary-uuid';
const USER_COUNSELOR = 'user-counselor-uuid';
const USER_MEMBER = 'user-member-uuid';

const CLUB_ID = 500;
const CQ_SECTION_ID = 101;
const GM_SECTION_ID = 201;

const ASSIGN_CQ_DIRECTOR_2025 = 'assign-cq-dir-2025-uuid';
const ASSIGN_SECRETARY_2025 = 'assign-sec-2025-uuid';
const ASSIGN_COUNSELOR_2025 = 'assign-counselor-2025-uuid';
const ASSIGN_MEMBER_2025 = 'assign-member-2025-uuid';
const ASSIGN_FUTURE_DIRECTOR = 'assign-future-dir-uuid';
const PLAN_CQ_2026 = 'plan-cq-2026-uuid';
const PLAN_GM_2026 = 'plan-gm-2026-uuid';
const NEW_DIRECTOR_ASSIGNMENT = 'assign-cq-dir-2026-active-uuid';

function expiredCqDirector(overrides: Record<string, unknown> = {}) {
  return {
    assignment_id: ASSIGN_CQ_DIRECTOR_2025,
    user_id: USER_CQ_DIRECTOR,
    role_id: DIRECTOR_ROLE_ID,
    club_section_id: CQ_SECTION_ID,
    ecclesiastical_year_id: YEAR_ID_PREV,
    end_date: null,
    ecclesiastical_year: { end_date: PREV_YEAR.end_date },
    status: 'active',
    roles: { role_name: 'director' },
    club_sections: {
      main_club_id: CLUB_ID,
      club_type_id: CONQUISTADORES_TYPE_ID,
      club_types: { name: 'Conquistadores' },
    },
    ...overrides,
  };
}

function scheduledCqPlan() {
  return {
    succession_id: PLAN_CQ_2026,
    club_section_id: CQ_SECTION_ID,
    successor_user_id: USER_SUCCESSOR,
    outgoing_assignment_id: ASSIGN_CQ_DIRECTOR_2025,
    target_ecclesiastical_year_id: YEAR_ID_CURRENT,
    effective_date: CURRENT_YEAR.start_date,
    status: 'scheduled',
    version: 1,
    club_section: { main_club_id: CLUB_ID },
  };
}

function makePrismaMock() {
  return {
    roles: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    club_types: { findMany: jest.fn() },
    club_sections: { findFirst: jest.fn(), findUnique: jest.fn() },
    club_role_assignments: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
    },
    director_succession_plans: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    club_year_transitions: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ status: 'in_progress' }),
      update: jest.fn(),
    },
    class_counselor_assignments: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
}

describe('YearCutService', () => {
  let service: YearCutService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let authContextVersion: { bumpMany: jest.Mock };
  let authContext: { invalidateUserAuthorizationCache: jest.Mock };
  let policy: {
    resolveBase: jest.Mock;
    ensureNotEnrolled: jest.Mock;
  };

  beforeEach(async () => {
    prisma = makePrismaMock();
    authContextVersion = { bumpMany: jest.fn().mockResolvedValue(1) };
    authContext = {
      invalidateUserAuthorizationCache: jest.fn().mockResolvedValue(undefined),
    };
    policy = {
      resolveBase: jest.fn().mockResolvedValue({
        clubId: CLUB_ID,
        baseSectionId: GM_SECTION_ID,
        clubTypeName: 'Guías Mayores',
      }),
      ensureNotEnrolled: jest.fn().mockResolvedValue({
        assignment_id: 'not-enrolled-uuid',
        created: true,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YearCutService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: EcclesiasticalYearService,
          useValue: { getCurrentYear: jest.fn().mockResolvedValue(CURRENT_YEAR) },
        },
        {
          provide: AuthorizationContextVersionService,
          useValue: authContextVersion,
        },
        {
          provide: AuthorizationContextService,
          useValue: authContext,
        },
        {
          provide: AnnualMembershipPolicyService,
          useValue: policy,
        },
      ],
    }).compile();

    service = module.get(YearCutService);
    prisma.$transaction.mockImplementation(
      (cb: (tx: typeof prisma) => unknown) => cb(prisma),
    );
    prisma.roles.findMany.mockResolvedValue([
      { role_id: DIRECTOR_ROLE_ID, role_name: 'director' },
      { role_id: SECRETARY_ROLE_ID, role_name: 'secretary' },
      { role_id: COUNSELOR_ROLE_ID, role_name: 'counselor' },
      { role_id: MEMBER_ROLE_ID, role_name: 'member' },
    ]);
    prisma.roles.findFirst.mockResolvedValue({
      role_id: DIRECTOR_ROLE_ID,
      role_name: 'director',
    });
    prisma.club_types.findMany.mockResolvedValue([
      { club_type_id: CONQUISTADORES_TYPE_ID, name: 'Conquistadores' },
      { club_type_id: 11, name: 'Aventureros' },
      { club_type_id: GM_TYPE_ID, name: 'Guías Mayores' },
    ]);
  });

  afterEach(() => jest.clearAllMocks());

  describe('A01 – CQ director ends; successor plan activates; return is not enrolled', () => {
    beforeEach(() => {
      prisma.club_role_assignments.findMany.mockResolvedValue([
        expiredCqDirector(),
      ]);
      prisma.director_succession_plans.findMany.mockResolvedValue([
        scheduledCqPlan(),
      ]);
      prisma.club_role_assignments.updateMany.mockResolvedValue({ count: 1 });
      prisma.club_role_assignments.create.mockResolvedValue({
        assignment_id: NEW_DIRECTOR_ASSIGNMENT,
        user_id: USER_SUCCESSOR,
      });
      prisma.director_succession_plans.update.mockResolvedValue({
        succession_id: PLAN_CQ_2026,
        status: 'activated',
      });
    });

    it('selects expired assignments by ecclesiastical year dates, not by year_id inequality', async () => {
      await service.applyCut();

      expect(prisma.club_role_assignments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'active',
            ecclesiastical_year: {
              end_date: { lt: CURRENT_YEAR.start_date },
            },
          }),
        }),
      );
      const yearIdNotFilter = (
        prisma.club_role_assignments.findMany as jest.Mock
      ).mock.calls.some(
        (call) => call[0]?.where?.ecclesiastical_year_id?.not === YEAR_ID_CURRENT,
      );
      expect(yearIdNotFilter).toBe(false);
    });

    it('ends the 2025 board assignment', async () => {
      const summary = await service.applyCut();

      expect(prisma.club_role_assignments.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            active: false,
            status: 'ended',
            end_date: PREV_YEAR.end_date,
          }),
        }),
      );
      expect(summary.ended).toBe(1);
    });

    it('keeps an earlier assignment end_date instead of rewriting it to the outgoing year end', async () => {
      const earlierEnd = new Date('2025-06-15');
      prisma.club_role_assignments.findMany.mockResolvedValue([
        expiredCqDirector({ end_date: earlierEnd }),
      ]);
      prisma.club_role_assignments.updateMany.mockResolvedValue({ count: 1 });

      await service.applyCut();

      expect(prisma.club_role_assignments.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ended',
            end_date: earlierEnd,
          }),
        }),
      );
    });

    it('activates the scheduled plan into an operational director, not a designated CRA', async () => {
      const summary = await service.applyCut();

      expect(prisma.club_role_assignments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: USER_SUCCESSOR,
            role_id: DIRECTOR_ROLE_ID,
            club_section_id: CQ_SECTION_ID,
            ecclesiastical_year_id: YEAR_ID_CURRENT,
            status: 'active',
            active: true,
          }),
        }),
      );
      expect(prisma.director_succession_plans.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { succession_id: PLAN_CQ_2026 },
          data: expect.objectContaining({
            status: 'activated',
            activated_assignment_id: NEW_DIRECTOR_ASSIGNMENT,
          }),
        }),
      );
      expect(summary.activated).toBe(1);
      const designatedActivate = (
        prisma.club_role_assignments.updateMany as jest.Mock
      ).mock.calls.some((call) => call[0]?.where?.status === 'designated');
      expect(designatedActivate).toBe(false);
    });

    it('A01: returning CQ director is not-enrolled via policy; no class; gmMembersCreated absent', async () => {
      const summary = await service.applyCut();

      expect(policy.resolveBase).toHaveBeenCalledWith(
        prisma,
        USER_CQ_DIRECTOR,
        expect.objectContaining({
          sourceClubId: CLUB_ID,
          sourceSectionId: CQ_SECTION_ID,
        }),
      );
      expect(policy.ensureNotEnrolled).toHaveBeenCalledWith(
        prisma,
        USER_CQ_DIRECTOR,
        GM_SECTION_ID,
        expect.objectContaining({ year_id: YEAR_ID_CURRENT }),
      );
      expect(summary.returnedNotEnrolled).toBe(1);
      expect(summary).not.toHaveProperty('gmMembersCreated');
    });

    it('locks the club/year inside the transaction and completes the ledger', async () => {
      await service.applyCut();

      expect(prisma.$executeRaw).toHaveBeenCalled();
      const lockSql = String(prisma.$executeRaw.mock.calls[0][0]);
      expect(lockSql).toMatch(/pg_advisory_xact_lock/);
      expect(prisma.club_year_transitions.upsert).toHaveBeenCalled();
      expect(prisma.club_year_transitions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'completed' }),
        }),
      );
    });
  });

  describe('A04 – scheduled GM director is kept; no extra member', () => {
    beforeEach(() => {
      prisma.club_role_assignments.findMany.mockResolvedValue([
        expiredCqDirector(),
      ]);
      prisma.director_succession_plans.findMany.mockResolvedValue([
        {
          succession_id: PLAN_GM_2026,
          club_section_id: GM_SECTION_ID,
          successor_user_id: USER_CQ_DIRECTOR,
          outgoing_assignment_id: null,
          target_ecclesiastical_year_id: YEAR_ID_CURRENT,
          effective_date: CURRENT_YEAR.start_date,
          status: 'scheduled',
          version: 1,
          club_section: { main_club_id: CLUB_ID },
        },
      ]);
      prisma.club_role_assignments.updateMany.mockResolvedValue({ count: 1 });
      prisma.club_role_assignments.create.mockResolvedValue({
        assignment_id: 'gm-dir-2026',
        user_id: USER_CQ_DIRECTOR,
      });
      prisma.director_succession_plans.update.mockResolvedValue({
        status: 'activated',
      });
      policy.ensureNotEnrolled.mockResolvedValue({
        assignment_id: 'gm-dir-2026',
        created: false,
      });
    });

    it('activates the GM director plan and does not count a returned member', async () => {
      const summary = await service.applyCut();

      expect(prisma.club_role_assignments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: USER_CQ_DIRECTOR,
            club_section_id: GM_SECTION_ID,
            status: 'active',
          }),
        }),
      );
      expect(summary.activated).toBe(1);
      expect(summary.returnedNotEnrolled).toBe(0);
    });
  });

  describe('vacant section and non-director expired cargos', () => {
    it('activates a plan when outgoing_assignment_id is null', async () => {
      prisma.club_role_assignments.findMany.mockResolvedValue([]);
      prisma.director_succession_plans.findMany.mockResolvedValue([
        {
          ...scheduledCqPlan(),
          outgoing_assignment_id: null,
        },
      ]);
      prisma.club_role_assignments.create.mockResolvedValue({
        assignment_id: NEW_DIRECTOR_ASSIGNMENT,
        user_id: USER_SUCCESSOR,
      });
      prisma.director_succession_plans.update.mockResolvedValue({
        status: 'activated',
      });

      const summary = await service.applyCut();
      expect(summary.activated).toBe(1);
      expect(summary.ended).toBe(0);
    });

    it('ends an expired secretary and returns them as not enrolled in GM', async () => {
      prisma.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: ASSIGN_SECRETARY_2025,
          user_id: USER_SECRETARY,
          role_id: SECRETARY_ROLE_ID,
          club_section_id: CQ_SECTION_ID,
          ecclesiastical_year_id: YEAR_ID_PREV,
          end_date: null,
          ecclesiastical_year: { end_date: PREV_YEAR.end_date },
          status: 'active',
          roles: { role_name: 'secretary' },
          club_sections: {
            main_club_id: CLUB_ID,
            club_type_id: CONQUISTADORES_TYPE_ID,
          },
        },
      ]);
      prisma.club_role_assignments.updateMany.mockResolvedValue({ count: 1 });

      const summary = await service.applyCut();
      expect(summary.ended).toBe(1);
      expect(policy.resolveBase).toHaveBeenCalledWith(
        prisma,
        USER_SECRETARY,
        expect.objectContaining({ sourceSectionId: CQ_SECTION_ID }),
      );
      expect(summary.returnedNotEnrolled).toBe(1);
    });

    it('ends an expired counselor without transferring pedagogical authority', async () => {
      prisma.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: ASSIGN_COUNSELOR_2025,
          user_id: USER_COUNSELOR,
          role_id: COUNSELOR_ROLE_ID,
          club_section_id: CQ_SECTION_ID,
          ecclesiastical_year_id: YEAR_ID_PREV,
          end_date: null,
          ecclesiastical_year: { end_date: PREV_YEAR.end_date },
          status: 'active',
          roles: { role_name: 'counselor' },
          club_sections: {
            main_club_id: CLUB_ID,
            club_type_id: CONQUISTADORES_TYPE_ID,
          },
        },
      ]);
      prisma.club_role_assignments.updateMany.mockResolvedValue({ count: 1 });
      prisma.class_counselor_assignments.findMany.mockResolvedValue([
        {
          assignment_id: ASSIGN_COUNSELOR_2025,
          end_date: null,
          ecclesiastical_year: { end_date: PREV_YEAR.end_date },
        },
      ]);
      prisma.class_counselor_assignments.updateMany.mockResolvedValue({
        count: 1,
      });
      policy.ensureNotEnrolled.mockResolvedValue({
        assignment_id: 'cq-not-enrolled',
        created: true,
      });

      const summary = await service.applyCut();
      expect(prisma.class_counselor_assignments.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            active: false,
            end_date: PREV_YEAR.end_date,
          }),
        }),
      );
      expect(policy.ensureNotEnrolled).toHaveBeenCalledWith(
        prisma,
        USER_COUNSELOR,
        CQ_SECTION_ID,
        expect.objectContaining({ year_id: YEAR_ID_CURRENT }),
      );
      expect(summary.ended).toBe(1);
    });

    it('A10: does not close a future-year assignment', async () => {
      prisma.club_role_assignments.findMany.mockResolvedValue([]);
      prisma.director_succession_plans.findMany.mockResolvedValue([]);

      await service.applyCut();

      expect(prisma.club_role_assignments.updateMany).not.toHaveBeenCalled();
      expect(ASSIGN_FUTURE_DIRECTOR).toBeTruthy();
    });
  });

  describe('A07 – retry and completed ledger', () => {
    it('skips a club whose transition is already completed', async () => {
      prisma.club_year_transitions.findMany.mockResolvedValue([
        { club_id: CLUB_ID, status: 'pending' },
      ]);
      prisma.club_year_transitions.findUnique.mockResolvedValue({
        transition_id: 't1',
        status: 'completed',
      });

      const summary = await service.applyCut();
      expect(summary.ended).toBe(0);
      expect(prisma.club_role_assignments.updateMany).not.toHaveBeenCalled();
    });

    it('second run after a completed cut does not duplicate directors or members', async () => {
      prisma.club_role_assignments.findMany.mockResolvedValue([]);
      prisma.director_succession_plans.findMany.mockResolvedValue([]);
      prisma.club_year_transitions.findUnique.mockResolvedValue({
        status: 'completed',
      });
      prisma.club_year_transitions.findMany.mockResolvedValue([
        { club_id: CLUB_ID },
      ]);

      const summary = await service.applyCut();
      expect(prisma.club_role_assignments.create).not.toHaveBeenCalled();
      expect(policy.ensureNotEnrolled).not.toHaveBeenCalled();
      expect(summary.activated).toBe(0);
    });
  });

  describe('legacy designated CRA is not a second activation path', () => {
    it('does not activate leftover designated rows', async () => {
      prisma.club_role_assignments.findMany.mockResolvedValue([
        expiredCqDirector(),
      ]);
      prisma.director_succession_plans.findMany.mockResolvedValue([]);
      prisma.club_role_assignments.updateMany.mockResolvedValue({ count: 1 });

      await service.applyCut();

      const designatedActivate = (
        prisma.club_role_assignments.updateMany as jest.Mock
      ).mock.calls.some((call) => call[0]?.where?.status === 'designated');
      expect(designatedActivate).toBe(false);
    });
  });

  describe('cache invalidation without JWT blacklist or closeYear', () => {
    beforeEach(() => {
      prisma.club_role_assignments.findMany.mockResolvedValue([
        expiredCqDirector(),
      ]);
      prisma.director_succession_plans.findMany.mockResolvedValue([]);
      prisma.club_role_assignments.updateMany.mockResolvedValue({ count: 1 });
    });

    it('invalidates affected users after commit', async () => {
      await service.applyCut();
      expect(authContext.invalidateUserAuthorizationCache).toHaveBeenCalledWith(
        USER_CQ_DIRECTOR,
      );
    });

    it('does not fail the cut when cache invalidation throws', async () => {
      authContext.invalidateUserAuthorizationCache.mockRejectedValue(
        new Error('redis down'),
      );
      await expect(service.applyCut()).resolves.toEqual(
        expect.objectContaining({ ended: 1 }),
      );
    });

    it('does not call TokenBlacklist or closeYear', () => {
      const src = readFileSync(join(__dirname, 'year-cut.service.ts'), 'utf8');
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(codeOnly).not.toMatch(/TokenBlacklist/);
      expect(codeOnly).not.toMatch(/YearEndService/);
      expect(codeOnly).not.toMatch(/closeYear/);
    });
  });

  describe('A10 historical member row is ended, not rewritten to inactive', () => {
    it('ends the expired member and creates current not-enrolled via policy', async () => {
      prisma.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: ASSIGN_MEMBER_2025,
          user_id: USER_MEMBER,
          role_id: MEMBER_ROLE_ID,
          club_section_id: CQ_SECTION_ID,
          ecclesiastical_year_id: YEAR_ID_PREV,
          end_date: null,
          ecclesiastical_year: { end_date: PREV_YEAR.end_date },
          status: 'active',
          roles: { role_name: 'member' },
          club_sections: {
            main_club_id: CLUB_ID,
            club_type_id: CONQUISTADORES_TYPE_ID,
          },
        },
      ]);
      prisma.club_role_assignments.updateMany.mockResolvedValue({ count: 1 });

      const summary = await service.applyCut();
      const inactiveRewrite = (
        prisma.club_role_assignments.updateMany as jest.Mock
      ).mock.calls.some((call) => call[0]?.data?.status === 'inactive');
      expect(inactiveRewrite).toBe(false);
      expect(policy.ensureNotEnrolled).toHaveBeenCalledWith(
        prisma,
        USER_MEMBER,
        CQ_SECTION_ID,
        expect.objectContaining({ year_id: YEAR_ID_CURRENT }),
      );
      expect(summary.ended).toBe(1);
      expect(YEAR_ID_FUTURE).toBe(2027);
    });
  });
});
