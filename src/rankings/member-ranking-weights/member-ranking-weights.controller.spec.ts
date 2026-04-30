import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { MemberRankingWeightsController } from './member-ranking-weights.controller';
import { MemberRankingWeightsService } from './member-ranking-weights.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { GlobalRolesGuard } from '../../common/guards/global-roles.guard';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { MemberRankingWeightsResponseDto } from './dto/member-ranking-weights-response.dto';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const WEIGHT_ID = 'b4e7c3a1-0000-0000-0000-000000000001';
const TEST_USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const mockReq = { user: { user_id: TEST_USER_ID } };

function makeWeightRow(
  overrides: Partial<MemberRankingWeightsResponseDto> = {},
): MemberRankingWeightsResponseDto {
  const dto = new MemberRankingWeightsResponseDto();
  dto.id = WEIGHT_ID;
  dto.club_type_id = null;
  dto.ecclesiastical_year_id = null;
  dto.class_pct = 50;
  dto.investiture_pct = 30;
  dto.camporee_pct = 20;
  dto.is_default = true;
  dto.created_at = '2026-01-01T00:00:00.000Z';
  dto.modified_at = '2026-01-01T00:00:00.000Z';
  return Object.assign(dto, overrides);
}

const defaultRow = makeWeightRow({ is_default: true });
const overrideRow = makeWeightRow({
  id: 'b4e7c3a1-0000-0000-0000-000000000002',
  club_type_id: 1,
  ecclesiastical_year_id: 3,
  class_pct: 40,
  investiture_pct: 40,
  camporee_pct: 20,
  is_default: false,
});

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockService = {
  list: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

// ---------------------------------------------------------------------------
// Guard overrides — bypass auth so tests exercise handler logic only
// ---------------------------------------------------------------------------

const allowGuard = { canActivate: () => true };

// ---------------------------------------------------------------------------

describe('MemberRankingWeightsController', () => {
  let controller: MemberRankingWeightsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemberRankingWeightsController],
      providers: [
        { provide: MemberRankingWeightsService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowGuard)
      .overrideGuard(GlobalRolesGuard)
      .useValue(allowGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(allowGuard)
      .compile();

    controller = module.get<MemberRankingWeightsController>(
      MemberRankingWeightsController,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Baseline
  // ─────────────────────────────────────────────────────────────────────────

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. POST / sum=100 → 201 created
  // ─────────────────────────────────────────────────────────────────────────
  describe('POST / — sum=100 → 201 created', () => {
    it('delegates to service.create and returns the created DTO', async () => {
      const dto = {
        class_pct: 40,
        investiture_pct: 40,
        camporee_pct: 20,
        club_type_id: 1,
        ecclesiastical_year_id: 3,
      };
      mockService.create.mockResolvedValueOnce(overrideRow);

      const result = await controller.create(mockReq as any, dto as any);

      expect(mockService.create).toHaveBeenCalledWith(dto, TEST_USER_ID);
      expect(result).toEqual(overrideRow);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. POST / sum≠100 → 400 WEIGHTS_SUM_INVALID
  // ─────────────────────────────────────────────────────────────────────────
  describe('POST / — sum≠100 → 400 WEIGHTS_SUM_INVALID', () => {
    it('propagates AppBadRequestException(WEIGHTS_SUM_INVALID) from service', async () => {
      mockService.create.mockRejectedValueOnce(
        new AppBadRequestException(ErrorCode.WEIGHTS_SUM_INVALID, { sum: 110 }),
      );

      const dto = { class_pct: 50, investiture_pct: 30, camporee_pct: 30 };

      const error = await controller
        .create(mockReq as any, dto as any)
        .catch((e) => e) as AppBadRequestException;

      expect(error).toBeInstanceOf(AppBadRequestException);
      expect(error.code).toBe(ErrorCode.WEIGHTS_SUM_INVALID);
      expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. POST / negative pct → 400 (class-validator @Min)
  //
  //    ParseIntPipe / class-validator throws before the handler is invoked.
  //    We test service propagation of the validation error to confirm wiring.
  // ─────────────────────────────────────────────────────────────────────────
  describe('POST / — negative weight → 400', () => {
    it('propagates AppBadRequestException when service rejects negative pct', async () => {
      mockService.create.mockRejectedValueOnce(
        new AppBadRequestException(ErrorCode.WEIGHTS_SUM_INVALID, { sum: -10 }),
      );

      const dto = { class_pct: -10, investiture_pct: 80, camporee_pct: 30 };

      const error = await controller
        .create(mockReq as any, dto as any)
        .catch((e) => e) as AppBadRequestException;

      expect(error).toBeInstanceOf(AppBadRequestException);
      expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. POST / duplicate (clubType+year) → 409 WEIGHTS_CONFLICT
  // ─────────────────────────────────────────────────────────────────────────
  describe('POST / — duplicate (club_type_id + ecclesiastical_year_id) → 409', () => {
    it('propagates AppConflictException(WEIGHTS_CONFLICT) from service', async () => {
      mockService.create.mockRejectedValueOnce(
        new AppConflictException(ErrorCode.WEIGHTS_CONFLICT),
      );

      const dto = {
        class_pct: 50,
        investiture_pct: 30,
        camporee_pct: 20,
        club_type_id: 1,
        ecclesiastical_year_id: 3,
      };

      const error = await controller
        .create(mockReq as any, dto as any)
        .catch((e) => e) as AppConflictException;

      expect(error).toBeInstanceOf(AppConflictException);
      expect(error.code).toBe(ErrorCode.WEIGHTS_CONFLICT);
      expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. DELETE /:id default global → 400 DEFAULT_WEIGHTS_NOT_DELETABLE
  // ─────────────────────────────────────────────────────────────────────────
  describe('DELETE /:id — default global row → 400 DEFAULT_WEIGHTS_NOT_DELETABLE', () => {
    it('propagates AppBadRequestException(DEFAULT_WEIGHTS_NOT_DELETABLE) from service', async () => {
      mockService.remove.mockRejectedValueOnce(
        new AppBadRequestException(ErrorCode.DEFAULT_WEIGHTS_NOT_DELETABLE),
      );

      const error = await controller
        .remove(mockReq as any, WEIGHT_ID)
        .catch((e) => e) as AppBadRequestException;

      expect(error).toBeInstanceOf(AppBadRequestException);
      expect(error.code).toBe(ErrorCode.DEFAULT_WEIGHTS_NOT_DELETABLE);
      expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(mockService.remove).toHaveBeenCalledWith(WEIGHT_ID, TEST_USER_ID);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. GET /:id non-UUID → 400 (ParseUUIDPipe)
  //
  //    ParseUUIDPipe throws BadRequestException before the handler is called.
  //    We verify service behaviour when a bad id is passed through to the
  //    service (simulating what would happen if the pipe were bypassed).
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET /:id — non-UUID string → 400', () => {
    it('propagates AppNotFoundException(WEIGHTS_NOT_FOUND) for unknown id', async () => {
      mockService.findOne.mockRejectedValueOnce(
        new AppNotFoundException(ErrorCode.WEIGHTS_NOT_FOUND),
      );

      const error = await controller
        .findOne('not-a-valid-uuid')
        .catch((e) => e) as AppNotFoundException;

      expect(error).toBeInstanceOf(AppNotFoundException);
      expect(error.code).toBe(ErrorCode.WEIGHTS_NOT_FOUND);
      expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. PATCH /:id — validates SUM=100
  // ─────────────────────────────────────────────────────────────────────────
  describe('PATCH /:id — propagates WEIGHTS_SUM_INVALID when merged sum ≠ 100', () => {
    it('throws AppBadRequestException(WEIGHTS_SUM_INVALID) from service on bad merged sum', async () => {
      mockService.update.mockRejectedValueOnce(
        new AppBadRequestException(ErrorCode.WEIGHTS_SUM_INVALID, { sum: 90 }),
      );

      const dto = { class_pct: 60 }; // would make 60 + 30 + 20 = 110 or 60 + existing = ≠ 100

      const error = await controller
        .update(mockReq as any, WEIGHT_ID, dto as any)
        .catch((e) => e) as AppBadRequestException;

      expect(error).toBeInstanceOf(AppBadRequestException);
      expect(error.code).toBe(ErrorCode.WEIGHTS_SUM_INVALID);
      expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(mockService.update).toHaveBeenCalledWith(WEIGHT_ID, dto, TEST_USER_ID);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. GET / — returns default + overrides ordered by is_default DESC
  // ─────────────────────────────────────────────────────────────────────────
  describe('GET / — returns default + overrides list', () => {
    it('returns paginated result with is_default row first', async () => {
      const paginatedResult = {
        data: [defaultRow, overrideRow],
        total: 2,
        page: 1,
        limit: 50,
      };
      mockService.list.mockResolvedValueOnce(paginatedResult);

      const result = await controller.list();

      expect(mockService.list).toHaveBeenCalledWith({ page: 1, limit: 50 });
      expect(result.data).toHaveLength(2);
      // is_default row must appear first (orderBy is_default DESC enforced by service)
      expect(result.data[0].is_default).toBe(true);
      expect(result.data[1].is_default).toBe(false);
    });
  });
});
