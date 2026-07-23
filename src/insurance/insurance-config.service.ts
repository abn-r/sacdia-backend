import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { isIanaTimezone } from '../common/validators/iana-timezone.validator';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateInsuranceCycleDto,
  CreateInsuranceProductDto,
  InsuranceCoverageScope,
  InsuranceValidityMode,
  UpdateInsuranceCycleDto,
  UpdateInsuranceProductDto,
} from './dto/insurance-config.dto';

export type InsuranceConfigActor = {
  userId: string;
  localFieldId: number;
};

type ProductPolicyInput = {
  coverage_scope: InsuranceCoverageScope;
  validity_mode: InsuranceValidityMode;
  default_duration_months?: number | null;
};

@Injectable()
export class InsuranceConfigService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  async listProducts(actor: InsuranceConfigActor) {
    return this.db.insurance_products.findMany({
      where: { local_field_id: actor.localFieldId },
      orderBy: { name: 'asc' },
    });
  }

  async createProduct(
    dto: CreateInsuranceProductDto,
    actor: InsuranceConfigActor,
  ) {
    this.assertProductPolicy(dto);

    return this.db.insurance_products.create({
      data: {
        name: dto.name.trim(),
        coverage_scope: dto.coverage_scope,
        validity_mode: dto.validity_mode,
        default_duration_months: dto.default_duration_months ?? null,
        active: dto.active ?? true,
        local_field_id: actor.localFieldId,
        created_by_id: actor.userId,
        modified_by_id: actor.userId,
      },
    });
  }

  async updateProduct(
    productId: number,
    dto: UpdateInsuranceProductDto,
    actor: InsuranceConfigActor,
  ) {
    const product = await this.findProductInActorField(productId, actor);
    const nextPolicy: ProductPolicyInput = {
      coverage_scope: dto.coverage_scope ?? product.coverage_scope,
      validity_mode: dto.validity_mode ?? product.validity_mode,
      default_duration_months:
        dto.default_duration_months !== undefined
          ? dto.default_duration_months
          : product.default_duration_months,
    };
    this.assertProductPolicy(nextPolicy);

    return this.db.insurance_products.update({
      where: { insurance_product_id: productId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.coverage_scope !== undefined
          ? { coverage_scope: dto.coverage_scope }
          : {}),
        ...(dto.validity_mode !== undefined
          ? { validity_mode: dto.validity_mode }
          : {}),
        ...(dto.default_duration_months !== undefined
          ? { default_duration_months: dto.default_duration_months }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        modified_by_id: actor.userId,
      },
    });
  }

  async listCycles(actor: InsuranceConfigActor) {
    return this.db.insurance_cycle_configs.findMany({
      where: { local_field_id: actor.localFieldId },
      orderBy: [
        { ecclesiastical_year_id: 'desc' },
        { insurance_product_id: 'asc' },
        { club_type_id: 'asc' },
      ],
      include: { product: true, club_type: true, ecclesiastical_year: true },
    });
  }

  async createCycle(dto: CreateInsuranceCycleDto, actor: InsuranceConfigActor) {
    this.assertIanaTimezone(dto.timezone);
    await this.findProductInActorField(dto.insurance_product_id, actor);
    const deadline = await this.assertDeadlineInYear(
      dto.purchase_deadline,
      dto.ecclesiastical_year_id,
    );

    const duplicate = await this.db.insurance_cycle_configs.findFirst({
      where: {
        insurance_product_id: dto.insurance_product_id,
        local_field_id: actor.localFieldId,
        ecclesiastical_year_id: dto.ecclesiastical_year_id,
        club_type_id: dto.club_type_id,
      },
      select: { insurance_cycle_config_id: true },
    });
    if (duplicate) {
      throw new AppConflictException(
        ErrorCode.INSURANCE_CYCLE_CONFIG_DUPLICATE,
      );
    }

    try {
      return await this.db.insurance_cycle_configs.create({
        data: {
          insurance_product_id: dto.insurance_product_id,
          local_field_id: actor.localFieldId,
          ecclesiastical_year_id: dto.ecclesiastical_year_id,
          club_type_id: dto.club_type_id,
          unit_cost: dto.unit_cost,
          purchase_deadline: deadline,
          timezone: dto.timezone,
          active: dto.active ?? true,
          created_by_id: actor.userId,
          modified_by_id: actor.userId,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new AppConflictException(
          ErrorCode.INSURANCE_CYCLE_CONFIG_DUPLICATE,
        );
      }
      throw error;
    }
  }

  async updateCycle(
    cycleConfigId: number,
    dto: UpdateInsuranceCycleDto,
    actor: InsuranceConfigActor,
  ) {
    if (dto.timezone !== undefined) {
      this.assertIanaTimezone(dto.timezone);
    }
    const cycle = await this.db.insurance_cycle_configs.findUnique({
      where: { insurance_cycle_config_id: cycleConfigId },
    });
    if (!cycle) {
      throw new AppNotFoundException(
        ErrorCode.INSURANCE_CYCLE_CONFIG_NOT_FOUND,
      );
    }
    if (cycle.local_field_id !== actor.localFieldId) {
      throw new AppForbiddenException(
        ErrorCode.INSURANCE_PRODUCT_OUTSIDE_LOCAL_FIELD,
      );
    }

    let deadline: Date | undefined;
    if (dto.purchase_deadline !== undefined) {
      deadline = this.parseDateOnly(dto.purchase_deadline);
      if (!this.sameDate(deadline, new Date(cycle.purchase_deadline))) {
        const confirmedPurchase = await this.db.insurance_purchases.findFirst({
          where: {
            insurance_cycle_config_id: cycleConfigId,
            status: 'CONFIRMED',
          },
          select: { insurance_purchase_id: true },
        });
        if (confirmedPurchase) {
          throw new AppConflictException(
            ErrorCode.INSURANCE_CYCLE_DEADLINE_LOCKED,
          );
        }
      }
      await this.assertDeadlineInYear(deadline, cycle.ecclesiastical_year_id);
    }

    return this.db.insurance_cycle_configs.update({
      where: { insurance_cycle_config_id: cycleConfigId },
      data: {
        ...(dto.unit_cost !== undefined ? { unit_cost: dto.unit_cost } : {}),
        ...(deadline !== undefined ? { purchase_deadline: deadline } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        modified_by_id: actor.userId,
      },
    });
  }

  private async findProductInActorField(
    productId: number,
    actor: InsuranceConfigActor,
  ) {
    const product = await this.db.insurance_products.findUnique({
      where: { insurance_product_id: productId },
    });
    if (!product) {
      throw new AppNotFoundException(ErrorCode.INSURANCE_PRODUCT_NOT_FOUND);
    }
    if (product.local_field_id !== actor.localFieldId) {
      throw new AppForbiddenException(
        ErrorCode.INSURANCE_PRODUCT_OUTSIDE_LOCAL_FIELD,
      );
    }
    return product;
  }

  private assertProductPolicy(input: ProductPolicyInput): void {
    if (input.coverage_scope === 'GENERAL') {
      if (input.validity_mode !== 'FIXED_MONTHS') {
        throw new AppBadRequestException(
          ErrorCode.INSURANCE_PRODUCT_VALIDITY_INVALID,
        );
      }
      if (
        !Number.isInteger(input.default_duration_months) ||
        (input.default_duration_months ?? 0) < 1
      ) {
        throw new AppBadRequestException(
          ErrorCode.INSURANCE_PRODUCT_DURATION_INVALID,
        );
      }
      return;
    }

    if (input.validity_mode !== 'EVENT_DATES') {
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_PRODUCT_VALIDITY_INVALID,
      );
    }
    if (
      input.default_duration_months !== undefined &&
      input.default_duration_months !== null
    ) {
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_PRODUCT_DURATION_INVALID,
      );
    }
  }

  private async assertDeadlineInYear(
    deadlineInput: string | Date,
    ecclesiasticalYearId: number,
  ): Promise<Date> {
    const deadline =
      deadlineInput instanceof Date
        ? new Date(deadlineInput)
        : this.parseDateOnly(deadlineInput);
    const year = await this.db.ecclesiastical_years.findUnique({
      where: { year_id: ecclesiasticalYearId },
      select: { year_id: true, start_date: true, end_date: true },
    });
    if (!year) {
      throw new AppNotFoundException(ErrorCode.INSURANCE_CYCLE_YEAR_NOT_FOUND);
    }
    if (
      deadline.getTime() < this.dateOnly(new Date(year.start_date)).getTime() ||
      deadline.getTime() > this.dateOnly(new Date(year.end_date)).getTime()
    ) {
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_CYCLE_DEADLINE_OUTSIDE_YEAR,
      );
    }
    return deadline;
  }

  private parseDateOnly(value: string): Date {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_CYCLE_DEADLINE_INVALID,
      );
    }
    return parsed;
  }

  private assertIanaTimezone(value: unknown): void {
    if (!isIanaTimezone(value)) {
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_CYCLE_TIMEZONE_INVALID,
      );
    }
  }

  private dateOnly(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private sameDate(left: Date, right: Date): boolean {
    return this.dateOnly(left).getTime() === this.dateOnly(right).getTime();
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}
