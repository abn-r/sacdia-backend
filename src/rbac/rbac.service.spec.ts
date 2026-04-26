import { Test, TestingModule } from '@nestjs/testing';
import { RbacService } from './rbac.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { CreateRoleDto, RoleCategoryEnum } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ErrorCode } from '../common/errors/error-codes';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PERMISSION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PERMISSION_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ROLE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ROLE_PERMISSION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const basePermission = {
  permission_id: PERMISSION_ID,
  permission_name: 'users:read',
  description: 'Ver usuarios',
  active: true,
  created_at: new Date('2025-01-01'),
  modified_at: new Date('2025-01-01'),
};

const basePermission2 = {
  permission_id: PERMISSION_ID_2,
  permission_name: 'users:write',
  description: 'Escribir usuarios',
  active: true,
  created_at: new Date('2025-01-01'),
  modified_at: new Date('2025-01-01'),
};

const baseRole = {
  role_id: ROLE_ID,
  role_name: 'admin',
  description: 'Administrador del sistema con acceso completo',
  role_category: 'GLOBAL',
  active: true,
  created_at: new Date('2025-01-01'),
  modified_at: new Date('2025-01-01'),
};

const superAdminRole = {
  role_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  role_name: 'super_admin',
  description: 'Super administrador con control total del sistema',
  role_category: 'GLOBAL',
  active: true,
  created_at: new Date('2025-01-01'),
  modified_at: new Date('2025-01-01'),
};

const baseRoleWithPermissions = {
  ...baseRole,
  role_permissions: [
    {
      role_permission_id: ROLE_PERMISSION_ID,
      role_id: ROLE_ID,
      permission_id: PERMISSION_ID,
      active: true,
      permissions: {
        permission_id: PERMISSION_ID,
        permission_name: 'users:read',
        description: 'Ver usuarios',
      },
    },
  ],
};

const baseRolePermissionRecord = {
  role_permission_id: ROLE_PERMISSION_ID,
  role_id: ROLE_ID,
  permission_id: PERMISSION_ID,
  active: true,
};

// ─── Mock PrismaService ────────────────────────────────────────────────────────

const mockPrismaService = {
  permissions: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  roles: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  role_permissions: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  users_roles: {
    count: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  // Prisma interactive transaction mock: executes callback with a tx proxy
  $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    // Pass a tx object that delegates to the same mocks
    const txProxy = {
      roles: mockPrismaService.roles,
      role_permissions: mockPrismaService.role_permissions,
    };
    return fn(txProxy);
  }),
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('RbacService', () => {
  let service: RbacService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: AuthorizationContextService,
          useValue: { invalidateUserAuthorizationCache: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<RbacService>(RbacService);
  });

  // ============================================================
  // listPermissions
  // ============================================================

  describe('listPermissions', () => {
    it('TC01 - returns all permissions ordered by name', async () => {
      mockPrismaService.permissions.findMany.mockResolvedValue([
        basePermission,
        basePermission2,
      ]);

      const result = await service.listPermissions();

      expect(result).toHaveLength(2);
      expect(mockPrismaService.permissions.findMany).toHaveBeenCalledWith({
        orderBy: { permission_name: 'asc' },
        take: 500,
      });
    });

    it('TC02 - returns empty array when no permissions exist', async () => {
      mockPrismaService.permissions.findMany.mockResolvedValue([]);

      const result = await service.listPermissions();

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // getPermissionById
  // ============================================================

  describe('getPermissionById', () => {
    it('TC03 - happy path: returns permission when found', async () => {
      mockPrismaService.permissions.findUnique.mockResolvedValue(
        basePermission,
      );

      const result = await service.getPermissionById(PERMISSION_ID);

      expect(result.permission_id).toBe(PERMISSION_ID);
      expect(result.permission_name).toBe('users:read');
    });

    it('TC04 - error: throws NotFoundException when permission not found', async () => {
      mockPrismaService.permissions.findUnique.mockResolvedValue(null);

      await expect(service.getPermissionById(PERMISSION_ID)).rejects.toMatchObject(
        { code: ErrorCode.RBAC_PERMISSION_NOT_FOUND },
      );
    });
  });

  // ============================================================
  // createPermission
  // ============================================================

  describe('createPermission', () => {
    const dto: CreatePermissionDto = {
      permission_name: 'users:read',
      description: 'Ver usuarios',
    };

    it('TC05 - happy path: creates permission when name is unique', async () => {
      mockPrismaService.permissions.findUnique.mockResolvedValue(null);
      mockPrismaService.permissions.create.mockResolvedValue(basePermission);

      const result = await service.createPermission(dto);

      expect(result.permission_name).toBe('users:read');
      expect(mockPrismaService.permissions.create).toHaveBeenCalledWith({
        data: {
          permission_name: 'users:read',
          description: 'Ver usuarios',
        },
      });
    });

    it('TC06 - error: throws ConflictException when name already exists', async () => {
      mockPrismaService.permissions.findUnique.mockResolvedValue(
        basePermission,
      );

      await expect(service.createPermission(dto)).rejects.toMatchObject(
        { code: ErrorCode.RBAC_PERMISSION_NAME_CONFLICT },
      );
      expect(mockPrismaService.permissions.create).not.toHaveBeenCalled();
    });

    it('TC07 - creates permission with null description when not provided', async () => {
      const dtoNoDesc: CreatePermissionDto = { permission_name: 'clubs:read' };
      const permNoDesc = {
        ...basePermission,
        permission_name: 'clubs:read',
        description: null,
      };

      mockPrismaService.permissions.findUnique.mockResolvedValue(null);
      mockPrismaService.permissions.create.mockResolvedValue(permNoDesc);

      const result = await service.createPermission(dtoNoDesc);

      expect(mockPrismaService.permissions.create).toHaveBeenCalledWith({
        data: { permission_name: 'clubs:read', description: null },
      });
      expect(result.description).toBeNull();
    });
  });

  // ============================================================
  // updatePermission
  // ============================================================

  describe('updatePermission', () => {
    it('TC08 - happy path: updates name and description', async () => {
      const dto: UpdatePermissionDto = {
        permission_name: 'users:list',
        description: 'Listar usuarios',
      };
      const updated = {
        ...basePermission,
        permission_name: 'users:list',
        description: 'Listar usuarios',
      };

      mockPrismaService.permissions.findUnique.mockResolvedValue(
        basePermission,
      );
      mockPrismaService.permissions.findFirst.mockResolvedValue(null);
      mockPrismaService.permissions.update.mockResolvedValue(updated);

      const result = await service.updatePermission(PERMISSION_ID, dto);

      expect(result.permission_name).toBe('users:list');
    });

    it('TC09 - error: throws NotFoundException when permission does not exist', async () => {
      mockPrismaService.permissions.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePermission(PERMISSION_ID, {
          permission_name: 'users:list',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.RBAC_PERMISSION_NOT_FOUND });
    });

    it('TC10 - error: throws ConflictException when new name already used by another permission', async () => {
      const conflict = { ...basePermission2, permission_name: 'users:list' };

      mockPrismaService.permissions.findUnique.mockResolvedValue(
        basePermission,
      );
      mockPrismaService.permissions.findFirst.mockResolvedValue(conflict);

      await expect(
        service.updatePermission(PERMISSION_ID, {
          permission_name: 'users:list',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.RBAC_PERMISSION_NAME_CONFLICT });
    });

    it('TC11 - skips name-conflict check when permission_name is not in dto', async () => {
      const dto: UpdatePermissionDto = { description: 'Nueva descripción' };
      const updated = { ...basePermission, description: 'Nueva descripción' };

      mockPrismaService.permissions.findUnique.mockResolvedValue(
        basePermission,
      );
      mockPrismaService.permissions.update.mockResolvedValue(updated);

      await service.updatePermission(PERMISSION_ID, dto);

      expect(mockPrismaService.permissions.findFirst).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // deletePermission
  // ============================================================

  describe('deletePermission', () => {
    it('TC12 - happy path: soft-deletes permission (sets active=false)', async () => {
      mockPrismaService.permissions.findUnique.mockResolvedValue(
        basePermission,
      );
      mockPrismaService.permissions.update.mockResolvedValue({
        ...basePermission,
        active: false,
      });

      const result = await service.deletePermission(PERMISSION_ID);

      expect(result).toEqual({ success: true, message: 'Permiso desactivado' });
      expect(mockPrismaService.permissions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { permission_id: PERMISSION_ID },
          data: expect.objectContaining({ active: false }),
        }),
      );
    });

    it('TC13 - error: throws NotFoundException when permission not found', async () => {
      mockPrismaService.permissions.findUnique.mockResolvedValue(null);

      await expect(service.deletePermission(PERMISSION_ID)).rejects.toMatchObject(
        { code: ErrorCode.RBAC_PERMISSION_NOT_FOUND },
      );
    });
  });

  // ============================================================
  // listRoles
  // ============================================================

  describe('listRoles', () => {
    it('TC14 - returns only active roles with their active permissions', async () => {
      mockPrismaService.roles.findMany.mockResolvedValue([
        baseRoleWithPermissions,
      ]);

      const result = await service.listRoles();

      expect(result).toHaveLength(1);
      expect(result[0].role_name).toBe('admin');
      expect(mockPrismaService.roles.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { active: true },
          orderBy: { role_name: 'asc' },
        }),
      );
    });

    it('TC15 - returns empty array when no active roles exist', async () => {
      mockPrismaService.roles.findMany.mockResolvedValue([]);

      const result = await service.listRoles();

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // getRoleWithPermissions
  // ============================================================

  describe('getRoleWithPermissions', () => {
    it('TC16 - happy path: returns role with its active permissions', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(
        baseRoleWithPermissions,
      );

      const result = await service.getRoleWithPermissions(ROLE_ID);

      expect(result.role_id).toBe(ROLE_ID);
      expect(result.role_permissions).toHaveLength(1);
    });

    it('TC17 - error: throws NotFoundException when role not found', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(null);

      await expect(service.getRoleWithPermissions(ROLE_ID)).rejects.toMatchObject(
        { code: ErrorCode.RBAC_ROLE_NOT_FOUND },
      );
    });
  });

  // ============================================================
  // assignPermissionsToRole
  // ============================================================

  describe('assignPermissionsToRole', () => {
    it('TC18 - happy path: creates new role-permission assignments', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);
      mockPrismaService.permissions.findMany.mockResolvedValue([
        basePermission,
        basePermission2,
      ]);
      // Both permissions have no existing assignment
      mockPrismaService.role_permissions.findFirst.mockResolvedValue(null);
      mockPrismaService.role_permissions.create.mockResolvedValue({});

      const result = await service.assignPermissionsToRole(ROLE_ID, [
        PERMISSION_ID,
        PERMISSION_ID_2,
      ]);

      expect(result.success).toBe(true);
      expect(result.created).toBe(2);
      expect(result.reactivated).toBe(0);
      expect(mockPrismaService.role_permissions.create).toHaveBeenCalledTimes(
        2,
      );
    });

    it('TC19 - reactivates previously deactivated assignment instead of creating duplicate', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);
      mockPrismaService.permissions.findMany.mockResolvedValue([
        basePermission,
      ]);
      // Existing inactive assignment
      mockPrismaService.role_permissions.findFirst.mockResolvedValue({
        ...baseRolePermissionRecord,
        active: false,
      });
      mockPrismaService.role_permissions.update.mockResolvedValue({
        ...baseRolePermissionRecord,
        active: true,
      });

      const result = await service.assignPermissionsToRole(ROLE_ID, [
        PERMISSION_ID,
      ]);

      expect(result.created).toBe(0);
      expect(result.reactivated).toBe(1);
      expect(mockPrismaService.role_permissions.create).not.toHaveBeenCalled();
    });

    it('TC20 - skips already active assignments (returns "existing")', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);
      mockPrismaService.permissions.findMany.mockResolvedValue([
        basePermission,
      ]);
      // Existing active assignment → skip
      mockPrismaService.role_permissions.findFirst.mockResolvedValue(
        baseRolePermissionRecord,
      );

      const result = await service.assignPermissionsToRole(ROLE_ID, [
        PERMISSION_ID,
      ]);

      expect(result.created).toBe(0);
      expect(result.reactivated).toBe(0);
      expect(mockPrismaService.role_permissions.create).not.toHaveBeenCalled();
      expect(mockPrismaService.role_permissions.update).not.toHaveBeenCalled();
    });

    it('TC21 - error: throws NotFoundException when role not found', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(null);

      await expect(
        service.assignPermissionsToRole(ROLE_ID, [PERMISSION_ID]),
      ).rejects.toMatchObject({ code: ErrorCode.RBAC_ROLE_NOT_FOUND });
    });

    it('TC22 - error: throws NotFoundException when one of the permissions does not exist', async () => {
      const MISSING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);
      // Only one permission found, but two were requested
      mockPrismaService.permissions.findMany.mockResolvedValue([
        basePermission,
      ]);

      await expect(
        service.assignPermissionsToRole(ROLE_ID, [PERMISSION_ID, MISSING_ID]),
      ).rejects.toMatchObject({ code: ErrorCode.RBAC_PERMISSIONS_NOT_FOUND });
    });
  });

  // ============================================================
  // removePermissionFromRole
  // ============================================================

  describe('removePermissionFromRole', () => {
    it('TC23 - happy path: soft-removes an active permission from role', async () => {
      mockPrismaService.role_permissions.findFirst.mockResolvedValue(
        baseRolePermissionRecord,
      );
      mockPrismaService.role_permissions.update.mockResolvedValue({
        ...baseRolePermissionRecord,
        active: false,
      });

      const result = await service.removePermissionFromRole(
        ROLE_ID,
        PERMISSION_ID,
      );

      expect(result).toEqual({
        success: true,
        message: 'Permiso removido del rol',
      });
      expect(mockPrismaService.role_permissions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role_permission_id: ROLE_PERMISSION_ID },
          data: expect.objectContaining({ active: false }),
        }),
      );
    });

    it('TC24 - error: throws NotFoundException when active assignment not found', async () => {
      mockPrismaService.role_permissions.findFirst.mockResolvedValue(null);

      await expect(
        service.removePermissionFromRole(ROLE_ID, PERMISSION_ID),
      ).rejects.toMatchObject({ code: ErrorCode.RBAC_ROLE_PERMISSION_NOT_FOUND });
    });
  });

  // ============================================================
  // listRoles (active filter)
  // ============================================================

  describe('listRoles — active filter', () => {
    it('TC-LR1 - default (no arg): queries only active roles', async () => {
      mockPrismaService.roles.findMany.mockResolvedValue([baseRoleWithPermissions]);

      await service.listRoles();

      expect(mockPrismaService.roles.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
    });

    it('TC-LR2 - active=false: queries only inactive roles', async () => {
      mockPrismaService.roles.findMany.mockResolvedValue([]);

      await service.listRoles(false);

      expect(mockPrismaService.roles.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: false } }),
      );
    });

    it('TC-LR3 - active=undefined: falls back to default (active=true) because undefined triggers JS default parameter', async () => {
      mockPrismaService.roles.findMany.mockResolvedValue([baseRoleWithPermissions]);

      await service.listRoles(undefined);

      // Explicit undefined triggers the default parameter value (true), same as calling listRoles()
      expect(mockPrismaService.roles.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
    });
  });

  // ============================================================
  // createRole
  // ============================================================

  describe('createRole', () => {
    const dto: CreateRoleDto = {
      role_name: 'club_treasurer',
      description: 'Rol encargado de la tesorería del club con acceso financiero',
      role_category: RoleCategoryEnum.CLUB,
    };

    it('TC-CR1 - happy path: creates role without permissions', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(null);
      mockPrismaService.roles.create.mockResolvedValue({
        ...baseRole,
        role_name: 'club_treasurer',
        role_id: ROLE_ID,
      });
      // Second findUnique in transaction (returns created role with permissions)
      mockPrismaService.roles.findUnique
        .mockResolvedValueOnce(null) // uniqueness check
        .mockResolvedValueOnce({ // tx findUnique after create
          ...baseRole,
          role_name: 'club_treasurer',
          role_permissions: [],
        });

      const result = await service.createRole(dto);

      expect(result!.role_name).toBe('club_treasurer');
      expect(mockPrismaService.roles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role_name: 'club_treasurer',
            description: dto.description,
            role_category: RoleCategoryEnum.CLUB,
          }),
        }),
      );
    });

    it('TC-CR2 - happy path: creates role with permission_ids', async () => {
      const dtoWithPerms: CreateRoleDto = {
        ...dto,
        permission_ids: [PERMISSION_ID],
      };

      mockPrismaService.roles.findUnique.mockResolvedValue(null);
      mockPrismaService.permissions.findMany.mockResolvedValue([basePermission]);
      mockPrismaService.roles.create.mockResolvedValue({ ...baseRole, role_name: 'club_treasurer' });
      mockPrismaService.role_permissions.createMany.mockResolvedValue({ count: 1 });
      mockPrismaService.roles.findUnique
        .mockResolvedValueOnce(null) // uniqueness check
        .mockResolvedValueOnce({ ...baseRole, role_name: 'club_treasurer', role_permissions: [] });

      await service.createRole(dtoWithPerms);

      expect(mockPrismaService.role_permissions.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ role_id: ROLE_ID, permission_id: PERMISSION_ID }],
        }),
      );
    });

    it('TC-CR3 - error: throws BadRequestException when role_name is "super_admin"', async () => {
      const reserved: CreateRoleDto = {
        ...dto,
        role_name: 'super_admin',
      };

      await expect(service.createRole(reserved)).rejects.toMatchObject(
        { code: ErrorCode.RBAC_ROLE_NAME_RESERVED },
      );
      expect(mockPrismaService.roles.findUnique).not.toHaveBeenCalled();
    });

    it('TC-CR4 - error: throws ConflictException when role_name already exists', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);

      await expect(service.createRole(dto)).rejects.toMatchObject({ code: ErrorCode.RBAC_ROLE_NAME_CONFLICT });
      expect(mockPrismaService.roles.create).not.toHaveBeenCalled();
    });

    it('TC-CR5 - error: throws NotFoundException when permission_id does not exist', async () => {
      const dtoWithBadPerm: CreateRoleDto = {
        ...dto,
        permission_ids: ['ffffffff-ffff-ffff-ffff-ffffffffffff'],
      };

      mockPrismaService.roles.findUnique.mockResolvedValue(null);
      mockPrismaService.permissions.findMany.mockResolvedValue([]); // no permissions found

      await expect(service.createRole(dtoWithBadPerm)).rejects.toMatchObject(
        { code: ErrorCode.RBAC_PERMISSIONS_NOT_FOUND },
      );
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('TC-CR6 - error: role_name pattern "super_admin" blocked even with different casing is still blocked at exact match', async () => {
      // Pattern validation happens at DTO layer (via @Matches), but service also blocks exact 'super_admin'
      await expect(
        service.createRole({ ...dto, role_name: 'super_admin' }),
      ).rejects.toMatchObject({ code: ErrorCode.RBAC_ROLE_NAME_RESERVED });
    });
  });

  // ============================================================
  // updateRole
  // ============================================================

  describe('updateRole', () => {
    it('TC-UR1 - happy path: updates description only', async () => {
      const updateDto: UpdateRoleDto = {
        description: 'Nueva descripción detallada del rol de administrador',
      };
      const updated = { ...baseRoleWithPermissions, description: updateDto.description };

      mockPrismaService.roles.findUnique
        .mockResolvedValueOnce(baseRole) // load check
        .mockResolvedValueOnce(updated); // final fetch
      mockPrismaService.roles.update.mockResolvedValue(updated);

      const result = await service.updateRole(ROLE_ID, updateDto);

      expect(mockPrismaService.roles.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role_id: ROLE_ID },
          data: expect.objectContaining({ description: updateDto.description }),
        }),
      );
      expect(result!.description).toBe(updateDto.description);
    });

    it('TC-UR2 - error: throws ForbiddenException when updating super_admin role', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(superAdminRole);

      await expect(
        service.updateRole(superAdminRole.role_id, { description: 'Cambio' }),
      ).rejects.toMatchObject({ code: ErrorCode.RBAC_ROLE_PROTECTED });
    });

    it('TC-UR3 - error: throws BadRequestException when body contains role_name', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);

      // Simulate caller sneaking role_name into the body (bypass DTO — raw object)
      const bodyWithName = { description: 'desc válida aquí hay más de diez chars', role_name: 'new_name' };

      await expect(service.updateRole(ROLE_ID, bodyWithName as UpdateRoleDto)).rejects.toMatchObject(
        { code: ErrorCode.RBAC_ROLE_NAME_IMMUTABLE },
      );
    });

    it('TC-UR4 - error: throws NotFoundException when role does not exist', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(null);

      await expect(
        service.updateRole(ROLE_ID, { description: 'Descripción válida completa aquí' }),
      ).rejects.toMatchObject({ code: ErrorCode.RBAC_ROLE_NOT_FOUND });
    });
  });

  // ============================================================
  // deactivateRole
  // ============================================================

  describe('deactivateRole', () => {
    it('TC-DR1 - happy path: soft-deletes role when no users assigned', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);
      mockPrismaService.users_roles.count.mockResolvedValue(0);
      mockPrismaService.roles.update.mockResolvedValue({ ...baseRole, active: false });

      const result = await service.deactivateRole(ROLE_ID);

      expect(result).toEqual({ success: true, role_id: ROLE_ID });
      expect(mockPrismaService.roles.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role_id: ROLE_ID },
          data: expect.objectContaining({ active: false }),
        }),
      );
    });

    it('TC-DR2 - error: throws ForbiddenException when role is super_admin', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(superAdminRole);

      await expect(service.deactivateRole(superAdminRole.role_id)).rejects.toMatchObject(
        { code: ErrorCode.RBAC_ROLE_PROTECTED },
      );
      expect(mockPrismaService.users_roles.count).not.toHaveBeenCalled();
    });

    it('TC-DR3 - error: throws AppConflictException when users are still assigned', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);
      mockPrismaService.users_roles.count.mockResolvedValue(3);

      await expect(service.deactivateRole(ROLE_ID)).rejects.toMatchObject(
        { code: ErrorCode.RBAC_ROLE_HAS_ASSIGNMENTS },
      );
      expect(mockPrismaService.roles.update).not.toHaveBeenCalled();
    });

    it('TC-DR4 - error: throws NotFoundException when role does not exist', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(null);

      await expect(service.deactivateRole(ROLE_ID)).rejects.toMatchObject({ code: ErrorCode.RBAC_ROLE_NOT_FOUND });
    });

    it('TC-DR5 - throws AppConflictException when exactly 1 user assigned', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);
      mockPrismaService.users_roles.count.mockResolvedValue(1);

      await expect(service.deactivateRole(ROLE_ID)).rejects.toMatchObject(
        { code: ErrorCode.RBAC_ROLE_HAS_ASSIGNMENTS },
      );
    });
  });

  describe('syncRolePermissions', () => {
    it('TC25 - happy path: adds new permissions and removes unlisted ones', async () => {
      // Current active: PERMISSION_ID. Desired: PERMISSION_ID_2
      const currentAssignments = [
        {
          ...baseRolePermissionRecord,
          role_permission_id: 'old-rp-id',
          permission_id: PERMISSION_ID,
        },
      ];

      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);
      mockPrismaService.role_permissions.findMany.mockResolvedValue(
        currentAssignments,
      );
      mockPrismaService.role_permissions.updateMany.mockResolvedValue({
        count: 1,
      });

      // assignPermissionsToRole will be called internally for the new permission
      mockPrismaService.permissions.findMany.mockResolvedValue([
        basePermission2,
      ]);
      mockPrismaService.role_permissions.findFirst.mockResolvedValue(null);
      mockPrismaService.role_permissions.create.mockResolvedValue({});

      const result = await service.syncRolePermissions(ROLE_ID, [
        PERMISSION_ID_2,
      ]);

      expect(result.success).toBe(true);
      expect(result.added).toBe(1);
      expect(result.removed).toBe(1);
      expect(
        mockPrismaService.role_permissions.updateMany,
      ).toHaveBeenCalledTimes(1);
    });

    it('TC26 - no-op: returns zero added/removed when permissions already match', async () => {
      const currentAssignments = [
        { ...baseRolePermissionRecord, permission_id: PERMISSION_ID },
      ];

      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);
      mockPrismaService.role_permissions.findMany.mockResolvedValue(
        currentAssignments,
      );

      const result = await service.syncRolePermissions(ROLE_ID, [
        PERMISSION_ID,
      ]);

      expect(result.added).toBe(0);
      expect(result.removed).toBe(0);
      expect(
        mockPrismaService.role_permissions.updateMany,
      ).not.toHaveBeenCalled();
    });

    it('TC27 - error: throws NotFoundException when role not found', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue(null);

      await expect(
        service.syncRolePermissions(ROLE_ID, [PERMISSION_ID]),
      ).rejects.toMatchObject({ code: ErrorCode.RBAC_ROLE_NOT_FOUND });
    });

    it('TC28 - removes all current permissions when desired list is empty', async () => {
      const currentAssignments = [
        { ...baseRolePermissionRecord, permission_id: PERMISSION_ID },
      ];

      mockPrismaService.roles.findUnique.mockResolvedValue(baseRole);
      mockPrismaService.role_permissions.findMany.mockResolvedValue(
        currentAssignments,
      );
      mockPrismaService.role_permissions.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.syncRolePermissions(ROLE_ID, []);

      expect(result.removed).toBe(1);
      expect(result.added).toBe(0);
    });
  });
});
