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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { FinancesService } from './finances.service';
import { FinanceReportsService } from './finance-reports.service';
import {
  CreateFinanceDto,
  UpdateFinanceDto,
  GetAllTransactionsDto,
  FinanceExportQueryDto,
  FinanceOverviewQueryDto,
  FinanceReportQueryDto,
  RemoveFinanceDto,
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
import {
  ALLOWED_MIME_TYPES,
  FileValidationPipe,
} from '../common/pipes/file-validation.pipe';
import { ClubRole } from '../common/authorization/roles';

@ApiTags('finances')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class FinancesController {
  constructor(
    private readonly financesService: FinancesService,
    private readonly financeReportsService: FinanceReportsService,
  ) {}

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

  @Get('finances/overview')
  @RequirePermissions('finances:read')
  @AuthorizationResource({
    type: 'global',
    bind: [
      {
        kind: 'local_field',
        source: 'query',
        field: 'local_field_id',
        optional: true,
      },
    ],
  })
  @ApiOperation({
    summary:
      'Vista consolidada de finanzas por club (campo local / unión / división)',
    description:
      'Por cada club del territorio del solicitante: ingresos, egresos, neto, saldo acumulado, movimientos, meses sin movimientos y último movimiento. Requiere un rol global con finances:read (admin, campo local, unión, división); el servicio filtra por el territorio del rol.',
  })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Resumen por club y totales' })
  @ApiResponse({ status: 403, description: 'Sin rol global con finances:read' })
  async getOverview(
    @Query() query: FinanceOverviewQueryDto,
    @Request() req: any,
  ) {
    return this.financeReportsService.getOverview(req.user.sub, query);
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
        number | undefined) ?? null;

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
  @ApiQuery({ name: 'club_section_id', required: false, type: Number })
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
    @Query('club_section_id', new ParseIntPipe({ optional: true }))
    clubSectionId?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Request() req?: any,
  ) {
    const pagination = new PaginationDto();
    if (page) pagination.page = page;
    if (limit) pagination.limit = Math.min(limit, 100);

    const userSectionId: number | null =
      (req?.authorization?.effective?.scope?.club?.section?.club_section_id as
        number | undefined) ?? null;

    return this.financesService.findByClub(
      clubId,
      { year, month, clubTypeId, categoryId, clubSectionId },
      pagination,
      userSectionId,
    );
  }

  @Get('clubs/:clubId/finances/summary')
  @RequirePermissions('finances:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Resumen financiero del club',
    description:
      'Ingresos y egresos del periodo pedido (mes, año o todo) y balance acumulado de toda la historia hasta el fin del periodo. year_income/year_expenses son el acumulado del año eclesiástico hasta el mes. period_closed indica si el mes está cerrado.',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'club_section_id', required: false, type: Number })
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
    @Query('club_section_id', new ParseIntPipe({ optional: true }))
    clubSectionId?: number,
    @Request() req?: any,
  ) {
    const userSectionId: number | null =
      (req?.authorization?.effective?.scope?.club?.section?.club_section_id as
        number | undefined) ?? null;

    return this.financesService.getSummary(
      clubId,
      year,
      month,
      userSectionId,
      clubSectionId ?? null,
    );
  }

  @Get('clubs/:clubId/finances/by-category')
  @RequirePermissions('finances:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Totales por categoría',
    description:
      'Ingresos y egresos agrupados por categoría (nombres traducidos), de mayor a menor total.',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiQuery({ name: 'year', required: true, type: Number })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'club_section_id', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Totales por categoría' })
  @ApiResponse({ status: 403, description: 'Sección fuera de tu alcance' })
  @ApiResponse({ status: 404, description: 'Club o sección no encontrados' })
  async getByCategory(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Query() query: FinanceReportQueryDto,
    @Request() req?: any,
  ) {
    const userSectionId: number | null =
      (req?.authorization?.effective?.scope?.club?.section?.club_section_id as
        number | undefined) ?? null;

    return this.financeReportsService.getByCategory(
      clubId,
      query,
      userSectionId,
    );
  }

  @Get('clubs/:clubId/finances/export')
  @RequirePermissions('finances:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Exportar movimientos a Excel o PDF',
    description:
      'Descarga un .xlsx (hojas Movimientos y Resumen) o, con format=pdf, un PDF carta con resumen, totales por categoría y movimientos. Sin month se exporta el año completo.',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiQuery({ name: 'year', required: true, type: Number })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'club_section_id', required: false, type: Number })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['xlsx', 'pdf'],
    description: 'Formato del archivo (por defecto xlsx)',
  })
  @ApiResponse({ status: 200, description: 'Archivo .xlsx o .pdf' })
  @ApiResponse({ status: 403, description: 'Sección fuera de tu alcance' })
  @ApiResponse({ status: 404, description: 'Club o sección no encontrados' })
  async exportMovements(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Query() query: FinanceExportQueryDto,
    @Res() res: Response,
    @Request() req?: any,
  ) {
    const userSectionId: number | null =
      (req?.authorization?.effective?.scope?.club?.section?.club_section_id as
        number | undefined) ?? null;

    const file = await this.financeReportsService.buildExport(
      clubId,
      query,
      userSectionId,
      req?.user?.sub
        ? { userId: req.user.sub, authorization: req.authorization }
        : undefined,
    );

    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': file.contentDisposition,
      'Content-Length': file.buffer.length,
      ...(file.cacheControl ? { 'Cache-Control': file.cacheControl } : {}),
    });
    res.end(file.buffer);
  }

  @Post('clubs/:clubId/finances')
  @UseGuards(ClubRolesGuard)
  @ClubRoles(
    ClubRole.DIRECTOR,
    ClubRole.DEPUTY_DIRECTOR,
    ClubRole.TREASURER,
    ClubRole.SECRETARY_TREASURER,
  )
  @RequirePermissions('finances:create')
  @AuthorizationResource({
    type: 'club',
    clubIdParam: 'clubId',
    bind: [{ kind: 'club_section', source: 'body', field: 'club_section_id' }],
  })
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

  @Post('finances/:financeId/evidences')
  @RequirePermissions('finances:update')
  @AuthorizationResource({ type: 'finance', idParam: 'financeId' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir foto de evidencia de un movimiento financiero',
    description:
      'Agrega una foto de evidencia al ingreso o egreso. Máximo 3 fotos activas por movimiento.',
  })
  @ApiParam({ name: 'financeId', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Foto del comprobante (JPEG, PNG o WebP, máximo 5MB)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Evidencia subida exitosamente' })
  @ApiResponse({
    status: 400,
    description: 'Archivo inválido o límite excedido',
  })
  @ApiResponse({ status: 404, description: 'Movimiento no encontrado' })
  async uploadEvidence(
    @Param('financeId', ParseIntPipe) financeId: number,
    @UploadedFile(
      new FileValidationPipe({
        allowedMimeTypes: ALLOWED_MIME_TYPES.IMAGES,
      }),
    )
    file: Express.Multer.File,
    @Request() req: any,
  ) {
    return this.financesService.uploadEvidence(financeId, req.user.sub, file);
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
      'Nota de cierre (5 a 500 caracteres), obligatoria en mes cerrado (solo admin). También se acepta en el body como { reason }.',
  })
  @ApiResponse({ status: 200, description: 'Movimiento desactivado' })
  async remove(
    @Param('financeId', ParseIntPipe) financeId: number,
    @Request() req: any,
    @Body() body?: RemoveFinanceDto,
    @Query('reason') reasonQuery?: string,
  ) {
    // Body wins; `?reason=` stays supported for old clients.
    return this.financesService.remove(
      financeId,
      req.user.sub,
      body?.reason ?? reasonQuery,
    );
  }
}
