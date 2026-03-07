import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
      ],
    }).compile();

    service = module.get<AdminUsersService>(AdminUsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
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
  });
});
