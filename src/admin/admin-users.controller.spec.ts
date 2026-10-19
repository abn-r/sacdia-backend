import { Test, TestingModule } from '@nestjs/testing';
import { user_approval_status } from '@prisma/client';
import type { Request } from 'express';
import {
  AdminUsersController,
  USER_MANAGEMENT_ROLES,
} from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import {
  AUTHORIZATION_RESOURCE_KEY,
  GLOBAL_ROLES_KEY,
  PERMISSIONS_KEY,
  SENSITIVE_USER_SUBRESOURCE_KEY,
} from '../common/decorators';
import { GuardianEvidenceService } from '../guardianships/guardian-evidence.service';
import {
  JwtAuthGuard,
  GlobalRolesGuard,
  PermissionsGuard,
} from '../common/guards';
import { AdminListUsersQueryDto, CreateAdminUserDto } from './dto';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;

  const mockAdminUsersService = {
    listUsers: jest.fn(),
    getUserById: jest.fn(),
    updateUserApproval: jest.fn(),
    updateUser: jest.fn(),
    createAdminUser: jest.fn(),
    assertUserInActorScope: jest.fn(),
  };
  const mockGuardianEvidence = { getForAdmin: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [
        {
          provide: AdminUsersService,
          useValue: mockAdminUsersService,
        },
        { provide: GuardianEvidenceService, useValue: mockGuardianEvidence },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(GlobalRolesGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<AdminUsersController>(AdminUsersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('authorization metadata', () => {
    const fieldRoles = [
      'director-lf',
      'assistant-lf',
      'director-union',
      'assistant-union',
      'director-dia',
      'assistant-dia',
    ];

    it('keeps the class-level admin fence', () => {
      expect(
        Reflect.getMetadata(GLOBAL_ROLES_KEY, AdminUsersController),
      ).toEqual(['admin', 'super-admin']);
    });

    it('opens list and detail reads to field-level roles (scope-trimmed in service)', () => {
      for (const handler of [
        AdminUsersController.prototype.listUsers,
        AdminUsersController.prototype.getUserById,
      ]) {
        const roles = Reflect.getMetadata(GLOBAL_ROLES_KEY, handler);
        expect(roles).toEqual([...USER_MANAGEMENT_ROLES]);
        expect(roles).toEqual(expect.arrayContaining(fieldRoles));
      }

      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          AdminUsersController.prototype.listUsers,
        ),
      ).toEqual({ permissions: ['users:read'], mode: 'all' });
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          AdminUsersController.prototype.getUserById,
        ),
      ).toEqual({ permissions: ['users:read_detail'], mode: 'all' });
    });

    it('uses the same role set for create, bulk create and bulk template', () => {
      for (const handler of [
        AdminUsersController.prototype.createUser,
        AdminUsersController.prototype.bulkCreateUsers,
        AdminUsersController.prototype.downloadBulkTemplate,
      ]) {
        expect(Reflect.getMetadata(GLOBAL_ROLES_KEY, handler)).toEqual([
          ...USER_MANAGEMENT_ROLES,
        ]);
      }
    });

    it('keeps administrative writes admin-only', () => {
      for (const handler of [
        AdminUsersController.prototype.updateUser,
        AdminUsersController.prototype.updateUserApproval,
      ]) {
        expect(Reflect.getMetadata(GLOBAL_ROLES_KEY, handler)).toBeUndefined();
      }
    });
  });

  describe('listUsers', () => {
    it('should delegate to service with actor id from JWT and query filters', async () => {
      const req = { user: { sub: 'actor-1' } } as Request & {
        user: { sub: string };
      };
      const query: AdminListUsersQueryDto = {
        page: 1,
        limit: 20,
        search: 'juan',
        skip: 0,
        take: 20,
      };
      const expected = {
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      };
      mockAdminUsersService.listUsers.mockResolvedValue(expected);

      const result = await controller.listUsers(req, query);

      expect(mockAdminUsersService.listUsers).toHaveBeenCalledWith(
        'actor-1',
        query,
      );
      expect(result).toEqual({ status: 'success', data: expected });
    });
  });

  describe('getUserById', () => {
    it('should delegate to service with actor id and target user id', async () => {
      const req = { user: { sub: 'actor-1' } } as Request & {
        user: { sub: string };
      };
      const expected = {
        user_id: 'target-1',
        current_operational_enrollment: null,
        trajectory_classes: [
          {
            user_class_id: 10,
            class_id: 3,
            class_name: 'Explorador',
            investiture: true,
            date_investiture: null,
            advanced: false,
            certificate: null,
            current_class: false,
          },
        ],
        classes: [
          {
            user_class_id: 10,
            class_id: 3,
            class_name: 'Explorador',
            investiture: true,
            date_investiture: null,
            advanced: false,
            certificate: null,
            current_class: false,
          },
        ],
      };
      mockAdminUsersService.getUserById.mockResolvedValue(expected);

      const result = await controller.getUserById(req, 'target-1');

      expect(mockAdminUsersService.getUserById).toHaveBeenCalledWith(
        'actor-1',
        'target-1',
      );
      expect(result).toEqual({ status: 'success', data: expected });
    });
  });

  describe('getGuardianshipConsentEvidence', () => {
    const handler =
      AdminUsersController.prototype.getGuardianshipConsentEvidence;
    const req = { user: { sub: 'actor-1' } } as Request & {
      user: { sub: string };
    };

    it('needs the legal_representative sensitive read (users:read_detail fallback) on the target user', () => {
      expect(
        Reflect.getMetadata(SENSITIVE_USER_SUBRESOURCE_KEY, handler),
      ).toEqual({ family: 'legal_representative', mode: 'read' });
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
        permissions: ['legal_representative:read'],
        mode: 'all',
      });
      expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
        type: 'user',
        ownerParam: 'userId',
      });
      expect(Reflect.getMetadata(GLOBAL_ROLES_KEY, handler)).toEqual([
        ...USER_MANAGEMENT_ROLES,
      ]);
    });

    it('checks the actor territorial scope BEFORE reading the form', async () => {
      const order: string[] = [];
      mockAdminUsersService.assertUserInActorScope.mockImplementation(() => {
        order.push('scope');
        return Promise.resolve();
      });
      mockGuardianEvidence.getForAdmin.mockImplementation(() => {
        order.push('read');
        return Promise.resolve({ url: 'https://signed/x' });
      });

      const result = await controller.getGuardianshipConsentEvidence(
        req,
        'user-1',
        'gs-1',
      );

      expect(order).toEqual(['scope', 'read']);
      expect(mockGuardianEvidence.getForAdmin).toHaveBeenCalledWith(
        'actor-1',
        'user-1',
        'gs-1',
      );
      expect(result).toEqual({
        status: 'success',
        data: { url: 'https://signed/x' },
      });
    });

    it('does not read anything when the user is outside the actor scope', async () => {
      mockAdminUsersService.assertUserInActorScope.mockRejectedValue(
        new Error('out of scope'),
      );

      await expect(
        controller.getGuardianshipConsentEvidence(req, 'user-1', 'gs-1'),
      ).rejects.toThrow('out of scope');
      expect(mockGuardianEvidence.getForAdmin).not.toHaveBeenCalled();
    });
  });

  describe('updateUserApproval', () => {
    it('should delegate approval updates to the service', async () => {
      const expected = {
        user_id: 'target-1',
        approval_status: 'approved',
        rejection_reason: null,
        active: true,
      };
      const dto = { approved: true };
      mockAdminUsersService.updateUserApproval.mockResolvedValue(expected);

      const result = await controller.updateUserApproval('target-1', dto);

      expect(mockAdminUsersService.updateUserApproval).toHaveBeenCalledWith(
        'target-1',
        dto,
      );
      expect(result).toEqual({ status: 'success', data: expected });
    });
  });

  describe('updateUser', () => {
    it('should delegate admin user updates to the service', async () => {
      const expected = {
        user_id: 'target-1',
        approval_status: 'rejected',
        rejection_reason: 'Missing documents',
        active: false,
      };
      const dto = {
        approval_status: user_approval_status.rejected,
        rejection_reason: 'Missing documents',
        active: false,
      };
      mockAdminUsersService.updateUser.mockResolvedValue(expected);

      const result = await controller.updateUser('target-1', dto);

      expect(mockAdminUsersService.updateUser).toHaveBeenCalledWith(
        'target-1',
        dto,
      );
      expect(result).toEqual({ status: 'success', data: expected });
    });
  });

  describe('createUser', () => {
    it('should delegate to createAdminUser with actor id from JWT and return wrapped response', async () => {
      const req = { user: { sub: 'actor-admin-uuid' } } as Request & {
        user: { sub: string };
      };
      const dto: CreateAdminUserDto = {
        name: 'Juan',
        paternal_last_name: 'Pérez',
        maternal_last_name: 'García',
        email: 'juan.perez@example.com',
        role: 'director-lf',
        country_id: 1,
        union_id: 2,
        local_field_id: 10,
      };
      const serviceResult = {
        user_id: 'new-user-uuid',
        email: 'juan.perez@example.com',
        invite_email_sent: true,
      };
      mockAdminUsersService.createAdminUser.mockResolvedValue(serviceResult);

      const result = await controller.createUser(req, dto);

      expect(mockAdminUsersService.createAdminUser).toHaveBeenCalledWith(
        'actor-admin-uuid',
        dto,
      );
      expect(result).toEqual({ status: 'success', data: serviceResult });
    });
  });
});
