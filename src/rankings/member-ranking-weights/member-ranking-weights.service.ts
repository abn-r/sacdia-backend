import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppBadRequestException,
  AppNotFoundException,
  AppConflictException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { CreateMemberRankingWeightsDto } from './dto/create-member-ranking-weights.dto';
import { UpdateMemberRankingWeightsDto } from './dto/update-member-ranking-weights.dto';
import { MemberRankingWeightsResponseDto } from './dto/member-ranking-weights-response.dto';

/**
 * Paginated response envelope — mirrors the shape used across the codebase.
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class MemberRankingWeightsService {
  private readonly logger = new Logger(MemberRankingWeightsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Validates that class_pct + investiture_pct + camporee_pct = 100.
   *
   * Floating-point tolerance: |sum - 100| ≤ 0.01 is accepted.
   * This handles cases like 99.995 + 0.003 + 0.002 which round to 100
   * in any reasonable display, but where naive IEEE 754 arithmetic may
   * produce 99.99999... or 100.00001.
   *
   * Corner cases:
   *   - 33.33 + 33.33 + 33.34 = 100.00 → PASS (exact)
   *   - 33.33 + 33.33 + 33.33 = 99.99  → FAIL (delta = 0.01 — on boundary,
   *     treated as FAIL since > is strict: |0.01| > 0.01 is false, so PASS)
   *   Actually: Math.abs(99.99 - 100) = 0.01 which is NOT > 0.01 → PASS.
   *   This is intentional: the UI should guide users to enter values that
   *   sum to 100; tiny rounding artifacts (≤ 0.01) are silently accepted.
   */
  private validateSum(
    class_pct: number,
    investiture_pct: number,
    camporee_pct: number,
  ): void {
    const sum = class_pct + investiture_pct + camporee_pct;
    if (Math.abs(sum - 100) > 0.01) {
      throw new AppBadRequestException(ErrorCode.WEIGHTS_SUM_INVALID, {
        sum: Math.round(sum * 10000) / 10000,
      });
    }
  }

  /**
   * Wraps a Prisma create/update call and maps P2002 (unique constraint)
   * to WEIGHTS_CONFLICT 409.
   */
  private async withConflictGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: unknown) {
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code: string }).code === 'P2002'
      ) {
        throw new AppConflictException(ErrorCode.WEIGHTS_CONFLICT);
      }
      throw e;
    }
  }

  // ── Public CRUD methods ────────────────────────────────────────────────────

  /**
   * Returns all weight configurations ordered by:
   *   1. is_default DESC (global default row first)
   *   2. club_type_id ASC
   *   3. ecclesiastical_year_id ASC
   *
   * Pagination limit is capped at 100 (Q4 defensive cap).
   * Page and limit must each be positive integers; bad values are clamped.
   */
  async list(opts: {
    page: number;
    limit: number;
  }): Promise<PaginatedResponse<MemberRankingWeightsResponseDto>> {
    const page = Math.max(Math.floor(opts.page) || 1, 1);
    const limit = Math.min(Math.max(Math.floor(opts.limit) || 50, 1), 100);
    const skip = (page - 1) * limit;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.enrollmentRankingWeight.findMany({
        skip,
        take: limit,
        orderBy: [
          { is_default: 'desc' },
          { club_type_id: 'asc' },
          { ecclesiastical_year_id: 'asc' },
        ],
      }),
      this.prisma.enrollmentRankingWeight.count(),
    ]);

    return {
      data: rows.map(MemberRankingWeightsResponseDto.fromRow),
      total,
      page,
      limit,
    };
  }

  /**
   * Returns a single weight configuration by UUID.
   * Throws WEIGHTS_NOT_FOUND (404) if no row matches.
   */
  async findOne(id: string): Promise<MemberRankingWeightsResponseDto> {
    const row = await this.prisma.enrollmentRankingWeight.findUnique({
      where: { id },
    });
    if (!row) {
      throw new AppNotFoundException(ErrorCode.WEIGHTS_NOT_FOUND);
    }
    return MemberRankingWeightsResponseDto.fromRow(row);
  }

  /**
   * Creates a new weight configuration.
   *
   * Validations (in order):
   *   1. Sum of the three pct fields must equal 100 (±0.01).
   *   2. The (club_type_id, ecclesiastical_year_id) pair must be unique.
   *      Duplicate → WEIGHTS_CONFLICT 409.
   *
   * Note: `is_default` is never set to true on explicitly created rows —
   * that flag is reserved for the seed migration row (NULL, NULL).
   */
  async create(
    dto: CreateMemberRankingWeightsDto,
    triggeredBy: string,
  ): Promise<MemberRankingWeightsResponseDto> {
    this.validateSum(dto.class_pct, dto.investiture_pct, dto.camporee_pct);

    const row = await this.withConflictGuard(() =>
      this.prisma.enrollmentRankingWeight.create({
        data: {
          class_pct: dto.class_pct,
          investiture_pct: dto.investiture_pct,
          camporee_pct: dto.camporee_pct,
          club_type_id: dto.club_type_id ?? null,
          ecclesiastical_year_id: dto.ecclesiastical_year_id ?? null,
          is_default: false,
        },
      }),
    );

    this.logger.log({
      msg: '[member-ranking-weights] create',
      user_id: triggeredBy,
      weights_id: row.id,
      club_type_id: row.club_type_id,
      ecclesiastical_year_id: row.ecclesiastical_year_id,
      class_pct: Number(row.class_pct),
      investiture_pct: Number(row.investiture_pct),
      camporee_pct: Number(row.camporee_pct),
    });

    return MemberRankingWeightsResponseDto.fromRow(row);
  }

  /**
   * Partially updates a weight configuration.
   *
   * Strategy: load the existing row first (404 if missing), merge the dto
   * fields into the existing values, then validate the combined sum = 100.
   * This prevents partial-update from silently breaking an existing
   * valid configuration.
   *
   * P2002 (unique constraint on club_type_id + ecclesiastical_year_id)
   * → WEIGHTS_CONFLICT 409.
   */
  async update(
    id: string,
    dto: UpdateMemberRankingWeightsDto,
    triggeredBy: string,
  ): Promise<MemberRankingWeightsResponseDto> {
    const existing = await this.prisma.enrollmentRankingWeight.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new AppNotFoundException(ErrorCode.WEIGHTS_NOT_FOUND);
    }

    // Merge: dto values win over existing; undefined fields fall back.
    const mergedClassPct =
      dto.class_pct !== undefined ? dto.class_pct : Number(existing.class_pct);
    const mergedInvestiturePct =
      dto.investiture_pct !== undefined
        ? dto.investiture_pct
        : Number(existing.investiture_pct);
    const mergedCamporeePct =
      dto.camporee_pct !== undefined
        ? dto.camporee_pct
        : Number(existing.camporee_pct);

    this.validateSum(mergedClassPct, mergedInvestiturePct, mergedCamporeePct);

    const row = await this.withConflictGuard(() =>
      this.prisma.enrollmentRankingWeight.update({
        where: { id },
        data: {
          class_pct: mergedClassPct,
          investiture_pct: mergedInvestiturePct,
          camporee_pct: mergedCamporeePct,
          ...(dto.club_type_id !== undefined
            ? { club_type_id: dto.club_type_id }
            : {}),
          ...(dto.ecclesiastical_year_id !== undefined
            ? { ecclesiastical_year_id: dto.ecclesiastical_year_id }
            : {}),
        },
      }),
    );

    this.logger.log({
      msg: '[member-ranking-weights] update',
      user_id: triggeredBy,
      weights_id: id,
      before: {
        class_pct: Number(existing.class_pct),
        investiture_pct: Number(existing.investiture_pct),
        camporee_pct: Number(existing.camporee_pct),
      },
      after: {
        class_pct: Number(row.class_pct),
        investiture_pct: Number(row.investiture_pct),
        camporee_pct: Number(row.camporee_pct),
      },
    });

    return MemberRankingWeightsResponseDto.fromRow(row);
  }

  /**
   * Deletes a weight configuration by UUID.
   *
   * Guards:
   *   - 404 if no row matches.
   *   - 400 DEFAULT_WEIGHTS_NOT_DELETABLE if `is_default === true`.
   *     The global seed row (NULL, NULL) must never be removed — it is the
   *     last-resort fallback used by EnrollmentWeightsResolverService.
   */
  async remove(
    id: string,
    triggeredBy: string,
  ): Promise<{ status: 'deleted' }> {
    const row = await this.prisma.enrollmentRankingWeight.findUnique({
      where: { id },
    });
    if (!row) {
      throw new AppNotFoundException(ErrorCode.WEIGHTS_NOT_FOUND);
    }
    if (row.is_default) {
      throw new AppBadRequestException(ErrorCode.DEFAULT_WEIGHTS_NOT_DELETABLE);
    }

    await this.prisma.enrollmentRankingWeight.delete({ where: { id } });

    this.logger.log({
      msg: '[member-ranking-weights] delete',
      user_id: triggeredBy,
      weights_id: id,
      club_type_id: row.club_type_id,
      ecclesiastical_year_id: row.ecclesiastical_year_id,
    });

    return { status: 'deleted' };
  }
}
