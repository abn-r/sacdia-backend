import { Injectable } from '@nestjs/common';
import {
  AppForbiddenException,
  AppNotFoundException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  canConfigureOffering,
  type CamporeeOfferingTarget,
  type CamporeeOrderActor,
} from './camporee-order-actor';
import type { ReplaceCamporeeOfferingsDto } from './dto/replace-camporee-offerings.dto';
import type { UpdateOrderSettingsDto } from './dto/update-order-settings.dto';

export const DEFAULT_CAMPOREE_ORDERS_TIMEZONE = 'America/Mexico_City';

export type CamporeeKind = 'local' | 'union';

export type CamporeeOrdersWindowSource = {
  orders_enabled: boolean;
  orders_opens_at: Date | null;
  orders_deadline: Date | null;
  end_date: Date;
  timezone?: string | null;
};

export type CamporeeOrderSettings = {
  orders_enabled: boolean;
  orders_opens_at: Date | null;
  orders_deadline: Date | null;
};

type SizeScheme = 'LETTER' | 'NUMERIC' | 'NONE';

type OfferingProduct = {
  camporee_order_product_id: string;
  owner_scope: 'DIVISION' | 'UNION' | 'LOCAL_FIELD';
  owner_division_id: number | null;
  owner_union_id: number | null;
  owner_local_field_id: number | null;
  size_scheme: SizeScheme;
  active: boolean;
  options: Array<{ active: boolean }>;
};

type LocalCamporeeRow = CamporeeOrdersWindowSource & {
  local_camporee_id: number;
  local_field_id: number;
  local_fields: {
    local_field_id: number;
    union_id: number;
    unions: { union_id: number; division_id: number } | null;
  } | null;
};

type UnionCamporeeRow = CamporeeOrdersWindowSource & {
  union_camporee_id: number;
  union_id: number;
  unions: { union_id: number; division_id: number } | null;
};

const CAMPOREE_WINDOW_SELECT = {
  orders_enabled: true,
  orders_opens_at: true,
  orders_deadline: true,
  end_date: true,
  timezone: true,
} as const;

const LOCAL_CAMPOREE_INCLUDE = {
  ...CAMPOREE_WINDOW_SELECT,
  local_camporee_id: true,
  local_field_id: true,
  local_fields: {
    select: {
      local_field_id: true,
      union_id: true,
      unions: { select: { union_id: true, division_id: true } },
    },
  },
} as const;

const UNION_CAMPOREE_INCLUDE = {
  ...CAMPOREE_WINDOW_SELECT,
  union_camporee_id: true,
  union_id: true,
  unions: { select: { union_id: true, division_id: true } },
} as const;

const OFFERING_INCLUDE = {
  product: {
    include: {
      options: { orderBy: { sort_order: 'asc' as const } },
    },
  },
} as const;

/**
 * Fail-closed issuance window. Organizer GET/PUT of offerings does not call
 * this; Task 6 must invoke it on POST orders.
 */
export function assertOrdersWindow(
  camporee: CamporeeOrdersWindowSource,
  now: Date,
): void {
  if (!camporee.orders_enabled) {
    throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDERS_DISABLED);
  }

  if (camporee.orders_opens_at && now < camporee.orders_opens_at) {
    throw new AppUnprocessableEntityException(
      ErrorCode.CAMPOREE_ORDERS_NOT_OPEN,
    );
  }

  const deadline = resolveOrdersDeadline(camporee);
  if (now > deadline) {
    throw new AppUnprocessableEntityException(ErrorCode.CAMPOREE_ORDERS_CLOSED);
  }
}

export function resolveOrdersDeadline(
  camporee: CamporeeOrdersWindowSource,
): Date {
  if (camporee.orders_deadline) {
    return camporee.orders_deadline;
  }
  return endOfZonedCalendarDate(
    camporee.end_date,
    resolveOrdersTimezone(camporee.timezone),
  );
}

function resolveOrdersTimezone(timezone: string | null | undefined): string {
  const candidate = timezone?.trim() || DEFAULT_CAMPOREE_ORDERS_TIMEZONE;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_CAMPOREE_ORDERS_TIMEZONE;
  }
}

function utcCalendarDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function zonedCalendarDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function startOfZonedCalendarDate(ymd: string, timeZone: string): Date {
  const [year, month, day] = ymd.split('-').map(Number);
  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  let low = utcNoon - 36 * 60 * 60 * 1000;
  let high = utcNoon + 36 * 60 * 60 * 1000;
  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2);
    if (zonedCalendarDate(new Date(mid), timeZone) < ymd) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return new Date(high);
}

function nextUtcCalendarDate(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return utcCalendarDate(next);
}

function endOfZonedCalendarDate(date: Date, timeZone: string): Date {
  const ymd = utcCalendarDate(date);
  const startNext = startOfZonedCalendarDate(
    nextUtcCalendarDate(ymd),
    timeZone,
  );
  return new Date(startNext.getTime() - 1);
}

function settingsFrom(
  camporee: CamporeeOrderSettings,
): CamporeeOrderSettings {
  return {
    orders_enabled: camporee.orders_enabled,
    orders_opens_at: camporee.orders_opens_at,
    orders_deadline: camporee.orders_deadline,
  };
}

function toNullableDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? null : new Date(value);
}

function isProductInCascade(
  kind: CamporeeKind,
  territory: {
    localFieldId?: number;
    unionId: number;
    divisionId: number;
  },
  product: OfferingProduct,
): boolean {
  if (product.owner_scope === 'DIVISION') {
    return product.owner_division_id === territory.divisionId;
  }
  if (product.owner_scope === 'UNION') {
    return product.owner_union_id === territory.unionId;
  }
  if (kind === 'union') {
    return false;
  }
  return product.owner_local_field_id === territory.localFieldId;
}

@Injectable()
export class OfferingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOfferings(camporeeId: number, kind: CamporeeKind) {
    const camporee = await this.loadCamporee(camporeeId, kind);
    const items = await this.prisma.camporee_order_offerings.findMany({
      where:
        kind === 'local'
          ? { local_camporee_id: camporeeId }
          : { union_camporee_id: camporeeId },
      include: OFFERING_INCLUDE,
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    });

    return {
      settings: settingsFrom(camporee),
      items,
    };
  }

  async updateSettings(
    camporeeId: number,
    kind: CamporeeKind,
    dto: UpdateOrderSettingsDto,
    actor: CamporeeOrderActor,
  ) {
    const camporee = await this.loadCamporee(camporeeId, kind);
    this.assertCanConfigure(actor, camporee, kind);

    const data = {
      ...(dto.orders_enabled !== undefined
        ? { orders_enabled: dto.orders_enabled }
        : {}),
      ...(dto.orders_opens_at !== undefined
        ? { orders_opens_at: toNullableDate(dto.orders_opens_at) }
        : {}),
      ...(dto.orders_deadline !== undefined
        ? { orders_deadline: toNullableDate(dto.orders_deadline) }
        : {}),
      modified_at: new Date(),
    };

    const updated =
      kind === 'local'
        ? await this.prisma.local_camporees.update({
            where: { local_camporee_id: camporeeId },
            data,
            select: CAMPOREE_WINDOW_SELECT,
          })
        : await this.prisma.union_camporees.update({
            where: { union_camporee_id: camporeeId },
            data,
            select: CAMPOREE_WINDOW_SELECT,
          });

    return settingsFrom(updated);
  }

  async replaceOfferings(
    camporeeId: number,
    kind: CamporeeKind,
    dto: ReplaceCamporeeOfferingsDto,
    actor: CamporeeOrderActor,
  ) {
    const camporee = await this.loadCamporee(camporeeId, kind);
    this.assertCanConfigure(actor, camporee, kind);
    const territory = this.territoryOf(camporee, kind);

    const seen = new Set<string>();
    for (const item of dto.items) {
      if (seen.has(item.product_id)) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_OFFERING_INVALID,
        );
      }
      seen.add(item.product_id);
      if (!Number.isInteger(item.price_centavos) || item.price_centavos < 1) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_OFFERING_INVALID,
        );
      }
    }

    const productIds = dto.items.map((item) => item.product_id);
    const products =
      productIds.length === 0
        ? []
        : await this.prisma.camporee_order_products.findMany({
            where: { camporee_order_product_id: { in: productIds } },
            include: { options: true },
          });
    const productsById = new Map(
      products.map((product) => [product.camporee_order_product_id, product]),
    );

    for (const item of dto.items) {
      const product = productsById.get(item.product_id);
      if (!product || !product.active) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_OFFERING_INVALID,
        );
      }
      if (!isProductInCascade(kind, territory, product)) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
        );
      }
      this.assertSizeOptions(product);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        const where =
          kind === 'local'
            ? { local_camporee_id: camporeeId, product_id: item.product_id }
            : { union_camporee_id: camporeeId, product_id: item.product_id };
        const existing = await tx.camporee_order_offerings.findFirst({
          where,
        });
        const payload = {
          price_centavos: item.price_centavos,
          active: item.active ?? true,
          sort_order: item.sort_order ?? 0,
          modified_by_id: actor.userId,
        };
        if (existing) {
          await tx.camporee_order_offerings.update({
            where: {
              camporee_order_offering_id:
                existing.camporee_order_offering_id,
            },
            data: payload,
          });
        } else {
          await tx.camporee_order_offerings.create({
            data: {
              ...where,
              ...payload,
              created_by_id: actor.userId,
            },
          });
        }
      }

      const deactivateWhere =
        kind === 'local'
          ? { local_camporee_id: camporeeId, active: true }
          : { union_camporee_id: camporeeId, active: true };

      await tx.camporee_order_offerings.updateMany({
        where:
          productIds.length === 0
            ? deactivateWhere
            : {
                ...deactivateWhere,
                product_id: { notIn: productIds },
              },
        data: {
          active: false,
          modified_by_id: actor.userId,
        },
      });
    });

    return this.getOfferings(camporeeId, kind);
  }

  private assertSizeOptions(product: OfferingProduct): void {
    if (product.size_scheme === 'NONE') {
      return;
    }
    const hasActiveOption = product.options.some((option) => option.active);
    if (!hasActiveOption) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_OPTION_REQUIRED,
      );
    }
  }

  private assertCanConfigure(
    actor: CamporeeOrderActor,
    camporee: LocalCamporeeRow | UnionCamporeeRow,
    kind: CamporeeKind,
  ): void {
    const target: CamporeeOfferingTarget =
      kind === 'local'
        ? {
            type: 'local',
            localFieldId: (camporee as LocalCamporeeRow).local_field_id,
          }
        : {
            type: 'union',
            unionId: (camporee as UnionCamporeeRow).union_id,
          };
    if (!canConfigureOffering(actor, target)) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }
  }

  private territoryOf(
    camporee: LocalCamporeeRow | UnionCamporeeRow,
    kind: CamporeeKind,
  ): { localFieldId?: number; unionId: number; divisionId: number } {
    if (kind === 'local') {
      const local = camporee as LocalCamporeeRow;
      const unionId = local.local_fields?.union_id;
      const divisionId = local.local_fields?.unions?.division_id;
      if (typeof unionId !== 'number' || typeof divisionId !== 'number') {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_NOT_FOUND);
      }
      return {
        localFieldId: local.local_field_id,
        unionId,
        divisionId,
      };
    }
    const union = camporee as UnionCamporeeRow;
    const divisionId = union.unions?.division_id;
    if (typeof divisionId !== 'number') {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_NOT_FOUND);
    }
    return { unionId: union.union_id, divisionId };
  }

  private async loadCamporee(
    camporeeId: number,
    kind: CamporeeKind,
  ): Promise<LocalCamporeeRow | UnionCamporeeRow> {
    if (kind === 'local') {
      const camporee = await this.prisma.local_camporees.findUnique({
        where: { local_camporee_id: camporeeId },
        select: LOCAL_CAMPOREE_INCLUDE,
      });
      if (!camporee) {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_NOT_FOUND);
      }
      return camporee as LocalCamporeeRow;
    }

    const camporee = await this.prisma.union_camporees.findUnique({
      where: { union_camporee_id: camporeeId },
      select: UNION_CAMPOREE_INCLUDE,
    });
    if (!camporee) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_NOT_FOUND);
    }
    return camporee as UnionCamporeeRow;
  }
}
