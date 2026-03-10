import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(async (_bucket: unknown, value: string) => value),
  };

  const mockAuthorizationContextService = {
    resolveUserAuthorization: jest.fn(),
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
      ],
    }).compile();

    service = module.get<AdminUsersService>(AdminUsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const buildResolvedAuthorization = (globalPermissions: string[]) => ({
    profile: {},
    post_register_complete: false,
    authorization: {
      grants: {
        global_roles: [
          {
            role_name: 'admin',
            permissions: globalPermissions,
            scope: {},
          },
        ],
        club_assignments: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        permissions: globalPermissions,
        scope: {
          global: {},
          club: null,
        },
      },
    },
    legacy: {
      roles: ['admin'],
      permissions: globalPermissions,
      club: null,
      club_context: {
        active_assignment_id: null,
        active: null,
        available: [],
      },
    },
  });

  const buildAdminDetailRecord = () => ({
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
    users_pr: [
      {
        complete: false,
        profile_picture_complete: true,
        personal_info_complete: false,
        club_selection_complete: false,
        date_completed: null,
      },
    ],
    users_classes: [],
    club_role_assignments: [],
    emergency_contact: [
      {
        emergency_id: 91,
        name: 'Ana Tutor',
        phone: '555-1111',
        primary: true,
        relationship_type_id: 4,
      },
    ],
    legal_representative: {
      id: 41,
      representative_user_id: null,
      relationship_type_id: 8,
      name: 'Carlos',
      paternal_last_name: 'Tutor',
      maternal_last_name: 'Perez',
      phone: '555-2222',
    },
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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listUsers', () => {
    it('should allow super_admin with ALL scope', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-super',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'super_admin' } }],
      });
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

      const result = await service.listUsers('actor-super', {
        page: 1,
        limit: 20,
      } as any);

      expect(result.meta.scope.type).toBe('ALL');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].user_image).toBe(
        'https://cdn.example.com/users/u1.jpg',
      );
      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });

    it('should enforce UNION scope for admin with union_id', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-admin',
        union_id: 7,
        local_field_id: 99,
        users_roles: [{ roles: { role_name: 'admin' } }],
      });
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers('actor-admin', {
        page: 1,
        limit: 20,
      } as any);

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { union_id: 7 },
        }),
      );
    });

    it('should enforce LOCAL_FIELD scope for coordinator', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-coordinator',
        union_id: 5,
        local_field_id: 11,
        users_roles: [{ roles: { role_name: 'coordinator' } }],
      });
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers('actor-coordinator', {
        page: 1,
        limit: 20,
      } as any);

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { local_field_id: 11 },
        }),
      );
    });

    it('should reject admin without union_id/local_field_id', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-admin',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'admin' } }],
      });

      await expect(
        service.listUsers('actor-admin', {
          page: 1,
          limit: 20,
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject coordinator without local_field_id', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-coordinator',
        union_id: 5,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'coordinator' } }],
      });

      await expect(
        service.listUsers('actor-coordinator', {
          page: 1,
          limit: 20,
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should enforce UNION scope for assistant_admin with union_id', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-assistant-admin',
        union_id: 12,
        local_field_id: 44,
        users_roles: [{ roles: { role_name: 'assistant_admin' } }],
      });
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers('actor-assistant-admin', {
        page: 1,
        limit: 20,
      } as any);

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { union_id: 12 },
        }),
      );
    });

    it('should reject assistant_admin without union_id/local_field_id', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-assistant-admin',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'assistant_admin' } }],
      });

      await expect(
        service.listUsers('actor-assistant-admin', {
          page: 1,
          limit: 20,
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getUserById', () => {
    it('should return user detail in scope', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-super',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'super_admin' } }],
      });
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization(['users:read_detail']),
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
        users_classes: [],
        club_role_assignments: [],
        emergency_contact: [],
        legal_representative: null,
      });

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.user_id).toBe('user-1');
      expect(result.roles).toEqual(['user']);
      expect(result.scope.type).toBe('ALL');
    });

    it('should throw NotFoundException when user is outside scope', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-admin',
        union_id: 4,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'admin' } }],
      });
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization(['users:read_detail']),
      );
      mockPrismaService.users.findFirst.mockResolvedValue(null);

      await expect(
        service.getUserById('actor-admin', 'user-outside-scope'),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.users.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { user_id: 'user-outside-scope' },
              { union_id: 4 },
            ]),
          }),
        }),
      );
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
        mockPrismaService.users.findFirst.mockResolvedValue(buildAdminDetailRecord());
      });

      it.each([
        ['health', ['health:read'], 'health'],
        ['emergency_contacts', ['emergency_contacts:read'], 'emergency_contacts'],
        ['legal_representative', ['legal_representative:read'], 'legal_representative'],
        ['post_registration', ['post_registration:read'], 'post_registration'],
      ])(
        'should expose only %s block for fine-grained readers',
        async (_family, permissions, visibleBlock) => {
          mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
            buildResolvedAuthorization(permissions),
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
          expect(result.legal_representative).toEqual(
            visibleBlock === 'legal_representative'
              ? buildAdminDetailRecord().legal_representative
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
          buildResolvedAuthorization(['users:read_detail']),
        );

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.health).toEqual(definedHealth());
        expect(result.emergency_contacts).toEqual(
          buildAdminDetailRecord().emergency_contact,
        );
        expect(result.legal_representative).toEqual(
          buildAdminDetailRecord().legal_representative,
        );
        expect(result.post_registration).toEqual(definedPostRegistration());
      });

      it('should prune sensitive blocks when actor lacks fine and legacy detail permissions', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          buildResolvedAuthorization(['users:read']),
        );

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.health).toBeNull();
        expect(result.emergency_contacts).toBeNull();
        expect(result.legal_representative).toBeNull();
        expect(result.post_registration).toBeNull();
      });
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
