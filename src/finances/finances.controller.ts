import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { FinancesService } from './finances.service';
import {
  CreateFinanceDto,
  UpdateFinanceDto,
  GetAllTransactionsDto,
} from './dto';
import {
  JwtAuthGuard,
  ClubRolesGuard,
  PermissionsGuard,
} from '../common/guards';
import {
  AuthorizationResource,
  ClubRoles,
  RequirePermissions,
} from '../common/decorators';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('finances')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class FinancesController {
  constructor(private readonly financesService: FinancesService) {}

  // ========================================
  // CATEGORÍAS
  // ========================================

  @Get('finances/categories')
  @RequirePermissions('finances:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Listar categorías financieras',
    description: 'Lista todas las categorías de ingresos y egresos',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    type: Number,
    description: '0=Ingresos, 1=Egresos',
  })
  @ApiResponse({ status: 200, description: 'Lista de categorías' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires finances:read',
  })
  async getCategories(
    @Query('type', new ParseIntPipe({ optional: true })) type?: number,
  ) {
    return this.financesService.getCategories(type);
  }

  // ========================================
  // FINANZAS POR CLUB
  // ========================================

  @Get('clubs/:clubId/finances/transactions')
  @RequirePermissions('finances:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Listar todas las transacciones del club (paginadas)',
    description:
      'Obtiene todas las transacciones financieras del club con soporte de paginación, búsqueda, filtros por tipo y rango de fechas.',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Número de página (1-indexed, default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Elementos por página (max: 100, default: 20)',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['income', 'expense'],
    description: 'Filtrar por tipo: income o expense',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Búsqueda en descripción y nombre de categoría',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Fecha inicio del rango YYYY-MM-DD (inclusive)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'Fecha fin del rango YYYY-MM-DD (inclusive)',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['date', 'amount', 'category'],
    description: 'Campo de ordenamiento (default: date)',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['asc', 'desc'],
    description: 'Dirección del ordenamiento (default: desc)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de transacciones con meta de paginación',
  })
  @ApiResponse({ status: 404, description: 'Club no encontrado' })
  async getAllTransactions(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Query() dto: GetAllTransactionsDto,
    @Request() req?: any,
  ) {
    const userSectionId: number | null =
      (req?.authorization?.effective?.scope?.club?.section?.club_section_id as
        | number
        | undefined) ?? null;

    return this.financesService.getAllTransactions(clubId, dto, userSectionId);
  }

  @Get('clubs/:clubId/finances')
  @RequirePermissions('finances:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Listar movimientos financieros del club',
    description: 'Obtiene todos los movimientos de las instancias del club',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'clubTypeId', required: false, type: Number })
  @ApiQuery({ name: 'categoryId', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Lista paginada de movimientos' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires finances:read',
  })
  async findByClub(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
    @Query('month', new ParseIntPipe({ optional: true })) month?: number,
    @Query('clubTypeId', new ParseIntPipe({ optional: true }))
    clubTypeId?: number,
    @Query('categoryId', new ParseIntPipe({ optional: true }))
    categoryId?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Request() req?: any,
  ) {
    const pagination = new PaginationDto();
    if (page) pagination.page = page;
    if (limit) pagination.limit = Math.min(limit, 100);

    const userSectionId: number | null =
      (req?.authorization?.effective?.scope?.club?.section?.club_section_id as
        | number
        | undefined) ?? null;

    return this.financesService.findByClub(
      clubId,
      { year, month, clubTypeId, categoryId },
      pagination,
      userSectionId,
    );
  }

  @Get('clubs/:clubId/finances/summary')
  @RequirePermissions('finances:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Resumen financiero del club',
    description: 'Obtiene el resumen de ingresos, egresos y balance',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Resumen financiero' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires finances:read',
  })
  async getSummary(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
    @Query('month', new ParseIntPipe({ optional: true })) month?: number,
    @Request() req?: any,
  ) {
    const userSectionId: number | null =
      (req?.authorization?.effective?.scope?.club?.section?.club_section_id as
        | number
        | undefined) ?? null;

    return this.financesService.getSummary(clubId, year, month, userSectionId);
  }

  @Post('clubs/:clubId/finances')
  @UseGuards(ClubRolesGuard)
  @ClubRoles('director', 'deputy-director', 'treasurer')
  @RequirePermissions('finances:create')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Crear movimiento financiero',
    description: 'Crea un nuevo ingreso o egreso (requiere rol de tesorería)',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiResponse({ status: 201, description: 'Movimiento creado' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async create(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Body() dto: CreateFinanceDto,
    @Request() req: any,
  ) {
    return this.financesService.create(dto, req.user.sub, clubId);
  }

  // ========================================
  // MOVIMIENTO INDIVIDUAL
  // ========================================

  @Get('finances/:financeId')
  @RequirePermissions('finances:read')
  @AuthorizationResource({ type: 'finance', idParam: 'financeId' })
  @ApiOperation({ summary: 'Obtener movimiento por ID' })
  @ApiParam({ name: 'financeId', type: Number })
  @ApiResponse({ status: 200, description: 'Movimiento encontrado' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires finances:read',
  })
  @ApiResponse({ status: 404, description: 'Movimiento no encontrado' })
  async findOne(@Param('financeId', ParseIntPipe) financeId: number) {
    return this.financesService.findOne(financeId);
  }

  @Patch('finances/:financeId')
  @RequirePermissions('finances:update')
  @AuthorizationResource({ type: 'finance', idParam: 'financeId' })
  @ApiOperation({ summary: 'Actualizar movimiento' })
  @ApiParam({ name: 'financeId', type: Number })
  @ApiResponse({ status: 200, description: 'Movimiento actualizado' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires finances:update',
  })
  @ApiResponse({ status: 404, description: 'Movimiento no encontrado' })
  async update(
    @Param('financeId', ParseIntPipe) financeId: number,
    @Body() dto: UpdateFinanceDto,
    @Request() req: any,
  ) {
    return this.financesService.update(financeId, dto, req.user.sub);
  }

  @Delete('finances/:financeId')
  @RequirePermissions('finances:delete')
  @AuthorizationResource({ type: 'finance', idParam: 'financeId' })
  @ApiOperation({ summary: 'Desactivar movimiento' })
  @ApiParam({ name: 'financeId', type: Number })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires finances:delete',
  })
  @ApiResponse({ status: 404, description: 'Movimiento no encontrado' })
  @ApiQuery({
    name: 'reason',
    required: false,
    type: String,
    description:
      'Justificación para eliminación en período cerrado (solo admin)',
  })
  @ApiResponse({ status: 200, description: 'Movimiento desactivado' })
  async remove(
    @Param('financeId', ParseIntPipe) financeId: number,
    @Request() req: any,
    @Query('reason') reason?: string,
  ) {
    return this.financesService.remove(financeId, req.user.sub, reason);
  }
}
