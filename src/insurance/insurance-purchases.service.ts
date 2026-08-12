import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { FieldPaymentOrdersFlagService } from '../field-payment-orders/field-payment-orders-flag.service';
import { PrismaService } from '../prisma/prisma.service';
import { classifyInsurancePurchase } from './domain/insurance-policy';
import type {
  RejectInsurancePurchaseDto,
  SubmitInsurancePurchaseDto,
} from './dto/insurance-purchases.dto';
import {
  InsuranceEvidenceService,
  type InsuranceEvidenceActor,
} from './insurance-evidence.service';

export type InsurancePurchaseActor = InsuranceEvidenceActor & {
  sectionIds?: number[];
  canReview?: boolean;
};

@Injectable()
export class InsurancePurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: InsuranceEvidenceService,
    private readonly fieldPaymentOrdersFlag: FieldPaymentOrdersFlagService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  async submit(
    sectionId: number,
    dto: SubmitInsurancePurchaseDto,
    file: Express.Multer.File | undefined,
    actor: InsurancePurchaseActor,
  ) {
    this.assertSubmitScope(sectionId, actor);
    this.assertPositiveInput(dto);
    const section = await this.db.club_sections.findUnique({
      where: { club_section_id: sectionId },
      include: {
        clubs: {
          select: { club_id: true, local_field_id: true, club_type_id: true },
        },
      },
    });
    if (!section)
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    const club = section.clubs ?? section.club;
    // Con órdenes de pago habilitadas en el LF, el submit manual de purchases
    // por cantidad queda bloqueado: la compra nace del approve de la orden.
    if (
      typeof club?.local_field_id === 'number' &&
      (await this.fieldPaymentOrdersFlag.isEnabledForLocalField(
        club.local_field_id,
      ))
    ) {
      throw new AppConflictException(
        ErrorCode.FIELD_PAYMENT_ORDER_LEGACY_DISABLED,
      );
    }
    const cycle = await this.db.insurance_cycle_configs.findUnique({
      where: { insurance_cycle_config_id: dto.insurance_cycle_config_id },
      select: {
        insurance_cycle_config_id: true,
        local_field_id: true,
        club_type_id: true,
        active: true,
      },
    });
    if (!cycle)
      throw new AppNotFoundException(
        ErrorCode.INSURANCE_CYCLE_CONFIG_NOT_FOUND,
      );
    if (!cycle.active || cycle.local_field_id !== club.local_field_id) {
      throw new AppForbiddenException(
        ErrorCode.INSURANCE_CYCLE_OUTSIDE_LOCAL_FIELD,
      );
    }
    if (cycle.club_type_id !== club.club_type_id) {
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_CYCLE_CLUB_TYPE_MISMATCH,
      );
    }
    if (!actor.globalAccess && actor.localFieldId !== club.local_field_id) {
      throw new AppForbiddenException(
        ErrorCode.INSURANCE_PURCHASE_SECTION_FORBIDDEN,
      );
    }

    const proof = await this.evidence.uploadPurchaseProof(
      'pending',
      file,
      actor,
    );
    try {
      return await this.db.$transaction(async (tx: any) => {
        const purchase = await tx.insurance_purchases.create({
          data: {
            insurance_cycle_config_id: cycle.insurance_cycle_config_id,
            owner_club_id: club.club_id,
            purchasing_section_id: sectionId,
            quantity: dto.quantity,
            total_amount: dto.total_amount,
            external_reference: dto.external_reference.trim(),
            receipt_date: this.parseDateOnly(dto.receipt_date),
            submitted_by_id: actor.userId,
            created_by_id: actor.userId,
            modified_by_id: actor.userId,
          },
        });
        await this.evidence.persistPurchaseProof(
          tx,
          purchase.insurance_purchase_id,
          proof,
          actor,
        );
        return purchase;
      });
    } catch (error) {
      await this.deleteProofSafely(proof.fileKey);
      throw error;
    }
  }

  async listForSection(sectionId: number, actor: InsurancePurchaseActor) {
    this.assertSubmitScope(sectionId, actor);
    return this.db.insurance_purchases.findMany({
      where: { purchasing_section_id: sectionId },
      orderBy: { created_at: 'desc' },
      include: {
        evidence_files: {
          where: { evidence_type: 'PURCHASE_PROOF' },
          select: {
            insurance_evidence_file_id: true,
            file_name: true,
            mime_type: true,
            file_size: true,
          },
        },
      },
    });
  }

  async getById(purchaseId: number, actor: InsurancePurchaseActor) {
    const purchase = await this.findPurchase(purchaseId);
    this.assertPurchaseTerritory(purchase, actor);
    return purchase;
  }

  async confirm(purchaseId: number, actor: InsurancePurchaseActor) {
    this.assertReviewer(actor);
    return this.db.$transaction(async (tx: any) => {
      const purchase = await this.findPurchase(purchaseId, tx);
      this.assertPurchaseTerritory(purchase, actor);
      if (purchase.status !== 'PENDING_CONFIRMATION') {
        throw new AppConflictException(
          ErrorCode.INSURANCE_PURCHASE_NOT_PENDING,
        );
      }
      const classification = classifyInsurancePurchase(
        new Date(purchase.receipt_date),
        new Date(purchase.cycle_config.purchase_deadline),
      );
      const confirmed = await tx.insurance_purchases.update({
        where: { insurance_purchase_id: purchaseId },
        data: {
          status: 'CONFIRMED',
          classification,
          unit_cost_snapshot: purchase.cycle_config.unit_cost,
          applied_deadline: purchase.cycle_config.purchase_deadline,
          reviewed_by_id: actor.userId,
          reviewed_at: new Date(),
          modified_by_id: actor.userId,
        },
      });
      await tx.insurance_coverage_slots.createMany({
        data: Array.from({ length: purchase.quantity }, (_, index) => ({
          insurance_purchase_id: purchaseId,
          sequence_number: index + 1,
          owner_club_id: purchase.owner_club_id,
          purchasing_section_id: purchase.purchasing_section_id,
          current_section_id: purchase.purchasing_section_id,
          status: 'AVAILABLE',
          created_by_id: actor.userId,
          modified_by_id: actor.userId,
        })),
      });
      const createdSlots = await tx.insurance_coverage_slots.findMany({
        where: { insurance_purchase_id: purchaseId },
        select: { insurance_coverage_slot_id: true },
      });
      await tx.insurance_slot_movements.createMany({
        data: createdSlots.map(
          (slot: { insurance_coverage_slot_id: number }) => ({
            insurance_coverage_slot_id: slot.insurance_coverage_slot_id,
            movement_type: 'PURCHASE_CONFIRMED',
            from_section_id: null,
            to_section_id: purchase.purchasing_section_id,
            reason: 'Purchase confirmed',
            performed_by_id: actor.userId,
          }),
        ),
      });
      return confirmed;
    });
  }

  async reject(
    purchaseId: number,
    dto: RejectInsurancePurchaseDto,
    actor: InsurancePurchaseActor,
  ) {
    this.assertReviewer(actor);
    if (!dto.reason?.trim())
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_REJECTION_REASON_REQUIRED,
      );
    const purchase = await this.findPurchase(purchaseId);
    this.assertPurchaseTerritory(purchase, actor);
    if (purchase.status !== 'PENDING_CONFIRMATION')
      throw new AppConflictException(ErrorCode.INSURANCE_PURCHASE_NOT_PENDING);
    return this.db.insurance_purchases.update({
      where: { insurance_purchase_id: purchaseId },
      data: {
        status: 'REJECTED',
        rejection_reason: dto.reason.trim(),
        reviewed_by_id: actor.userId,
        reviewed_at: new Date(),
        modified_by_id: actor.userId,
      },
    });
  }

  async reverse(purchaseId: number, actor: InsurancePurchaseActor) {
    this.assertReviewer(actor);
    return this.db.$transaction(async (tx: any) => {
      const purchase = await this.findPurchase(purchaseId, tx);
      this.assertPurchaseTerritory(purchase, actor);
      if (purchase.status !== 'CONFIRMED')
        throw new AppConflictException(
          ErrorCode.INSURANCE_PURCHASE_NOT_CONFIRMED,
        );
      const assignedSlots = await tx.insurance_coverage_slots.count({
        where: {
          insurance_purchase_id: purchaseId,
          status: { not: 'AVAILABLE' },
        },
      });
      if (assignedSlots > 0)
        throw new AppConflictException(
          ErrorCode.INSURANCE_PURCHASE_ASSIGNED_SLOTS,
        );
      const availableSlots = await tx.insurance_coverage_slots.findMany({
        where: { insurance_purchase_id: purchaseId, status: 'AVAILABLE' },
        select: { insurance_coverage_slot_id: true, current_section_id: true },
      });
      await tx.insurance_coverage_slots.updateMany({
        where: { insurance_purchase_id: purchaseId, status: 'AVAILABLE' },
        data: { status: 'VOID', modified_by_id: actor.userId },
      });
      await tx.insurance_slot_movements.createMany({
        data: availableSlots.map(
          (slot: {
            insurance_coverage_slot_id: number;
            current_section_id: number;
          }) => ({
            insurance_coverage_slot_id: slot.insurance_coverage_slot_id,
            movement_type: 'VOIDED',
            from_section_id: slot.current_section_id,
            to_section_id: null,
            reason: 'Purchase reversed',
            performed_by_id: actor.userId,
          }),
        ),
      });
      return tx.insurance_purchases.update({
        where: { insurance_purchase_id: purchaseId },
        data: {
          status: 'REVERSED',
          reviewed_by_id: actor.userId,
          reviewed_at: new Date(),
          modified_by_id: actor.userId,
        },
      });
    });
  }

  private async findPurchase(purchaseId: number, db = this.db) {
    const purchase = await db.insurance_purchases.findUnique({
      where: { insurance_purchase_id: purchaseId },
      include: {
        cycle_config: {
          select: {
            local_field_id: true,
            unit_cost: true,
            purchase_deadline: true,
          },
        },
      },
    });
    if (!purchase)
      throw new AppNotFoundException(ErrorCode.INSURANCE_PURCHASE_NOT_FOUND);
    return purchase;
  }

  private assertSubmitScope(sectionId: number, actor: InsurancePurchaseActor) {
    if (
      !actor.globalAccess &&
      actor.sectionIds &&
      !actor.sectionIds.includes(sectionId)
    ) {
      throw new AppForbiddenException(
        ErrorCode.INSURANCE_PURCHASE_SECTION_FORBIDDEN,
      );
    }
  }

  private assertReviewer(actor: InsurancePurchaseActor) {
    if (!actor.canReview)
      throw new AppForbiddenException(
        ErrorCode.INSURANCE_PURCHASE_REVIEW_FORBIDDEN,
      );
  }

  private assertPurchaseTerritory(
    purchase: any,
    actor: InsurancePurchaseActor,
  ) {
    if (actor.sectionIds?.includes(purchase.purchasing_section_id)) {
      return;
    }
    if (
      !actor.globalAccess &&
      actor.localFieldId !== purchase.cycle_config.local_field_id
    ) {
      throw new AppForbiddenException(
        ErrorCode.INSURANCE_EVIDENCE_OUTSIDE_LOCAL_FIELD,
      );
    }
  }

  private assertPositiveInput(dto: SubmitInsurancePurchaseDto) {
    if (!Number.isInteger(dto.quantity) || dto.quantity < 1)
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_PURCHASE_INVALID_QUANTITY,
      );
    if (!Number.isFinite(dto.total_amount) || dto.total_amount <= 0)
      throw new AppBadRequestException(
        ErrorCode.INSURANCE_PURCHASE_INVALID_TOTAL_AMOUNT,
      );
  }

  private parseDateOnly(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()))
      throw new AppBadRequestException(ErrorCode.INSURANCE_DATE_INVALID);
    return date;
  }

  private async deleteProofSafely(fileKey: string) {
    try {
      await this.evidence.discardUploadedProof(fileKey);
    } catch {
      // The original database error remains authoritative; cleanup is best effort.
    }
  }
}
