import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { AppBadRequestException } from '../common/errors/app.exception';
import {
  memberInDivisionWhere,
  memberInLocalFieldWhere,
  memberInUnionWhere,
} from '../common/authorization/actor-territory-scope';
import { effectiveAssignmentAt } from '../common/testing/effective-assignment.testing';
import { MemberTerritoryScopeService } from '../common/authorization/member-territory-scope.service';
import { role_category, user_approval_status } from '@prisma/client';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CoordinationService } from '../coordination/coordination.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { BetterAuthService } from '../better-auth/better-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminListUsersQueryDto, CreateAdminUserDto } from './dto';
import { AdminUsersService } from './admin-users.service';
import { roleHolderAssignmentWhere } from '../rbac/role-holder-assignment';

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    users_pr: {
      createMany: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
    },
    users_roles: {
      create: jest.fn(),
    },
    ecclesiastical_years: {
      findFirst: jest.fn(),
    },
    enrollments: {
      findMany: jest.fn(),
    },
    // Family block of the user detail (guardianship:read readers).
    guardianships: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    dependent_profiles: {
      findUnique: jest.fn(),
    },
    // family_access block (Phase 3c): own login + paired devices.
    supervised_logins: {
      findUnique: jest.fn(),
    },
    linked_devices: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const EFFECTIVE = effectiveAssignmentAt(new Date('2026-10-28T12:00:00.000Z'));
  const mockMemberScope = {
    effectiveAssignmentForLocalField: jest.fn(async () => EFFECTIVE),
    effectiveAssignmentForScope: jest.fn(async () => EFFECTIVE),
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn((_bucket: unknown, value: string) =>
      Promise.resolve(value),
    ),
  };

  const mockAuthorizationContextService = {
    resolveUserAuthorization: jest.fn(),
  };

  const mockCoordinationService = {
    getEffectiveCoordinatorSectionIds: jest.fn(),
  };

  const mockBetterAuthService = {
    createUser: jest.fn(),
    resetPasswordForEmail: jest.fn(),
    sendInvitation: jest.fn(),
    isAccountActivated: jest.fn(),
    getInvitationIssuedAt: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: FILE_STORAGE_SERVICE,
          useValue: mockFileStorageService,
        },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContextService,
        },
        {
          provide: BetterAuthService,
          useValue: mockBetterAuthService,
        },
        {
          provide: CoordinationService,
          useValue: mockCoordinationService,
        },
        { provide: MemberTerritoryScopeService, useValue: mockMemberScope },
      ],
    }).compile();

    service = module.get<AdminUsersService>(AdminUsersService);

    mockBetterAuthService.isAccountActivated.mockResolvedValue(true);
    mockBetterAuthService.getInvitationIssuedAt.mockResolvedValue(null);
    mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(null);
    mockPrismaService.enrollments.findMany.mockResolvedValue([]);
    mockPrismaService.guardianships.findMany.mockResolvedValue([]);
    mockPrismaService.dependent_profiles.findUnique.mockResolvedValue(null);
    mockPrismaService.guardianships.findFirst.mockResolvedValue(null);
    mockPrismaService.supervised_logins.findUnique.mockResolvedValue(null);
    mockPrismaService.linked_devices.findMany.mockResolvedValue([]);
    mockCoordinationService.getEffectiveCoordinatorSectionIds.mockResolvedValue(
      [],
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const buildResolvedAuthorization = (
    options: {
      roles?: string[];
      permissions?: string[];
      divisionId?: number | null;
      unionId?: number | null;
      localFieldId?: number | null;
    } = {},
  ) => {
    const {
      roles = ['admin'],
      permissions = [],
      divisionId = null,
      unionId = null,
      localFieldId = null,
    } = options;

    return {
      profile: {},
      post_register_complete: false,
      authorization: {
        grants: {
          global_roles: roles.map((role_name) => ({
            role_name,
            permissions,
            scope: {},
          })),
          club_assignments: [],
        },
        active_assignment: { assignment_id: null },
        effective: {
          permissions,
          scope: {
            global: {
              ...(divisionId !== null
                ? { division: { id: divisionId, name: 'División' } }
                : {}),
              ...(unionId !== null
                ? { union: { id: unionId, name: 'Unión' } }
                : {}),
              ...(localFieldId !== null
                ? { local_field: { id: localFieldId, name: 'Campo Local' } }
                : {}),
            },
            club: null,
          },
        },
      },
      legacy: {
        roles,
        permissions,
        club: null,
        club_context: {
          active_assignment_id: null,
          active: null,
          available: [],
        },
      },
    };
  };

  const buildAdminDetailRecord = (): any => ({
    user_id: 'user-1',
    email: 'user1@example.com',
    name: 'Maria',
    paternal_last_name: 'Lopez',
    maternal_last_name: 'Diaz',
    gender: 'Femenino',
    birthday: new Date('2010-10-01'),
    blood: 'A_POSITIVE',
    baptism: false,
    baptism_date: null,
    user_image: null,
    active: true,
    access_app: true,
    access_panel: false,
    country_id: 1,
    union_id: 2,
    local_field_id: 3,
    created_at: new Date('2026-01-01'),
    modified_at: new Date('2026-01-05'),
    countries: { country_id: 1, name: 'Mexico' },
    unions: { union_id: 2, name: 'UMS' },
    local_fields: { local_field_id: 3, union_id: 2, name: 'Campo Sur' },
    users_roles: [{ role_id: 'r1', roles: { role_name: 'user' } }],
    users_pr: {
      complete: false,
      profile_picture_complete: true,
      personal_info_complete: false,
      club_selection_complete: false,
      date_completed: null,
    },
    enrollments: [],
    club_role_assignments: [],
    emergency_contact: [
      {
        emergency_id: 91,
        name: 'Ana Tutor',
        phone: '555-1111',
        primary: true,
        relationship_type_id: 4,
        relationship_types: {
          name: 'Madre',
        },
      },
    ],
    users_allergies: [
      {
        allergy_id: 1,
        allergies: { name: 'Peanuts' },
      },
    ],
    users_diseases: [
      {
        disease_id: 2,
        diseases: { name: 'Asthma' },
      },
    ],
    users_medicines: [
      {
        medicine_id: 3,
        medicines: { name: 'Salbutamol' },
      },
    ],
  });

  const buildTrajectoryClass = () => ({
    enrollment_id: 55,
    class_id: 9,
    ecclesiastical_year_id: 2026,
    advanced_status: false,
    active: true,
    enrollment_date: new Date('2026-01-10T00:00:00.000Z'),
    investiture_status: 'IN_PROGRESS',
    investiture_date: null,
    classes: {
      name: 'Explorador',
    },
    ecclesiastical_year: {
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
    },
  });

  const buildEnrollmentCandidate = (enrollmentId: number) => ({
    enrollment_id: enrollmentId,
    ecclesiastical_year_id: 2026,
    class_id: 7,
    enrollment_date: new Date('2026-01-05T10:00:00.000Z'),
    investiture_status: 'IN_PROGRESS',
    submitted_for_validation: false,
    submitted_at: null,
    validated_by: null,
    validated_at: null,
    rejection_reason: null,
    investiture_date: null,
    advanced_status: false,
    locked_for_validation: false,
    cross_type_enrollment: false,
    active: true,
    classes: {
      name: 'Amigo',
    },
  });

  const buildListQuery = (
    overrides: Partial<AdminListUsersQueryDto> = {},
  ): AdminListUsersQueryDto => ({
    page: 1,
    limit: 20,
    skip: 0,
    take: 20,
    ...overrides,
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listUsers', () => {
    it('returns email null without failing for a user with no email', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([
        {
          user_id: 'dep-1',
          email: null,
          name: 'Ana',
          paternal_last_name: 'Pérez',
          maternal_last_name: null,
          user_image: null,
          active: true,
          access_app: true,
          access_panel: false,
          country_id: 1,
          union_id: 10,
          local_field_id: 20,
          created_at: new Date('2026-01-01'),
          countries: { country_id: 1, name: 'México' },
          unions: { union_id: 10, name: 'UMN' },
          local_fields: { local_field_id: 20, union_id: 10, name: 'Campo A' },
          users_roles: [{ roles: { role_name: 'user' } }],
          users_pr: [],
        },
      ]);
      mockPrismaService.users.count.mockResolvedValue(1);

      const result = await service.listUsers('actor-super', buildListQuery());

      expect(result.data).toHaveLength(1);
      expect(result.data[0].email).toBeNull();
      expect(result.data[0].is_deleted).toBe(false);
    });

    it('should allow super-admin with ALL scope', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([
        {
          user_id: 'u1',
          email: 'u1@example.com',
          name: 'Juan',
          paternal_last_name: 'Pérez',
          maternal_last_name: 'García',
          user_image: 'https://cdn.example.com/users/u1.jpg',
          active: true,
          access_app: true,
          access_panel: false,
          country_id: 1,
          union_id: 10,
          local_field_id: 20,
          created_at: new Date('2026-01-01'),
          countries: { country_id: 1, name: 'México' },
          unions: { union_id: 10, name: 'UMN' },
          local_fields: { local_field_id: 20, union_id: 10, name: 'Campo A' },
          users_roles: [{ roles: { role_name: 'user' } }],
          users_pr: [
            {
              complete: true,
              profile_picture_complete: true,
              personal_info_complete: true,
              club_selection_complete: true,
            },
          ],
        },
      ]);
      mockPrismaService.users.count.mockResolvedValue(1);

      const result = await service.listUsers('actor-super', buildListQuery());

      expect(result.meta.scope.type).toBe('ALL');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].is_deleted).toBe(false);
      expect(result.data[0].user_image).toBe(
        'https://cdn.example.com/users/u1.jpg',
      );
      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });

    it('should flag self-deleted anonymized accounts', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([
        {
          user_id: '5b2b8a9a-f2d7-4e8d-a65b-6d9447e0e1bc',
          email: 'deleted-5b2b8a9a-f2d7-4e8d-a65b-6d9447e0e1bc@sacdia.deleted',
          name: null,
          paternal_last_name: null,
          maternal_last_name: null,
          user_image: null,
          active: false,
          access_app: false,
          access_panel: false,
          country_id: null,
          union_id: null,
          local_field_id: null,
          created_at: new Date('2026-01-01'),
          countries: null,
          unions: null,
          local_fields: null,
          users_roles: [],
          users_pr: null,
        },
      ]);
      mockPrismaService.users.count.mockResolvedValue(1);

      const result = await service.listUsers('actor-super', buildListQuery());

      expect(result.data[0].is_deleted).toBe(true);
      expect(result.data[0].full_name).toBe('');
    });

    it('should include active club roles in list role badges', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([
        {
          user_id: 'club-user',
          email: 'club-user@example.com',
          name: 'Abner',
          paternal_last_name: 'Reyes',
          maternal_last_name: 'Ramírez',
          user_image: null,
          active: true,
          access_app: true,
          access_panel: true,
          country_id: 1,
          union_id: 20,
          local_field_id: 4,
          created_at: new Date('2026-03-25'),
          countries: { country_id: 1, name: 'México' },
          unions: { union_id: 20, name: 'Unión Mexicana Interoceánica' },
          local_fields: {
            local_field_id: 4,
            union_id: 20,
            name: 'Asociación Centro de Veracruz',
          },
          users_roles: [],
          club_role_assignments: [
            {
              assignment_id: 'cra-director',
              status: 'active',
              roles: { role_name: 'director' },
              club_sections: {
                club_types: { name: 'Aventureros' },
                clubs: { name: 'ACV' },
              },
            },
            {
              assignment_id: 'cra-member',
              status: 'pending',
              roles: { role_name: 'member' },
              club_sections: {
                club_types: { name: 'Guías Mayores' },
                clubs: { name: 'ACV' },
              },
            },
            {
              assignment_id: 'cra-secretary',
              status: null,
              roles: { role_name: 'secretary' },
              club_sections: {
                club_types: { name: 'Conquistadores' },
                clubs: { name: 'ACV' },
              },
            },
          ],
          users_pr: {
            complete: true,
            profile_picture_complete: true,
            personal_info_complete: true,
            club_selection_complete: true,
          },
        },
      ]);
      mockPrismaService.users.count.mockResolvedValue(1);

      const result = await service.listUsers('actor-super', buildListQuery());

      expect(result.data[0].roles).toEqual(['director', 'member', 'secretary']);
      expect(result.data[0].club_assignments).toEqual([
        {
          assignment_id: 'cra-director',
          role_name: 'director',
          status: 'active',
          section_name: 'Aventureros',
          club_name: 'ACV',
        },
        {
          assignment_id: 'cra-secretary',
          role_name: 'secretary',
          status: 'active',
          section_name: 'Conquistadores',
          club_name: 'ACV',
        },
        {
          assignment_id: 'cra-member',
          role_name: 'member',
          status: 'pending',
          section_name: 'Guías Mayores',
          club_name: 'ACV',
        },
      ]);
    });

    it('should escape LIKE wildcards in the search term', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers(
        'actor-super',
        buildListQuery({ search: ' a%b_c ' }),
      );

      const { where } = mockPrismaService.users.findMany.mock.calls[0][0];
      expect(where).toEqual({
        OR: [
          { email: { contains: 'a\\%b\\_c', mode: 'insensitive' } },
          { name: { contains: 'a\\%b\\_c', mode: 'insensitive' } },
          {
            paternal_last_name: {
              contains: 'a\\%b\\_c',
              mode: 'insensitive',
            },
          },
          {
            maternal_last_name: {
              contains: 'a\\%b\\_c',
              mode: 'insensitive',
            },
          },
        ],
      });
    });

    it('should sort the full result set by name and surnames before pagination', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers('actor-super', buildListQuery());

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: [
            { name: { sort: 'asc', nulls: 'last' } },
            { paternal_last_name: { sort: 'asc', nulls: 'last' } },
            { maternal_last_name: { sort: 'asc', nulls: 'last' } },
            { user_id: 'asc' },
          ],
        }),
      );
      expect(mockPrismaService.users.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { created_at: 'desc' },
        }),
      );
    });

    it('should restore created_at desc when sortBy=created_at and sortOrder=desc', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers(
        'actor-super',
        buildListQuery({ sortBy: 'created_at', sortOrder: 'desc' }),
      );

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ created_at: 'desc' }, { user_id: 'asc' }],
        }),
      );
    });

    it('should keep the same name orderBy on page 2 instead of restarting the alphabet', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(40);

      await service.listUsers(
        'actor-super',
        buildListQuery({ page: 2, limit: 20 }),
      );

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
          orderBy: [
            { name: { sort: 'asc', nulls: 'last' } },
            { paternal_last_name: { sort: 'asc', nulls: 'last' } },
            { maternal_last_name: { sort: 'asc', nulls: 'last' } },
            { user_id: 'asc' },
          ],
        }),
      );
    });

    it('should filter users by either global or club role', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers(
        'actor-super',
        buildListQuery({ role: 'director' }),
      );

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              {
                users_roles: {
                  some: expect.objectContaining({
                    roles: expect.objectContaining({
                      role_category: role_category.GLOBAL,
                      role_name: {
                        equals: 'director',
                        mode: 'insensitive',
                      },
                    }),
                  }),
                },
              },
              {
                club_role_assignments: {
                  some: expect.objectContaining({
                    roles: expect.objectContaining({
                      role_category: role_category.CLUB,
                      role_name: {
                        equals: 'director',
                        mode: 'insensitive',
                      },
                    }),
                  }),
                },
              },
            ],
          },
        }),
      );
    });

    it('should enforce UNION scope for admin with union_id', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['admin'],
          divisionId: 1,
          unionId: 7,
          localFieldId: 99,
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers('actor-admin', buildListQuery());

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: memberInUnionWhere(7, EFFECTIVE),
        }),
      );
    });

    it('should enforce SECTIONS scope for coordinator assignments', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['coordinator'],
          unionId: 5,
          localFieldId: 11,
        }),
      );
      mockCoordinationService.getEffectiveCoordinatorSectionIds.mockResolvedValue(
        [20, 21],
      );
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      const result = await service.listUsers(
        'actor-coordinator',
        buildListQuery({ unionId: 99, localFieldId: 11 }),
      );

      expect(result.meta.scope).toEqual({
        type: 'SECTIONS',
        roles: ['coordinator'],
        division_id: null,
        union_id: null,
        local_field_id: null,
        club_section_ids: [20, 21],
      });
      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            club_role_assignments: {
              some: {
                club_section_id: { in: [20, 21] },
                active: true,
              },
            },
          },
        }),
      );
    });

    it('should reject coordinator without assignments even if local_field_id exists', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['coordinator'],
          unionId: 5,
          localFieldId: 11,
        }),
      );

      await expect(
        service.listUsers('actor-coordinator', buildListQuery()),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });

    it('should reject admin without union_id/local_field_id', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['admin'],
        }),
      );

      await expect(
        service.listUsers('actor-admin', buildListQuery()),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });

    it('should reject coordinator without assignments', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['coordinator'],
          unionId: 5,
        }),
      );

      await expect(
        service.listUsers('actor-coordinator', buildListQuery()),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });

    it('should enforce UNION scope for assistant-admin with union_id', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['assistant-admin'],
          divisionId: 2,
          unionId: 12,
          localFieldId: 44,
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers('actor-assistant-admin', buildListQuery());

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: memberInUnionWhere(12, EFFECTIVE),
        }),
      );
    });

    it('should reject assistant-admin without union_id/local_field_id', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['assistant-admin'],
        }),
      );

      await expect(
        service.listUsers('actor-assistant-admin', buildListQuery()),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });

    it('should enforce DIVISION scope for director-dia with division_id', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['director-dia'],
          divisionId: 3,
        }),
      );
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers('actor-director-dia', buildListQuery());

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: memberInDivisionWhere(3, EFFECTIVE),
        }),
      );
    });

    it('should reject director-dia without division scope', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['director-dia'],
        }),
      );

      await expect(
        service.listUsers('actor-director-dia', buildListQuery()),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });
  });

  describe('club assignments in the users list follow the role holder rule', () => {
    const superAdmin = () =>
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
          permissions: ['users:read_detail'],
        }),
      );

    const holderWhere = expect.objectContaining({
      active: true,
      status: { in: ['active', 'pending'] },
      AND: [
        { OR: [{ end_date: null }, { end_date: { gte: expect.any(Date) } }] },
        {
          OR: [{ expires_at: null }, { expires_at: { gt: expect.any(Date) } }],
        },
      ],
    });

    it('listUsers selects active and pending club assignments that have not ended or expired (rejected ones stay out)', async () => {
      superAdmin();
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers('actor-super', buildListQuery());

      const { select } = mockPrismaService.users.findMany.mock.calls[0][0];
      expect(select.club_role_assignments.where).toEqual(holderWhere);
      expect(select.club_role_assignments.select.status).toBe(true);
    });

    it('getUserById selects only status=active club assignments', async () => {
      superAdmin();
      mockPrismaService.users.findFirst.mockResolvedValue(null);

      await expect(
        service.getUserById('actor-super', 'user-1'),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_NOT_FOUND });

      const { select } = mockPrismaService.users.findFirst.mock.calls[0][0];
      expect(select.club_role_assignments.where).toEqual({
        active: true,
        status: 'active',
      });
    });

    it('the club role filter uses the same holder rule as the role usage count', async () => {
      superAdmin();
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers(
        'actor-super',
        buildListQuery({ role: 'member' }),
      );

      const { where } = mockPrismaService.users.findMany.mock.calls[0][0];
      const clubClause = where.OR.find(
        (c: Record<string, unknown>) => 'club_role_assignments' in c,
      );
      expect(clubClause.club_role_assignments.some).toEqual(holderWhere);
      expect(clubClause.club_role_assignments.some).toEqual(
        expect.objectContaining({
          ...roleHolderAssignmentWhere(),
          AND: expect.any(Array),
        }),
      );
    });
  });

  describe('getUserById', () => {
    it('should return user detail in scope', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
          permissions: ['users:read_detail'],
        }),
      );

      mockPrismaService.users.findFirst.mockResolvedValue({
        user_id: 'user-1',
        email: 'user1@example.com',
        name: 'María',
        paternal_last_name: 'López',
        maternal_last_name: 'Díaz',
        gender: 'Femenino',
        birthday: new Date('2010-10-01'),
        blood: 'A_POSITIVE',
        baptism: false,
        baptism_date: null,
        user_image: null,
        active: true,
        access_app: true,
        access_panel: false,
        country_id: 1,
        union_id: 2,
        local_field_id: 3,
        created_at: new Date('2026-01-01'),
        modified_at: new Date('2026-01-05'),
        countries: { country_id: 1, name: 'México' },
        unions: { union_id: 2, name: 'UMS' },
        local_fields: { local_field_id: 3, union_id: 2, name: 'Campo Sur' },
        users_roles: [{ role_id: 'r1', roles: { role_name: 'user' } }],
        users_pr: [
          {
            complete: false,
            profile_picture_complete: true,
            personal_info_complete: false,
            club_selection_complete: false,
            date_completed: null,
          },
        ],
        enrollments: [],
        club_role_assignments: [],
        emergency_contact: [],
      });

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.user_id).toBe('user-1');
      expect(result.roles).toEqual(['user']);
      expect(result.is_deleted).toBe(false);
      expect(result.scope.type).toBe('ALL');
      expect(result.current_operational_enrollment).toBeNull();
      expect(result.trajectory_classes).toEqual([]);
      expect(result.classes).toEqual([]);
    });

    it('should expose club assignment labels and emergency contact relationship names', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
          permissions: ['users:read_detail'],
        }),
      );

      const userRecord = buildAdminDetailRecord();
      userRecord.club_role_assignments = [
        {
          assignment_id: 'assignment-director',
          role_id: 'role-director',
          club_section_id: 10,
          ecclesiastical_year_id: 2026,
          start_date: new Date('2026-01-01'),
          end_date: null,
          roles: { role_name: 'director' },
          ecclesiastical_year: {
            year_id: 2026,
            start_date: new Date('2026-01-01'),
            end_date: new Date('2026-12-31'),
          },
          club_sections: {
            club_section_id: 10,
            club_type_id: 2,
            club_types: { name: 'Conquistadores' },
            clubs: {
              club_id: 7,
              name: 'ACV',
              local_field_id: 3,
              church_id: 44,
              districlub_type_id: 12,
              churches: { church_id: 44, name: 'Iglesia Central' },
              districts: {
                districlub_type_id: 12,
                name: 'Distrito Veracruz Centro',
              },
              local_fields: {
                local_field_id: 3,
                union_id: 2,
                name: 'Campo Sur',
              },
            },
          },
        },
      ];
      mockPrismaService.users.findFirst.mockResolvedValue(userRecord);

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.club_assignments[0]).toEqual(
        expect.objectContaining({
          assignment_id: 'assignment-director',
          role_name: 'director',
          club_name: 'ACV',
          section_name: 'Conquistadores',
          district_id: 12,
          district_name: 'Distrito Veracruz Centro',
          church_id: 44,
          church_name: 'Iglesia Central',
        }),
      );
      expect(result.emergency_contacts?.[0]).toEqual(
        expect.objectContaining({
          relationship_types: { name: 'Madre' },
        }),
      );
    });

    it('should apply DIVISION scope for director-dia detail access', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['director-dia'],
          permissions: ['users:read_detail'],
          divisionId: 1,
        }),
      );
      mockPrismaService.users.findFirst.mockResolvedValue({
        user_id: 'user-division',
        email: 'division@example.com',
        name: 'María',
        paternal_last_name: 'López',
        maternal_last_name: 'Díaz',
        gender: 'Femenino',
        birthday: new Date('2010-10-01'),
        blood: 'A_POSITIVE',
        baptism: false,
        baptism_date: null,
        user_image: null,
        active: true,
        access_app: true,
        access_panel: false,
        country_id: 1,
        union_id: 2,
        local_field_id: 3,
        created_at: new Date('2026-01-01'),
        modified_at: new Date('2026-01-05'),
        countries: { country_id: 1, name: 'México' },
        unions: { union_id: 2, name: 'UMS' },
        local_fields: { local_field_id: 3, union_id: 2, name: 'Campo Sur' },
        users_roles: [{ role_id: 'r1', roles: { role_name: 'user' } }],
        users_pr: [
          {
            complete: false,
            profile_picture_complete: true,
            personal_info_complete: false,
            club_selection_complete: false,
            date_completed: null,
          },
        ],
        enrollments: [],
        club_role_assignments: [],
        emergency_contact: [],
      });

      const result = await service.getUserById(
        'actor-director-dia',
        'user-division',
      );

      expect(result.scope.type).toBe('DIVISION');
      expect(result.scope.division_id).toBe(1);
    });

    it('should throw NotFoundException when user is outside scope', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['admin'],
          permissions: ['users:read_detail'],
          unionId: 4,
        }),
      );
      mockPrismaService.users.findFirst.mockResolvedValue(null);

      await expect(
        service.getUserById('actor-admin', 'user-outside-scope'),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_NOT_FOUND });

      const findFirstCalls = mockPrismaService.users.findFirst.mock
        .calls as Array<[unknown?]>;
      const findFirstArgs = findFirstCalls[0]?.[0] as
        | {
            where?: {
              AND?: Array<{
                user_id?: string;
                unions?: { division_id?: number };
                union_id?: number;
                local_field_id?: number;
              }>;
            };
          }
        | undefined;

      expect(findFirstArgs?.where?.AND).toEqual(
        expect.arrayContaining([
          { user_id: 'user-outside-scope' },
          memberInUnionWhere(4, EFFECTIVE),
        ]),
      );
    });

    describe('assertUserInActorScope', () => {
      it('resolves when the target user is inside the actor territory', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          buildResolvedAuthorization({
            roles: ['director-lf'],
            permissions: ['users:read_detail'],
            localFieldId: 3,
          }),
        );
        mockPrismaService.users.findFirst.mockResolvedValue({
          user_id: 'user-in-field',
        });

        await expect(
          service.assertUserInActorScope('actor-lf', 'user-in-field'),
        ).resolves.toBeUndefined();

        expect(mockPrismaService.users.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              AND: [
                { user_id: 'user-in-field' },
                memberInLocalFieldWhere(3, EFFECTIVE),
              ],
            },
            select: { user_id: true },
          }),
        );
      });

      it('scopes a director-lf by users.local_field_id OR an EFFECTIVE club role in the field (designated/pending/ended assignments do not count)', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          buildResolvedAuthorization({
            roles: ['director-lf'],
            permissions: ['users:read_detail'],
            localFieldId: 3,
          }),
        );
        mockPrismaService.users.findFirst.mockResolvedValue({
          user_id: 'director-without-field',
        });

        await service.assertUserInActorScope(
          'actor-lf',
          'director-without-field',
        );

        expect(
          mockMemberScope.effectiveAssignmentForLocalField,
        ).toHaveBeenCalledWith(3);
        const where = mockPrismaService.users.findFirst.mock.calls[0][0].where;
        expect(where.AND[1]).toEqual({
          OR: [
            { local_field_id: 3 },
            {
              club_role_assignments: {
                some: {
                  ...EFFECTIVE,
                  club_sections: { clubs: { local_field_id: 3 } },
                },
              },
            },
          ],
        });
        // The club path is the canonical policy predicate: only 'active', bounded by dates.
        expect(EFFECTIVE).toMatchObject({ active: true, status: 'active' });
        expect(JSON.stringify(where)).not.toMatch(/designated|pending|"in"/);
      });

      it('throws ADMIN_USER_NOT_FOUND when the target is outside scope', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          buildResolvedAuthorization({
            roles: ['director-lf'],
            permissions: ['users:read_detail'],
            localFieldId: 3,
          }),
        );
        mockPrismaService.users.findFirst.mockResolvedValue(null);

        await expect(
          service.assertUserInActorScope('actor-lf', 'user-other-field'),
        ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_NOT_FOUND });
      });
    });

    describe('sensitive subresource pruning', () => {
      const actor = {
        user_id: 'actor-admin',
        union_id: 2,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'admin' } }],
      };

      beforeEach(() => {
        mockPrismaService.users.findUnique.mockResolvedValue(actor);
        mockPrismaService.users.findFirst.mockResolvedValue(
          buildAdminDetailRecord(),
        );
      });

      it.each([
        ['health', ['health:read'], 'health'],
        [
          'emergency_contacts',
          ['emergency_contacts:read'],
          'emergency_contacts',
        ],
        ['post_registration', ['post_registration:read'], 'post_registration'],
      ])(
        'should expose only %s block for fine-grained readers',
        async (_family, permissions, visibleBlock) => {
          mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
            buildResolvedAuthorization({
              roles: ['admin'],
              permissions,
              unionId: 2,
            }),
          );

          const result = await service.getUserById('actor-admin', 'user-1');

          expect(result.health).toEqual(
            visibleBlock === 'health' ? definedHealth() : null,
          );
          expect(result.emergency_contacts).toEqual(
            visibleBlock === 'emergency_contacts'
              ? buildAdminDetailRecord().emergency_contact
              : null,
          );
          expect(result.post_registration).toEqual(
            visibleBlock === 'post_registration'
              ? definedPostRegistration()
              : null,
          );
        },
      );

      it('should preserve transitional legacy compatibility for users:read_detail', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          buildResolvedAuthorization({
            roles: ['admin'],
            permissions: ['users:read_detail'],
            unionId: 2,
          }),
        );

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.health).toEqual(definedHealth());
        expect(result.emergency_contacts).toEqual(
          buildAdminDetailRecord().emergency_contact,
        );
        expect(result.post_registration).toEqual(definedPostRegistration());
      });

      it('should prune sensitive blocks when actor lacks fine and legacy detail permissions', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          buildResolvedAuthorization({
            roles: ['admin'],
            permissions: ['users:read'],
            unionId: 2,
          }),
        );

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.health).toBeNull();
        expect(result.emergency_contacts).toBeNull();
        expect(result).not.toHaveProperty('legal_representative');
        expect(result.post_registration).toBeNull();
      });
    });

    describe('guardianships block (family profiles)', () => {
      const actor = {
        user_id: 'actor-admin',
        union_id: 2,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'admin' } }],
      };

      const readerOf = (permissions: string[]) =>
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          buildResolvedAuthorization({
            roles: ['admin'],
            permissions,
            unionId: 2,
          }),
        );

      beforeEach(() => {
        mockPrismaService.users.findUnique.mockResolvedValue(actor);
        mockPrismaService.users.findFirst.mockResolvedValue(
          buildAdminDetailRecord(),
        );
      });

      it('a role with only the legacy users:read_detail still reads the guardianships block (fallback until 2027-03-31)', async () => {
        readerOf(['users:read_detail']);
        mockPrismaService.guardianships.findMany.mockResolvedValue([]);
        mockPrismaService.guardianships.findFirst.mockResolvedValue(null);
        mockPrismaService.dependent_profiles.findUnique.mockResolvedValue(null);

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.guardianships).not.toBeNull();
        expect(result).not.toHaveProperty('legal_representative');
      });

      it('lists the guardians of a dependent with consent, verifier, form and test-data flags', async () => {
        readerOf(['guardianship:read']);
        mockPrismaService.guardianships.findMany
          .mockResolvedValueOnce([
            {
              guardianship_id: 'g-1',
              guardian_user_id: 'u-mom',
              is_primary: true,
              is_custodian: false,
              consent_status: 'verified',
              verification_method: 'director_paper_form',
              verified_at: new Date('2026-10-18T10:00:00.000Z'),
              external_name: null,
              is_test_data: false,
              created_at: new Date('2026-10-17T10:00:00.000Z'),
              revoked_at: null,
              revoked_reason: null,
              relationship_type: { name: 'Madre' },
              guardian: {
                user_id: 'u-mom',
                name: 'María',
                paternal_last_name: 'Pérez',
                email: 'maria@example.org',
                active: true,
              },
              custodian_club: null,
              verifier: {
                user_id: 'u-dir',
                name: 'Carlos',
                paternal_last_name: 'Ruiz',
              },
              consent_evidences: [{ evidence_id: 'e-1' }],
            },
          ])
          .mockResolvedValueOnce([]);
        mockPrismaService.dependent_profiles.findUnique.mockResolvedValue({
          created_at: new Date('2026-10-17T10:00:00.000Z'),
          created_by_user_id: 'u-mom',
          frozen_at: null,
          purge_after: null,
          majority_notice_sent_at: new Date('2026-10-02T10:00:00.000Z'),
          released_at: new Date('2026-11-01T10:00:00.000Z'),
          release_deadline_at: new Date('2026-12-01T10:00:00.000Z'),
          release_accepted_at: null,
          release_completed_at: null,
          release_source: 'cron',
          frozen_reason: null,
        });

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.guardianships).toEqual({
          as_dependent: [
            {
              guardianship_id: 'g-1',
              guardian: {
                user_id: 'u-mom',
                display_name: 'María Pérez',
                email: 'maria@example.org',
              },
              custodian_club: null,
              external_name: null,
              relationship_type_name: 'Madre',
              is_primary: true,
              is_custodian: false,
              consent_status: 'verified',
              verification_method: 'director_paper_form',
              verified_at: new Date('2026-10-18T10:00:00.000Z'),
              verified_by: { user_id: 'u-dir', display_name: 'Carlos Ruiz' },
              evidence_uploaded: true,
              is_test_data: false,
              created_at: new Date('2026-10-17T10:00:00.000Z'),
              revoked_at: null,
              revoked_reason: null,
            },
          ],
          as_guardian: [],
          dependent_profile: {
            created_at: new Date('2026-10-17T10:00:00.000Z'),
            created_by_user_id: 'u-mom',
            frozen_at: null,
            purge_after: null,
            majority_notice_sent_at: new Date('2026-10-02T10:00:00.000Z'),
            released_at: new Date('2026-11-01T10:00:00.000Z'),
            release_deadline_at: new Date('2026-12-01T10:00:00.000Z'),
            release_accepted_at: null,
            release_completed_at: null,
            release_source: 'cron',
            frozen_reason: null,
          },
        });
        // The user is read through the dependent side with the full history.
        expect(
          mockPrismaService.guardianships.findMany.mock.calls[0][0].where,
        ).toEqual({ dependent_user_id: 'user-1' });
      });

      it('shows a custodian row with the club and no guardian, and keeps revoked history', async () => {
        readerOf(['guardianship:read']);
        mockPrismaService.guardianships.findMany
          .mockResolvedValueOnce([
            {
              guardianship_id: 'g-old',
              guardian_user_id: 'u-gone',
              is_primary: true,
              is_custodian: false,
              consent_status: 'revoked',
              verification_method: null,
              verified_at: null,
              external_name: null,
              is_test_data: false,
              created_at: new Date('2026-10-01T00:00:00.000Z'),
              revoked_at: new Date('2026-10-10T00:00:00.000Z'),
              revoked_reason: 'guardian_account_closed',
              relationship_type: { name: 'Padre' },
              guardian: {
                user_id: 'u-gone',
                name: null,
                paternal_last_name: null,
                email:
                  'deleted-0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a@sacdia.deleted',
                active: false,
              },
              custodian_club: null,
              verifier: null,
              consent_evidences: [],
            },
            {
              guardianship_id: 'g-custody',
              guardian_user_id: null,
              is_primary: true,
              is_custodian: true,
              consent_status: 'pending',
              verification_method: null,
              verified_at: null,
              external_name: null,
              is_test_data: false,
              created_at: new Date('2026-10-10T00:00:00.000Z'),
              revoked_at: null,
              revoked_reason: null,
              relationship_type: null,
              guardian: null,
              custodian_club: { club_id: 9, name: 'Club Central' },
              verifier: null,
              consent_evidences: [],
            },
          ])
          .mockResolvedValueOnce([]);

        const result = await service.getUserById('actor-admin', 'user-1');

        const [revoked, custody] = result.guardianships!.as_dependent;
        expect(revoked).toMatchObject({
          consent_status: 'revoked',
          revoked_reason: 'guardian_account_closed',
          guardian: { user_id: 'u-gone', display_name: '', email: null },
        });
        expect(custody).toMatchObject({
          guardian: null,
          custodian_club: { club_id: 9, name: 'Club Central' },
          is_custodian: true,
          evidence_uploaded: false,
        });
      });

      it('lists the dependents of a guardian (live, non-custodian rows only)', async () => {
        readerOf(['guardianship:read']);
        mockPrismaService.guardianships.findMany
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              guardianship_id: 'g-ana',
              is_primary: true,
              consent_status: 'pending',
              relationship_type: { name: 'Madre' },
              dependent: {
                user_id: 'd-ana',
                name: 'Ana',
                paternal_last_name: 'Pérez',
                birthday: new Date('2017-04-02T00:00:00.000Z'),
              },
            },
          ]);

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.guardianships?.as_guardian).toEqual([
          {
            guardianship_id: 'g-ana',
            dependent: {
              user_id: 'd-ana',
              display_name: 'Ana Pérez',
              birthday: new Date('2017-04-02T00:00:00.000Z'),
            },
            relationship_type_name: 'Madre',
            is_primary: true,
            consent_status: 'pending',
          },
        ]);
        expect(
          mockPrismaService.guardianships.findMany.mock.calls[1][0].where,
        ).toEqual({
          guardian_user_id: 'user-1',
          is_custodian: false,
          consent_status: { not: 'revoked' },
        });
      });

      it('is also exposed to the transitional users:read_detail readers', async () => {
        readerOf(['users:read_detail']);

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.guardianships).toEqual({
          as_dependent: [],
          as_guardian: [],
          dependent_profile: null,
        });
      });

      it.each([['health:read'], ['emergency_contacts:read'], ['users:read']])(
        'is null and never queried for a reader without the guardianship family (%s)',
        async (permission) => {
          readerOf([permission]);

          const result = await service.getUserById('actor-admin', 'user-1');

          expect(result.guardianships).toBeNull();
          expect(
            mockPrismaService.guardianships.findMany,
          ).not.toHaveBeenCalled();
          expect(
            mockPrismaService.dependent_profiles.findUnique,
          ).not.toHaveBeenCalled();
        },
      );

      it('a dependent without e-mail does not break the detail (email null)', async () => {
        readerOf(['guardianship:read']);
        mockPrismaService.users.findFirst.mockResolvedValue({
          ...buildAdminDetailRecord(),
          email: null,
        });

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.email).toBeNull();
        expect(result.is_deleted).toBe(false);
      });
    });

    describe('family_access block (Phase 3c)', () => {
      const actor = {
        user_id: 'actor-admin',
        union_id: 2,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'admin' } }],
      };

      const readerOf = (permissions: string[]) =>
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          buildResolvedAuthorization({
            roles: ['admin'],
            permissions,
            unionId: 2,
          }),
        );

      const loginRow = (over: Record<string, unknown> = {}) => ({
        method: 'handle',
        login_handle: 'ana-7kq4m9xz',
        origin: 'guardian_enabled',
        enabled_at: new Date('2026-10-10T10:00:00.000Z'),
        password_set_by: 'guardian',
        pending_since: null,
        disabled_at: null,
        disabled_reason: null,
        enabled_by: {
          user_id: 'u-mom',
          name: 'María',
          paternal_last_name: 'Pérez',
        },
        ...over,
      });

      const deviceRow = (over: Record<string, unknown> = {}) => ({
        linked_device_id: 'dev-1',
        label: 'Tablet de Ana',
        platform: 'android',
        app_version: '2.4.0',
        paired_at: new Date('2026-10-01T10:00:00.000Z'),
        last_seen_at: new Date('2026-10-19T10:00:00.000Z'),
        absolute_expires_at: new Date('2027-03-30T10:00:00.000Z'),
        revoked_at: null,
        revoked_reason: null,
        paired_by: {
          user_id: 'u-mom',
          name: 'María',
          paternal_last_name: 'Pérez',
        },
        ...over,
      });

      beforeEach(() => {
        mockPrismaService.users.findUnique.mockResolvedValue(actor);
        mockPrismaService.users.findFirst.mockResolvedValue(
          buildAdminDetailRecord(),
        );
      });

      it('a handle teen with a verified guardian: active login with the handle, who enabled it, and no devices', async () => {
        readerOf(['guardianship:read']);
        mockPrismaService.supervised_logins.findUnique.mockResolvedValue(
          loginRow(),
        );
        mockPrismaService.guardianships.findFirst.mockResolvedValue({
          guardianship_id: 'g-1',
        });

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.family_access).toEqual({
          supervision: 'active',
          supervised_login: {
            status: 'active',
            method: 'handle',
            login_handle: 'ana-7kq4m9xz',
            origin: 'guardian_enabled',
            enabled_at: new Date('2026-10-10T10:00:00.000Z'),
            enabled_by: { user_id: 'u-mom', display_name: 'María Pérez' },
            disabled_at: null,
            disabled_reason: null,
            password_set_by: 'guardian',
            pending_since: null,
          },
          linked_devices: [],
        });
        expect(
          mockPrismaService.supervised_logins.findUnique.mock.calls[0][0].where,
        ).toEqual({ user_id: 'user-1' });
        // Consent: verified, not seeded test data, not revoked (custody counts).
        expect(
          mockPrismaService.guardianships.findFirst.mock.calls[0][0].where,
        ).toEqual({
          dependent_user_id: 'user-1',
          consent_status: 'verified',
          is_test_data: false,
          revoked_at: null,
        });
      });

      it('a self-registered email teen with no verified guardian: pending_guardian, no handle, nobody enabled it', async () => {
        readerOf(['guardianship:read']);
        mockPrismaService.supervised_logins.findUnique.mockResolvedValue(
          loginRow({
            method: 'email',
            login_handle: null,
            origin: 'self_registered',
            enabled_at: null,
            enabled_by: null,
            password_set_by: 'self',
            pending_since: new Date('2026-10-01T00:00:00.000Z'),
          }),
        );

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.family_access?.supervision).toBe('pending_guardian');
        expect(result.family_access?.supervised_login).toEqual(
          expect.objectContaining({
            status: 'pending_guardian',
            method: 'email',
            login_handle: null,
            origin: 'self_registered',
            enabled_by: null,
            pending_since: new Date('2026-10-01T00:00:00.000Z'),
          }),
        );
      });

      it('a disabled login reads as disabled with the reason and keeps the supervision state', async () => {
        readerOf(['guardianship:read']);
        mockPrismaService.supervised_logins.findUnique.mockResolvedValue(
          loginRow({
            disabled_at: new Date('2026-10-18T10:00:00.000Z'),
            disabled_reason: 'admin',
          }),
        );
        mockPrismaService.guardianships.findFirst.mockResolvedValue({
          guardianship_id: 'g-1',
        });

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.family_access?.supervision).toBe('active');
        expect(result.family_access?.supervised_login).toEqual(
          expect.objectContaining({
            status: 'disabled',
            disabled_at: new Date('2026-10-18T10:00:00.000Z'),
            disabled_reason: 'admin',
          }),
        );
      });

      it('lists the devices of a child with the pairer, expiry and recent revokes (30 days)', async () => {
        readerOf(['guardianship:read']);
        mockPrismaService.linked_devices.findMany.mockResolvedValue([
          deviceRow(),
          deviceRow({
            linked_device_id: 'dev-2',
            label: 'Teléfono viejo',
            platform: 'ios',
            app_version: null,
            last_seen_at: null,
            revoked_at: new Date('2026-10-15T10:00:00.000Z'),
            revoked_reason: 'guardian',
          }),
        ]);

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.family_access?.supervision).toBeNull();
        expect(result.family_access?.supervised_login).toBeNull();
        expect(result.family_access?.linked_devices).toEqual([
          {
            linked_device_id: 'dev-1',
            label: 'Tablet de Ana',
            platform: 'android',
            app_version: '2.4.0',
            status: 'active',
            paired_by: { user_id: 'u-mom', display_name: 'María Pérez' },
            paired_at: new Date('2026-10-01T10:00:00.000Z'),
            last_seen_at: new Date('2026-10-19T10:00:00.000Z'),
            absolute_expires_at: new Date('2027-03-30T10:00:00.000Z'),
            revoked_at: null,
            revoked_reason: null,
          },
          expect.objectContaining({
            linked_device_id: 'dev-2',
            platform: 'ios',
            app_version: null,
            last_seen_at: null,
            status: 'revoked',
            revoked_at: new Date('2026-10-15T10:00:00.000Z'),
            revoked_reason: 'guardian',
          }),
        ]);
        const where =
          mockPrismaService.linked_devices.findMany.mock.calls[0][0].where;
        expect(where.dependent_user_id).toBe('user-1');
        expect(where.OR).toEqual([
          { revoked_at: null },
          { revoked_at: { gte: expect.any(Date) } },
        ]);
      });

      it('a user with neither login nor devices still gets the (empty) block when the reader may see it', async () => {
        readerOf(['guardianship:read']);

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.family_access).toEqual({
          supervision: null,
          supervised_login: null,
          linked_devices: [],
        });
        // No login: no need to look for a verified guardian.
        expect(
          mockPrismaService.guardianships.findFirst,
        ).not.toHaveBeenCalled();
      });

      it('is also exposed to the transitional users:read_detail readers', async () => {
        readerOf(['users:read_detail']);
        mockPrismaService.supervised_logins.findUnique.mockResolvedValue(
          loginRow(),
        );

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.family_access?.supervised_login?.login_handle).toBe(
          'ana-7kq4m9xz',
        );
      });

      it.each([['health:read'], ['emergency_contacts:read'], ['users:read']])(
        'is null, with the handle never read, for a reader without the guardianship family (%s)',
        async (permission) => {
          readerOf([permission]);
          mockPrismaService.supervised_logins.findUnique.mockResolvedValue(
            loginRow(),
          );
          mockPrismaService.linked_devices.findMany.mockResolvedValue([
            deviceRow(),
          ]);

          const result = await service.getUserById('actor-admin', 'user-1');

          expect(result.family_access).toBeNull();
          expect(
            mockPrismaService.supervised_logins.findUnique,
          ).not.toHaveBeenCalled();
          expect(
            mockPrismaService.linked_devices.findMany,
          ).not.toHaveBeenCalled();
          expect(JSON.stringify(result)).not.toContain('ana-7kq4m9xz');
        },
      );
    });

    it('should map operational and trajectory sources with legacy classes alias', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
          permissions: ['users:read_detail'],
        }),
      );

      const userRecord = buildAdminDetailRecord();
      userRecord.enrollments = [buildTrajectoryClass()];
      mockPrismaService.users.findFirst.mockResolvedValue(userRecord);

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        buildEnrollmentCandidate(9001),
      ]);

      const result = await service.getUserById('actor-super', 'user-1');

      expect(mockPrismaService.enrollments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: 'user-1',
            ecclesiastical_year_id: 2026,
            active: true,
            record_kind: 'OPERATIONAL',
          }),
        }),
      );
      expect(result.current_operational_enrollment).toEqual(
        expect.objectContaining({
          enrollment_id: 9001,
          ecclesiastical_year_id: 2026,
          class_id: 7,
          class_name: 'Amigo',
        }),
      );
      expect(result.current_cross_type_enrollment).toBeNull();
      expect(result.trajectory_classes).toEqual([
        {
          enrollment_id: 55,
          class_id: 9,
          class_name: 'Explorador',
          ecclesiastical_year_id: 2026,
          advanced: false,
          current_class: true,
          investiture_status: 'IN_PROGRESS',
          enrollment_date: new Date('2026-01-10T00:00:00.000Z'),
        },
      ]);
      expect(result.classes).toEqual(result.trajectory_classes);
    });

    it('should return null operational enrollment when active year has no enrollment candidates', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
          permissions: ['users:read_detail'],
        }),
      );

      const userRecord = buildAdminDetailRecord();
      userRecord.enrollments = [buildTrajectoryClass()];
      mockPrismaService.users.findFirst.mockResolvedValue(userRecord);

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([]);

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.current_operational_enrollment).toBeNull();
      expect(result.trajectory_classes).toHaveLength(1);
      expect(result.classes).toEqual(result.trajectory_classes);
    });

    it('should return trajectory item with null class_name when linked class metadata is missing', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
          permissions: ['users:read_detail'],
        }),
      );

      const userRecord = buildAdminDetailRecord();
      userRecord.enrollments = [
        {
          ...buildTrajectoryClass(),
          classes: null,
        },
      ];
      mockPrismaService.users.findFirst.mockResolvedValue(userRecord);

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.current_operational_enrollment).toBeNull();
      expect(result.trajectory_classes[0]).toEqual(
        expect.objectContaining({
          class_name: null,
          class_id: 9,
        }),
      );
    });

    it('should return null operational enrollment and warn on enrollment conflicts', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
          permissions: ['users:read_detail'],
        }),
      );

      const userRecord = buildAdminDetailRecord();
      userRecord.enrollments = [buildTrajectoryClass()];
      mockPrismaService.users.findFirst.mockResolvedValue(userRecord);

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        buildEnrollmentCandidate(9001),
        buildEnrollmentCandidate(9002),
      ]);

      const warnSpy = jest
        .spyOn<any, any>(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.current_operational_enrollment).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'formative_read_model_conflict',
          userId: 'user-1',
          ecclesiasticalYearId: 2026,
          enrollmentIds: [9001, 9002],
          source: 'admin-user-detail',
        }),
      );

      warnSpy.mockRestore();
    });

    it('should keep both operational enrollments when one is cross-type', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
          permissions: ['users:read_detail'],
        }),
      );

      const userRecord = buildAdminDetailRecord();
      userRecord.enrollments = [buildTrajectoryClass()];
      mockPrismaService.users.findFirst.mockResolvedValue(userRecord);

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        buildEnrollmentCandidate(9001),
        {
          ...buildEnrollmentCandidate(9002),
          class_id: 1,
          cross_type_enrollment: true,
          classes: { name: 'Abejitas Laboriosas' },
        },
      ]);

      const warnSpy = jest
        .spyOn<any, any>(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.current_operational_enrollment).toMatchObject({
        enrollment_id: 9001,
        cross_type_enrollment: false,
      });
      expect(result.current_cross_type_enrollment).toMatchObject({
        enrollment_id: 9002,
        cross_type_enrollment: true,
        class_name: 'Abejitas Laboriosas',
      });
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('updateUserApproval', () => {
    it('should approve a user, clear rejection reason, and activate access', async () => {
      const expected = {
        user_id: 'user-1',
        approval_status: user_approval_status.approved,
        rejection_reason: null,
        active: true,
      };
      mockPrismaService.users.update.mockResolvedValue(expected);

      const result = await service.updateUserApproval('user-1', {
        approved: true,
      });

      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        data: {
          approval_status: user_approval_status.approved,
          rejection_reason: null,
          active: true,
        },
      });
      expect(result).toEqual(expected);
    });

    it('should reject a user, persist rejection reason, and deactivate access', async () => {
      const expected = {
        user_id: 'user-1',
        approval_status: user_approval_status.rejected,
        rejection_reason: 'Incomplete profile',
        active: false,
      };
      mockPrismaService.users.update.mockResolvedValue(expected);

      const result = await service.updateUserApproval('user-1', {
        approved: false,
        rejection_reason: 'Incomplete profile',
      });

      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        data: {
          approval_status: user_approval_status.rejected,
          rejection_reason: 'Incomplete profile',
          active: false,
        },
      });
      expect(result).toEqual(expected);
    });

    it('should flip a pending user to approved: sets approval_status=approved, active=true, rejection_reason=null', async () => {
      // Simulates the transition triggered by PATCH /admin/users/:id/approval
      // with { approved: true } — the canonical approval endpoint.
      const pendingUser = {
        user_id: 'pending-user',
        approval_status: user_approval_status.pending,
        rejection_reason: null,
        active: false,
      };
      const approvedUser = {
        ...pendingUser,
        approval_status: user_approval_status.approved,
        active: true,
      };
      mockPrismaService.users.update.mockResolvedValue(approvedUser);

      const result = await service.updateUserApproval(pendingUser.user_id, {
        approved: true,
      });

      // Verify the Prisma payload atomically updates both status + active
      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { user_id: 'pending-user' },
        data: {
          approval_status: user_approval_status.approved,
          rejection_reason: null,
          active: true,
        },
      });

      // Verify the returned record reflects the approved state
      expect(result.approval_status).toBe(user_approval_status.approved);
      expect(result.active).toBe(true);
      expect(result.rejection_reason).toBeNull();
    });

    it('should not pass legacy approval/approved fields to Prisma via updateUser', async () => {
      // Guards against clients that send { approval: 1, approved: true }
      // alongside approval_status — only known Prisma columns must be forwarded.
      const dto = {
        approval_status: user_approval_status.approved,
        active: true,
      };
      const expected = { user_id: 'user-1', ...dto };
      mockPrismaService.users.update.mockResolvedValue(expected);

      await service.updateUser('user-1', dto);

      const firstCallArg = mockPrismaService.users.update.mock.calls[0][0];
      const callData = (firstCallArg as { data: Record<string, unknown> }).data;

      // Prisma payload must NOT contain unknown fields
      expect(callData).not.toHaveProperty('approval');
      expect(callData).not.toHaveProperty('approved');
      expect(callData).toMatchObject({
        approval_status: user_approval_status.approved,
        active: true,
      });
    });
  });

  describe('updateUser', () => {
    it('should forward partial admin updates to prisma', async () => {
      const dto = {
        active: false,
        access_panel: true,
        approval_status: user_approval_status.approved,
      };
      const expected = { user_id: 'user-1', ...dto };
      mockPrismaService.users.update.mockResolvedValue(expected);

      const result = await service.updateUser('user-1', dto);

      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        data: dto,
      });
      expect(result).toEqual(expected);
    });
  });

  describe('createAdminUser', () => {
    const buildCreateDto = (
      overrides: Partial<CreateAdminUserDto> = {},
    ): CreateAdminUserDto => ({
      name: 'Juan',
      paternal_last_name: 'Pérez',
      maternal_last_name: 'García',
      email: 'juan.perez@example.com',
      role: 'director-lf',
      country_id: 1,
      union_id: 2,
      local_field_id: 10,
      ...overrides,
    });

    const adminActorRoles = [{ roles: { role_name: 'admin' } }];

    beforeEach(() => {
      // Default happy-path stubs
      mockPrismaService.users.findUnique
        // First call: email uniqueness check → not found
        .mockResolvedValueOnce(null)
        // Second call: actor's role resolution
        .mockResolvedValueOnce({ users_roles: adminActorRoles });

      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: 'role-uuid-lf',
        role_name: 'director-lf',
      });

      mockBetterAuthService.createUser.mockResolvedValue({
        user: { id: 'new-user-uuid', email: 'juan.perez@example.com' },
        session: {},
        accessToken: 'ignored',
      });

      // $transaction executes the array of operations
      mockPrismaService.$transaction.mockImplementation(
        (ops: Promise<unknown>[]) => Promise.all(ops),
      );
      mockPrismaService.users.update.mockResolvedValue({});
      mockPrismaService.users_roles.create.mockResolvedValue({});

      mockPrismaService.users_pr.createMany.mockResolvedValue({ count: 1 });
      mockPrismaService.users.delete.mockResolvedValue({});
      mockBetterAuthService.sendInvitation.mockResolvedValue({
        expiresAt: new Date(),
      });
    });

    it('should create user, assign role, send invite and return user_id + email + invite_email_sent=true', async () => {
      const dto = buildCreateDto();

      const result = await service.createAdminUser('actor-admin-uuid', dto);

      expect(result.user_id).toBe('new-user-uuid');
      expect(result.email).toBe('juan.perez@example.com');
      expect(result.invite_email_sent).toBe(true);

      expect(mockBetterAuthService.createUser).toHaveBeenCalledWith(
        'juan.perez@example.com',
        expect.any(String), // temp password — opaque
        'Juan Pérez García',
      );
      // S3.8 / R3.1: the 7-day invitation, never the 1-hour reset email.
      expect(mockBetterAuthService.sendInvitation).toHaveBeenCalledWith(
        'new-user-uuid',
      );
      expect(
        mockBetterAuthService.resetPasswordForEmail,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw ConflictException when email already exists', async () => {
      // Override: email uniqueness check finds existing user
      mockPrismaService.users.findUnique.mockReset();
      mockPrismaService.users.findUnique.mockResolvedValueOnce({
        user_id: 'existing-uuid',
      });

      await expect(
        service.createAdminUser('actor-admin-uuid', buildCreateDto()),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_EMAIL_ALREADY_IN_USE });

      expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when role does not exist in DB', async () => {
      mockPrismaService.roles.findFirst.mockResolvedValue(null);

      await expect(
        service.createAdminUser(
          'actor-admin-uuid',
          buildCreateDto({ role: 'nonexistent-role' }),
        ),
      ).rejects.toThrow();

      expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when assistant-lf tries to create admin role', async () => {
      // Override: email ok, actor is assistant-lf
      mockPrismaService.users.findUnique.mockReset();
      mockPrismaService.users.findUnique
        .mockResolvedValueOnce(null) // email not found
        .mockResolvedValueOnce({
          users_roles: [{ roles: { role_name: 'assistant-lf' } }],
        });

      await expect(
        service.createAdminUser(
          'actor-lf-uuid',
          buildCreateDto({ role: 'admin' }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });

      expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
    });

    it('should create user with invite_email_sent=false when EMAIL_ENABLED is not true', async () => {
      mockBetterAuthService.sendInvitation.mockRejectedValue(
        new ServiceUnavailableException('email disabled'),
      );

      const result = await service.createAdminUser(
        'actor-admin-uuid',
        buildCreateDto(),
      );

      expect(result.user_id).toBe('new-user-uuid');
      expect(result.invite_email_sent).toBe(false);
      // User must still be created and role assigned
      expect(mockBetterAuthService.createUser).toHaveBeenCalled();
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    describe('roles that require a Field', () => {
      beforeEach(() => {
        mockPrismaService.roles.findFirst.mockResolvedValue({
          role_id: 'role-uuid-pastor',
          role_name: 'pastor',
        });
      });

      it('S4.2 rejects a pastor without local_field_id with 400 before Better Auth runs', async () => {
        await expect(
          service.createAdminUser(
            'actor-admin-uuid',
            buildCreateDto({ role: 'pastor', local_field_id: undefined }),
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.ADMIN_USER_LOCAL_FIELD_REQUIRED,
          getStatus: expect.any(Function),
        });

        expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
        expect(mockPrismaService.users_pr.createMany).not.toHaveBeenCalled();
        expect(mockBetterAuthService.sendInvitation).not.toHaveBeenCalled();
      });

      it('answers with HTTP 400', async () => {
        const error = await service
          .createAdminUser(
            'actor-admin-uuid',
            buildCreateDto({ role: 'pastor', local_field_id: undefined }),
          )
          .catch((e: { getStatus(): number }) => e);
        expect(error.getStatus()).toBe(400);
      });

      it('S4.1 creates a pastor with a Field, with its users_pr row and the invitation', async () => {
        const result = await service.createAdminUser(
          'actor-admin-uuid',
          buildCreateDto({ role: 'pastor', local_field_id: 10 }),
        );

        expect(result).toEqual({
          user_id: 'new-user-uuid',
          email: 'juan.perez@example.com',
          invite_email_sent: true,
        });
        expect(mockPrismaService.users_pr.createMany).toHaveBeenCalledWith({
          data: [{ user_id: 'new-user-uuid' }],
          skipDuplicates: true,
        });
        expect(mockBetterAuthService.sendInvitation).toHaveBeenCalledWith(
          'new-user-uuid',
        );
      });

      it('S4.5 keeps the Field optional for a coordinator', async () => {
        mockPrismaService.roles.findFirst.mockResolvedValue({
          role_id: 'role-uuid-coordinator',
          role_name: 'coordinator',
        });

        await expect(
          service.createAdminUser(
            'actor-admin-uuid',
            buildCreateDto({ role: 'coordinator', local_field_id: undefined }),
          ),
        ).resolves.toMatchObject({ user_id: 'new-user-uuid' });
      });
    });

    it('R4.5 creates the users_pr row in the same transaction as profile and role', async () => {
      const calls: string[] = [];
      mockPrismaService.users.update.mockImplementation(() => {
        calls.push('users.update');
        return Promise.resolve({});
      });
      mockPrismaService.users_roles.create.mockImplementation(() => {
        calls.push('users_roles.create');
        return Promise.resolve({});
      });
      mockPrismaService.users_pr.createMany.mockImplementation(() => {
        calls.push('users_pr.createMany');
        return Promise.resolve({ count: 1 });
      });
      mockPrismaService.$transaction.mockImplementation(
        (ops: Promise<unknown>[]) => {
          expect(ops).toHaveLength(3); // the three writes ARE the transaction
          return Promise.all(ops);
        },
      );

      await service.createAdminUser('actor-admin-uuid', buildCreateDto());

      expect(calls).toEqual([
        'users.update',
        'users_roles.create',
        'users_pr.createMany',
      ]);
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it('S4.6 rolls back and discards the new user when the users_pr insert fails', async () => {
      mockPrismaService.users_pr.createMany.mockRejectedValue(
        new Error('users_pr insert failed'),
      );
      // A real transaction would roll back the profile and role writes.
      mockPrismaService.$transaction.mockImplementation(
        async (ops: Promise<unknown>[]) => {
          const settled = await Promise.allSettled(ops);
          const failed = settled.find((r) => r.status === 'rejected');
          if (failed) throw failed.reason;
          return settled;
        },
      );

      await expect(
        service.createAdminUser('actor-admin-uuid', buildCreateDto()),
      ).rejects.toThrow('users_pr insert failed');

      expect(mockPrismaService.users.delete).toHaveBeenCalledWith({
        where: { user_id: 'new-user-uuid' },
      });
      expect(mockBetterAuthService.sendInvitation).not.toHaveBeenCalled();
    });

    it('S4.6 still surfaces the original error when the cleanup itself fails', async () => {
      mockPrismaService.$transaction.mockRejectedValue(
        new Error('users_pr insert failed'),
      );
      mockPrismaService.users.delete.mockRejectedValue(new Error('cleanup'));

      await expect(
        service.createAdminUser('actor-admin-uuid', buildCreateDto()),
      ).rejects.toThrow('users_pr insert failed');
    });

    it('should build full_name without maternal_last_name when absent', async () => {
      const dto = buildCreateDto({ maternal_last_name: undefined });

      await service.createAdminUser('actor-admin-uuid', dto);

      expect(mockBetterAuthService.createUser).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'Juan Pérez', // no trailing space, no extra segment
      );
    });
  });

  describe('invitation_pending in the detail (R3.15)', () => {
    const setup = () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({
          roles: ['super-admin'],
          permissions: ['users:read_detail'],
        }),
      );
      mockPrismaService.users.findFirst.mockResolvedValue(
        buildAdminDetailRecord(),
      );
    };

    it('is true while the account is not activated', async () => {
      setup();
      mockBetterAuthService.isAccountActivated.mockResolvedValue(false);

      const detail = await service.getUserById('actor-admin', 'user-1');

      expect(detail.invitation_pending).toBe(true);
      expect(mockBetterAuthService.isAccountActivated).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('is false once the email is verified or a social account exists', async () => {
      setup();
      mockBetterAuthService.isAccountActivated.mockResolvedValue(true);

      const detail = await service.getUserById('actor-admin', 'user-1');

      expect(detail.invitation_pending).toBe(false);
    });

    it.each([
      // active, email, activated, expected
      [true, 'user1@example.com', false, true],
      [true, 'user1@example.com', true, false],
      [true, null, false, false],
      [true, null, true, false],
      [false, 'user1@example.com', false, false],
      [false, 'user1@example.com', true, false],
      [false, null, false, false],
      [false, null, true, false],
    ])(
      'active=%s email=%s activated=%s -> invitation_pending=%s',
      async (active, email, activated, expected) => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          buildResolvedAuthorization({
            roles: ['super-admin'],
            permissions: ['users:read_detail'],
          }),
        );
        mockPrismaService.users.findFirst.mockResolvedValue({
          ...buildAdminDetailRecord(),
          active,
          email,
        });
        mockBetterAuthService.isAccountActivated.mockResolvedValue(activated);

        const detail = await service.getUserById('actor-admin', 'user-1');

        expect(detail.invitation_pending).toBe(expected);
      },
    );
  });

  describe('resendInvitation', () => {
    const ACTOR = 'actor-admin-uuid';
    const TARGET = 'target-user-uuid';

    beforeEach(() => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization({ roles: ['super-admin'] }),
      );
      // assertUserInActorScope: target is inside the actor scope.
      mockPrismaService.users.findFirst.mockResolvedValue({ user_id: TARGET });
      mockPrismaService.users.findUnique.mockImplementation(
        (args: { where: { user_id: string } }) =>
          Promise.resolve(
            args.where.user_id === ACTOR
              ? { users_roles: [{ roles: { role_name: 'admin' } }] }
              : {
                  email: 'target@example.com',
                  active: true,
                  users_roles: [{ roles: { role_name: 'pastor' } }],
                },
          ),
      );
      mockBetterAuthService.isAccountActivated.mockResolvedValue(false);
      mockBetterAuthService.getInvitationIssuedAt.mockResolvedValue(null);
      mockBetterAuthService.sendInvitation.mockResolvedValue({
        expiresAt: new Date('2026-12-01T00:00:00Z'),
      });
    });

    it('issues a new invitation and returns its expiry (R3.9)', async () => {
      await expect(service.resendInvitation(ACTOR, TARGET)).resolves.toEqual({
        user_id: TARGET,
        expires_at: new Date('2026-12-01T00:00:00Z'),
      });
      expect(mockBetterAuthService.sendInvitation).toHaveBeenCalledWith(TARGET);
    });

    it('S3.16 answers 404 for a user outside the actor scope or unknown, sending nothing', async () => {
      mockPrismaService.users.findFirst.mockResolvedValue(null);

      await expect(
        service.resendInvitation(ACTOR, TARGET),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_NOT_FOUND });
      expect(mockBetterAuthService.sendInvitation).not.toHaveBeenCalled();
    });

    it('S3.16 answers 403 when the actor cannot create the target role', async () => {
      mockPrismaService.users.findUnique.mockImplementation(
        (args: { where: { user_id: string } }) =>
          Promise.resolve(
            args.where.user_id === ACTOR
              ? { users_roles: [{ roles: { role_name: 'assistant-lf' } }] }
              : {
                  email: 'target@example.com',
                  active: true,
                  users_roles: [{ roles: { role_name: 'admin' } }],
                },
          ),
      );

      await expect(
        service.resendInvitation(ACTOR, TARGET),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      expect(mockBetterAuthService.sendInvitation).not.toHaveBeenCalled();
    });

    describe.each([
      ['has no email (minor or dependent)', { email: null, active: true }],
      ['is deactivated', { email: 'target@example.com', active: false }],
      ['has no email and is deactivated', { email: null, active: false }],
    ])('a target that %s', (_label, flags) => {
      beforeEach(() => {
        mockPrismaService.users.findUnique.mockImplementation(
          (args: { where: { user_id: string } }) =>
            Promise.resolve(
              args.where.user_id === ACTOR
                ? { users_roles: [{ roles: { role_name: 'admin' } }] }
                : {
                    ...flags,
                    users_roles: [{ roles: { role_name: 'pastor' } }],
                  },
            ),
        );
      });

      it('answers 400 NOT_APPLICABLE before checking activation or cooldown and issues nothing', async () => {
        const error = await service
          .resendInvitation(ACTOR, TARGET)
          .catch((e: { getStatus(): number; code: ErrorCode }) => e);

        expect(error.getStatus()).toBe(400);
        expect(error.code).toBe(ErrorCode.ADMIN_USER_INVITATION_NOT_APPLICABLE);
        expect(mockBetterAuthService.isAccountActivated).not.toHaveBeenCalled();
        expect(
          mockBetterAuthService.getInvitationIssuedAt,
        ).not.toHaveBeenCalled();
        expect(mockBetterAuthService.sendInvitation).not.toHaveBeenCalled();
      });
    });

    it('still answers 403 before NOT_APPLICABLE when the actor cannot create the target role', async () => {
      mockPrismaService.users.findUnique.mockImplementation(
        (args: { where: { user_id: string } }) =>
          Promise.resolve(
            args.where.user_id === ACTOR
              ? { users_roles: [{ roles: { role_name: 'assistant-lf' } }] }
              : {
                  email: null,
                  active: false,
                  users_roles: [{ roles: { role_name: 'admin' } }],
                },
          ),
      );

      await expect(
        service.resendInvitation(ACTOR, TARGET),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    });

    it('S3.6 answers 409 for an already accepted invitation, with no email and no token change', async () => {
      mockBetterAuthService.isAccountActivated.mockResolvedValue(true);

      const error = await service
        .resendInvitation(ACTOR, TARGET)
        .catch((e: { getStatus(): number; code: ErrorCode }) => e);

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe(ErrorCode.ADMIN_USER_INVITATION_ALREADY_ACCEPTED);
      expect(mockBetterAuthService.sendInvitation).not.toHaveBeenCalled();
    });

    it('S3.7 answers 429 inside the 60 s cooldown and allows it afterwards', async () => {
      mockBetterAuthService.getInvitationIssuedAt.mockResolvedValue(
        new Date(Date.now() - 30_000),
      );
      const error = await service
        .resendInvitation(ACTOR, TARGET)
        .catch((e: { getStatus(): number; code: ErrorCode }) => e);
      expect(error.getStatus()).toBe(429);
      expect(error.code).toBe(ErrorCode.ADMIN_USER_INVITATION_COOLDOWN);
      expect(mockBetterAuthService.sendInvitation).not.toHaveBeenCalled();

      mockBetterAuthService.getInvitationIssuedAt.mockResolvedValue(
        new Date(Date.now() - 61_000),
      );
      await expect(
        service.resendInvitation(ACTOR, TARGET),
      ).resolves.toMatchObject({ user_id: TARGET });
    });

    it('S3.9 answers 503 with the unavailable code when email is disabled', async () => {
      mockBetterAuthService.sendInvitation.mockRejectedValue(
        new ServiceUnavailableException('email disabled'),
      );

      const error = await service
        .resendInvitation(ACTOR, TARGET)
        .catch((e: { getStatus(): number; code: ErrorCode }) => e);

      expect(error.getStatus()).toBe(503);
      expect(error.code).toBe(ErrorCode.ADMIN_USER_INVITATION_UNAVAILABLE);
    });

    it('rethrows unexpected failures untouched', async () => {
      mockBetterAuthService.sendInvitation.mockRejectedValue(new Error('boom'));

      await expect(service.resendInvitation(ACTOR, TARGET)).rejects.toThrow(
        'boom',
      );
    });
  });

  // ── bulkCreateAdminUsers ─────────────────────────────────────────────────────

  describe('bulkCreateAdminUsers', () => {
    // Builds a minimal valid xlsx buffer with given data rows.
    // Row 1 is always the standard headers.
    const buildXlsxBuffer = (
      dataRows: (string | number | null)[][],
    ): Buffer => {
      // Dynamic import not possible in Jest without async, so use require.

      const XLSX = require('xlsx') as typeof import('xlsx');
      const wb = XLSX.utils.book_new();
      const wsData = [
        [
          'email',
          'name',
          'paternal_last_name',
          'maternal_last_name',
          'role',
          'country_id',
          'union_id',
          'local_field_id',
        ],
        ...dataRows,
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Usuarios');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    };

    const XLSX_MIME =
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const adminActorRolesForBulk = [{ roles: { role_name: 'admin' } }];

    beforeEach(() => {
      // Default stubs that mirror createAdminUser happy-path
      mockPrismaService.users.findUnique
        .mockResolvedValue(null) // email not found (first call)
        .mockResolvedValueOnce({ users_roles: adminActorRolesForBulk }); // actor roles

      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: 'role-uuid',
        role_name: 'user',
      });

      mockBetterAuthService.createUser.mockResolvedValue({
        user: { id: 'new-uuid', email: 'test@example.com' },
        session: {},
        accessToken: 'ignored',
      });

      mockPrismaService.$transaction.mockImplementation(
        (ops: Promise<unknown>[]) => Promise.all(ops),
      );
      mockPrismaService.users.update.mockResolvedValue({});
      mockPrismaService.users_roles.create.mockResolvedValue({});
      mockPrismaService.users_pr.createMany.mockResolvedValue({ count: 1 });
      mockBetterAuthService.sendInvitation.mockResolvedValue({
        expiresAt: new Date(),
      });
    });

    it('happy path: 3 rows, all succeed', async () => {
      // Provide sequential stubs: each row calls findUnique twice
      // (email check + actor lookup) and creates a user.
      mockPrismaService.users.findUnique.mockReset();
      mockBetterAuthService.createUser.mockReset();

      // Row 1
      mockPrismaService.users.findUnique.mockResolvedValueOnce(null); // email not found
      mockPrismaService.users.findUnique.mockResolvedValueOnce({
        users_roles: adminActorRolesForBulk,
      }); // actor
      mockBetterAuthService.createUser.mockResolvedValueOnce({
        user: { id: 'uid-1', email: 'a@x.com' },
        session: {},
      });

      // Row 2
      mockPrismaService.users.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.users.findUnique.mockResolvedValueOnce({
        users_roles: adminActorRolesForBulk,
      });
      mockBetterAuthService.createUser.mockResolvedValueOnce({
        user: { id: 'uid-2', email: 'b@x.com' },
        session: {},
      });

      // Row 3
      mockPrismaService.users.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.users.findUnique.mockResolvedValueOnce({
        users_roles: adminActorRolesForBulk,
      });
      mockBetterAuthService.createUser.mockResolvedValueOnce({
        user: { id: 'uid-3', email: 'c@x.com' },
        session: {},
      });

      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: 'r1',
        role_name: 'user',
      });

      const buffer = buildXlsxBuffer([
        ['a@x.com', 'Ana', 'Lopez', '', 'user', 1, 12, 34],
        ['b@x.com', 'Bob', 'Smith', '', 'user', 1, 12, 34],
        ['c@x.com', 'Carlos', 'Torres', '', 'user', 1, 12, 34],
      ]);

      const result = await service.bulkCreateAdminUsers(
        'actor-admin-uuid',
        buffer,
        XLSX_MIME,
      );

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.results.every((r) => r.status === 'success')).toBe(true);
    });

    it('should mark second occurrence of same email as DUPLICATE_IN_FILE', async () => {
      mockPrismaService.users.findUnique.mockReset();
      mockBetterAuthService.createUser.mockReset();

      // Row 1 (duplicate@x.com — succeeds)
      mockPrismaService.users.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.users.findUnique.mockResolvedValueOnce({
        users_roles: adminActorRolesForBulk,
      });
      mockBetterAuthService.createUser.mockResolvedValueOnce({
        user: { id: 'uid-1', email: 'duplicate@x.com' },
        session: {},
      });

      // Row 2 (unique@x.com — succeeds)
      mockPrismaService.users.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.users.findUnique.mockResolvedValueOnce({
        users_roles: adminActorRolesForBulk,
      });
      mockBetterAuthService.createUser.mockResolvedValueOnce({
        user: { id: 'uid-2', email: 'unique@x.com' },
        session: {},
      });

      // Row 3 (duplicate@x.com again — should be caught before createAdminUser)

      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: 'r1',
        role_name: 'user',
      });

      const buffer = buildXlsxBuffer([
        ['duplicate@x.com', 'Ana', 'Lopez', '', 'user', '', '', ''],
        ['unique@x.com', 'Bob', 'Smith', '', 'user', '', '', ''],
        ['duplicate@x.com', 'Ana', 'Lopez2', '', 'user', '', '', ''],
      ]);

      const result = await service.bulkCreateAdminUsers(
        'actor-admin-uuid',
        buffer,
        XLSX_MIME,
      );

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);

      const errorRow = result.results.find((r) => r.status === 'error');
      expect(errorRow?.error_code).toBe('DUPLICATE_IN_FILE');
      expect(errorRow?.row).toBe(4); // row 4 in the file (1 header + 3 data → row index 2+2)
    });

    it('should map AppConflictException(AUTH_EMAIL_ALREADY_IN_USE) to EMAIL_ALREADY_IN_USE error_code', async () => {
      mockPrismaService.users.findUnique.mockReset();
      mockBetterAuthService.createUser.mockReset();

      // Simulate createAdminUser throwing conflict
      mockPrismaService.users.findUnique.mockResolvedValueOnce({
        user_id: 'existing',
      }); // email already exists

      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: 'r1',
        role_name: 'user',
      });

      const buffer = buildXlsxBuffer([
        ['existing@x.com', 'Ana', 'Lopez', '', 'user', '', '', ''],
      ]);

      const result = await service.bulkCreateAdminUsers(
        'actor-admin-uuid',
        buffer,
        XLSX_MIME,
      );

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0].error_code).toBe('EMAIL_ALREADY_IN_USE');
    });

    it('S4.3 reports a pastor row without local_field_id and still creates the other rows', async () => {
      mockPrismaService.users.findUnique.mockReset();
      mockBetterAuthService.createUser.mockReset();
      let n = 0;
      mockPrismaService.users.findUnique.mockImplementation(
        (args: { where: { email?: string } }) =>
          Promise.resolve(
            args.where.email ? null : { users_roles: adminActorRolesForBulk },
          ),
      );
      mockBetterAuthService.createUser.mockImplementation(() => {
        n += 1;
        return Promise.resolve({ user: { id: `uid-${n}` }, session: {} });
      });
      mockPrismaService.roles.findFirst.mockImplementation(
        (args: { where: { role_name: string } }) =>
          Promise.resolve({
            role_id: `r-${args.where.role_name}`,
            role_name: args.where.role_name,
          }),
      );

      const buffer = buildXlsxBuffer([
        ['a@x.com', 'Ana', 'Lopez', '', 'user', 1, 12, 34],
        ['b@x.com', 'Bob', 'Smith', '', 'user', 1, 12, 34],
        ['c@x.com', 'Carlos', 'Torres', '', 'user', 1, 12, 34],
        ['bad@x.com', 'Pastor', 'Sin Campo', '', 'pastor', 1, 12, ''],
        ['ok@x.com', 'Pastor', 'Con Campo', '', 'pastor', 1, 12, 34],
      ]);

      const result = await service.bulkCreateAdminUsers(
        'actor-admin-uuid',
        buffer,
        XLSX_MIME,
      );

      expect(result.total).toBe(5);
      expect(result.succeeded).toBe(4);
      expect(result.failed).toBe(1);
      const bad = result.results.find((r) => r.email === 'bad@x.com');
      expect(bad).toMatchObject({
        row: 5,
        status: 'error',
        error_code: 'LOCAL_FIELD_REQUIRED',
      });
      expect(result.results.filter((r) => r.status === 'success')).toHaveLength(
        4,
      );
      expect(mockBetterAuthService.createUser).toHaveBeenCalledTimes(4);
    });

    it('S4.4 reports every row when all are pastors without local_field_id and creates none', async () => {
      mockPrismaService.users.findUnique.mockReset();
      mockBetterAuthService.createUser.mockReset();

      const buffer = buildXlsxBuffer([
        ['p1@x.com', 'Uno', 'Pastor', '', 'pastor', 1, 12, ''],
        ['p2@x.com', 'Dos', 'Pastor', '', 'pastor', 1, 12, ''],
      ]);

      const result = await service.bulkCreateAdminUsers(
        'actor-admin-uuid',
        buffer,
        XLSX_MIME,
      );

      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.results.map((r) => r.error_code)).toEqual([
        'LOCAL_FIELD_REQUIRED',
        'LOCAL_FIELD_REQUIRED',
      ]);
      expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
    });

    it('maps the single-create rejection to the row-level code too', async () => {
      mockPrismaService.users.findUnique.mockReset();
      mockBetterAuthService.createUser.mockReset();
      const spy = jest
        .spyOn(service, 'createAdminUser')
        .mockRejectedValue(
          new AppBadRequestException(ErrorCode.ADMIN_USER_LOCAL_FIELD_REQUIRED),
        );

      const result = await service.bulkCreateAdminUsers(
        'actor-admin-uuid',
        buildXlsxBuffer([['p1@x.com', 'Uno', 'Pastor', '', 'user', 1, 12, 34]]),
        XLSX_MIME,
      );

      expect(result.results[0].error_code).toBe('LOCAL_FIELD_REQUIRED');
      spy.mockRestore();
    });

    it('adds requiere_campo_local to the "Roles permitidos" template sheet', async () => {
      mockPrismaService.users.findUnique.mockReset();
      mockPrismaService.users.findUnique.mockResolvedValue({
        users_roles: adminActorRolesForBulk,
      });

      const buffer = await service.getBulkTemplateBuffer('actor-admin-uuid');

      const XLSX = require('xlsx') as typeof import('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
        wb.Sheets['Roles permitidos'],
      );
      expect(Object.keys(rows[0])).toEqual([
        'slug',
        'etiqueta',
        'requiere_campo_local',
      ]);
      const bySlug = Object.fromEntries(
        rows.map((r) => [r.slug, r.requiere_campo_local]),
      );
      expect(bySlug['pastor']).toBe('si');
      expect(bySlug['coordinator']).toBe('no');
      expect(bySlug['user']).toBe('no');
    });

    it('should throw AppBadRequestException when file has more than 500 rows', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => [
        `user${i}@x.com`,
        'Test',
        'User',
        '',
        'user',
        '',
        '',
        '',
      ]);
      const buffer = buildXlsxBuffer(rows);

      await expect(
        service.bulkCreateAdminUsers('actor-admin-uuid', buffer, XLSX_MIME),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_BULK_TOO_MANY_ROWS });
    });
  });
});

function definedHealth() {
  return {
    blood: 'A_POSITIVE',
    allergies: [{ allergy_id: 1, name: 'Peanuts' }],
    diseases: [{ disease_id: 2, name: 'Asthma' }],
    medicines: [{ medicine_id: 3, name: 'Salbutamol' }],
  };
}

function definedPostRegistration() {
  return {
    complete: false,
    profile_picture_complete: true,
    personal_info_complete: false,
    club_selection_complete: false,
    date_completed: null,
  };
}
