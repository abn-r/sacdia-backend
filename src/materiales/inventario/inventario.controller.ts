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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthorizationResource, RequirePermissions } from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { MATERIALES_MANAGE_INVENTORY } from '../shared/permissions';
import { InventarioService } from './inventario.service';
import { ListInventarioQueryDto } from './dto/list-inventario.query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantStockDto } from './dto/update-variant-stock.dto';
import {
  InventarioProductDto,
  PaginatedInventarioProductDto,
  VariantStockUpdateResponseDto,
} from './dto/inventario-product.dto';

@ApiTags('Materiales — Inventario')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller('materiales/inventario')
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  // ---------------------------------------------------------------------------
  // GET /materiales/inventario
  // REQ-INV-001 — paginated list including inactive products (campo/admin view)
  // ---------------------------------------------------------------------------

  @Get()
  @RequirePermissions(MATERIALES_MANAGE_INVENTORY)
  @ApiOperation({ summary: 'List all products (including inactive) for inventory management' })
  @ApiResponse({ status: 200, type: PaginatedInventarioProductDto })
  list(@Query() query: ListInventarioQueryDto): Promise<PaginatedInventarioProductDto> {
    return this.inventarioService.list(query);
  }

  // ---------------------------------------------------------------------------
  // POST /materiales/inventario
  // REQ-INV-002 — create product
  // ---------------------------------------------------------------------------

  @Post()
  @RequirePermissions(MATERIALES_MANAGE_INVENTORY)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new product' })
  @ApiResponse({ status: 201, type: InventarioProductDto })
  @ApiResponse({ status: 400, description: 'Invalid category or club_type' })
  @ApiResponse({ status: 409, description: 'SKU already exists' })
  create(@Body() dto: CreateProductDto): Promise<InventarioProductDto> {
    return this.inventarioService.create(dto);
  }

  // ---------------------------------------------------------------------------
  // PATCH /materiales/inventario/:id
  // REQ-INV-003 — partial update (title, description, price, stock, active)
  // ---------------------------------------------------------------------------

  @Patch(':id')
  @RequirePermissions(MATERIALES_MANAGE_INVENTORY)
  @ApiOperation({ summary: 'Partially update a product' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: InventarioProductDto })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'Product has open orders (when deactivating)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<InventarioProductDto> {
    return this.inventarioService.update(id, dto);
  }

  // ---------------------------------------------------------------------------
  // DELETE /materiales/inventario/:id
  // REQ-INV-003 — soft-delete: sets active=false
  // ---------------------------------------------------------------------------

  @Delete(':id')
  @RequirePermissions(MATERIALES_MANAGE_INVENTORY)
  @ApiOperation({ summary: 'Soft-delete a product (sets active=false)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, schema: { properties: { id: { type: 'string' }, active: { type: 'boolean', example: false } } } })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'Product has open order lines' })
  softDelete(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; active: false }> {
    return this.inventarioService.softDelete(id);
  }

  // ---------------------------------------------------------------------------
  // PATCH /materiales/inventario/:id/variantes/:variantId
  // REQ-INV-006, SC-17 — update variant option stock; recomputes parent product.stock
  // :variantId is the material_variant_option.id (leaf node)
  // ---------------------------------------------------------------------------

  @Patch(':id/variantes/:variantId')
  @RequirePermissions(MATERIALES_MANAGE_INVENTORY)
  @ApiOperation({ summary: 'Update stock for a specific variant option; recomputes product total stock' })
  @ApiParam({ name: 'id', description: 'Product UUID', type: String })
  @ApiParam({ name: 'variantId', description: 'MaterialVariantOption UUID (leaf ID)', type: String })
  @ApiResponse({ status: 200, type: VariantStockUpdateResponseDto })
  @ApiResponse({ status: 400, description: 'stock < 0' })
  @ApiResponse({ status: 404, description: 'Product or variant option not found' })
  updateVariantStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantStockDto,
  ): Promise<VariantStockUpdateResponseDto> {
    return this.inventarioService.updateVariantStock(id, variantId, dto);
  }
}
