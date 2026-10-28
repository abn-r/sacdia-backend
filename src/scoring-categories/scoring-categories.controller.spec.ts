import { Test, TestingModule } from '@nestjs/testing';
import { ScoringCategoriesController } from './scoring-categories.controller';
import { ScoringCategoriesService } from './scoring-categories.service';
import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators/authorization-resource.decorator';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import {
  JwtAuthGuard,
  PermissionsGuard,
  GlobalRolesGuard,
} from '../common/guards';

describe('ScoringCategoriesController', () => {
  const mockScoringCategoriesService = {
    findDivisionCategories: jest.fn(),
    createDivisionCategory: jest.fn(),
    updateDivisionCategory: jest.fn(),
    deleteDivisionCategory: jest.fn(),
    findUnionCategories: jest.fn(),
    createUnionCategory: jest.fn(),
    updateUnionCategory: jest.fn(),
    deleteUnionCategory: jest.fn(),
    findLocalFieldCategories: jest.fn(),
    createLocalFieldCategory: jest.fn(),
    updateLocalFieldCategory: jest.fn(),
    deleteLocalFieldCategory: jest.fn(),
  };

  let controller: ScoringCategoriesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScoringCategoriesController],
      providers: [
        {
          provide: ScoringCategoriesService,
          useValue: mockScoringCategoriesService,
        },
      ],
    })
      .overrideGuard(GlobalRolesGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<ScoringCategoriesController>(
      ScoringCategoriesController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['findDivisionCategories', 'scoring_categories:read'],
    ['createDivisionCategory', 'scoring_categories:manage'],
    ['updateDivisionCategory', 'scoring_categories:manage'],
    ['deleteDivisionCategory', 'scoring_categories:manage'],
  ] as const)(
    'declares a global authorization resource on %s so PermissionsGuard does not 500',
    (method, permission) => {
      const handler = ScoringCategoriesController.prototype[method];

      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(
        expect.objectContaining({ permissions: [permission] }),
      );
      expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual(
        expect.objectContaining({ type: 'global' }),
      );
    },
  );

  it('passes the authenticated user id to union read scope checks', async () => {
    await controller.findUnionCategories(42, {
      user: { sub: 'user-123' },
    } as any);

    expect(
      mockScoringCategoriesService.findUnionCategories,
    ).toHaveBeenCalledWith(42, 'user-123');
  });

  it('passes the authenticated user id to local field read scope checks', async () => {
    await controller.findLocalFieldCategories(99, {
      user: { sub: 'user-123' },
    } as any);

    expect(
      mockScoringCategoriesService.findLocalFieldCategories,
    ).toHaveBeenCalledWith(99, 'user-123');
  });
});
