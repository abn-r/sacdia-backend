import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AUTH_CONTEXT_CACHE_KEY,
  AuthorizationContextService,
} from './authorization-context.service';
import { ErrorCode } from '../errors/error-codes';
import { InstitutionalHierarchyService } from './institutional-hierarchy.service';

describe('AuthorizationContextService', () => {
  let service: AuthorizationContextService;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
    },
  };

  const mockHierarchyService = {
    resolveCurrent: jest.fn(),
  };

  beforeEach(async () => {
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

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
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
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
    expect(AUTH_CONTEXT_CACHE_KEY('user-123')).toBe('auth:context:v3:user-123');
  });

  it('invalidates both current and legacy authorization cache keys', async () => {
    await service.invalidateUserAuthorizationCache('user-123');

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
});
