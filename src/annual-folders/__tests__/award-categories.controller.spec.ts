import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { AwardCategoriesController } from '../award-categories.controller';
import { AwardCategoriesService } from '../award-categories.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AppBadRequestException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const mockCategory = {
  award_category_id: 'cat-uuid-1',
  name: 'Placa de Honor',
  description: null,
  club_type_id: null,
  min_points: 80,
  max_points: null,
  icon: null,
  order: 0,
  scope: 'club',
  active: true,
};

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

// ---------------------------------------------------------------------------
// Guard bypass — test handler logic only
// ---------------------------------------------------------------------------

const allowGuard = { canActivate: () => true };

// ---------------------------------------------------------------------------

describe('AwardCategoriesController', () => {
  let controller: AwardCategoriesController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AwardCategoriesController],
      providers: [
        { provide: AwardCategoriesService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(allowGuard)
      .compile();

    controller = module.get<AwardCategoriesController>(AwardCategoriesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET / — scope filter forwarding
  // ─────────────────────────────────────────────────────────────────────────

  describe('GET / — scope=club → forwards scope to service.findAll', () => {
    it('calls service.findAll with scope="club" and returns data', async () => {
      mockService.findAll.mockResolvedValueOnce([mockCategory]);

      const result = await controller.findAll(undefined, undefined, 'club');

      expect(mockService.findAll).toHaveBeenCalledWith(
        undefined,
        undefined,
        'club',
      );
      expect(result).toEqual({ status: 'success', data: [mockCategory] });
    });
  });

  describe('GET / — scope=member → forwards scope to service.findAll', () => {
    it('calls service.findAll with scope="member"', async () => {
      mockService.findAll.mockResolvedValueOnce([]);

      const result = await controller.findAll(undefined, undefined, 'member');

      expect(mockService.findAll).toHaveBeenCalledWith(
        undefined,
        undefined,
        'member',
      );
      expect(result).toEqual({ status: 'success', data: [] });
    });
  });

  describe('GET / — scope=section → forwards scope to service.findAll', () => {
    it('calls service.findAll with scope="section"', async () => {
      mockService.findAll.mockResolvedValueOnce([]);

      const result = await controller.findAll(undefined, undefined, 'section');

      expect(mockService.findAll).toHaveBeenCalledWith(
        undefined,
        undefined,
        'section',
      );
      expect(result).toEqual({ status: 'success', data: [] });
    });
  });

  describe('GET / — scope=invalid → throws AppBadRequestException AWARD_CATEGORY_SCOPE_INVALID', () => {
    it('throws 400 with AWARD_CATEGORY_SCOPE_INVALID error code', async () => {
      const error = await controller
        .findAll(undefined, undefined, 'invalid')
        .catch((e) => e) as AppBadRequestException;

      expect(error).toBeInstanceOf(AppBadRequestException);
      expect(error.code).toBe(ErrorCode.AWARD_CATEGORY_SCOPE_INVALID);
      expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);

      // Service must NOT be called when scope is invalid
      expect(mockService.findAll).not.toHaveBeenCalled();
    });
  });

  describe('GET / — no scope → forwards scope=undefined to service.findAll', () => {
    it('calls service.findAll with scope=undefined when scope param is omitted', async () => {
      mockService.findAll.mockResolvedValueOnce([mockCategory]);

      const result = await controller.findAll(undefined, undefined, undefined);

      expect(mockService.findAll).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
      );
      expect(result).toEqual({ status: 'success', data: [mockCategory] });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST / — scope in body forwarded to service.create
  // ─────────────────────────────────────────────────────────────────────────

  describe('POST / — scope="member" in body → forwards to service.create', () => {
    it('creates a category with scope="member" and returns 201 shape', async () => {
      const dto = { name: 'Distinción', min_points: 50, scope: 'member' as const };
      const created = { ...mockCategory, scope: 'member', name: 'Distinción' };
      mockService.create.mockResolvedValueOnce(created);

      const result = await controller.create(dto);

      expect(mockService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ status: 'success', data: created });
    });
  });
});
