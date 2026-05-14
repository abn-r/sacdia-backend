import { Test } from '@nestjs/testing';
import { MemberRankingWeightsService } from './member-ranking-weights.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppBadRequestException,
  AppNotFoundException,
  AppConflictException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

// ---------------------------------------------------------------------------
// Shared test UUID fixtures
// ---------------------------------------------------------------------------

const ID = 'b4e7c3a1-0000-0000-0000-000000000001';
const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

// A minimal raw DB row shape returned by Prisma (Decimal fields as numbers for simplicity)
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    club_type_id: null,
    ecclesiastical_year_id: null,
    class_pct: 50,
    investiture_pct: 30,
    camporee_pct: 20,
    is_default: false,
    created_at: new Date('2026-01-01'),
    modified_at: new Date('2026-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('MemberRankingWeightsService', () => {
  let service: MemberRankingWeightsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      enrollmentRankingWeight: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        MemberRankingWeightsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MemberRankingWeightsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Test 1: validateSum happy path 33.33 + 33.33 + 33.34 = 100 ──────────

  it('create: 33.33 + 33.33 + 33.34 = 100.00 → passes validateSum', async () => {
    const row = makeRow({
      class_pct: 33.33,
      investiture_pct: 33.33,
      camporee_pct: 33.34,
      is_default: false,
    });
    prisma.enrollmentRankingWeight.create.mockResolvedValueOnce(row);

    const dto = {
      class_pct: 33.33,
      investiture_pct: 33.33,
      camporee_pct: 33.34,
    };

    await expect(service.create(dto, USER_ID)).resolves.toBeDefined();
    expect(prisma.enrollmentRankingWeight.create).toHaveBeenCalledTimes(1);
  });

  // ── Test 2: validateSum rejects 50 + 30 + 30 = 110 (delta > 0.01) ────────

  it('create: 50 + 30 + 30 = 110 → throws WEIGHTS_SUM_INVALID', async () => {
    const dto = { class_pct: 50, investiture_pct: 30, camporee_pct: 30 };

    const error = (await service
      .create(dto as any, USER_ID)
      .catch((e) => e)) as AppBadRequestException;

    expect(error).toBeInstanceOf(AppBadRequestException);
    expect(error.code).toBe(ErrorCode.WEIGHTS_SUM_INVALID);
    // Prisma create must NOT have been called
    expect(prisma.enrollmentRankingWeight.create).not.toHaveBeenCalled();
  });

  // ── Test 3: 33.33 × 3 = 99.99 (DB precision) → REJECTS ────────────────────
  //
  // Sum at @db.Decimal(5,2) precision is 99.99, which is NOT 100. Reject is
  // correct UX behavior — UI must enforce that user entries sum exactly to 100
  // (e.g. 33.34 + 33.33 + 33.33). The 0.01 tolerance covers IEEE float drift
  // for values that round to 100 at 2-decimal precision, NOT for genuinely
  // off-by-one-cent inputs like 99.99.

  it('create: 33.33 + 33.33 + 33.33 = 99.99 → throws WEIGHTS_SUM_INVALID', async () => {
    const dto = {
      class_pct: 33.33,
      investiture_pct: 33.33,
      camporee_pct: 33.33,
    };

    await expect(service.create(dto, USER_ID)).rejects.toThrow(
      AppBadRequestException,
    );
    expect(prisma.enrollmentRankingWeight.create).not.toHaveBeenCalled();
  });

  // ── Test 4: PATCH merge existing{50,30,20} + dto{class_pct:60} → 110 ────

  it('update: merge existing{50,30,20} + dto{class_pct:60} → 110 → throws WEIGHTS_SUM_INVALID', async () => {
    prisma.enrollmentRankingWeight.findUnique.mockResolvedValueOnce(
      makeRow({ class_pct: 50, investiture_pct: 30, camporee_pct: 20 }),
    );

    const error = (await service
      .update(ID, { class_pct: 60 } as any, USER_ID)
      .catch((e) => e)) as AppBadRequestException;

    expect(error).toBeInstanceOf(AppBadRequestException);
    expect(error.code).toBe(ErrorCode.WEIGHTS_SUM_INVALID);
    expect(prisma.enrollmentRankingWeight.update).not.toHaveBeenCalled();
  });

  // ── Test 5: PATCH merge happy path → {40,40,20} = 100 → passes ───────────

  it('update: merge existing{50,30,20} + dto{class_pct:40,investiture_pct:40} → 100 → passes', async () => {
    const existing = makeRow({
      class_pct: 50,
      investiture_pct: 30,
      camporee_pct: 20,
    });
    const updated = makeRow({
      class_pct: 40,
      investiture_pct: 40,
      camporee_pct: 20,
    });

    prisma.enrollmentRankingWeight.findUnique.mockResolvedValueOnce(existing);
    prisma.enrollmentRankingWeight.update.mockResolvedValueOnce(updated);

    const result = await service.update(
      ID,
      { class_pct: 40, investiture_pct: 40 },
      USER_ID,
    );

    expect(result).toBeDefined();
    expect(prisma.enrollmentRankingWeight.update).toHaveBeenCalledTimes(1);
  });

  // ── Test 6: DELETE — findUnique returns null → throws WEIGHTS_NOT_FOUND ──

  it('remove: findUnique returns null → throws WEIGHTS_NOT_FOUND; is_default check not reached', async () => {
    prisma.enrollmentRankingWeight.findUnique.mockResolvedValueOnce(null);

    const error = (await service
      .remove(ID, USER_ID)
      .catch((e) => e)) as AppNotFoundException;

    expect(error).toBeInstanceOf(AppNotFoundException);
    expect(error.code).toBe(ErrorCode.WEIGHTS_NOT_FOUND);
    // delete must NOT have been called
    expect(prisma.enrollmentRankingWeight.delete).not.toHaveBeenCalled();
  });

  // ── Test 7: DELETE — is_default=true → throws DEFAULT_WEIGHTS_NOT_DELETABLE

  it('remove: is_default=true → throws DEFAULT_WEIGHTS_NOT_DELETABLE; delete not called', async () => {
    prisma.enrollmentRankingWeight.findUnique.mockResolvedValueOnce(
      makeRow({ is_default: true }),
    );

    const error = (await service
      .remove(ID, USER_ID)
      .catch((e) => e)) as AppBadRequestException;

    expect(error).toBeInstanceOf(AppBadRequestException);
    expect(error.code).toBe(ErrorCode.DEFAULT_WEIGHTS_NOT_DELETABLE);
    expect(prisma.enrollmentRankingWeight.delete).not.toHaveBeenCalled();
  });

  // ── Test 8: withConflictGuard — P2002 → WEIGHTS_CONFLICT (409) ───────────

  it('create: Prisma P2002 → throws WEIGHTS_CONFLICT (409)', async () => {
    // validateSum passes first (sum = 100)
    const dto = { class_pct: 50, investiture_pct: 30, camporee_pct: 20 };

    const prismaError = Object.assign(new Error('Unique constraint'), {
      code: 'P2002',
    });
    prisma.enrollmentRankingWeight.create.mockRejectedValueOnce(prismaError);

    const error = (await service
      .create(dto as any, USER_ID)
      .catch((e) => e)) as AppConflictException;

    expect(error).toBeInstanceOf(AppConflictException);
    expect(error.code).toBe(ErrorCode.WEIGHTS_CONFLICT);
  });
});
