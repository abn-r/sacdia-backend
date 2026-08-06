import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AUTH_CONTEXT_CACHE_KEY,
  AuthorizationContextService,
} from './authorization-context.service';
import { authorizationContextV4Key } from '../authorization/authorization-context-cache-v4';
import { AuthorizationContextVersionService } from '../authorization/authorization-context-version.service';
import { ClubAssignmentEffectivityPolicy } from '../authorization/club-assignment-effectivity.policy';
import { LocalFieldTimezoneResolver } from '../authorization/local-field-timezone.resolver';
import { CLOCK } from '../clock/clock';
import { TemporalContextFactory } from '../clock/temporal-context.factory';
import { TestingClock } from '../clock/testing-clock';
import { ZonedBusinessTimeService } from '../clock/zoned-business-time.service';
import { ErrorCode } from '../errors/error-codes';
import { InstitutionalHierarchyService } from './institutional-hierarchy.service';

describe('AuthorizationContextService', () => {
  let service: AuthorizationContextService;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let versionService: { current: jest.Mock };
  let configValues: Record<string, string | undefined>;
  let loggerDebugSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let testingClock: TestingClock;
  let effectivityPolicy: ClubAssignmentEffectivityPolicy;

  const localFieldWithTimezone = (
    patch: {
      local_field_id?: number;
      name?: string;
      timezone?: string;
    } = {},
  ) => ({
    local_field_id: patch.local_field_id ?? 30,
    name: patch.name ?? 'Campo Centro',
    timezone: patch.timezone ?? 'America/Mexico_City',
    unions: {
      union_id: 20,
      name: 'Unión Norte',
      countries: {
        country_id: 10,
        name: 'México',
      },
    },
  });

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
    },
  };

  const mockHierarchyService = {
    resolveCurrent: jest.fn(),
  };

  const minimalUser = (userId: string, email = 'user@example.com') => ({
    user_id: userId,
    email,
    name: 'User',
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
    users_roles: [
      {
        roles: {
          role_name: 'assistant-admin',
          role_permissions: [
            { permissions: { permission_name: 'clubs:read' } },
          ],
        },
      },
    ],
    club_role_assignments: [],
  });

  beforeEach(async () => {
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    versionService = { current: jest.fn().mockResolvedValue(3n) };
    configValues = { AUTH_CONTEXT_CACHE_V4_ENABLED: 'true' };
    testingClock = new TestingClock(new Date('2026-08-05T18:00:00.000Z'));

    mockHierarchyService.resolveCurrent.mockResolvedValue({
      division_id: 1,
      division_name: 'División Interamericana',
      union_id: 2,
      local_field_id: 3,
      as_of: new Date('2026-01-01'),
      source: 'current',
      precision: 'exact',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationContextService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: InstitutionalHierarchyService,
          useValue: mockHierarchyService,
        },
        {
          provide: AuthorizationContextVersionService,
          useValue: versionService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => configValues[key],
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
        { provide: CLOCK, useValue: testingClock },
        ZonedBusinessTimeService,
        TemporalContextFactory,
        LocalFieldTimezoneResolver,
        ClubAssignmentEffectivityPolicy,
      ],
    }).compile();

    service = module.get<AuthorizationContextService>(
      AuthorizationContextService,
    );
    effectivityPolicy = module.get(ClubAssignmentEffectivityPolicy);
    loggerDebugSpy = jest.spyOn(
      (
        service as unknown as {
          logger: { debug: (...args: unknown[]) => void };
        }
      ).logger,
      'debug',
    );
    loggerWarnSpy = jest.spyOn(
      (service as unknown as { logger: { warn: (...args: unknown[]) => void } })
        .logger,
      'warn',
    );
  });

  afterEach(() => {
    loggerDebugSpy?.mockRestore();
    loggerWarnSpy?.mockRestore();
    jest.clearAllMocks();
  });

  it('uses versioned cache keys so stale legacy snapshots are bypassed', () => {
    expect(AUTH_CONTEXT_CACHE_KEY('user-123')).toBe('auth:context:v3:user-123');
    expect(authorizationContextV4Key('user-123', 3n)).toBe(
      'auth:context:v4:user-123:3',
    );
  });

  it('invalidates both current and legacy authorization cache keys', async () => {
    await service.invalidateUserAuthorizationCache('user-123');

    expect(cacheManager.del).toHaveBeenCalledWith('auth:context:v4:user-123:3');
    expect(cacheManager.del).toHaveBeenCalledWith('auth:context:v3:user-123');
    expect(cacheManager.del).toHaveBeenCalledWith('auth:context:v2:user-123');
    expect(cacheManager.del).toHaveBeenCalledWith('auth:context:user-123');
  });

  it('serves a fresh v4 cache envelope without querying the canonical source', async () => {
    const cachedProfile = {
      profile: { user_id: 'user-123' },
      authorization: {
        grants: { global_roles: [], club_assignments: [] },
        active_assignment: { assignment_id: null },
        effective: {
          permissions: ['clubs:read'],
          scope: { global: {}, club: null },
        },
      },
    };
    cacheManager.get.mockResolvedValue({
      value: cachedProfile,
      valid_until: '2099-01-01T00:00:00.000Z',
      territory_time_vector: [],
    });

    await expect(service.resolveUserAuthorization('user-123')).resolves.toBe(
      cachedProfile,
    );
    expect(versionService.current).toHaveBeenCalledWith('user-123');
    expect(cacheManager.get).toHaveBeenCalledWith('auth:context:v4:user-123:3');
    expect(mockPrismaService.users.findUnique).not.toHaveBeenCalled();
  });

  it('skips cache when AUTH_CONTEXT_CACHE_V4_ENABLED is false', async () => {
    configValues.AUTH_CONTEXT_CACHE_V4_ENABLED = 'false';
    cacheManager.get.mockResolvedValue({
      value: {
        profile: { user_id: 'user-123' },
        authorization: {
          effective: { permissions: ['admin:all'] },
        },
      },
      valid_until: '2099-01-01T00:00:00.000Z',
      territory_time_vector: [],
    });
    mockPrismaService.users.findUnique.mockResolvedValue(
      minimalUser('user-123', 'secret.owner@example.com'),
    );

    const result = await service.resolveUserAuthorization('user-123');

    expect(result.authorization.effective.permissions).toEqual(['clubs:read']);
    expect(cacheManager.get).not.toHaveBeenCalled();
    expect(cacheManager.set).not.toHaveBeenCalled();
    expect(versionService.current).not.toHaveBeenCalled();
    expect(service.getAuthorizationCacheMetrics().bypassed).toBe(1);
  });

  it('records cache metrics without PII when enabled', async () => {
    const cachedProfile = {
      profile: { user_id: 'user-metrics', email: 'pii@example.com' },
      authorization: {
        grants: { global_roles: [], club_assignments: [] },
        active_assignment: { assignment_id: null },
        effective: {
          permissions: ['clubs:read'],
          scope: { global: {}, club: null },
        },
      },
    };
    cacheManager.get.mockResolvedValue({
      value: cachedProfile,
      valid_until: '2099-01-01T00:00:00.000Z',
      territory_time_vector: [],
    });

    await service.resolveUserAuthorization('user-metrics');

    expect(service.getAuthorizationCacheMetrics()).toEqual(
      expect.objectContaining({ hits: 1, misses: 0, errors: 0, bypassed: 0 }),
    );
    const metricLogs = [
      ...loggerDebugSpy.mock.calls,
      ...loggerWarnSpy.mock.calls,
    ]
      .map((args) => String(args[0]))
      .filter((line) => line.includes('auth_context_cache'));
    expect(metricLogs.length).toBeGreaterThan(0);
    for (const line of metricLogs) {
      expect(line).not.toMatch(/pii@example\.com|user-metrics|email=/i);
      expect(line).toMatch(/outcome=hit/);
    }
  });

  it('rollback leaves authorization decisions identical to the canonical source', async () => {
    configValues.AUTH_CONTEXT_CACHE_V4_ENABLED = 'false';
    cacheManager.get.mockResolvedValue({
      value: {
        profile: { user_id: 'user-rollback' },
        authorization: {
          grants: { global_roles: [], club_assignments: [] },
          active_assignment: { assignment_id: null },
          effective: {
            permissions: ['admin:all', 'secrets:read'],
            scope: { global: {}, club: null },
          },
        },
      },
      valid_until: '2099-01-01T00:00:00.000Z',
      territory_time_vector: [],
    });
    mockPrismaService.users.findUnique.mockResolvedValue(
      minimalUser('user-rollback'),
    );

    const rolledBack = await service.resolveUserAuthorization('user-rollback');

    // Direct source load (same flag-off path) must match; cached admin:all must not win.
    const sourceAgain = await service.resolveUserAuthorization('user-rollback');
    expect(rolledBack.authorization.effective.permissions).toEqual([
      'clubs:read',
    ]);
    expect(sourceAgain.authorization.effective.permissions).toEqual(
      rolledBack.authorization.effective.permissions,
    );
    expect(rolledBack.authorization.effective.permissions).not.toContain(
      'admin:all',
    );
    expect(cacheManager.get).not.toHaveBeenCalled();
  });

  it('reloads from the canonical source on cache miss', async () => {
    cacheManager.get.mockResolvedValue(null);
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'user-miss',
      email: 'miss@example.com',
      name: 'Miss',
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
    });

    const result = await service.resolveUserAuthorization('user-miss');

    expect(result.profile.user_id).toBe('user-miss');
    expect(mockPrismaService.users.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 'user-miss' } }),
    );
    expect(cacheManager.set).toHaveBeenCalledWith(
      'auth:context:v4:user-miss:3',
      expect.objectContaining({
        value: expect.objectContaining({
          profile: expect.objectContaining({ user_id: 'user-miss' }),
        }),
        valid_until: expect.any(String),
        territory_time_vector: [],
      }),
      expect.any(Number),
    );
  });

  it('does not grant permissions from corrupt cache or version backend failure', async () => {
    cacheManager.get.mockResolvedValue({
      value: {
        profile: { user_id: 'user-123' },
        authorization: {
          effective: { permissions: ['admin:all'] },
        },
      },
      valid_until: 'not-a-date',
      territory_time_vector: [
        { local_field_id: 0, timezone: '', modified_at: 'invalid' },
      ],
    });
    mockPrismaService.users.findUnique.mockResolvedValue(null);

    await expect(
      service.resolveUserAuthorization('user-123'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_CONTEXT_USER_NOT_FOUND });
    expect(mockPrismaService.users.findUnique).toHaveBeenCalled();

    versionService.current.mockRejectedValueOnce(new Error('version down'));
    cacheManager.get.mockResolvedValue({
      value: {
        profile: { user_id: 'user-123' },
        authorization: {
          effective: { permissions: ['admin:all'] },
        },
      },
      valid_until: '2099-01-01T00:00:00.000Z',
      territory_time_vector: [],
    });

    await expect(
      service.resolveUserAuthorization('user-123'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_CONTEXT_UNAVAILABLE });
    expect(mockPrismaService.users.findUnique).toHaveBeenCalledTimes(1);
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
              local_fields: localFieldWithTimezone(),
            },
          },
        },
        {
          assignment_id: 'assignment-2',
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
              local_fields: localFieldWithTimezone(),
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
              local_fields: localFieldWithTimezone({
                local_field_id: 44,
                name: 'Campo Horizonte',
              }),
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
          local_fields: localFieldWithTimezone({
            local_field_id: 12,
            name: 'Campo Orión',
          }),
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

  describe('T08 club assignment effectivity (canonical authority path)', () => {
    const clubAssignment = (patch: {
      assignment_id?: string;
      status?: string;
      start_date?: Date;
      end_date?: Date | null;
      expires_at?: Date | null;
      permission?: string;
      timezone?: string | null;
      omitLocalField?: boolean;
    }) => ({
      assignment_id: patch.assignment_id ?? 'assignment-effectivity',
      status: patch.status ?? 'active',
      active: true,
      start_date: patch.start_date ?? new Date('2026-01-01'),
      end_date: patch.end_date === undefined ? null : patch.end_date,
      expires_at: patch.expires_at === undefined ? null : patch.expires_at,
      roles: {
        role_name: 'director',
        role_permissions: [
          {
            permissions: {
              permission_name: patch.permission ?? 'clubs:update',
            },
          },
        ],
      },
      club_sections: {
        club_section_id: 11,
        club_type_id: 1,
        club_types: { name: 'Aventureros' },
        clubs: {
          club_id: 10,
          name: 'Club Amanecer',
          local_fields: patch.omitLocalField
            ? null
            : patch.timezone === null
              ? {
                  local_field_id: 30,
                  name: 'Campo Centro',
                  timezone: null,
                  unions: {
                    union_id: 20,
                    name: 'Unión Norte',
                    countries: { country_id: 10, name: 'México' },
                  },
                }
              : localFieldWithTimezone({
                  timezone: patch.timezone ?? 'America/Mexico_City',
                }),
        },
      },
    });

    it('excludes future start_date assignments from effective club permissions', async () => {
      const isEffectiveSpy = jest.spyOn(effectivityPolicy, 'isEffective');
      mockPrismaService.users.findUnique.mockResolvedValue({
        ...minimalUser('user-future'),
        users_roles: [],
        club_role_assignments: [
          clubAssignment({
            start_date: new Date('2027-01-01'),
            permission: 'clubs:update',
          }),
        ],
      });

      const result = await service.resolveUserAuthorization('user-future');

      expect(isEffectiveSpy).toHaveBeenCalled();
      expect(result.authorization.grants.club_assignments).toHaveLength(1);
      expect(result.authorization.active_assignment.assignment_id).toBeNull();
      expect(result.authorization.effective.permissions).toEqual([]);
      expect(result.authorization.effective.scope.club).toBeNull();
    });

    it('excludes expired expires_at assignments from effective club permissions', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        ...minimalUser('user-expired'),
        users_roles: [],
        club_role_assignments: [
          clubAssignment({
            expires_at: new Date('2026-08-05T18:00:00.000Z'),
            permission: 'finances:update',
          }),
        ],
      });

      const result = await service.resolveUserAuthorization('user-expired');

      expect(result.authorization.grants.club_assignments).toHaveLength(1);
      expect(result.authorization.effective.permissions).toEqual([]);
      expect(result.authorization.active_assignment.assignment_id).toBeNull();
    });

    it('excludes ended end_date assignments from effective club permissions', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        ...minimalUser('user-ended'),
        users_roles: [],
        club_role_assignments: [
          clubAssignment({
            end_date: new Date('2026-08-04'),
            permission: 'reports:read',
          }),
        ],
      });

      const result = await service.resolveUserAuthorization('user-ended');

      expect(result.authorization.grants.club_assignments).toHaveLength(1);
      expect(result.authorization.effective.permissions).toEqual([]);
      expect(result.authorization.active_assignment.assignment_id).toBeNull();
    });

    it('keeps temporally effective assignments in effective permissions', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        ...minimalUser('user-effective'),
        users_roles: [],
        users_pr: {
          complete: true,
          active_club_assignment_id: 'assignment-effectivity',
        },
        club_role_assignments: [
          clubAssignment({
            start_date: new Date('2026-01-01'),
            permission: 'clubs:update',
          }),
        ],
      });

      const result = await service.resolveUserAuthorization('user-effective');

      expect(result.authorization.active_assignment.assignment_id).toBe(
        'assignment-effectivity',
      );
      expect(result.authorization.effective.permissions).toEqual([
        'clubs:update',
      ]);
    });

    it('fails closed when an active assignment lacks a classifiable local-field timezone', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        ...minimalUser('user-tz'),
        users_roles: [],
        club_role_assignments: [
          clubAssignment({
            timezone: null,
            permission: 'clubs:update',
          }),
        ],
      });

      await expect(
        service.resolveUserAuthorization('user-tz'),
      ).rejects.toMatchObject({
        code: ErrorCode.LOCAL_FIELD_TIMEZONE_UNAVAILABLE,
      });
    });
  });
});
