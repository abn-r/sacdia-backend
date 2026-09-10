import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { DirectorDesignationService } from './director-designation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { ErrorCode } from '../common/errors/error-codes';

function hashDirectorDesignationRequest(input: {
  clubId: number;
  sectionId: number;
  userId: string;
  ecclesiasticalYearId: number;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        club_id: input.clubId,
        club_section_id: input.sectionId,
        user_id: input.userId.toLowerCase(),
        ecclesiastical_year_id: input.ecclesiasticalYearId,
      }),
    )
    .digest('hex');
}

describe('DirectorDesignationService', () => {
  let service: DirectorDesignationService;

  const mockPrismaService = {
    club_sections: {
      findUnique: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
    },
    ecclesiastical_years: {
      findFirst: jest.fn(),
    },
    club_role_assignments: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    director_succession_plans: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockAuthorizationContextService = {
    hasAnyGlobalRole: jest.fn(),
    canManageClub: jest.fn(),
    invalidateUserAuthorizationCache: jest.fn(),
    resolveUserAuthorization: jest.fn(),
  };

  const mockEcclesiasticalYearService = {
    getCurrentYear: jest.fn(),
  };

  const ACTOR_ID = '00000000-0000-0000-0000-000000000001';
  const DESIGNATEE_USER_ID = '00000000-0000-0000-0000-000000000002';
  const OTHER_USER_ID = '00000000-0000-0000-0000-000000000003';
  const DIRECTOR_ROLE_ID = '00000000-0000-0000-0000-000000000010';
  const SUCCESSION_ID = '00000000-0000-0000-0000-000000000030';
  const OUTGOING_ASSIGNMENT_ID = '00000000-0000-0000-0000-000000000040';
  const IDEMPOTENCY_KEY = '00000000-0000-0000-0000-000000000050';
  const CLUB_ID = 99;
  const OTHER_CLUB_ID = 77;
  const SECTION_ID = 7;
  const LOCAL_FIELD_ID = 3;
  const CURRENT_YEAR_ID = 2026;
  const FUTURE_YEAR_ID = 2027;

  const FUTURE_YEAR = {
    year_id: FUTURE_YEAR_ID,
    start_date: new Date('2027-01-01'),
    end_date: new Date('2027-12-31'),
  };

  const SCHEDULED_PLAN = {
    succession_id: SUCCESSION_ID,
    club_section_id: SECTION_ID,
    successor_user_id: DESIGNATEE_USER_ID,
    target_ecclesiastical_year_id: FUTURE_YEAR_ID,
    effective_date: FUTURE_YEAR.start_date,
    status: 'scheduled',
    version: 1,
    outgoing_assignment_id: OUTGOING_ASSIGNMENT_ID,
    scheduled_local_field_id: LOCAL_FIELD_ID,
    request_hash: 'hash',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DirectorDesignationService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContextService,
        },
        {
          provide: EcclesiasticalYearService,
          useValue: mockEcclesiasticalYearService,
        },
      ],
    }).compile();

    service = module.get(DirectorDesignationService);

    mockPrismaService.$transaction.mockImplementation(
      (callback: (tx: typeof mockPrismaService) => unknown) =>
        callback(mockPrismaService),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function setupHappyPath() {
    mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
    mockAuthorizationContextService.canManageClub.mockResolvedValue(true);
    mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        grants: {
          global_roles: [{ role_name: 'director-lf' }],
          club_assignments: [],
        },
      },
    });
    mockPrismaService.club_sections.findUnique.mockResolvedValue({
      main_club_id: CLUB_ID,
      clubs: { club_id: CLUB_ID, local_field_id: LOCAL_FIELD_ID },
    });
    mockPrismaService.roles.findFirst.mockResolvedValue({
      role_id: DIRECTOR_ROLE_ID,
    });
    mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue({
      year_id: CURRENT_YEAR_ID,
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      active: true,
    });
    mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(FUTURE_YEAR);
    mockPrismaService.director_succession_plans.findUnique.mockResolvedValue(null);
    mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(null);
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
      assignment_id: OUTGOING_ASSIGNMENT_ID,
    });
  }

  describe('A05 – designate creates a private succession plan', () => {
    it('creates a scheduled plan and does not create a designated CRA', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.create.mockResolvedValue(SCHEDULED_PLAN);

      const result = await service.designate(
        CLUB_ID,
        SECTION_ID,
        { user_id: DESIGNATEE_USER_ID, ecclesiastical_year_id: FUTURE_YEAR_ID },
        ACTOR_ID,
        IDEMPOTENCY_KEY,
      );

      expect(result).toEqual(
        expect.objectContaining({
          succession_id: SUCCESSION_ID,
          user_id: DESIGNATEE_USER_ID,
          ecclesiastical_year_id: FUTURE_YEAR_ID,
          status: 'scheduled',
          version: 1,
        }),
      );
      expect(mockPrismaService.director_succession_plans.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            club_section_id: SECTION_ID,
            successor_user_id: DESIGNATEE_USER_ID,
            target_ecclesiastical_year_id: FUTURE_YEAR_ID,
            status: 'scheduled',
            outgoing_assignment_id: OUTGOING_ASSIGNMENT_ID,
            scheduled_by_id: ACTOR_ID,
            idempotency_key: IDEMPOTENCY_KEY,
          }),
        }),
      );
      expect(mockPrismaService.club_role_assignments.create).not.toHaveBeenCalled();
      expect(mockPrismaService.club_role_assignments.update).not.toHaveBeenCalled();
      expect(
        mockAuthorizationContextService.invalidateUserAuthorizationCache,
      ).not.toHaveBeenCalled();
    });

    it('allows a vacant section (outgoing_assignment_id null)', async () => {
      setupHappyPath();
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);
      mockPrismaService.director_succession_plans.create.mockResolvedValue({
        ...SCHEDULED_PLAN,
        outgoing_assignment_id: null,
      });

      const result = await service.designate(
        CLUB_ID,
        SECTION_ID,
        { user_id: DESIGNATEE_USER_ID, ecclesiastical_year_id: FUTURE_YEAR_ID },
        ACTOR_ID,
        IDEMPOTENCY_KEY,
      );

      expect(mockPrismaService.director_succession_plans.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outgoing_assignment_id: null }),
        }),
      );
      expect(result.outgoing_assignment_id).toBeNull();
    });

    it('rejects when section does not belong to clubId in the URL', async () => {
      setupHappyPath();
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: OTHER_CLUB_ID,
        clubs: { club_id: OTHER_CLUB_ID, local_field_id: LOCAL_FIELD_ID },
      });

      await expect(
        service.designate(
          CLUB_ID,
          SECTION_ID,
          { user_id: DESIGNATEE_USER_ID, ecclesiastical_year_id: FUTURE_YEAR_ID },
          ACTOR_ID,
          IDEMPOTENCY_KEY,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_ASSIGNMENT_SCOPE_INVALID });

      expect(mockPrismaService.director_succession_plans.create).not.toHaveBeenCalled();
    });

    it('rejects actors outside the club territory', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
      mockAuthorizationContextService.canManageClub.mockResolvedValue(false);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: CLUB_ID,
        clubs: { club_id: CLUB_ID, local_field_id: LOCAL_FIELD_ID },
      });

      await expect(
        service.designate(
          CLUB_ID,
          SECTION_ID,
          { user_id: DESIGNATEE_USER_ID, ecclesiastical_year_id: FUTURE_YEAR_ID },
          ACTOR_ID,
          IDEMPOTENCY_KEY,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    });

    it('returns 400 CLUB_DIRECTOR_PLAN_YEAR_INVALID for the current year', async () => {
      setupHappyPath();
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: CURRENT_YEAR_ID,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
      });

      await expect(
        service.designate(
          CLUB_ID,
          SECTION_ID,
          { user_id: DESIGNATEE_USER_ID, ecclesiastical_year_id: CURRENT_YEAR_ID },
          ACTOR_ID,
          IDEMPOTENCY_KEY,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_PLAN_YEAR_INVALID,
      });
    });

    it('returns 400 when year_id is high but dates are in the past', async () => {
      setupHappyPath();
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 9999,
        start_date: new Date('2020-01-01'),
        end_date: new Date('2020-12-31'),
      });

      await expect(
        service.designate(
          CLUB_ID,
          SECTION_ID,
          { user_id: DESIGNATEE_USER_ID, ecclesiastical_year_id: 9999 },
          ACTOR_ID,
          IDEMPOTENCY_KEY,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_PLAN_YEAR_INVALID,
      });
    });

    it('returns 409 CLUB_DIRECTOR_PLAN_CONFLICT when a scheduled plan already exists', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(SCHEDULED_PLAN);

      await expect(
        service.designate(
          CLUB_ID,
          SECTION_ID,
          { user_id: DESIGNATEE_USER_ID, ecclesiastical_year_id: FUTURE_YEAR_ID },
          ACTOR_ID,
          IDEMPOTENCY_KEY,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CLUB_DIRECTOR_PLAN_CONFLICT });

      expect(mockPrismaService.director_succession_plans.create).not.toHaveBeenCalled();
    });

    it('maps a Prisma unique race on the open-plan index to CLUB_DIRECTOR_PLAN_CONFLICT', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.create.mockRejectedValue({
        code: 'P2002',
        meta: {
          modelName: 'director_succession_plans',
          driverAdapterError: {
            cause: {
              constraint: {
                fields: ['club_section_id', 'target_ecclesiastical_year_id'],
              },
            },
          },
        },
      });

      await expect(
        service.designate(
          CLUB_ID,
          SECTION_ID,
          { user_id: DESIGNATEE_USER_ID, ecclesiastical_year_id: FUTURE_YEAR_ID },
          ACTOR_ID,
          IDEMPOTENCY_KEY,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CLUB_DIRECTOR_PLAN_CONFLICT });
    });

    it('returns the same plan when Idempotency-Key and payload match', async () => {
      setupHappyPath();
      const requestHash = hashDirectorDesignationRequest({
        clubId: CLUB_ID,
        sectionId: SECTION_ID,
        userId: DESIGNATEE_USER_ID,
        ecclesiasticalYearId: FUTURE_YEAR_ID,
      });
      mockPrismaService.director_succession_plans.findUnique.mockResolvedValue({
        ...SCHEDULED_PLAN,
        request_hash: requestHash,
      });

      const result = await service.designate(
        CLUB_ID,
        SECTION_ID,
        { user_id: DESIGNATEE_USER_ID, ecclesiastical_year_id: FUTURE_YEAR_ID },
        ACTOR_ID,
        IDEMPOTENCY_KEY,
      );

      expect(result.succession_id).toBe(SUCCESSION_ID);
      expect(mockPrismaService.director_succession_plans.create).not.toHaveBeenCalled();
    });

    it('rejects the same Idempotency-Key with a different payload', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findUnique.mockResolvedValue({
        ...SCHEDULED_PLAN,
        request_hash: 'different-hash',
      });

      await expect(
        service.designate(
          CLUB_ID,
          SECTION_ID,
          { user_id: OTHER_USER_ID, ecclesiastical_year_id: FUTURE_YEAR_ID },
          ACTOR_ID,
          IDEMPOTENCY_KEY,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REUSED });
    });

    it('rejects missing Idempotency-Key', async () => {
      setupHappyPath();

      await expect(
        service.designate(
          CLUB_ID,
          SECTION_ID,
          { user_id: DESIGNATEE_USER_ID, ecclesiastical_year_id: FUTURE_YEAR_ID },
          ACTOR_ID,
          undefined,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_PLAN_IDEMPOTENCY_REQUIRED,
      });
    });
  });

  describe('getDesignation', () => {
    it('returns the scheduled plan, never a designated CRA', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(SCHEDULED_PLAN);

      const result = await service.getDesignation(
        CLUB_ID,
        SECTION_ID,
        FUTURE_YEAR_ID,
        ACTOR_ID,
      );

      expect(result).toEqual(
        expect.objectContaining({
          succession_id: SUCCESSION_ID,
          user_id: DESIGNATEE_USER_ID,
          status: 'scheduled',
          version: 1,
        }),
      );
      expect(mockPrismaService.club_role_assignments.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when no open plan exists', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(null);

      await expect(
        service.getDesignation(CLUB_ID, SECTION_ID, FUTURE_YEAR_ID, ACTOR_ID),
      ).resolves.toBeNull();
    });

    it('rejects GET without allowed global roles', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(false);

      await expect(
        service.getDesignation(CLUB_ID, SECTION_ID, FUTURE_YEAR_ID, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    });
  });

  describe('replacePlan', () => {
    it('replaces the successor when version matches and does not touch the current director', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(SCHEDULED_PLAN);
      mockPrismaService.director_succession_plans.update.mockResolvedValue({
        ...SCHEDULED_PLAN,
        successor_user_id: OTHER_USER_ID,
        version: 2,
      });

      const result = await service.replacePlan(
        CLUB_ID,
        SECTION_ID,
        {
          succession_id: SUCCESSION_ID,
          version: 1,
          successor_user_id: OTHER_USER_ID,
        },
        ACTOR_ID,
      );

      expect(result.version).toBe(2);
      expect(result.user_id).toBe(OTHER_USER_ID);
      expect(mockPrismaService.club_role_assignments.update).not.toHaveBeenCalled();
    });

    it('returns 409 CLUB_DIRECTOR_PLAN_VERSION_CONFLICT on stale version', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue({
        ...SCHEDULED_PLAN,
        version: 2,
      });

      await expect(
        service.replacePlan(
          CLUB_ID,
          SECTION_ID,
          {
            succession_id: SUCCESSION_ID,
            version: 1,
            successor_user_id: OTHER_USER_ID,
          },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_PLAN_VERSION_CONFLICT,
      });
    });
  });

  describe('cancelPlan', () => {
    it('cancels a scheduled plan without mutating the operational director', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(SCHEDULED_PLAN);
      mockPrismaService.director_succession_plans.update.mockResolvedValue({
        ...SCHEDULED_PLAN,
        status: 'cancelled',
      });

      const result = await service.cancelPlan(
        CLUB_ID,
        SECTION_ID,
        SUCCESSION_ID,
        1,
        ACTOR_ID,
      );

      expect(result.status).toBe('cancelled');
      expect(mockPrismaService.club_role_assignments.update).not.toHaveBeenCalled();
    });

    it('returns 404 when the plan is missing', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelPlan(CLUB_ID, SECTION_ID, SUCCESSION_ID, 1, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CLUB_DIRECTOR_PLAN_NOT_FOUND });
    });

    it('returns 409 CLUB_DIRECTOR_PLAN_VERSION_CONFLICT on stale version', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue({
        ...SCHEDULED_PLAN,
        version: 2,
      });

      await expect(
        service.cancelPlan(CLUB_ID, SECTION_ID, SUCCESSION_ID, 1, ACTOR_ID),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_PLAN_VERSION_CONFLICT,
      });
    });
  });

  describe('legacy designated dry-run', () => {
    it('lists designated CRA rows without mutating them', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: 'legacy-1',
          user_id: DESIGNATEE_USER_ID,
          club_section_id: SECTION_ID,
          ecclesiastical_year_id: FUTURE_YEAR_ID,
          status: 'designated',
        },
      ]);

      const report = await service.reportUnreconciledDesignated();

      expect(report).toHaveLength(1);
      expect(report[0]).toEqual(
        expect.objectContaining({
          assignment_id: 'legacy-1',
          reason: expect.any(String),
        }),
      );
      expect(mockPrismaService.club_role_assignments.update).not.toHaveBeenCalled();
      expect(mockPrismaService.director_succession_plans.create).not.toHaveBeenCalled();
    });
  });
});
