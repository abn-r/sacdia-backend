import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the authenticated principal to update so the self-edit age gate can run', async () => {
    const principal = { sub: 'u1', kind: 'user' as const };
    mockUsersService.update.mockResolvedValue({ status: 'success' });

    await controller.update(
      '20a9a762-a4fa-49dd-93a6-3851e27f8b69',
      { birthday: '2000-01-01' },
      { user: principal as never },
    );

    expect(mockUsersService.update).toHaveBeenCalledWith(
      '20a9a762-a4fa-49dd-93a6-3851e27f8b69',
      { birthday: '2000-01-01' },
      principal,
    );
  });
});
