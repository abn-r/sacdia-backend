import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  UseGuards,
  Req,
  Res,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiProduces,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AnnualReportsService } from './annual-reports.service';
import { AnnualReportsPdfService } from './annual-reports-pdf.service';
import { monthlyReportContentDisposition } from '../monthly-reports/monthly-report-download-filename';
import { GenerateAnnualReportDto, ListAnnualReportsQueryDto } from './dto';
import {
  AuthorizationResource,
  ExactGlobalRoles,
  RequirePermissions,
} from '../common/decorators';
import {
  GlobalRolesGuard,
  JwtAuthGuard,
  PermissionsGuard,
} from '../common/guards';
import { GlobalRole } from '../common/authorization/roles';

@ApiTags('annual-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class AnnualReportsController {
  constructor(
    private readonly annualReportsService: AnnualReportsService,
    private readonly annualReportsPdfService: AnnualReportsPdfService,
  ) {}

  // ========================================
  // ADMIN: List
  // ========================================

  @Get('admin/annual-reports')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Listar informes anuales (admin)' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires reports:read',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de informes anuales',
  })
  async listAdmin(@Req() req: any, @Query() query: ListAnnualReportsQueryDto) {
    const data = await this.annualReportsService.listForAdmin(
      req.user.sub,
      query,
    );
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Get single
  // ========================================

  @Get('admin/annual-reports/:id')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Obtener informe anual por ID (admin)' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe anual' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires reports:read',
  })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async getAdmin(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.annualReportsService.assertReportVisibleToActor(
      req.user.sub,
      id,
    );
    const data = await this.annualReportsService.getReport(id);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Generate on demand
  // ========================================

  @Post('admin/annual-reports/generate')
  @HttpCode(200)
  @RequirePermissions('reports:update')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary:
      'Generar el informe anual de un club y año eclesiástico (admin). Crea el informe si no existe; en borrador se recalcula en vivo, y si el periodo ya pasó la gracia se crea congelado (finalizado). Uno finalizado se devuelve sin cambios',
  })
  @ApiResponse({
    status: 200,
    description: 'Informe anual (misma forma que GET por ID)',
  })
  @ApiResponse({ status: 400, description: 'Periodo futuro o datos inválidos' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Club fuera del alcance del usuario o sin reports:update',
  })
  @ApiResponse({
    status: 404,
    description: 'Club inactivo/no encontrado o año eclesiástico no encontrado',
  })
  async generate(@Body() dto: GenerateAnnualReportDto, @Req() req: any) {
    await this.annualReportsService.assertClubVisibleToActor(
      req.user.sub,
      dto.club_id,
    );
    const data = await this.annualReportsService.generateOnDemand(
      dto.club_id,
      dto.ecclesiastical_year_id,
    );
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Regenerate
  // ========================================

  @Post('admin/annual-reports/:id/regenerate')
  @UseGuards(GlobalRolesGuard)
  @ExactGlobalRoles(GlobalRole.SUPER_ADMIN, GlobalRole.ADMIN)
  @RequirePermissions('reports:update')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary:
      'Recalcular el informe (admin global: super-admin y admin). Funciona también sobre uno finalizado y conserva su estado',
  })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe recalculado' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires reports:update',
  })
  @ApiResponse({ status: 404, description: 'Informe no encontrado' })
  async regenerate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.annualReportsService.assertReportVisibleToActor(
      req.user.sub,
      id,
    );
    const data = await this.annualReportsService.regenerate(id);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: PDF
  // ========================================

  @Get('admin/annual-reports/:id/pdf')
  @RequirePermissions('reports:download')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary:
      'Descargar PDF del informe anual (admin). Nombre: informe-anual-{club}-{tipo}-{año}.pdf',
  })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del informe anual' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires reports:download',
  })
  @ApiResponse({ status: 404, description: 'Informe no encontrado' })
  async downloadPdfAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Res() res: Response,
  ) {
    await this.annualReportsService.assertReportVisibleToActor(
      req.user.sub,
      id,
    );
    await this.annualReportsService.refreshDraft(id);
    const buffer = await this.annualReportsPdfService.generatePdf(id);
    const filename =
      await this.annualReportsPdfService.resolveDownloadFilename(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': monthlyReportContentDisposition(filename),
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  // ========================================
  // USER: List by club
  // ========================================

  @Get('clubs/:clubId/annual-reports')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Listar informes anuales de un club (usuario)' })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiResponse({
    status: 200,
    description: 'Lista de informes anuales del club',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires reports:read',
  })
  async listForClub(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Req() req: any,
  ) {
    await this.annualReportsService.assertPeriodicReportsAccess(req.user.sub);
    const data = await this.annualReportsService.listForClub(clubId);
    return { status: 'success', data };
  }

  // ========================================
  // USER: Get single
  // ========================================

  @Get('clubs/:clubId/annual-reports/:id')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Obtener informe anual por ID (usuario)' })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe anual' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires reports:read',
  })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async getForClub(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    await this.annualReportsService.assertPeriodicReportsAccess(req.user.sub);
    await this.annualReportsService.assertReportBelongsToClub(clubId, id);
    const data = await this.annualReportsService.getReport(id);
    return { status: 'success', data };
  }

  // ========================================
  // USER: PDF
  // ========================================

  @Get('clubs/:clubId/annual-reports/:id/pdf')
  @RequirePermissions('reports:download')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary:
      'Descargar PDF del informe anual (usuario). Nombre: informe-anual-{club}-{tipo}-{año}.pdf',
  })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del informe anual' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires reports:download',
  })
  @ApiResponse({ status: 404, description: 'Informe no encontrado' })
  async downloadPdfUser(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Res() res: Response,
  ) {
    await this.annualReportsService.assertPeriodicReportsAccess(req.user.sub);
    await this.annualReportsService.assertReportBelongsToClub(clubId, id);
    await this.annualReportsService.refreshDraft(id);
    const buffer = await this.annualReportsPdfService.generatePdf(id);
    const filename =
      await this.annualReportsPdfService.resolveDownloadFilename(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': monthlyReportContentDisposition(filename),
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
