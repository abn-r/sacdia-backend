import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  Res,
  ParseIntPipe,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
  ApiProduces,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { MonthlyReportsService } from './monthly-reports.service';
import { MonthlyReportArtifactsService } from './monthly-report-artifacts.service';
import { UpdateManualDataDto } from './dto';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

@ApiTags('monthly-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('monthly-reports')
export class MonthlyReportsController {
  constructor(
    private readonly monthlyReportsService: MonthlyReportsService,
    private readonly monthlyReportArtifactsService: MonthlyReportArtifactsService,
  ) {}

  // ========================================
  // PREVIEW — live auto-calculated data
  // ========================================

  @Get('preview/:enrollmentId')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'monthly_report', idParam: 'enrollmentId' })
  @ApiOperation({
    summary: 'Vista previa del informe mensual',
    description:
      'Retorna datos auto-calculados en tiempo real (miembros, directiva, honores, actividades, finanzas). No congela datos.',
  })
  @ApiParam({
    name: 'enrollmentId',
    description: 'ID de la matrícula del club',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({ name: 'month', description: 'Mes (1-12)', example: 3 })
  @ApiQuery({ name: 'year', description: 'Año', example: 2026 })
  @ApiResponse({
    status: 200,
    description: 'Vista previa con datos calculados',
  })
  @ApiResponse({ status: 404, description: 'Matrícula no encontrada' })
  async preview(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
  ) {
    const data = await this.monthlyReportsService.preview(
      enrollmentId,
      month,
      year,
    );
    return { status: 'success', data };
  }

  // ========================================
  // CREATE / GET DRAFT
  // ========================================

  @Post(':enrollmentId')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'monthly_report', idParam: 'enrollmentId' })
  @ApiOperation({
    summary: 'Obtener o crear borrador de informe mensual',
    description:
      'Retorna un informe existente o crea uno nuevo en estado borrador para el mes/año indicado.',
  })
  @ApiParam({
    name: 'enrollmentId',
    description: 'ID de la matrícula del club',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({ name: 'month', description: 'Mes (1-12)', example: 3 })
  @ApiQuery({ name: 'year', description: 'Año', example: 2026 })
  @ApiResponse({ status: 200, description: 'Informe borrador' })
  @ApiResponse({ status: 201, description: 'Informe borrador creado' })
  @ApiResponse({ status: 404, description: 'Matrícula no encontrada' })
  async getOrCreateDraft(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
  ) {
    const data = await this.monthlyReportsService.getOrCreateDraft(
      enrollmentId,
      month,
      year,
    );
    return { status: 'success', data };
  }

  // ========================================
  // UPDATE MANUAL DATA
  // ========================================

  @Patch(':reportId/manual-data')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'monthly_report', idParam: 'reportId' })
  @ApiOperation({
    summary: 'Actualizar datos manuales del informe',
    description:
      'Actualiza los campos manuales del informe (solo en estado borrador). Incluye reuniones, bautismos, estudios bíblicos, etc.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'ID del informe mensual',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({ status: 200, description: 'Datos manuales actualizados' })
  @ApiResponse({
    status: 400,
    description: 'Solo se pueden editar informes en borrador',
  })
  @ApiResponse({ status: 404, description: 'Informe no encontrado' })
  async updateManualData(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: UpdateManualDataDto,
  ) {
    const data = await this.monthlyReportsService.updateManualData(
      reportId,
      dto,
    );
    return { status: 'success', data };
  }

  // ========================================
  // GENERATE (freeze snapshot)
  // ========================================

  @Post(':reportId/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'monthly_report', idParam: 'reportId' })
  @ApiOperation({
    summary: 'Generar informe (congelar datos)',
    description:
      'Encola el congelamiento de snapshot_data, el PDF en R2 y el cambio a "generated". ' +
      'La respuesta vuelve al encolar. Poll GET :reportId hasta status generated. Solo informes en borrador.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'ID del informe mensual',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 202,
    description: 'Generación encolada (o corrida inline si Redis no está)',
  })
  @ApiResponse({
    status: 400,
    description: 'Solo se pueden generar informes en borrador',
  })
  @ApiResponse({ status: 404, description: 'Informe no encontrado' })
  async generate(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Req() req: any,
  ) {
    const data = await this.monthlyReportsService.enqueueGenerate(
      reportId,
      req.user.sub,
    );
    return {
      status: 'queued' in data && data.queued ? 'accepted' : 'success',
      data,
    };
  }

  // ========================================
  // SUBMIT
  // ========================================

  @Post(':reportId/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'monthly_report', idParam: 'reportId' })
  @ApiOperation({
    summary: 'Enviar informe al campo',
    description:
      'Cambia el estado del informe a "submitted". Solo informes generados pueden enviarse.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'ID del informe mensual',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({ status: 200, description: 'Informe enviado' })
  @ApiResponse({
    status: 400,
    description: 'Solo se pueden enviar informes generados',
  })
  @ApiResponse({ status: 404, description: 'Informe no encontrado' })
  async submit(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Req() req: any,
  ) {
    const data = await this.monthlyReportsService.submit(
      reportId,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  // ========================================
  // LIST REPORTS BY ENROLLMENT
  // ========================================

  @Get('enrollment/:enrollmentId')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'monthly_report', idParam: 'enrollmentId' })
  @ApiOperation({
    summary: 'Listar informes de una matrícula',
    description:
      'Retorna todos los informes mensuales de una matrícula, con filtro opcional por estado.',
  })
  @ApiParam({
    name: 'enrollmentId',
    description: 'ID de la matrícula del club',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'status',
    description: 'Filtrar por estado (draft, generated, submitted)',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Lista de informes' })
  @ApiResponse({ status: 404, description: 'Matrícula no encontrada' })
  async listReports(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Query('status') status?: string,
  ) {
    const data = await this.monthlyReportsService.listReports(
      enrollmentId,
      status,
    );
    return { status: 'success', data };
  }

  // ========================================
  // DOWNLOAD PDF
  // ========================================

  @Get(':reportId/pdf')
  @RequirePermissions('reports:download')
  @AuthorizationResource({ type: 'monthly_report', idParam: 'reportId' })
  @ApiOperation({
    summary: 'Descargar informe mensual en PDF',
    description:
      'Descarga el artefacto PDF privado almacenado en R2. Si falta o está desactualizado, el backend lo repara desde el snapshot congelado. Solo disponible para informes con estado "generated" o "submitted".',
  })
  @ApiParam({
    name: 'reportId',
    description: 'ID del informe mensual',
    type: 'string',
    format: 'uuid',
  })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'Archivo PDF del informe' })
  @ApiResponse({
    status: 400,
    description: 'Solo se pueden descargar informes generados o enviados',
  })
  @ApiResponse({ status: 404, description: 'Informe no encontrado' })
  async downloadPdf(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Res() res: Response,
  ) {
    const pdfBuffer =
      await this.monthlyReportArtifactsService.getStoredPdfBuffer(reportId);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="informe-mensual-${reportId}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  }

  // ========================================
  // REGENERATE STORED PDF ARTIFACT
  // ========================================

  @Post(':reportId/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('reports:write')
  @AuthorizationResource({ type: 'monthly_report', idParam: 'reportId' })
  @ApiOperation({
    summary: 'Regenerar el PDF almacenado del informe mensual',
    description:
      'Encola el rerender del PDF desde el snapshot congelado. La respuesta vuelve al encolar. ' +
      'GET :reportId/pdf repara el artefacto si el worker aún no terminó. ' +
      'Solo disponible para informes generados o enviados.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'ID del informe mensual',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 202,
    description: 'Regeneración encolada (o corrida inline si Redis no está)',
  })
  @ApiResponse({
    status: 400,
    description:
      'Solo se pueden regenerar informes generados o enviados con snapshot',
  })
  @ApiResponse({ status: 404, description: 'Informe no encontrado' })
  async regenerate(@Param('reportId', ParseUUIDPipe) reportId: string) {
    const data = await this.monthlyReportsService.enqueueRegenerate(reportId);
    return {
      status: 'queued' in data && data.queued ? 'accepted' : 'success',
      data,
    };
  }

  // ========================================
  // LIST REPORTS FOR ADMIN (multi-club supervision)
  // ========================================

  @Get('admin/list')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Listar reportes multi-club (admin/coordinator)' })
  @ApiQuery({ name: 'club_type_id', required: false, type: Number })
  @ApiQuery({ name: 'division_id', required: false, type: Number })
  @ApiQuery({ name: 'union_id', required: false, type: Number })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['draft', 'generated', 'submitted'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listForAdmin(
    @Req() req: any,
    @Query('club_type_id', new ParseIntPipe({ optional: true }))
    clubTypeId?: number,
    @Query('division_id', new ParseIntPipe({ optional: true }))
    divisionId?: number,
    @Query('union_id', new ParseIntPipe({ optional: true }))
    unionId?: number,
    @Query('local_field_id', new ParseIntPipe({ optional: true }))
    localFieldId?: number,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
    @Query('month', new ParseIntPipe({ optional: true })) month?: number,
    @Query('status') status?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const data = await this.monthlyReportsService.listForAdmin(req.user.sub, {
      clubTypeId,
      divisionId,
      unionId,
      localFieldId,
      year,
      month,
      status,
      page,
      limit,
    });
    return { status: 'success', data };
  }

  // ========================================
  // GET SINGLE REPORT
  // ========================================

  @Get(':reportId')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'monthly_report', idParam: 'reportId' })
  @ApiOperation({
    summary: 'Obtener informe mensual',
    description:
      'Retorna un informe con sus datos manuales, snapshot y datos del club.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'ID del informe mensual',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({ status: 200, description: 'Informe completo' })
  @ApiResponse({ status: 404, description: 'Informe no encontrado' })
  async getReport(@Param('reportId', ParseUUIDPipe) reportId: string) {
    const data = await this.monthlyReportsService.getReport(reportId);
    return { status: 'success', data };
  }
}
