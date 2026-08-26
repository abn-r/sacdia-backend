import { Injectable } from '@nestjs/common';
import {
  AppForbiddenException,
  AppNotFoundException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  canConfigureAsParticipatingLf,
  canConfigureSupplyOrganizer,
  type CamporeeKind,
  type CamporeeSupplyActor,
} from './camporee-supply-actor';
import {
  camporeeWhere,
  loadSupplyCamporee,
  type SupplyCamporeeRow,
} from './camporee-context';
import { parseCutoffMinutes } from './freeze';
import type {
  CreateSupplyProductDto,
  CreateSupplySlotDto,
  UpdateSupplyProductDto,
  UpdateSupplySettingsDto,
  UpdateSupplySlotDto,
} from './dto/supply.dto';

@Injectable()
export class CamporeeSupplyConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getCatalog(camporeeId: number, kind: CamporeeKind) {
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    const where = camporeeWhere(kind, camporeeId);
    const [slots, products] = await Promise.all([
      this.prisma.camporee_supply_slots.findMany({
        where,
        orderBy: [{ sort_order: 'asc' }, { deliver_time: 'asc' }],
      }),
      this.prisma.camporee_supply_products.findMany({
        where,
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      supply_edit_cutoff_local_time: camporee.cutoffHm,
      timezone: camporee.timezone,
      start_date: camporee.startDate,
      end_date: camporee.endDate,
      slots: slots.map(mapSlot),
      products: products.map(mapProduct),
    };
  }

  async updateSettings(
    camporeeId: number,
    kind: CamporeeKind,
    dto: UpdateSupplySettingsDto,
    actor: CamporeeSupplyActor,
  ) {
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    await this.assertCanConfigure(actor, camporee);
    if (dto.supply_edit_cutoff_local_time) {
      try {
        parseCutoffMinutes(dto.supply_edit_cutoff_local_time);
      } catch {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_CUTOFF_INVALID,
        );
      }
    }
    const data = {
      ...(dto.supply_edit_cutoff_local_time
        ? { supply_edit_cutoff_local_time: dto.supply_edit_cutoff_local_time }
        : {}),
    };
    if (kind === 'local') {
      await this.prisma.local_camporees.update({
        where: { local_camporee_id: camporeeId },
        data,
      });
    } else {
      await this.prisma.union_camporees.update({
        where: { union_camporee_id: camporeeId },
        data,
      });
    }
    return this.getCatalog(camporeeId, kind);
  }

  async createSlot(
    camporeeId: number,
    kind: CamporeeKind,
    dto: CreateSupplySlotDto,
    actor: CamporeeSupplyActor,
  ) {
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    await this.assertCanConfigure(actor, camporee);
    const created = await this.prisma.camporee_supply_slots.create({
      data: {
        ...camporeeWhere(kind, camporeeId),
        label: dto.label.trim(),
        deliver_time: dto.deliver_time,
        sort_order: dto.sort_order ?? 0,
      },
    });
    return mapSlot(created);
  }

  async updateSlot(
    camporeeId: number,
    kind: CamporeeKind,
    slotId: string,
    dto: UpdateSupplySlotDto,
    actor: CamporeeSupplyActor,
  ) {
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    await this.assertCanConfigure(actor, camporee);
    const slot = await this.requireSlot(slotId, kind, camporeeId);
    const updated = await this.prisma.camporee_supply_slots.update({
      where: { camporee_supply_slot_id: slot.camporee_supply_slot_id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
        ...(dto.deliver_time !== undefined
          ? { deliver_time: dto.deliver_time }
          : {}),
        ...(dto.sort_order !== undefined ? { sort_order: dto.sort_order } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return mapSlot(updated);
  }

  async createProduct(
    camporeeId: number,
    kind: CamporeeKind,
    dto: CreateSupplyProductDto,
    actor: CamporeeSupplyActor,
  ) {
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    await this.assertCanConfigure(actor, camporee);
    const created = await this.prisma.camporee_supply_products.create({
      data: {
        ...camporeeWhere(kind, camporeeId),
        name: dto.name.trim(),
        uom: dto.uom,
        unit_cost_centavos: dto.unit_cost_centavos,
      },
    });
    return mapProduct(created);
  }

  async updateProduct(
    camporeeId: number,
    kind: CamporeeKind,
    productId: string,
    dto: UpdateSupplyProductDto,
    actor: CamporeeSupplyActor,
  ) {
    const camporee = await loadSupplyCamporee(this.prisma, camporeeId, kind);
    await this.assertCanConfigure(actor, camporee);
    const product = await this.requireProduct(productId, kind, camporeeId);
    if (
      dto.unit_cost_centavos !== undefined &&
      dto.unit_cost_centavos !== product.unit_cost_centavos
    ) {
      const submitted = await this.prisma.camporee_supply_plans.count({
        where: {
          status: 'SUBMITTED',
          ...camporeeWhere(kind, camporeeId),
        },
      });
      if (submitted > 0) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_SUPPLIES_PRICE_LOCKED,
        );
      }
    }
    const updated = await this.prisma.camporee_supply_products.update({
      where: { camporee_supply_product_id: product.camporee_supply_product_id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.uom !== undefined ? { uom: dto.uom } : {}),
        ...(dto.unit_cost_centavos !== undefined
          ? { unit_cost_centavos: dto.unit_cost_centavos }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return mapProduct(updated);
  }

  async assertCanConfigure(
    actor: CamporeeSupplyActor,
    camporee: SupplyCamporeeRow,
  ): Promise<void> {
    const target = {
      type: camporee.kind,
      localFieldId: camporee.localFieldId,
      unionId: camporee.unionId,
    };
    if (canConfigureSupplyOrganizer(actor, target)) {
      return;
    }
    if (
      camporee.kind === 'union' &&
      canConfigureAsParticipatingLf(actor)
    ) {
      if (actor.territory.level === 'all') {
        return;
      }
      const localFieldId =
        actor.territory.level === 'local_field'
          ? actor.territory.localFieldId
          : actor.localFieldId;
      if (typeof localFieldId !== 'number') {
        throw new AppForbiddenException(ErrorCode.CAMPOREE_SUPPLIES_FORBIDDEN);
      }
      const participating =
        await this.prisma.union_camporee_local_fields.findFirst({
          where: {
            union_camporee_lf_id: camporee.id,
            local_field_id: localFieldId,
            active: true,
          },
          select: { local_field_id: true },
        });
      if (participating) {
        return;
      }
    }
    throw new AppForbiddenException(ErrorCode.CAMPOREE_SUPPLIES_FORBIDDEN);
  }

  private async requireSlot(
    slotId: string,
    kind: CamporeeKind,
    camporeeId: number,
  ) {
    const slot = await this.prisma.camporee_supply_slots.findFirst({
      where: {
        camporee_supply_slot_id: slotId,
        ...camporeeWhere(kind, camporeeId),
      },
    });
    if (!slot) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_SUPPLIES_SLOT_INVALID);
    }
    return slot;
  }

  private async requireProduct(
    productId: string,
    kind: CamporeeKind,
    camporeeId: number,
  ) {
    const product = await this.prisma.camporee_supply_products.findFirst({
      where: {
        camporee_supply_product_id: productId,
        ...camporeeWhere(kind, camporeeId),
      },
    });
    if (!product) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_SUPPLIES_PRODUCT_INVALID,
      );
    }
    return product;
  }
}

function mapSlot(row: {
  camporee_supply_slot_id: string;
  label: string;
  deliver_time: string;
  sort_order: number;
  active: boolean;
}) {
  return {
    slot_id: row.camporee_supply_slot_id,
    label: row.label,
    deliver_time: row.deliver_time,
    sort_order: row.sort_order,
    active: row.active,
  };
}

function mapProduct(row: {
  camporee_supply_product_id: string;
  name: string;
  uom: string;
  unit_cost_centavos: number;
  active: boolean;
}) {
  return {
    product_id: row.camporee_supply_product_id,
    name: row.name,
    uom: row.uom,
    unit_cost_centavos: row.unit_cost_centavos,
    active: row.active,
  };
}
