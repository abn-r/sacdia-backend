import { Test, TestingModule } from '@nestjs/testing';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';

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
      .overrideGuard(GlobalRolesGuard)
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
      const req = { user: { sub: 'actor-1' } };
      const query = { page: 1, limit: 20, search: 'juan' } as any;
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
      const req = { user: { sub: 'actor-1' } };
      const expected = { user_id: 'target-1' };
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
