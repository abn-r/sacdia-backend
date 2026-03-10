import { Test, TestingModule } from '@nestjs/testing';
import { EmergencyContactsController } from './emergency-contacts.controller';
import { EmergencyContactsService } from './emergency-contacts.service';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

describe('EmergencyContactsController', () => {
  let controller: EmergencyContactsController;

  const mockEmergencyContactsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmergencyContactsController],
      providers: [
        {
          provide: EmergencyContactsService,
          useValue: mockEmergencyContactsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<EmergencyContactsController>(
      EmergencyContactsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
