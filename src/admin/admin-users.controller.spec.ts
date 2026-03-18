import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { AdminListUsersQueryDto } from './dto';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;

  const mockAdminUsersService = {
    listUsers: jest.fn(),
    getUserById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [
        {
          provide: AdminUsersService,
          useValue: mockAdminUsersService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
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

  describe('listUsers', () => {
    it('should delegate to service with actor id from JWT and query filters', async () => {
      const req = { user: { sub: 'actor-1' } } as Request & {
        user: { sub: string };
      };
      const query: AdminListUsersQueryDto = {
        page: 1,
        limit: 20,
        search: 'juan',
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
});
