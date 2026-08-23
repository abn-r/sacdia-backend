import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { PrismaService } from '../../prisma/prisma.service';
import { MATERIALS_MANAGE_INVENTORY } from '../shared/permissions';
import {
  requireLocalFieldFor,
  resolveActorLocalField,
  resolveMaterialsListLocalFieldId,
} from '../shared/actor-local-field';
import { InventoryService } from './inventory.service';
import { ListInventoryQueryDto } from './dto/list-inventory.query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantStockDto } from './dto/update-variant-stock.dto';
import {
  InventoryProductDto,
  PaginatedInventoryProductDto,
  VariantStockUpdateResponseDto,
} from './dto/inventory-product.dto';

@ApiTags('Materials — Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('materials/inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /materials/inventory
  // REQ-INV-001 — paginated list including inactive products (campo/admin view)
  // ---------------------------------------------------------------------------

  @Get()
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @ApiOperation({
    summary:
      "List products for the caller's local_field (admins can pass ?local_field_id=N)",
  })
  @ApiQuery({
    name: 'local_field_id',
    required: false,
    type: Number,
    description:
      'Required when the caller is an unscoped admin/super-admin. Ignored for LF-scoped callers.',
  })
  @ApiResponse({ status: 200, type: PaginatedInventoryProductDto })
  async list(
    @Query() query: ListInventoryQueryDto,
    @Request() req: any,
    @Query('local_field_id') localFieldIdParam?: string,
  ): Promise<PaginatedInventoryProductDto> {
    // For listing we permit an unscoped admin to omit local_field_id and see
    // every LF's inventory at once. Union/division actors see their territory.
    const override =
      localFieldIdParam !== undefined
        ? parseInt(localFieldIdParam, 10)
        : undefined;
    const localFieldId = await resolveMaterialsListLocalFieldId(
      this.prisma,
      req.authorization,
      Number.isFinite(override) ? (override as number) : undefined,
    );
    return this.inventoryService.list(query, localFieldId);
  }

  // ---------------------------------------------------------------------------
  // POST /materials/inventory
  // REQ-INV-002 — create product
  // ---------------------------------------------------------------------------

  @Post()
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Create a product for the caller's local_field (admins can pass ?local_field_id=N)",
  })
  @ApiQuery({
    name: 'local_field_id',
    required: false,
    type: Number,
    description:
      'Required when the caller is an unscoped admin/super-admin. Must match the caller scope otherwise.',
  })
  @ApiResponse({ status: 201, type: InventoryProductDto })
  @ApiResponse({ status: 400, description: 'Invalid category or club_type' })
  @ApiResponse({ status: 409, description: 'SKU already exists in this LF' })
  async create(
    @Body() dto: CreateProductDto,
    @Request() req: any,
    @Query('local_field_id') localFieldIdParam?: string,
  ): Promise<InventoryProductDto> {
    const scope = await resolveActorLocalField(this.prisma, req.authorization);
    const override =
      localFieldIdParam !== undefined
        ? parseInt(localFieldIdParam, 10)
        : undefined;
    const localFieldId = await requireLocalFieldFor(
      this.prisma,
      scope,
      override,
      'write',
    );
    return this.inventoryService.create(dto, localFieldId);
  }

  // ---------------------------------------------------------------------------
  // PATCH /materials/inventory/:id
  // REQ-INV-003 — partial update (title, description, price, stock, active)
  // ---------------------------------------------------------------------------

  @Patch(':id')
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @ApiOperation({ summary: 'Partially update a product' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: InventoryProductDto })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({
    status: 409,
    description: 'Product has open orders (when deactivating)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<InventoryProductDto> {
    return this.inventoryService.update(id, dto);
  }

  // ---------------------------------------------------------------------------
  // DELETE /materials/inventory/:id
  // REQ-INV-003 — soft-delete: sets active=false
  // ---------------------------------------------------------------------------

  @Delete(':id')
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @ApiOperation({ summary: 'Soft-delete a product (sets active=false)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        id: { type: 'string' },
        active: { type: 'boolean', example: false },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'Product has open order lines' })
  softDelete(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; active: false }> {
    return this.inventoryService.softDelete(id);
  }

  // ---------------------------------------------------------------------------
  // PATCH /materials/inventory/:id/variants/:variantId
  // REQ-INV-006, SC-17 — update variant option stock; recomputes parent product.stock
  // :variantId is the material_variant_option.id (leaf node)
  // ---------------------------------------------------------------------------

  @Patch(':id/variants/:variantId')
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @ApiOperation({
    summary:
      'Update stock for a specific variant option; recomputes product total stock',
  })
  @ApiParam({ name: 'id', description: 'Product UUID', type: String })
  @ApiParam({
    name: 'variantId',
    description: 'MaterialVariantOption UUID (leaf ID)',
    type: String,
  })
  @ApiResponse({ status: 200, type: VariantStockUpdateResponseDto })
  @ApiResponse({ status: 400, description: 'stock < 0' })
  @ApiResponse({
    status: 404,
    description: 'Product or variant option not found',
  })
  updateVariantStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantStockDto,
  ): Promise<VariantStockUpdateResponseDto> {
    return this.inventoryService.updateVariantStock(id, variantId, dto);
  }
}
