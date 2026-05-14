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
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MATERIALS_APPROVE,
  MATERIALS_CREATE,
  MATERIALS_DELIVER,
  MATERIALS_READ,
} from '../shared/permissions';
import { resolveActorLocalField } from '../shared/actor-local-field';
import { OrdersService } from './orders.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto';
import { UpdateOrderLineDto } from './dto/update-order-line.dto';
import { OrderDto } from './dto/order.dto';
import { PaginatedOrdersDto } from './dto/order-summary.dto';

@ApiTags('Materials — Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('materials/orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly prisma: PrismaService,
  ) {}

  // LF-scoped callers see only their LF's orders; unscoped admin/super-admin
  // see everything unless they pass ?local_field_id=N.
  private async resolveLfForRead(
    req: any,
    localFieldIdParam: string | undefined,
  ): Promise<number | undefined> {
    const scope = await resolveActorLocalField(this.prisma, req.authorization);
    if (scope.scope === 'single') return scope.localFieldId;
    const parsed =
      localFieldIdParam !== undefined ? parseInt(localFieldIdParam, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/materials/orders
  // REQ-ORD-001, REQ-ORD-002, SC-01, SC-02
  // ---------------------------------------------------------------------------

  @Post()
  @RequirePermissions(MATERIALS_CREATE)
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, type: OrderDto })
  @ApiResponse({ status: 404, description: 'Product not found or inactive' })
  create(@Body() dto: CreateOrderDto, @Request() req: any): Promise<OrderDto> {
    const userId: string = req.user.sub;
    return this.ordersService.createOrder(dto, userId);
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materials/orders/history
  // REQ-ORD-005 — MUST be declared BEFORE /:folio (static before param — R-1 rule)
  // Always scoped to the caller's own orders, regardless of permissions.
  // ---------------------------------------------------------------------------

  @Get('history')
  @RequirePermissions(MATERIALS_READ)
  @ApiOperation({
    summary: "Caller's own order history (always scoped to own orders)",
  })
  @ApiResponse({ status: 200, type: PaginatedOrdersDto })
  async history(
    @Query() query: ListOrdersQueryDto,
    @Request() req: any,
    @Query('local_field_id') localFieldIdParam?: string,
  ): Promise<PaginatedOrdersDto> {
    const userId: string = req.user.sub;
    const localFieldId = await this.resolveLfForRead(req, localFieldIdParam);
    return this.ordersService.historial(query, userId, localFieldId);
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materials/orders
  // REQ-ORD-003, REQ-ORD-004, SC-11
  // Visibility is server-side: without materials:approve → own orders only.
  // ---------------------------------------------------------------------------

  @Get()
  @RequirePermissions(MATERIALS_READ)
  @ApiOperation({ summary: 'List orders (visibility + LF aware)' })
  @ApiResponse({ status: 200, type: PaginatedOrdersDto })
  async list(
    @Query() query: ListOrdersQueryDto,
    @Request() req: any,
    @Query('local_field_id') localFieldIdParam?: string,
  ): Promise<PaginatedOrdersDto> {
    // Permission resolution:
    // PermissionsGuard sets req.authorization = resolved.authorization after the permission check.
    // The AuthorizationSnapshot exposes effective.permissions — a flat string[] of all granted perms.
    const effectivePermissions: string[] =
      req.authorization?.effective?.permissions ?? [];
    const canApprove = effectivePermissions.includes(MATERIALS_APPROVE);

    const localFieldId = await this.resolveLfForRead(req, localFieldIdParam);

    return this.ordersService.list(
      query,
      { id: req.user.sub, canApprove },
      localFieldId,
    );
  }

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/materials/orders/:folio/lines/:lineId
  // REQ-ORD-006, REQ-ORD-009, R-arch-4, SC-15, SC-16
  // ---------------------------------------------------------------------------

  @Patch(':folio/lines/:lineId')
  @RequirePermissions(MATERIALS_APPROVE)
  @ApiOperation({
    summary:
      'Update line availability (campo local only, en_revision orders only)',
  })
  @ApiParam({ name: 'folio', type: String })
  @ApiParam({ name: 'lineId', type: String, description: 'Line UUID' })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({
    status: 400,
    description: 'qty_disponible_required or qty_disponible_out_of_range',
  })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  @ApiResponse({
    status: 422,
    description: 'lines_frozen — order not in en_revision',
  })
  patchLine(
    @Param('folio') folio: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateOrderLineDto,
    @Request() req: any,
  ): Promise<OrderDto> {
    return this.ordersService.patchLine(folio, lineId, dto, {
      id: req.user.sub,
    });
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/materials/orders/:folio/approve
  // REQ-ORD-007, REQ-ORD-008, REQ-INV-004, SC-03, SC-04, SC-07, SC-18
  // MUST be declared BEFORE GET :folio (static segment :folio/approve takes priority)
  // ---------------------------------------------------------------------------

  @Post(':folio/approve')
  @RequirePermissions(MATERIALS_APPROVE)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve order — allocate folio, decrement stock, snapshot config',
  })
  @ApiParam({
    name: 'folio',
    type: String,
    description: 'Order folio_referencia or UUID',
  })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 409, description: 'Insufficient stock' })
  @ApiResponse({
    status: 422,
    description: 'state_machine_violation or unresolved_lines',
  })
  approve(
    @Param('folio') folio: string,
    @Request() req: any,
  ): Promise<OrderDto> {
    return this.ordersService.approve(folio, { id: req.user.sub });
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/materials/orders/:folio/cancel
  // REQ-ORD-010, REQ-INV-005, SC-08, SC-09
  // MUST be declared BEFORE GET :folio
  // ---------------------------------------------------------------------------

  @Post(':folio/cancel')
  @RequirePermissions(MATERIALS_READ)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Cancel order — allowed from en_revision (own or campo), aprobada, pagada (campo only)',
  })
  @ApiParam({
    name: 'folio',
    type: String,
    description: 'Order folio_referencia or UUID',
  })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({
    status: 403,
    description: 'cancel_forbidden — insufficient permission or not owner',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({
    status: 422,
    description: 'state_machine_violation — order in terminal state',
  })
  cancel(
    @Param('folio') folio: string,
    @Body() dto: CancelOrderDto,
    @Request() req: any,
  ): Promise<OrderDto> {
    const effectivePermissions: string[] =
      req.authorization?.effective?.permissions ?? [];
    const canApprove = effectivePermissions.includes(MATERIALS_APPROVE);
    return this.ordersService.cancel(folio, dto, {
      id: req.user.sub,
      canApprove,
    });
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/materials/orders/:folio/deliver
  // REQ-ORD-011 — terminal transition pagada → entregada
  // MUST be declared BEFORE GET :folio
  // ---------------------------------------------------------------------------

  @Post(':folio/deliver')
  @RequirePermissions(MATERIALS_DELIVER)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Mark order as delivered — terminal transition (pagada → entregada)',
  })
  @ApiParam({
    name: 'folio',
    type: String,
    description: 'Order folio_referencia or UUID',
  })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({
    status: 422,
    description: 'state_machine_violation — order not in pagada',
  })
  deliver(
    @Param('folio') folio: string,
    @Request() req: any,
  ): Promise<OrderDto> {
    return this.ordersService.deliver(folio, { id: req.user.sub });
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materials/orders/:folio
  // MUST be LAST (param route) — static routes above must be declared first
  // REQ-ORD-003, SC-11
  // ---------------------------------------------------------------------------

  @Get(':folio')
  @RequirePermissions(MATERIALS_READ)
  @ApiOperation({ summary: 'Get full order detail by folio' })
  @ApiParam({ name: 'folio', type: String })
  @ApiResponse({ status: 200, type: OrderDto })
  @ApiResponse({
    status: 403,
    description: 'Access denied (not owner and no approve perm)',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  getByFolio(
    @Param('folio') folio: string,
    @Request() req: any,
  ): Promise<OrderDto> {
    const effectivePermissions: string[] =
      req.authorization?.effective?.permissions ?? [];
    const canApprove = effectivePermissions.includes(MATERIALS_APPROVE);

    return this.ordersService.getByFolio(folio, {
      id: req.user.sub,
      canApprove,
    });
  }
}
