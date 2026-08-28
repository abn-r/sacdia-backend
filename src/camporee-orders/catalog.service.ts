import { Injectable } from '@nestjs/common';
import {
  AppForbiddenException,
  AppNotFoundException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  canManageCatalog,
  type CamporeeOrderActor,
  type CamporeeOrderOwner,
  type CamporeeOrderOwnerScope,
} from './camporee-order-actor';
import type { CreateCamporeeOrderProductDto } from './dto/create-camporee-order-product.dto';
import type { UpdateCamporeeOrderProductDto } from './dto/update-camporee-order-product.dto';
import type {
  CreateProductOptionDto,
  UpdateProductOptionDto,
} from './dto/create-product-option.dto';

const NUMERIC_LABEL = /^\d+$/;

const PRODUCT_INCLUDE = {
  options: { orderBy: { sort_order: 'asc' as const } },
} as const;

const OWNER_MUTATION_KEYS = [
  'owner_scope',
  'owner_division_id',
  'owner_union_id',
  'owner_local_field_id',
] as const;

type SizeScheme = 'LETTER' | 'NUMERIC' | 'NONE';

type CatalogProduct = {
  camporee_order_product_id: string;
  owner_scope: CamporeeOrderOwnerScope;
  owner_division_id: number | null;
  owner_union_id: number | null;
  owner_local_field_id: number | null;
  title: string;
  description: string | null;
  size_scheme: SizeScheme;
  club_type_id: number | null;
  active: boolean;
};

type AncestorIds = {
  localFieldId?: number;
  unionId?: number;
  divisionId?: number;
};

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function countDefinedIds(...ids: Array<number | null | undefined>): number {
  return ids.filter((id) => typeof id === 'number').length;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCamporeeOrderProductDto, actor: CamporeeOrderActor) {
    const owner = this.deriveOwner(dto, actor);
    if (!canManageCatalog(actor, owner)) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }

    return this.prisma.camporee_order_products.create({
      data: {
        owner_scope: owner.scope,
        owner_division_id:
          owner.scope === 'DIVISION' ? (owner.divisionId ?? null) : null,
        owner_union_id:
          owner.scope === 'UNION' ? (owner.unionId ?? null) : null,
        owner_local_field_id:
          owner.scope === 'LOCAL_FIELD' ? (owner.localFieldId ?? null) : null,
        title: dto.title,
        description: dto.description ?? null,
        size_scheme: dto.size_scheme,
        club_type_id: dto.club_type_id ?? null,
        active: true,
        created_by_id: actor.userId,
        modified_by_id: actor.userId,
      },
      include: PRODUCT_INCLUDE,
    });
  }

  async list(actor: CamporeeOrderActor, query: { active?: boolean } = {}) {
    const where = await this.buildReadWhere(actor);
    if (!where) {
      return [];
    }
    if (typeof query.active === 'boolean') {
      where.active = query.active;
    }
    return this.prisma.camporee_order_products.findMany({
      where,
      include: PRODUCT_INCLUDE,
      orderBy: { title: 'asc' },
    });
  }

  async getById(productId: string, actor: CamporeeOrderActor) {
    const product = await this.prisma.camporee_order_products.findUnique({
      where: { camporee_order_product_id: productId },
      include: PRODUCT_INCLUDE,
    });
    if (!product || !(await this.isInReadCascade(actor, product))) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_NOT_FOUND);
    }
    return product;
  }

  async update(
    productId: string,
    dto: UpdateCamporeeOrderProductDto,
    actor: CamporeeOrderActor,
  ) {
    this.assertOwnerImmutable(dto);
    const product = await this.requireWritableProduct(productId, actor);

    return this.prisma.camporee_order_products.update({
      where: { camporee_order_product_id: product.camporee_order_product_id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.size_scheme !== undefined
          ? { size_scheme: dto.size_scheme }
          : {}),
        ...(dto.club_type_id !== undefined
          ? { club_type_id: dto.club_type_id }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        modified_by_id: actor.userId,
      },
      include: PRODUCT_INCLUDE,
    });
  }

  async addOption(
    productId: string,
    dto: CreateProductOptionDto,
    actor: CamporeeOrderActor,
  ) {
    const product = await this.requireWritableProduct(productId, actor);
    if (product.size_scheme === 'NONE') {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
      );
    }
    const label = this.normalizeOptionLabel(product.size_scheme, dto.label);

    try {
      return await this.prisma.camporee_order_product_options.create({
        data: {
          product_id: product.camporee_order_product_id,
          label,
          sort_order: dto.sort_order ?? 0,
          active: true,
        },
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
        );
      }
      throw error;
    }
  }

  async updateOption(
    optionId: string,
    dto: UpdateProductOptionDto,
    actor: CamporeeOrderActor,
  ) {
    const option = await this.prisma.camporee_order_product_options.findUnique({
      where: { camporee_order_product_option_id: optionId },
      include: { product: true },
    });
    if (!option) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_NOT_FOUND);
    }

    const owner = await this.hydrateOwner(option.product);
    if (!canManageCatalog(actor, owner)) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }

    let nextLabel: string | undefined;
    if (dto.label !== undefined && dto.label !== option.label) {
      const referenced = await this.prisma.camporee_order_lines.count({
        where: { option_id: optionId },
      });
      if (referenced > 0) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
        );
      }
      nextLabel = this.normalizeOptionLabel(
        option.product.size_scheme,
        dto.label,
      );
    }

    try {
      return await this.prisma.camporee_order_product_options.update({
        where: { camporee_order_product_option_id: optionId },
        data: {
          ...(nextLabel !== undefined ? { label: nextLabel } : {}),
          ...(dto.sort_order !== undefined
            ? { sort_order: dto.sort_order }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
        );
      }
      throw error;
    }
  }

  private deriveOwner(
    dto: CreateCamporeeOrderProductDto,
    actor: CamporeeOrderActor,
  ): CamporeeOrderOwner {
    const { territory } = actor;
    if (territory.level === 'open' || territory.level === 'unconfigured') {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }

    if (territory.level === 'all') {
      return this.ownerFromAdminHint(dto);
    }

    if (territory.level === 'local_field') {
      this.rejectConflictingHint(dto, 'LOCAL_FIELD', {
        owner_local_field_id: territory.localFieldId,
      });
      return {
        scope: 'LOCAL_FIELD',
        localFieldId: territory.localFieldId,
        unionId: territory.unionId,
        divisionId: territory.divisionId,
      };
    }

    if (territory.level === 'union') {
      this.rejectConflictingHint(dto, 'UNION', {
        owner_union_id: territory.unionId,
      });
      return {
        scope: 'UNION',
        unionId: territory.unionId,
        divisionId: territory.divisionId,
      };
    }

    this.rejectConflictingHint(dto, 'DIVISION', {
      owner_division_id: territory.divisionId,
    });
    return {
      scope: 'DIVISION',
      divisionId: territory.divisionId,
    };
  }

  private ownerFromAdminHint(
    dto: CreateCamporeeOrderProductDto,
  ): CamporeeOrderOwner {
    const defined = countDefinedIds(
      dto.owner_division_id,
      dto.owner_union_id,
      dto.owner_local_field_id,
    );
    if (!dto.owner_scope || defined !== 1) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
      );
    }

    if (dto.owner_scope === 'DIVISION') {
      if (typeof dto.owner_division_id !== 'number') {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
        );
      }
      return { scope: 'DIVISION', divisionId: dto.owner_division_id };
    }

    if (dto.owner_scope === 'UNION') {
      if (typeof dto.owner_union_id !== 'number') {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
        );
      }
      return { scope: 'UNION', unionId: dto.owner_union_id };
    }

    if (typeof dto.owner_local_field_id !== 'number') {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
      );
    }
    return { scope: 'LOCAL_FIELD', localFieldId: dto.owner_local_field_id };
  }

  private rejectConflictingHint(
    dto: CreateCamporeeOrderProductDto,
    expectedScope: CamporeeOrderOwnerScope,
    allowed: {
      owner_division_id?: number;
      owner_union_id?: number;
      owner_local_field_id?: number;
    },
  ): void {
    if (dto.owner_scope !== undefined && dto.owner_scope !== expectedScope) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
      );
    }

    if (
      typeof dto.owner_division_id === 'number' &&
      dto.owner_division_id !== allowed.owner_division_id
    ) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }
    if (
      typeof dto.owner_union_id === 'number' &&
      dto.owner_union_id !== allowed.owner_union_id
    ) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }
    if (
      typeof dto.owner_local_field_id === 'number' &&
      dto.owner_local_field_id !== allowed.owner_local_field_id
    ) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }
  }

  private assertOwnerImmutable(dto: UpdateCamporeeOrderProductDto): void {
    for (const key of OWNER_MUTATION_KEYS) {
      if (dto[key] !== undefined) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
        );
      }
    }
  }

  private async requireWritableProduct(
    productId: string,
    actor: CamporeeOrderActor,
  ): Promise<CatalogProduct> {
    const product = await this.prisma.camporee_order_products.findUnique({
      where: { camporee_order_product_id: productId },
    });
    if (!product) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_ORDER_NOT_FOUND);
    }
    const owner = await this.hydrateOwner(product);
    if (!canManageCatalog(actor, owner)) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }
    return product;
  }

  private async hydrateOwner(
    product: CatalogProduct,
  ): Promise<CamporeeOrderOwner> {
    if (product.owner_scope === 'DIVISION') {
      return {
        scope: 'DIVISION',
        divisionId: product.owner_division_id ?? undefined,
      };
    }

    if (product.owner_scope === 'UNION') {
      let divisionId: number | undefined;
      if (typeof product.owner_union_id === 'number') {
        const union = await this.prisma.unions.findUnique({
          where: { union_id: product.owner_union_id },
          select: { division_id: true },
        });
        divisionId = union?.division_id;
      }
      return {
        scope: 'UNION',
        unionId: product.owner_union_id ?? undefined,
        divisionId,
      };
    }

    let unionId: number | undefined;
    let divisionId: number | undefined;
    if (typeof product.owner_local_field_id === 'number') {
      const localField = await this.prisma.local_fields.findUnique({
        where: { local_field_id: product.owner_local_field_id },
        select: {
          union_id: true,
          unions: { select: { division_id: true } },
        },
      });
      unionId = localField?.union_id;
      divisionId = localField?.unions?.division_id;
    }
    return {
      scope: 'LOCAL_FIELD',
      localFieldId: product.owner_local_field_id ?? undefined,
      unionId,
      divisionId,
    };
  }

  private async buildReadWhere(
    actor: CamporeeOrderActor,
  ): Promise<Record<string, unknown> | null> {
    const { territory } = actor;
    if (territory.level === 'all') {
      return {};
    }
    if (territory.level === 'open' || territory.level === 'unconfigured') {
      return null;
    }

    const ancestors = await this.resolveAncestorIds(actor);
    if (territory.level === 'local_field') {
      return {
        OR: [
          {
            owner_scope: 'LOCAL_FIELD',
            owner_local_field_id: ancestors.localFieldId,
          },
          ...(typeof ancestors.unionId === 'number'
            ? [
                {
                  owner_scope: 'UNION',
                  owner_union_id: ancestors.unionId,
                },
              ]
            : []),
          ...(typeof ancestors.divisionId === 'number'
            ? [
                {
                  owner_scope: 'DIVISION',
                  owner_division_id: ancestors.divisionId,
                },
              ]
            : []),
        ],
      };
    }

    if (territory.level === 'union') {
      return {
        OR: [
          {
            owner_scope: 'UNION',
            owner_union_id: ancestors.unionId,
          },
          ...(typeof ancestors.divisionId === 'number'
            ? [
                {
                  owner_scope: 'DIVISION',
                  owner_division_id: ancestors.divisionId,
                },
              ]
            : []),
        ],
      };
    }

    return {
      owner_scope: 'DIVISION',
      owner_division_id: ancestors.divisionId,
    };
  }

  private async isInReadCascade(
    actor: CamporeeOrderActor,
    product: CatalogProduct,
  ): Promise<boolean> {
    const where = await this.buildReadWhere(actor);
    if (!where) {
      return false;
    }
    if (Object.keys(where).length === 0) {
      return true;
    }

    const ancestors = await this.resolveAncestorIds(actor);
    if (product.owner_scope === 'LOCAL_FIELD') {
      return (
        actor.territory.level === 'local_field' &&
        product.owner_local_field_id === ancestors.localFieldId
      );
    }
    if (product.owner_scope === 'UNION') {
      return (
        (actor.territory.level === 'union' ||
          actor.territory.level === 'local_field') &&
        product.owner_union_id === ancestors.unionId
      );
    }
    return product.owner_division_id === ancestors.divisionId;
  }

  private async resolveAncestorIds(
    actor: CamporeeOrderActor,
  ): Promise<AncestorIds> {
    const { territory } = actor;
    if (territory.level === 'local_field') {
      const localField = await this.prisma.local_fields.findUnique({
        where: { local_field_id: territory.localFieldId },
        select: {
          union_id: true,
          unions: { select: { division_id: true } },
        },
      });
      return {
        localFieldId: territory.localFieldId,
        unionId: localField?.union_id ?? territory.unionId,
        divisionId: localField?.unions?.division_id ?? territory.divisionId,
      };
    }

    if (territory.level === 'union') {
      const union = await this.prisma.unions.findUnique({
        where: { union_id: territory.unionId },
        select: { division_id: true },
      });
      return {
        unionId: territory.unionId,
        divisionId: union?.division_id ?? territory.divisionId,
      };
    }

    if (territory.level === 'division') {
      return { divisionId: territory.divisionId };
    }

    return {};
  }

  private normalizeOptionLabel(sizeScheme: SizeScheme, label: string): string {
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > 40) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
      );
    }
    if (sizeScheme === 'NONE') {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
      );
    }
    if (sizeScheme === 'NUMERIC' && !NUMERIC_LABEL.test(trimmed)) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
      );
    }
    return trimmed;
  }
}
