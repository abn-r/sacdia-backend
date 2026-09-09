import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AUTH_CONTEXT_CACHE_KEY,
  AuthorizationContextService,
} from './authorization-context.service';
import { ErrorCode } from '../errors/error-codes';
import { AppConflictException, AppNotFoundException } from '../errors/app.exception';
import { InstitutionalHierarchyService } from './institutional-hierarchy.service';
import { EcclesiasticalYearService } from './ecclesiastical-year.service';
import { ClubCycleReadinessService } from './club-cycle-readiness.service';
import { CLOCK } from '../clock/clock';
import { ZonedBusinessTimeService } from '../clock/zoned-business-time.service';

/** Canonical year_id used across all test fixtures. */
const CURRENT_YEAR_ID = 7;

describe('AuthorizationContextService', () => {
  let service: AuthorizationContextService;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let mockClock: { now: jest.Mock };
  let mockZoned: { startOfNextBusinessDate: jest.Mock };
  let mockCycle: { readinessByClub: jest.Mock; isReady: jest.Mock };

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
    },
  };

  const mockHierarchyService = {
    resolveCurrent: jest.fn(),
  };

  const mockEcclesiasticalYearService = {
    getCurrentYear: jest.fn(),
  };

  const CURRENT_YEAR = {
    year_id: CURRENT_YEAR_ID,
    start_date: new Date('2026-01-01'),
    end_date: new Date('2026-12-31'),
    active: true,
    modified_at: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    mockClock = {
      now: jest.fn().mockReturnValue(new Date('2026-06-01T12:00:00.000Z')),
    };
    mockZoned = {
      startOfNextBusinessDate: jest
        .fn()
        .mockReturnValue(new Date('2027-01-01T06:00:00.000Z')),
    };
    mockCycle = {
      readinessByClub: jest.fn().mockResolvedValue(new Map()),
      isReady: jest.fn().mockResolvedValue(true),
    };

    mockHierarchyService.resolveCurrent.mockResolvedValue({
      division_id: 1,
      division_name: 'División Interamericana',
      union_id: 2,
      local_field_id: 3,
      as_of: new Date('2026-01-01'),
      source: 'current',
      precision: 'exact',
    });

    mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue(CURRENT_YEAR);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationContextService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: InstitutionalHierarchyService,
          useValue: mockHierarchyService,
        },
        {
          provide: EcclesiasticalYearService,
          useValue: mockEcclesiasticalYearService,
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
        { provide: CLOCK, useValue: mockClock },
        { provide: ZonedBusinessTimeService, useValue: mockZoned },
        { provide: ClubCycleReadinessService, useValue: mockCycle },
      ],
    }).compile();

    service = module.get<AuthorizationContextService>(
      AuthorizationContextService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses versioned cache keys so stale legacy snapshots are bypassed', () => {
    expect(AUTH_CONTEXT_CACHE_KEY('user-123')).toBe('auth:context:v7:user-123');
  });

  it('invalidates both current and legacy authorization cache keys', async () => {
    await service.invalidateUserAuthorizationCache('user-123');

    expect(cacheManager.del).toHaveBeenCalledWith('auth:context:v7:user-123');
    expect(cacheManager.del).toHaveBeenCalledWith('auth:context:v6:user-123');
    expect(cacheManager.del).toHaveBeenCalledWith('auth:context:v5:user-123');
    expect(cacheManager.del).toHaveBeenCalledWith('auth:context:v4:user-123');
    expect(cacheManager.del).toHaveBeenCalledWith('auth:context:v3:user-123');
    expect(cacheManager.del).toHaveBeenCalledWith('auth:context:v2:user-123');
    expect(cacheManager.del).toHaveBeenCalledWith('auth:context:user-123');
  });

  it('should throw UnauthorizedException when user is not found', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue(null);

    await expect(
      service.resolveUserAuthorization('missing-user'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_CONTEXT_USER_NOT_FOUND });
  });

  it('should resolve canonical authorization payload with active assignment and structured scope', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-123',
      email: 'juan.garcia@example.com',
      name: 'Juan',
      paternal_last_name: 'Garcia',
      maternal_last_name: 'Lopez',
      gender: 'M',
      birthday: new Date('2000-01-01'),
      baptism: true,
      baptism_date: new Date('2015-01-01'),
      user_image: 'https://avatar.test/user-123.png',
      country_id: 1,
      union_id: 2,
      local_field_id: 3,
      created_at: new Date('2026-02-10'),
      countries: { country_id: 1, name: 'México' },
      unions: { union_id: 2, name: 'Unión Norte' },
      local_fields: { local_field_id: 3, name: 'Campo Centro' },
      users_pr: {
        complete: true,
        active_club_assignment_id: 'assignment-2',
      },
      users_roles: [
        {
          roles: {
            role_name: 'assistant-admin',
            role_permissions: [
              { permissions: { permission_name: 'clubs:read' } },
              { permissions: { permission_name: 'reports:read' } },
            ],
          },
        },
      ],
      club_role_assignments: [
        {
          assignment_id: 'assignment-1',
          ecclesiastical_year_id: CURRENT_YEAR_ID,
          status: 'active',
          start_date: new Date('2026-01-01'),
          end_date: null,
          expires_at: null,
          roles: {
            role_name: 'director',
            role_permissions: [
              { permissions: { permission_name: 'clubs:update' } },
            ],
          },
          club_sections: {
            club_section_id: 11,
            club_type_id: 1,
            club_types: { name: 'Aventureros' },
            clubs: {
              club_id: 10,
              name: 'Club Amanecer',
              local_fields: {
                local_field_id: 30,
                name: 'Campo Centro',
                unions: {
                  union_id: 20,
                  name: 'Unión Norte',
                  countries: {
                    country_id: 10,
                    name: 'México',
                  },
                },
              },
            },
          },
        },
        {
          assignment_id: 'assignment-2',
          ecclesiastical_year_id: CURRENT_YEAR_ID,
          status: 'active',
          start_date: new Date('2026-02-01'),
          end_date: null,
          expires_at: null,
          roles: {
            role_name: 'treasurer',
            role_permissions: [
              { permissions: { permission_name: 'finances:update' } },
            ],
          },
          club_sections: {
            club_section_id: 22,
            club_type_id: 2,
            club_types: { name: 'Conquistadores' },
            clubs: {
              club_id: 10,
              name: 'Club Amanecer',
              local_fields: {
                local_field_id: 30,
                name: 'Campo Centro',
                unions: {
                  union_id: 20,
                  name: 'Unión Norte',
                  countries: {
                    country_id: 10,
                    name: 'México',
                  },
                },
              },
            },
          },
        },
      ],
    });

    const result = await service.resolveUserAuthorization('user-123');

    expect(result.post_register_complete).toBe(true);
    expect(result.authorization.grants.global_roles).toEqual([
      {
        role_name: 'assistant-admin',
        permissions: ['clubs:read', 'reports:read'],
        scope: {
          division: { id: 1, name: 'División Interamericana' },
          country: { id: 1, name: 'México' },
          union: { id: 2, name: 'Unión Norte' },
          local_field: { id: 3, name: 'Campo Centro' },
        },
      },
    ]);
    expect(result.authorization.active_assignment).toEqual({
      assignment_id: 'assignment-2',
    });
    expect(result.authorization.effective.permissions).toEqual([
      'clubs:read',
      'finances:update',
      'reports:read',
    ]);
    expect(result.authorization.grants.direct_permissions).toEqual([]);
    expect(result.authorization.effective.scope.club).toEqual({
      assignment_id: 'assignment-2',
      role_name: 'treasurer',
      club: {
        club_id: 10,
        club_name: 'Club Amanecer',
      },
      section: {
        club_section_id: 22,
        club_type_id: 2,
        club_type_name: 'Conquistadores',
      },
    });
    expect(result.legacy.club_context.active).toEqual({
      assignment_id: 'assignment-2',
      role_name: 'treasurer',
      club_section_id: 22,
      club_type_id: 2,
      club_id: 10,
      club_name: 'Club Amanecer',
      club_type: 'Conquistadores',
    });
  });

  it('merges active users_permissions into effective and direct grants', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-direct',
      email: 'direct@example.com',
      name: 'Direct',
      paternal_last_name: 'Grant',
      maternal_last_name: null,
      gender: 'M',
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: 1,
      union_id: 2,
      local_field_id: 3,
      created_at: new Date('2026-02-10'),
      countries: { country_id: 1, name: 'México' },
      unions: { union_id: 2, name: 'Unión Norte' },
      local_fields: { local_field_id: 3, name: 'Campo Centro' },
      users_pr: { complete: true, active_club_assignment_id: null },
      users_roles: [
        {
          roles: {
            role_name: 'pastor',
            role_permissions: [
              { permissions: { permission_name: 'dashboard:read' } },
            ],
          },
        },
      ],
      club_role_assignments: [],
      users_permissions: [
        { permissions: { permission_name: 'reports:read' } },
      ],
    });

    const result = await service.resolveUserAuthorization('user-direct');

    expect(result.authorization.grants.direct_permissions).toEqual([
      'reports:read',
    ]);
    expect(result.authorization.effective.permissions).toEqual([
      'dashboard:read',
      'reports:read',
    ]);
  });

  describe('isSuperAdmin', () => {
    const buildUserWithRole = (roleName: string) => ({
      user_id: 'user-sa',
      email: 'sa@test.com',
      name: 'Super',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2026-01-01'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: null },
      users_roles: [
        {
          roles: {
            role_name: roleName,
            role_permissions: [],
          },
        },
      ],
      club_role_assignments: [],
    });

    it('should return true when user has super-admin role', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(
        buildUserWithRole('super-admin'),
      );

      await expect(service.isSuperAdmin('user-sa')).resolves.toBe(true);
    });

    it('should return false when user has a non-super-admin role', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(
        buildUserWithRole('admin'),
      );

      await expect(service.isSuperAdmin('user-sa')).resolves.toBe(false);
    });
  });

  it('denies historical read when a union-level actor reads a different historical union in the same division', async () => {
    mockHierarchyService.resolveCurrent.mockResolvedValue({
      division_id: 1,
      division_name: 'División Interamericana',
      union_id: 20,
      union_name: 'Unión Norte',
      as_of: new Date('2026-01-01'),
      source: 'current',
      precision: 'exact',
    });
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-union',
      email: 'union@test.com',
      name: 'Union',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      user_image: null,
      country_id: 1,
      union_id: 20,
      local_field_id: null,
      created_at: new Date('2026-01-01'),
      countries: { country_id: 1, name: 'México' },
      unions: { union_id: 20, name: 'Unión Norte' },
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: null },
      users_roles: [
        {
          roles: {
            role_name: 'director-union',
            role_permissions: [],
          },
        },
      ],
      club_role_assignments: [],
    });

    await expect(
      service.canReadHistoricalScope('user-union', {
        division_id: 1,
        union_id: 99,
        local_field_id: null,
        as_of: new Date('2025-01-01'),
        source: 'as_of',
        precision: 'exact',
      }),
    ).resolves.toBe(false);
  });

  it('should fall back to the first available assignment when persisted context is stale', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-123',
      email: 'juan.garcia@example.com',
      name: 'Juan',
      paternal_last_name: 'Garcia',
      maternal_last_name: 'Lopez',
      gender: 'M',
      birthday: new Date('2000-01-01'),
      baptism: true,
      baptism_date: new Date('2015-01-01'),
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2026-02-10'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: {
        complete: false,
        active_club_assignment_id: 'missing-assignment',
      },
      users_roles: [],
      club_role_assignments: [
        {
          assignment_id: 'assignment-1',
          ecclesiastical_year_id: CURRENT_YEAR_ID,
          status: 'active',
          start_date: new Date('2026-01-01'),
          end_date: null,
          expires_at: null,
          roles: {
            role_name: 'director',
            role_permissions: [],
          },
          club_sections: {
            club_section_id: 33,
            club_type_id: 3,
            club_types: { name: 'Guías Mayores' },
            clubs: {
              club_id: 44,
              name: 'Club Horizonte',
              local_fields: null,
            },
          },
        },
      ],
    });

    const result = await service.resolveUserAuthorization('user-123');

    expect(result.authorization.active_assignment.assignment_id).toBe(
      'assignment-1',
    );
    expect(result.authorization.effective.scope.club).toEqual({
      assignment_id: 'assignment-1',
      role_name: 'director',
      club: {
        club_id: 44,
        club_name: 'Club Horizonte',
      },
      section: {
        club_section_id: 33,
        club_type_id: 3,
        club_type_name: 'Guías Mayores',
      },
    });
  });

  it('uses assignment id to resolve equal-date fallback ties deterministically', async () => {
    const assignment = (
      assignmentId: string,
      clubSectionId: number,
      clubTypeId: number,
    ) => ({
      assignment_id: assignmentId,
      ecclesiastical_year_id: CURRENT_YEAR_ID,
      status: 'active',
      start_date: new Date('2026-01-01'),
      end_date: null,
      expires_at: null,
      roles: { role_name: 'director', role_permissions: [] },
      club_sections: {
        club_section_id: clubSectionId,
        club_type_id: clubTypeId,
        club_types: { name: 'Conquistadores' },
        clubs: {
          club_id: 12,
          name: 'Orión',
          local_fields: null,
        },
      },
    });
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'target-user',
      email: 'target@example.com',
      name: 'Target',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2026-01-01'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: null },
      users_roles: [],
      club_role_assignments: [
        assignment('assignment-a', 44, 2),
        assignment('assignment-b', 99, 3),
      ],
    });

    const result = await service.resolveUserAuthorization('target-user');

    expect(mockPrismaService.users.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          club_role_assignments: expect.objectContaining({
            orderBy: [{ start_date: 'desc' }, { assignment_id: 'asc' }],
          }),
        }),
      }),
    );
    expect(result.authorization.active_assignment.assignment_id).toBe(
      'assignment-a',
    );
    expect(
      result.authorization.effective.scope.club?.section.club_section_id,
    ).toBe(44);
  });

  it('does not treat coordinators as local-field hierarchy actors', () => {
    const resolved = {
      authorization: {
        grants: {
          global_roles: [
            { role_name: 'coordinator', permissions: [], scope: {} },
          ],
        },
        effective: {
          scope: {
            global: {
              local_field: { id: 7, name: 'Campo' },
            },
          },
        },
      },
    } as any;

    expect(
      service.canAccessHierarchyScope(
        resolved,
        { local_field_id: 7 },
        'current-write',
      ),
    ).toBe(false);
  });

  it('still allows director-lf on a matching local field', () => {
    const resolved = {
      authorization: {
        grants: {
          global_roles: [
            { role_name: 'director-lf', permissions: [], scope: {} },
          ],
        },
        effective: {
          scope: {
            global: {
              local_field: { id: 7, name: 'Campo' },
            },
          },
        },
      },
    } as any;

    expect(
      service.canAccessHierarchyScope(
        resolved,
        { local_field_id: 7 },
        'current-write',
      ),
    ).toBe(true);
  });

  it('keeps director-union at union even when home local_field is set', () => {
    const resolved = {
      authorization: {
        grants: {
          global_roles: [
            { role_name: 'director-union', permissions: [], scope: {} },
          ],
        },
        effective: {
          scope: {
            global: {
              union: { id: 2, name: 'Unión' },
              local_field: { id: 7, name: 'Campo' },
            },
          },
        },
      },
    } as any;

    expect(
      service.canAccessHierarchyScope(
        resolved,
        { union_id: 2, local_field_id: 99 },
        'current-write',
      ),
    ).toBe(true);
    expect(
      service.canAccessHierarchyScope(
        resolved,
        { union_id: 3, local_field_id: 7 },
        'current-write',
      ),
    ).toBe(false);
  });

  // ── Ecclesiastical year filtering ──────────────────────────────────────────

  it('assignment from a past year with status=active does NOT enter effective.permissions', async () => {
    const pastYearId = CURRENT_YEAR_ID - 1;
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-past',
      email: 'past@example.com',
      name: 'Past',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2025-01-01'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: null },
      users_roles: [],
      club_role_assignments: [
        {
          assignment_id: 'past-assignment',
          ecclesiastical_year_id: pastYearId,
          status: 'active',
          start_date: new Date('2025-01-01'),
          end_date: new Date('2025-12-31'),
          expires_at: null,
          roles: {
            role_name: 'director',
            role_permissions: [
              { permissions: { permission_name: 'clubs:update' } },
            ],
          },
          club_sections: {
            club_section_id: 5,
            club_type_id: 1,
            club_types: { name: 'Aventureros' },
            clubs: {
              club_id: 1,
              name: 'Club X',
              local_fields: null,
            },
          },
        },
      ],
      users_permissions: [],
    });

    const result = await service.resolveUserAuthorization('user-past');

    // Past-year assignment appears in grants.club_assignments
    expect(result.authorization.grants.club_assignments).toHaveLength(1);
    expect(
      result.authorization.grants.club_assignments[0].assignment_id,
    ).toBe('past-assignment');
    // Past-year grant must carry EMPTY permissions (non-operational)
    expect(result.authorization.grants.club_assignments[0].permissions).toEqual(
      [],
    );
    // Past-year grant is NOT operational
    expect(result.authorization.grants.club_assignments[0].operational).toBe(false);
    expect(result.authorization.grants.club_assignments[0].ecclesiastical_year_id).toBe(pastYearId);
    // But does NOT contribute to effective.permissions
    expect(result.authorization.effective.permissions).toEqual([]);
    // And no active assignment is resolved
    expect(result.authorization.active_assignment.assignment_id).toBeNull();
  });

  it('A05: designated/future director is omitted from grants, selector and profile', async () => {
    const nextYearId = CURRENT_YEAR_ID + 1;
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-designated',
      email: 'designated@example.com',
      name: 'Designated',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2026-01-01'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: null },
      users_roles: [],
      club_role_assignments: [
        {
          assignment_id: 'designated-assignment',
          ecclesiastical_year_id: nextYearId,
          status: 'designated',
          start_date: new Date('2027-01-01'),
          end_date: null,
          expires_at: null,
          roles: {
            role_name: 'director',
            role_permissions: [
              { permissions: { permission_name: 'clubs:update' } },
            ],
          },
          club_sections: {
            club_section_id: 6,
            club_type_id: 1,
            club_types: { name: 'Conquistadores' },
            clubs: {
              club_id: 2,
              name: 'Club Y',
              local_fields: null,
            },
          },
        },
      ],
      users_permissions: [],
    });

    const result = await service.resolveUserAuthorization('user-designated');

    expect(result.authorization.grants.club_assignments).toEqual([]);
    expect(result.legacy.club_context.available).toEqual([]);
    expect(result.legacy.club).toBeNull();
    expect(result.authorization.effective.permissions).toEqual([]);
    expect(result.authorization.active_assignment.assignment_id).toBeNull();
  });

  it('current-year inactive assignment is listed in grants with empty permissions, not in effective, no active_assignment', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-inactive',
      email: 'inactive@example.com',
      name: 'Inactive',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2026-01-01'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: null },
      users_roles: [],
      club_role_assignments: [
        {
          assignment_id: 'inactive-assignment',
          ecclesiastical_year_id: CURRENT_YEAR_ID,
          status: 'inactive',
          start_date: new Date('2026-01-01'),
          end_date: new Date('2026-06-30'),
          expires_at: null,
          roles: {
            role_name: 'director',
            role_permissions: [
              { permissions: { permission_name: 'clubs:update' } },
            ],
          },
          club_sections: {
            club_section_id: 9,
            club_type_id: 1,
            club_types: { name: 'Aventureros' },
            clubs: {
              club_id: 5,
              name: 'Club Inactivo',
              local_fields: null,
            },
          },
        },
      ],
      users_permissions: [],
    });

    const result = await service.resolveUserAuthorization('user-inactive');

    // Inactive grant appears in grants.club_assignments
    expect(result.authorization.grants.club_assignments).toHaveLength(1);
    expect(
      result.authorization.grants.club_assignments[0].assignment_id,
    ).toBe('inactive-assignment');
    expect(result.authorization.grants.club_assignments[0].status).toBe(
      'inactive',
    );
    // Inactive grant must carry EMPTY permissions (non-operational)
    expect(
      result.authorization.grants.club_assignments[0].permissions,
    ).toEqual([]);
    // Inactive grant is NOT operational
    expect(result.authorization.grants.club_assignments[0].operational).toBe(false);
    expect(result.authorization.grants.club_assignments[0].ecclesiastical_year_id).toBe(CURRENT_YEAR_ID);
    // Does NOT contribute to effective.permissions
    expect(result.authorization.effective.permissions).toEqual([]);
    // No active_assignment because inactive is not operational
    expect(result.authorization.active_assignment.assignment_id).toBeNull();
  });

  it('current-year active assignment DOES enter effective.permissions', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-current',
      email: 'current@example.com',
      name: 'Current',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2026-01-01'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: null },
      users_roles: [],
      club_role_assignments: [
        {
          assignment_id: 'current-assignment',
          ecclesiastical_year_id: CURRENT_YEAR_ID,
          status: 'active',
          start_date: new Date('2026-01-01'),
          end_date: null,
          expires_at: null,
          roles: {
            role_name: 'director',
            role_permissions: [
              { permissions: { permission_name: 'clubs:read' } },
            ],
          },
          club_sections: {
            club_section_id: 7,
            club_type_id: 1,
            club_types: { name: 'Conquistadores' },
            clubs: {
              club_id: 3,
              name: 'Club Z',
              local_fields: null,
            },
          },
        },
      ],
      users_permissions: [],
    });

    const result = await service.resolveUserAuthorization('user-current');

    expect(result.authorization.effective.permissions).toContain('clubs:read');
    expect(result.authorization.active_assignment.assignment_id).toBe(
      'current-assignment',
    );
    // Active current-year grant DOES have permissions on the grant itself
    expect(result.authorization.grants.club_assignments[0].permissions).toEqual(
      ['clubs:read'],
    );
    // Active current-year grant IS operational
    expect(result.authorization.grants.club_assignments[0].operational).toBe(true);
    expect(result.authorization.grants.club_assignments[0].ecclesiastical_year_id).toBe(CURRENT_YEAR_ID);
  });

  it('degrades gracefully when no current ecclesiastical year exists (permissions empty, no throw)', async () => {
    mockEcclesiasticalYearService.getCurrentYear.mockRejectedValue(
      new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND),
    );
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-no-year',
      email: 'noyear@example.com',
      name: 'NoYear',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2026-01-01'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: null },
      users_roles: [],
      club_role_assignments: [
        {
          assignment_id: 'some-assignment',
          ecclesiastical_year_id: CURRENT_YEAR_ID,
          status: 'active',
          start_date: new Date('2026-01-01'),
          end_date: null,
          expires_at: null,
          roles: {
            role_name: 'director',
            role_permissions: [
              { permissions: { permission_name: 'clubs:read' } },
            ],
          },
          club_sections: {
            club_section_id: 8,
            club_type_id: 1,
            club_types: { name: 'Aventureros' },
            clubs: {
              club_id: 4,
              name: 'Club W',
              local_fields: null,
            },
          },
        },
      ],
      users_permissions: [],
    });

    // Should NOT throw; should return empty permissions
    const result = await service.resolveUserAuthorization('user-no-year');

    expect(result.authorization.effective.permissions).toEqual([]);
    expect(result.authorization.grants.club_assignments).toHaveLength(1);
  });

  it('rethrows unexpected errors from getCurrentYear and does NOT cache', async () => {
    mockEcclesiasticalYearService.getCurrentYear.mockRejectedValue(
      new Error('db down'),
    );
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-err',
      email: 'err@example.com',
      name: 'Err',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2026-01-01'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: null },
      users_roles: [],
      club_role_assignments: [],
      users_permissions: [],
    });

    await expect(
      service.resolveUserAuthorization('user-err'),
    ).rejects.toThrow('db down');

    expect(cacheManager.set).not.toHaveBeenCalled();
  });

  it('A09: overlapping years are not fail-softed into empty club permissions', async () => {
    mockEcclesiasticalYearService.getCurrentYear.mockRejectedValue(
      new AppConflictException(ErrorCode.ECCLESIASTICAL_YEAR_AMBIGUOUS),
    );

    await expect(
      service.resolveUserAuthorization('user-ambiguous'),
    ).rejects.toMatchObject({ code: ErrorCode.ECCLESIASTICAL_YEAR_AMBIGUOUS });
    expect(mockPrismaService.users.findUnique).not.toHaveBeenCalled();
  });

  it('A06: cache from the previous year is ignored after the institutional date crosses', async () => {
    cacheManager.get.mockResolvedValue({
      calendarRevision: '6:2025-01-01:2025-12-31:',
      payload: {
        authorization: {
          grants: { club_assignments: [], global_roles: [], direct_permissions: [] },
          active_assignment: { assignment_id: 'stale-director' },
          effective: { permissions: ['clubs:update'], scope: { global: {}, club: null } },
        },
      },
    });
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-stale-cache',
      email: 'stale@example.com',
      name: 'Stale',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2026-01-01'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: 'past-assignment' },
      users_roles: [],
      club_role_assignments: [
        {
          assignment_id: 'past-assignment',
          ecclesiastical_year_id: CURRENT_YEAR_ID - 1,
          status: 'active',
          start_date: new Date('2025-01-01'),
          end_date: null,
          expires_at: null,
          roles: {
            role_name: 'director',
            role_permissions: [
              { permissions: { permission_name: 'clubs:update' } },
            ],
          },
          club_sections: {
            club_section_id: 1,
            club_type_id: 1,
            club_types: { name: 'Conquistadores' },
            clubs: { club_id: 10, name: 'Club A', local_fields: null },
          },
        },
      ],
      users_permissions: [],
    });

    const result = await service.resolveUserAuthorization('user-stale-cache');

    expect(mockPrismaService.users.findUnique).toHaveBeenCalled();
    expect(result.authorization.effective.permissions).toEqual([]);
    expect(result.authorization.grants.club_assignments[0].operational).toBe(
      false,
    );
  });

  it('A06: pending club transition does not grant new-period club operation', async () => {
    mockCycle.readinessByClub.mockResolvedValue(new Map([[10, false]]));
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-pending-cut',
      email: 'pending@example.com',
      name: 'Pending',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2026-01-01'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: 'new-dir' },
      users_roles: [],
      club_role_assignments: [
        {
          assignment_id: 'new-dir',
          ecclesiastical_year_id: CURRENT_YEAR_ID,
          status: 'active',
          start_date: new Date('2026-01-01'),
          end_date: null,
          expires_at: null,
          roles: {
            role_name: 'director',
            role_permissions: [
              { permissions: { permission_name: 'clubs:update' } },
            ],
          },
          club_sections: {
            club_section_id: 1,
            club_type_id: 1,
            club_types: { name: 'Conquistadores' },
            clubs: { club_id: 10, name: 'Club A', local_fields: null },
          },
        },
      ],
      users_permissions: [],
    });

    const result = await service.resolveUserAuthorization('user-pending-cut');

    expect(result.authorization.grants.club_assignments[0].operational).toBe(
      false,
    );
    expect(result.authorization.grants.club_assignments[0].permissions).toEqual(
      [],
    );
    expect(result.authorization.effective.permissions).toEqual([]);
    expect(result.authorization.active_assignment.assignment_id).toBeNull();
  });

  it('A06: cache TTL does not extend past the next ecclesiastical year boundary', async () => {
    mockClock.now.mockReturnValue(new Date('2026-12-31T05:59:30.000Z'));
    mockZoned.startOfNextBusinessDate.mockReturnValue(
      new Date('2026-12-31T06:00:00.000Z'),
    );
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-ttl',
      email: 'ttl@example.com',
      name: 'Ttl',
      paternal_last_name: null,
      maternal_last_name: null,
      gender: null,
      birthday: null,
      baptism: false,
      baptism_date: null,
      blood: null,
      user_image: null,
      country_id: null,
      union_id: null,
      local_field_id: null,
      created_at: new Date('2026-01-01'),
      countries: null,
      unions: null,
      local_fields: null,
      users_pr: { complete: true, active_club_assignment_id: null },
      users_roles: [],
      club_role_assignments: [],
      users_permissions: [],
    });

    await service.resolveUserAuthorization('user-ttl');

    expect(cacheManager.set).toHaveBeenCalledWith(
      AUTH_CONTEXT_CACHE_KEY('user-ttl'),
      expect.objectContaining({
        calendarRevision: expect.stringContaining('7:'),
      }),
      30_000,
    );
  });
});
