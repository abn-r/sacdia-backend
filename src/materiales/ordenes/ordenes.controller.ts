import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthorizationResource, RequirePermissions } from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import {
  MATERIALES_APPROVE,
  MATERIALES_CREATE,
  MATERIALES_READ,
} from '../shared/permissions';
import { OrdenesService } from './ordenes.service';
import { CreateOrdenDto } from './dto/create-orden.dto';
import { ListOrdenesQueryDto } from './dto/list-ordenes.query.dto';
import { UpdateOrdenLineDto } from './dto/update-orden-line.dto';
import { OrdenDto } from './dto/orden.dto';
import { PaginatedOrdenesDto } from './dto/orden-summary.dto';

@ApiTags('Materiales — Órdenes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller('materiales/ordenes')
export class OrdenesController {
  constructor(private readonly ordenesService: OrdenesService) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/materiales/ordenes
  // REQ-ORD-001, REQ-ORD-002, SC-01, SC-02
  // ---------------------------------------------------------------------------

  @Post()
  @RequirePermissions(MATERIALES_CREATE)
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, type: OrdenDto })
  @ApiResponse({ status: 404, description: 'Product not found or inactive' })
  create(@Body() dto: CreateOrdenDto, @Request() req: any): Promise<OrdenDto> {
    const userId: string = req.user.sub;
    return this.ordenesService.createOrder(dto, userId);
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materiales/ordenes/historial
  // REQ-ORD-005 — MUST be declared BEFORE /:folio (static before param — R-1 rule)
  // Always scoped to the caller's own orders, regardless of permissions.
  // ---------------------------------------------------------------------------

  @Get('historial')
  @RequirePermissions(MATERIALES_READ)
  @ApiOperation({
    summary: "Caller's own order history (always scoped to own orders)",
  })
  @ApiResponse({ status: 200, type: PaginatedOrdenesDto })
  historial(
    @Query() query: ListOrdenesQueryDto,
    @Request() req: any,
  ): Promise<PaginatedOrdenesDto> {
    const userId: string = req.user.sub;
    return this.ordenesService.historial(query, userId);
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materiales/ordenes
  // REQ-ORD-003, REQ-ORD-004, SC-11
  // Visibility is server-side: without materiales:approve → own orders only.
  // ---------------------------------------------------------------------------

  @Get()
  @RequirePermissions(MATERIALES_READ)
  @ApiOperation({ summary: 'List orders (visibility-aware)' })
  @ApiResponse({ status: 200, type: PaginatedOrdenesDto })
  list(
    @Query() query: ListOrdenesQueryDto,
    @Request() req: any,
  ): Promise<PaginatedOrdenesDto> {
    // Permission resolution:
    // PermissionsGuard sets req.authorization = resolved.authorization after the permission check.
    // The AuthorizationSnapshot exposes effective.permissions — a flat string[] of all granted perms.
    const effectivePermissions: string[] =
      req.authorization?.effective?.permissions ?? [];
    const canApprove = effectivePermissions.includes(MATERIALES_APPROVE);

    return this.ordenesService.list(query, {
      id: req.user.sub,
      canApprove,
    });
  }

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/materiales/ordenes/:folio/lineas/:lineId
  // REQ-ORD-006, REQ-ORD-009, R-arch-4, SC-15, SC-16
  // ---------------------------------------------------------------------------

  @Patch(':folio/lineas/:lineId')
  @RequirePermissions(MATERIALES_APPROVE)
  @ApiOperation({
    summary: 'Update line availability (campo local only, en_revision orders only)',
  })
  @ApiParam({ name: 'folio', type: String })
  @ApiParam({ name: 'lineId', type: String, description: 'Line UUID' })
  @ApiResponse({ status: 200, type: OrdenDto })
  @ApiResponse({ status: 400, description: 'qty_disponible_required or qty_disponible_out_of_range' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  @ApiResponse({ status: 422, description: 'lines_frozen — order not in en_revision' })
  patchLine(
    @Param('folio') folio: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateOrdenLineDto,
    @Request() req: any,
  ): Promise<OrdenDto> {
    return this.ordenesService.patchLine(folio, lineId, dto, { id: req.user.sub });
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/materiales/ordenes/:folio/aprobar
  // REQ-ORD-007, REQ-ORD-008, REQ-INV-004, SC-03, SC-04, SC-07, SC-18
  // MUST be declared BEFORE GET :folio (static segment :folio/aprobar takes priority)
  // ---------------------------------------------------------------------------

  @Post(':folio/aprobar')
  @RequirePermissions(MATERIALES_APPROVE)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve order — allocate folio, decrement stock, snapshot config',
  })
  @ApiParam({ name: 'folio', type: String, description: 'Order folio_referencia or UUID' })
  @ApiResponse({ status: 200, type: OrdenDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 409, description: 'Insufficient stock' })
  @ApiResponse({ status: 422, description: 'state_machine_violation or unresolved_lines' })
  approve(
    @Param('folio') folio: string,
    @Request() req: any,
  ): Promise<OrdenDto> {
    return this.ordenesService.approve(folio, { id: req.user.sub });
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materiales/ordenes/:folio
  // MUST be LAST (param route) — static routes above must be declared first
  // REQ-ORD-003, SC-11
  // ---------------------------------------------------------------------------

  @Get(':folio')
  @RequirePermissions(MATERIALES_READ)
  @ApiOperation({ summary: 'Get full order detail by folio' })
  @ApiParam({ name: 'folio', type: String })
  @ApiResponse({ status: 200, type: OrdenDto })
  @ApiResponse({ status: 403, description: 'Access denied (not owner and no approve perm)' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  getByFolio(
    @Param('folio') folio: string,
    @Request() req: any,
  ): Promise<OrdenDto> {
    const effectivePermissions: string[] =
      req.authorization?.effective?.permissions ?? [];
    const canApprove = effectivePermissions.includes(MATERIALES_APPROVE);

    return this.ordenesService.getByFolio(folio, {
      id: req.user.sub,
      canApprove,
    });
  }
}
