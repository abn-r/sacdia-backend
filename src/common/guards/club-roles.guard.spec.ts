import { Reflector } from '@nestjs/core';
import { ClubRolesGuard } from './club-roles.guard';
import { AuthorizationContextService } from '../services/authorization-context.service';
import { ErrorCode } from '../errors/error-codes';
import { AUTHORIZATION_RESOURCE_KEY } from '../decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubAssignmentEffectivityPolicy } from '../authorization/club-assignment-effectivity.policy';
import { LocalFieldTimezoneResolver } from '../authorization/local-field-timezone.resolver';
import { TemporalContextFactory } from '../clock/temporal-context.factory';
import { TestingClock } from '../clock/testing-clock';
import { ZonedBusinessTimeService } from '../clock/zoned-business-time.service';

describe('ClubRolesGuard', () => {
  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockAuthorizationContext = {
    canManageClub: jest.fn(),
    resolveUserAuthorization: jest.fn(),
  };
  const mockPrisma = {
    enrollments: { findFirst: jest.fn() },
    club_role_assignments: { findFirst: jest.fn(), findMany: jest.fn() },
  };

  const testingClock = new TestingClock(new Date('2026-08-05T18:00:00.000Z'));
  const zonedBusinessTime = new ZonedBusinessTimeService();
  const temporalContextFactory = new TemporalContextFactory(
    testingClock,
    zonedBusinessTime,
  );
  const localFieldTimezoneResolver = new LocalFieldTimezoneResolver(
    {} as never,
  );
  const assignmentEffectivityPolicy = new ClubAssignmentEffectivityPolicy(
    zonedBusinessTime,
  );

  const guard = new ClubRolesGuard(
    mockReflector as unknown as Reflector,
    mockAuthorizationContext as unknown as AuthorizationContextService,
    mockPrisma as unknown as PrismaService,
    temporalContextFactory,
    localFieldTimezoneResolver,
    assignmentEffectivityPolicy,
  );

  const createContext = (request: Record<string, unknown>) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should allow when no club roles are required', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'user-123' }, params: { clubId: '10' } }),
      ),
    ).resolves.toBe(true);
  });

  it('should allow territorial global managers before checking active assignment', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['director']);
    mockAuthorizationContext.canManageClub.mockResolvedValue(true);

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'user-123' }, params: { clubId: '10' } }),
      ),
    ).resolves.toBe(true);
    expect(
      mockAuthorizationContext.resolveUserAuthorization,
    ).not.toHaveBeenCalled();
  });

  it('should allow when active assignment belongs to the club and role matches', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['deputy-director']);
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        effective: {
          scope: {
            club: {
              assignment_id: 'assignment-1',
              role_name: 'subdirector',
              club: {
                club_id: 10,
                club_name: 'Club Amanecer',
              },
              instance: {
                type: 'pathfinders',
                instance_id: 22,
                instance_name: 'Conquistadores',
              },
            },
          },
        },
      },
    });

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'user-123' }, params: { clubId: '10' } }),
      ),
    ).resolves.toBe(true);
  });

  it('should reject when the request does not include a club id', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['director']);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'user-123' } })),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_ID_REQUIRED });
  });

  it('should reject when the active assignment belongs to another club', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['director']);
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        effective: {
          scope: {
            club: {
              assignment_id: 'assignment-1',
              role_name: 'director',
              club: {
                club_id: 99,
                club_name: 'Club Horizonte',
              },
              instance: {
                type: 'pathfinders',
                instance_id: 44,
                instance_name: 'Conquistadores',
              },
            },
          },
        },
      },
    });

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'user-123' }, params: { clubId: '10' } }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });

  it('should reject when the active club role does not satisfy the required roles', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['treasurer']);
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        effective: {
          scope: {
            club: {
              assignment_id: 'assignment-1',
              role_name: 'director',
              club: {
                club_id: 10,
                club_name: 'Club Amanecer',
              },
              instance: {
                type: 'adventurers',
                instance_id: 11,
                instance_name: 'Aventureros',
              },
            },
          },
        },
      },
    });

    await expect(
      guard.canActivate(
        createContext({ user: { sub: 'user-123' }, params: { clubId: '10' } }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });

  it('derives investiture club scope from enrollmentId instead of trusting body.club_id', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === AUTHORIZATION_RESOURCE_KEY) {
        return { type: 'investiture_enrollment', idParam: 'enrollmentId' };
      }
      return ['director'];
    });
    mockAuthorizationContext.canManageClub.mockResolvedValue(false);
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        effective: {
          scope: {
            club: {
              assignment_id: 'assignment-1',
              role_name: 'director',
              club: {
                club_id: 10,
                club_name: 'Club A',
              },
              section: {
                club_section_id: 22,
                club_type_name: 'Conquistadores',
              },
            },
          },
        },
      },
    });
    mockPrisma.enrollments.findFirst.mockResolvedValue({
      user_id: 'member-b',
      ecclesiastical_year_id: 2026,
      classes: { club_type_id: 2 },
    });
    mockPrisma.club_role_assignments.findMany.mockResolvedValue([
      {
        active: true,
        status: 'active',
        start_date: new Date('2026-01-01'),
        end_date: null,
        expires_at: null,
        club_sections: {
          main_club_id: 99,
          clubs: {
            local_fields: {
              local_field_id: 30,
              timezone: 'America/Mexico_City',
            },
          },
        },
      },
    ]);

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'club-a-actor' },
          params: { enrollmentId: '123' },
          body: { club_id: 10 },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
    expect(mockAuthorizationContext.canManageClub).toHaveBeenCalledWith(
      'club-a-actor',
      99,
    );
  });

  describe('T08 club assignment effectivity (investiture resource scope)', () => {
    const enrollmentFixture = {
      user_id: 'member-b',
      ecclesiastical_year_id: 2026,
      classes: { club_type_id: 2 },
    };

    const temporallyInvalidAssignment = {
      active: true,
      status: 'active',
      start_date: new Date('2027-01-01'),
      end_date: null,
      expires_at: null,
      club_sections: {
        main_club_id: 10,
        clubs: {
          local_fields: {
            local_field_id: 30,
            timezone: 'America/Mexico_City',
          },
        },
      },
    };

    beforeEach(() => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === AUTHORIZATION_RESOURCE_KEY) {
          return { type: 'investiture_enrollment', idParam: 'enrollmentId' };
        }
        return ['director'];
      });
      mockAuthorizationContext.canManageClub.mockResolvedValue(false);
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
        authorization: {
          effective: {
            scope: {
              club: {
                assignment_id: 'actor-assignment',
                role_name: 'director',
                club: { club_id: 10, club_name: 'Club A' },
                section: {
                  club_section_id: 22,
                  club_type_name: 'Conquistadores',
                },
              },
            },
          },
        },
      });
      mockPrisma.enrollments.findFirst.mockResolvedValue(enrollmentFixture);
    });

    it('does not resolve club scope from a future start_date assignment', async () => {
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue(
        temporallyInvalidAssignment,
      );
      mockPrisma.club_role_assignments.findMany.mockResolvedValue([
        temporallyInvalidAssignment,
      ]);

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'director-1' },
            params: { enrollmentId: '123' },
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_ID_REQUIRED });
    });

    it('does not resolve club scope from an expired expires_at assignment', async () => {
      const expired = {
        ...temporallyInvalidAssignment,
        start_date: new Date('2026-01-01'),
        expires_at: new Date('2026-08-05T18:00:00.000Z'),
      };
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue(expired);
      mockPrisma.club_role_assignments.findMany.mockResolvedValue([expired]);

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'director-1' },
            params: { enrollmentId: '123' },
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_ID_REQUIRED });
    });

    it('does not resolve club scope from an ended end_date assignment', async () => {
      const ended = {
        ...temporallyInvalidAssignment,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-08-04'),
      };
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue(ended);
      mockPrisma.club_role_assignments.findMany.mockResolvedValue([ended]);

      await expect(
        guard.canActivate(
          createContext({
            user: { sub: 'director-1' },
            params: { enrollmentId: '123' },
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_ID_REQUIRED });
    });
  });
});
