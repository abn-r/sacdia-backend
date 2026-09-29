import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { USER_MANAGEMENT_ROLES } from './admin-users.controller';
import { GLOBAL_ROLES_KEY, PERMISSIONS_KEY } from '../common/decorators';
import {
  JwtAuthGuard,
  GlobalRolesGuard,
  PermissionsGuard,
} from '../common/guards';

describe('AdminAuthController', () => {
  let controller: AdminAuthController;

  const mockAdminAuthService = {
    listUserSessions: jest.fn(),
    revokeUserSession: jest.fn(),
    revokeAllUserSessions: jest.fn(),
    getUserMfaStatus: jest.fn(),
    resetUserMfa: jest.fn(),
    setUserPassword: jest.fn(),
  };

  const fieldRoles = [
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAuthController],
      providers: [
        {
          provide: AdminAuthService,
          useValue: mockAdminAuthService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(GlobalRolesGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<AdminAuthController>(AdminAuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('authorization metadata', () => {
    it('keeps the class-level admin fence for MFA and password', () => {
      expect(
        Reflect.getMetadata(GLOBAL_ROLES_KEY, AdminAuthController),
      ).toEqual(['admin', 'super-admin']);

      for (const handler of [
        AdminAuthController.prototype.getUserMfaStatus,
        AdminAuthController.prototype.resetUserMfa,
        AdminAuthController.prototype.setUserPassword,
      ]) {
        expect(Reflect.getMetadata(GLOBAL_ROLES_KEY, handler)).toBeUndefined();
        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
          permissions: ['users:update_admin'],
          mode: 'all',
        });
      }
    });

    it('opens session list and revoke to USER_MANAGEMENT_ROLES with users:read_detail', () => {
      for (const handler of [
        AdminAuthController.prototype.listUserSessions,
        AdminAuthController.prototype.revokeUserSession,
        AdminAuthController.prototype.revokeAllUserSessions,
      ]) {
        const roles = Reflect.getMetadata(GLOBAL_ROLES_KEY, handler);
        expect(roles).toEqual([...USER_MANAGEMENT_ROLES]);
        expect(roles).toEqual(expect.arrayContaining(fieldRoles));
        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
          permissions: ['users:read_detail'],
          mode: 'all',
        });
      }
    });
  });

  describe('listUserSessions', () => {
    it('delegates to the service with actor id from JWT and target user id', async () => {
      const req = { user: { sub: 'actor-lf' } } as Request & {
        user: { sub: string };
      };
      const expected = {
        userId: 'target-1',
        totalSessions: 0,
        sessions: [],
      };
      mockAdminAuthService.listUserSessions.mockResolvedValue(expected);

      const result = await controller.listUserSessions(req, 'target-1');

      expect(mockAdminAuthService.listUserSessions).toHaveBeenCalledWith(
        'actor-lf',
        'target-1',
      );
      expect(result).toEqual({ status: 'success', data: expected });
    });
  });
});
