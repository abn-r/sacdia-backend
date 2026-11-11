import { createHash } from 'node:crypto';
import { gateAdultUser } from '../membership-requests/activation-gate.testing';
import { Test, TestingModule } from '@nestjs/testing';
import { DirectorDesignationService } from './director-designation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { ErrorCode } from '../common/errors/error-codes';
import { SectionRoleMutationPolicy } from '../common/authorization/section-role-mutation.policy';
import { TemporalContextFactory } from '../common/clock/temporal-context.factory';
import { RoleRequirementService } from '../role-requirements/role-requirement.service';
import { ZonedBusinessTimeService } from '../common/clock/zoned-business-time.service';
import { TestingClock } from '../common/clock/testing-clock';
import { CLOCK } from '../common/clock/clock';
import { ClubRoleEligibilityService } from '../club-role-eligibility/club-role-eligibility.service';
import { CriticalAuditWriterService } from '../audit-logs/critical-audit-writer.service';
import {
  AppConflictException,
  AppForbiddenException,
} from '../common/errors/app.exception';

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

  const mockRoleRequirements = { assertMet: jest.fn() };

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
    users: { findUnique: jest.fn() },
    guardianships: { findFirst: jest.fn() },
    $executeRaw: jest.fn(),
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
    getNextYear: jest.fn(),
  };

  const mockRoleEligibility = { assertAssignment: jest.fn() };
  const mockCriticalAudit = { write: jest.fn() };
  // Mid-window business date by default (15 Oct 2026, 12:00 UTC).
  const clock = new TestingClock(new Date('2026-10-15T12:00:00.000Z'));

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
        // Real policy: the exact-authority matrix is exercised end to end.
        SectionRoleMutationPolicy,
        { provide: ClubRoleEligibilityService, useValue: mockRoleEligibility },
        { provide: CriticalAuditWriterService, useValue: mockCriticalAudit },
        { provide: RoleRequirementService, useValue: mockRoleRequirements },
        { provide: CLOCK, useValue: clock },
        ZonedBusinessTimeService,
        TemporalContextFactory,
      ],
    }).compile();

    service = module.get(DirectorDesignationService);

    clock.set(new Date('2026-10-15T12:00:00.000Z'));
    mockPrismaService.users.findUnique.mockImplementation(() =>
      Promise.resolve(gateAdultUser()),
    );
    mockRoleEligibility.assertAssignment.mockResolvedValue(undefined);
    mockRoleRequirements.assertMet.mockReset().mockResolvedValue(undefined);
    mockCriticalAudit.write.mockResolvedValue({
      auditLogId: 1n,
      replayed: false,
    });
    mockPrismaService.$transaction.mockImplementation(
      (callback: (tx: typeof mockPrismaService) => unknown) =>
        callback(mockPrismaService),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  type AuthOpts = {
    globalRoles?: string[];
    localFieldId?: number | null;
    clubAssignments?: Array<{ role_name: string; sectionId: number }>;
  };

  function setActor({
    globalRoles = ['admin'],
    localFieldId = null,
    clubAssignments = [],
  }: AuthOpts = {}) {
    mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        grants: {
          global_roles: globalRoles.map((role_name) => ({ role_name })),
          club_assignments: clubAssignments.map((a) => ({
            operational: true,
            role_name: a.role_name,
            section: { club_section_id: a.sectionId },
          })),
        },
        effective: {
          scope: {
            global: {
              local_field: localFieldId == null ? null : { id: localFieldId },
            },
          },
        },
      },
    });
  }

  function setupHappyPath() {
    setActor({ globalRoles: ['director-lf'], localFieldId: LOCAL_FIELD_ID });
    mockPrismaService.club_sections.findUnique.mockResolvedValue({
      main_club_id: CLUB_ID,
      clubs: {
        club_id: CLUB_ID,
        local_field_id: LOCAL_FIELD_ID,
        local_fields: {
          local_field_id: LOCAL_FIELD_ID,
          timezone: 'America/Mexico_City',
        },
      },
    });
    mockPrismaService.roles.findFirst.mockResolvedValue({
      role_id: DIRECTOR_ROLE_ID,
    });
    const currentYear = {
      year_id: CURRENT_YEAR_ID,
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      active: true,
    };
    mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue(currentYear);
    mockEcclesiasticalYearService.getNextYear.mockResolvedValue({
      ...FUTURE_YEAR,
      active: true,
    });
    mockPrismaService.director_succession_plans.findUnique.mockResolvedValue(
      null,
    );
    mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(
      null,
    );
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
      assignment_id: OUTGOING_ASSIGNMENT_ID,
    });
  }

  const DTO = {
    user_id: DESIGNATEE_USER_ID,
    ecclesiastical_year_id: FUTURE_YEAR_ID,
  };

  function designate(dto = DTO) {
    return service.designate(
      CLUB_ID,
      SECTION_ID,
      dto,
      ACTOR_ID,
      IDEMPOTENCY_KEY,
    );
  }

  describe('A05 – designate creates a private succession plan', () => {
    it('creates a scheduled plan and does not create a designated CRA', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.create.mockResolvedValue(
        SCHEDULED_PLAN,
      );

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
      expect(
        mockPrismaService.director_succession_plans.create,
      ).toHaveBeenCalledWith(
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
      expect(
        mockPrismaService.club_role_assignments.create,
      ).not.toHaveBeenCalled();
      expect(
        mockPrismaService.club_role_assignments.update,
      ).not.toHaveBeenCalled();
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

      expect(
        mockPrismaService.director_succession_plans.create,
      ).toHaveBeenCalledWith(
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
          {
            user_id: DESIGNATEE_USER_ID,
            ecclesiastical_year_id: FUTURE_YEAR_ID,
          },
          ACTOR_ID,
          IDEMPOTENCY_KEY,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.GUARD_ASSIGNMENT_SCOPE_INVALID,
      });

      expect(
        mockPrismaService.director_succession_plans.create,
      ).not.toHaveBeenCalled();
    });

    describe('exact authority', () => {
      beforeEach(() => setupHappyPath());

      it('rejects a union-level actor with CLUB_ROLE_MUTATION_FORBIDDEN', async () => {
        setActor({ globalRoles: ['union-director'] });
        await expect(designate()).rejects.toMatchObject({
          code: ErrorCode.CLUB_ROLE_MUTATION_FORBIDDEN,
        });
        expect(
          mockPrismaService.director_succession_plans.create,
        ).not.toHaveBeenCalled();
      });

      it('rejects a director-lf of another local field', async () => {
        setActor({
          globalRoles: ['director-lf'],
          localFieldId: LOCAL_FIELD_ID + 1,
        });
        await expect(designate()).rejects.toMatchObject({
          code: ErrorCode.CLUB_ROLE_MUTATION_FORBIDDEN,
        });
      });

      it('rejects the section director (cannot touch the director seat)', async () => {
        setActor({
          globalRoles: [],
          clubAssignments: [{ role_name: 'director', sectionId: SECTION_ID }],
        });
        await expect(designate()).rejects.toMatchObject({
          code: ErrorCode.CLUB_ROLE_MUTATION_FORBIDDEN,
        });
      });

      it('accepts the director-lf of the same local field', async () => {
        setActor({
          globalRoles: ['director-lf'],
          localFieldId: LOCAL_FIELD_ID,
        });
        mockPrismaService.director_succession_plans.create.mockResolvedValue(
          SCHEDULED_PLAN,
        );
        await expect(designate()).resolves.toMatchObject({
          status: 'scheduled',
        });
        expect(
          mockPrismaService.director_succession_plans.create,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ scheduled_by_role: 'director-lf' }),
          }),
        );
      });

      it('accepts an admin', async () => {
        setActor({ globalRoles: ['admin'] });
        mockPrismaService.director_succession_plans.create.mockResolvedValue(
          SCHEDULED_PLAN,
        );
        await expect(designate()).resolves.toMatchObject({
          status: 'scheduled',
        });
      });
    });

    describe('successor eligibility', () => {
      it('rejects an ineligible successor before writing', async () => {
        setupHappyPath();
        mockRoleEligibility.assertAssignment.mockRejectedValue(
          new AppForbiddenException(ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED),
        );
        await expect(designate()).rejects.toMatchObject({
          code: ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED,
        });
        expect(mockRoleEligibility.assertAssignment).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: DESIGNATEE_USER_ID,
            roleName: 'director',
            clubSectionId: SECTION_ID,
          }),
        );
        expect(
          mockPrismaService.director_succession_plans.create,
        ).not.toHaveBeenCalled();
        expect(mockCriticalAudit.write).not.toHaveBeenCalled();
      });
    });

    describe('counselor requirement (D8)', () => {
      it('rejects a successor without the enforced constancia before writing', async () => {
        setupHappyPath();
        mockRoleRequirements.assertMet.mockRejectedValue(
          new AppConflictException(ErrorCode.CLUB_ROLE_REQUIREMENT_MISSING),
        );
        await expect(designate()).rejects.toMatchObject({
          code: ErrorCode.CLUB_ROLE_REQUIREMENT_MISSING,
        });
        expect(mockRoleRequirements.assertMet).toHaveBeenCalledWith(
          mockPrismaService,
          expect.objectContaining({
            userId: DESIGNATEE_USER_ID,
            roleName: 'director',
            clubSectionId: SECTION_ID,
          }),
        );
        expect(
          mockPrismaService.director_succession_plans.create,
        ).not.toHaveBeenCalled();
      });
    });

    describe('target year and scheduling window', () => {
      beforeEach(() => {
        setupHappyPath();
        mockPrismaService.director_succession_plans.create.mockResolvedValue(
          SCHEDULED_PLAN,
        );
      });

      it('returns 400 CLUB_DIRECTOR_PLAN_YEAR_INVALID for the current year', async () => {
        await expect(
          designate({ ...DTO, ecclesiastical_year_id: CURRENT_YEAR_ID }),
        ).rejects.toMatchObject({
          code: ErrorCode.CLUB_DIRECTOR_PLAN_YEAR_INVALID,
        });
      });

      it('returns 400 for a year that is not the immediate next one', async () => {
        await expect(
          designate({ ...DTO, ecclesiastical_year_id: FUTURE_YEAR_ID + 1 }),
        ).rejects.toMatchObject({
          code: ErrorCode.CLUB_DIRECTOR_PLAN_YEAR_INVALID,
        });
      });

      it('propagates the error when there is no next year', async () => {
        mockEcclesiasticalYearService.getNextYear.mockRejectedValue(
          new AppForbiddenException(ErrorCode.CLUB_DIRECTOR_PLAN_YEAR_INVALID),
        );
        await expect(designate()).rejects.toMatchObject({
          code: ErrorCode.CLUB_DIRECTOR_PLAN_YEAR_INVALID,
        });
      });

      it.each([
        ['15 Sep is closed', '2026-09-15T12:00:00.000Z', false],
        ['30 Sep is closed', '2026-09-30T12:00:00.000Z', false],
        ['1 Oct is open', '2026-10-01T12:00:00.000Z', true],
        ['31 Dec is open', '2026-12-31T12:00:00.000Z', true],
        ['1 Jan is closed', '2027-01-01T12:00:00.000Z', false],
        // 03:00Z on 1 Jan is still 31 Dec in America/Mexico_City.
        [
          'local-field business date, not UTC (open)',
          '2027-01-01T03:00:00.000Z',
          true,
        ],
        // 03:00Z on 1 Oct is still 30 Sep in America/Mexico_City.
        [
          'local-field business date, not UTC (closed)',
          '2026-10-01T03:00:00.000Z',
          false,
        ],
      ])('window: %s', async (_label, instant, open) => {
        clock.set(new Date(instant));
        if (open) {
          await expect(designate()).resolves.toMatchObject({
            status: 'scheduled',
          });
        } else {
          await expect(designate()).rejects.toMatchObject({
            code: ErrorCode.CLUB_DIRECTOR_PLAN_WINDOW_CLOSED,
          });
          expect(
            mockPrismaService.director_succession_plans.create,
          ).not.toHaveBeenCalled();
        }
      });

      it('falls back to the institutional timezone when the local field timezone is unusable', async () => {
        mockPrismaService.club_sections.findUnique.mockResolvedValue({
          main_club_id: CLUB_ID,
          clubs: {
            club_id: CLUB_ID,
            local_field_id: LOCAL_FIELD_ID,
            local_fields: { local_field_id: LOCAL_FIELD_ID, timezone: null },
          },
        });
        await expect(designate()).resolves.toMatchObject({
          status: 'scheduled',
        });
      });
    });

    describe('durable audit', () => {
      beforeEach(() => setupHappyPath());

      it('writes DIRECTOR_SUCCESSION_SCHEDULED with the real actor inside the transaction', async () => {
        mockPrismaService.director_succession_plans.create.mockResolvedValue(
          SCHEDULED_PLAN,
        );
        await designate();
        expect(mockCriticalAudit.write).toHaveBeenCalledWith(
          mockPrismaService,
          expect.objectContaining({
            action: 'DIRECTOR_SUCCESSION_SCHEDULED',
            entityType: 'director_succession_plan',
            entityId: SUCCESSION_ID,
            eventKey: `director-succession:scheduled:${ACTOR_ID}:${IDEMPOTENCY_KEY}`,
            clubId: CLUB_ID,
            actor: expect.objectContaining({ kind: 'user', userId: ACTOR_ID }),
            target: expect.objectContaining({ userId: DESIGNATEE_USER_ID }),
            temporal: expect.objectContaining({
              businessDate: '2026-10-15',
              businessTimezone: 'America/Mexico_City',
            }),
            correlationId: expect.any(String),
          }),
        );
      });

      it('propagates a writer failure so the transaction rolls back', async () => {
        mockPrismaService.director_succession_plans.create.mockResolvedValue(
          SCHEDULED_PLAN,
        );
        mockCriticalAudit.write.mockRejectedValue(
          new Error('audit unavailable'),
        );
        await expect(designate()).rejects.toThrow('audit unavailable');
      });
    });

    it('returns 409 CLUB_DIRECTOR_PLAN_CONFLICT when a scheduled plan already exists', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(
        SCHEDULED_PLAN,
      );

      await expect(
        service.designate(
          CLUB_ID,
          SECTION_ID,
          {
            user_id: DESIGNATEE_USER_ID,
            ecclesiastical_year_id: FUTURE_YEAR_ID,
          },
          ACTOR_ID,
          IDEMPOTENCY_KEY,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CLUB_DIRECTOR_PLAN_CONFLICT });

      expect(
        mockPrismaService.director_succession_plans.create,
      ).not.toHaveBeenCalled();
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
          {
            user_id: DESIGNATEE_USER_ID,
            ecclesiastical_year_id: FUTURE_YEAR_ID,
          },
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
      expect(
        mockPrismaService.director_succession_plans.create,
      ).not.toHaveBeenCalled();
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
          {
            user_id: DESIGNATEE_USER_ID,
            ecclesiastical_year_id: FUTURE_YEAR_ID,
          },
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
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(
        SCHEDULED_PLAN,
      );

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
      expect(
        mockPrismaService.club_role_assignments.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('returns null when no open plan exists', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(
        null,
      );

      await expect(
        service.getDesignation(CLUB_ID, SECTION_ID, FUTURE_YEAR_ID, ACTOR_ID),
      ).resolves.toBeNull();
    });

    it('rejects GET without exact authority', async () => {
      setupHappyPath();
      setActor({ globalRoles: ['union-director'] });

      await expect(
        service.getDesignation(CLUB_ID, SECTION_ID, FUTURE_YEAR_ID, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CLUB_ROLE_MUTATION_FORBIDDEN });
    });
  });

  describe('replacePlan', () => {
    it('replaces the successor when version matches and does not touch the current director', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(
        SCHEDULED_PLAN,
      );
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
      expect(mockRoleEligibility.assertAssignment).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: OTHER_USER_ID,
          roleName: 'director',
        }),
      );
      expect(mockCriticalAudit.write).toHaveBeenCalledWith(
        mockPrismaService,
        expect.objectContaining({
          action: 'DIRECTOR_SUCCESSION_REPLACED',
          entityId: SUCCESSION_ID,
          target: expect.objectContaining({ userId: OTHER_USER_ID }),
        }),
      );
      expect(
        mockPrismaService.club_role_assignments.update,
      ).not.toHaveBeenCalled();
    });

    it('replace does not require the scheduling window', async () => {
      setupHappyPath();
      clock.set(new Date('2027-03-01T12:00:00.000Z'));
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(
        SCHEDULED_PLAN,
      );
      mockPrismaService.director_succession_plans.update.mockResolvedValue({
        ...SCHEDULED_PLAN,
        successor_user_id: OTHER_USER_ID,
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
      ).resolves.toMatchObject({ version: 2 });
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
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(
        SCHEDULED_PLAN,
      );
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
      expect(mockCriticalAudit.write).toHaveBeenCalledWith(
        mockPrismaService,
        expect.objectContaining({
          action: 'DIRECTOR_SUCCESSION_CANCELLED',
          target: expect.objectContaining({ userId: DESIGNATEE_USER_ID }),
        }),
      );
      expect(
        mockPrismaService.club_role_assignments.update,
      ).not.toHaveBeenCalled();
    });

    it('revokes against the plan successor: a section director cannot cancel', async () => {
      setupHappyPath();
      setActor({
        globalRoles: [],
        clubAssignments: [{ role_name: 'director', sectionId: SECTION_ID }],
      });
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(
        SCHEDULED_PLAN,
      );

      await expect(
        service.cancelPlan(CLUB_ID, SECTION_ID, SUCCESSION_ID, 1, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CLUB_ROLE_MUTATION_FORBIDDEN });
      expect(
        mockPrismaService.director_succession_plans.update,
      ).not.toHaveBeenCalled();
    });

    it('cancel does not require the scheduling window', async () => {
      setupHappyPath();
      clock.set(new Date('2027-03-01T12:00:00.000Z'));
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(
        SCHEDULED_PLAN,
      );
      mockPrismaService.director_succession_plans.update.mockResolvedValue({
        ...SCHEDULED_PLAN,
        status: 'cancelled',
      });

      await expect(
        service.cancelPlan(CLUB_ID, SECTION_ID, SUCCESSION_ID, 1, ACTOR_ID),
      ).resolves.toMatchObject({ status: 'cancelled' });
    });

    it('returns 404 when the plan is missing', async () => {
      setupHappyPath();
      mockPrismaService.director_succession_plans.findFirst.mockResolvedValue(
        null,
      );

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
      expect(
        mockPrismaService.club_role_assignments.update,
      ).not.toHaveBeenCalled();
      expect(
        mockPrismaService.director_succession_plans.create,
      ).not.toHaveBeenCalled();
    });
  });
});
