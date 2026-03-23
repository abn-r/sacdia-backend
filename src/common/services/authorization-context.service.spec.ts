import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthorizationContextService } from './authorization-context.service';

describe('AuthorizationContextService', () => {
  let service: AuthorizationContextService;

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationContextService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AuthorizationContextService>(
      AuthorizationContextService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should throw UnauthorizedException when user is not found', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue(null);

    await expect(
      service.resolveUserAuthorization('missing-user'),
    ).rejects.toThrow(UnauthorizedException);
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
            role_name: 'assistant_admin',
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
          roles: {
            role_name: 'director',
            role_permissions: [
              { permissions: { permission_name: 'clubs:update' } },
            ],
          },
          club_sections: {
            club_section_id: 11,
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
          roles: {
            role_name: 'treasurer',
            role_permissions: [
              { permissions: { permission_name: 'finances:update' } },
            ],
          },
          club_sections: {
            club_section_id: 22,
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
        role_name: 'assistant_admin',
        permissions: ['clubs:read', 'reports:read'],
        scope: {
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
        club_type_name: 'Conquistadores',
      },
    });
    expect(result.legacy.club_context.active).toEqual({
      assignment_id: 'assignment-2',
      role_name: 'treasurer',
      club_section_id: 22,
      club_id: 10,
      club_name: 'Club Amanecer',
      club_type: 'Conquistadores',
    });
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
          roles: {
            role_name: 'director',
            role_permissions: [],
          },
          club_sections: {
            club_section_id: 33,
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
        club_type_name: 'Guías Mayores',
      },
    });
  });
});
