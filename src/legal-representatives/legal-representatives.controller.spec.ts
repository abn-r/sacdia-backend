import { Test, TestingModule } from '@nestjs/testing';
import { LegalRepresentativesController } from './legal-representatives.controller';
import { LegalRepresentativesService } from './legal-representatives.service';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

describe('LegalRepresentativesController', () => {
  let controller: LegalRepresentativesController;

  const mockLegalRepresentativesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LegalRepresentativesController],
      providers: [
        {
          provide: LegalRepresentativesService,
          useValue: mockLegalRepresentativesService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<LegalRepresentativesController>(
      LegalRepresentativesController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
