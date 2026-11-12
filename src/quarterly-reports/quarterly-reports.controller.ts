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
import { QuarterlyReportsService } from './quarterly-reports.service';
import { QuarterlyReportsPdfService } from './quarterly-reports-pdf.service';
import { monthlyReportContentDisposition } from '../monthly-reports/monthly-report-download-filename';
import {
  GenerateQuarterlyReportDto,
  ListQuarterlyReportsQueryDto,
} from './dto';
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

@ApiTags('quarterly-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class QuarterlyReportsController {
  constructor(
    private readonly quarterlyReportsService: QuarterlyReportsService,
    private readonly quarterlyReportsPdfService: QuarterlyReportsPdfService,
  ) {}

  // ========================================
  // ADMIN: List
  // ========================================

  @Get('admin/quarterly-reports')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Listar informes trimestrales (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de informes trimestrales',
  })
  async listAdmin(
    @Req() req: any,
    @Query() query: ListQuarterlyReportsQueryDto,
  ) {
    const data = await this.quarterlyReportsService.listForAdmin(
      req.user.sub,
      query,
    );
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Get single
  // ========================================

  @Get('admin/quarterly-reports/:id')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Obtener informe trimestral por ID (admin)' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe trimestral' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async getAdmin(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.quarterlyReportsService.assertReportVisibleToActor(
      req.user.sub,
      id,
    );
    const data = await this.quarterlyReportsService.getReport(id);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Generate on demand
  // ========================================

  @Post('admin/quarterly-reports/generate')
  @HttpCode(200)
  @RequirePermissions('reports:update')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary:
      'Generar el informe trimestral de un club y periodo (admin). Crea el informe si no existe; en borrador se recalcula en vivo, y si el periodo ya pasó la gracia se crea congelado (finalizado). Uno finalizado se devuelve sin cambios',
  })
  @ApiResponse({
    status: 200,
    description: 'Informe trimestral (misma forma que GET por ID)',
  })
  @ApiResponse({ status: 400, description: 'Periodo futuro o datos inválidos' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Club fuera del alcance del usuario o sin reports:update',
  })
  @ApiResponse({ status: 404, description: 'Club no encontrado o inactivo' })
  async generate(@Body() dto: GenerateQuarterlyReportDto, @Req() req: any) {
    await this.quarterlyReportsService.assertClubVisibleToActor(
      req.user.sub,
      dto.club_id,
    );
    const data = await this.quarterlyReportsService.generateOnDemand(
      dto.club_id,
      dto.year,
      dto.quarter,
    );
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Regenerate
  // ========================================

  @Post('admin/quarterly-reports/:id/regenerate')
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
  @ApiResponse({
    status: 403,
    description: 'Solo super-admin y admin pueden recalcular',
  })
  async regenerate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.quarterlyReportsService.assertReportVisibleToActor(
      req.user.sub,
      id,
    );
    const data = await this.quarterlyReportsService.regenerate(id);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: PDF
  // ========================================

  @Get('admin/quarterly-reports/:id/pdf')
  @RequirePermissions('reports:download')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary:
      'Descargar PDF del informe trimestral (admin). Nombre: informe-trimestral-{club}-{tipo}-{trimestre}-{año}.pdf',
  })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del informe trimestral' })
  async downloadPdfAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Res() res: Response,
  ) {
    await this.quarterlyReportsService.assertReportVisibleToActor(
      req.user.sub,
      id,
    );
    await this.quarterlyReportsService.refreshDraft(id);
    const buffer = await this.quarterlyReportsPdfService.generatePdf(id);
    const filename =
      await this.quarterlyReportsPdfService.resolveDownloadFilename(id);
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

  @Get('clubs/:clubId/quarterly-reports')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary: 'Listar informes trimestrales de un club (usuario)',
  })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiResponse({
    status: 200,
    description: 'Lista de informes trimestrales del club',
  })
  async listForClub(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Req() req: any,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
  ) {
    await this.quarterlyReportsService.assertPeriodicReportsAccess(
      req.user.sub,
    );
    const data = await this.quarterlyReportsService.listForClub(clubId, year);
    return { status: 'success', data };
  }

  // ========================================
  // USER: Get single
  // ========================================

  @Get('clubs/:clubId/quarterly-reports/:id')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Obtener informe trimestral por ID (usuario)' })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe trimestral' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async getForClub(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    await this.quarterlyReportsService.assertPeriodicReportsAccess(
      req.user.sub,
    );
    await this.quarterlyReportsService.assertReportBelongsToClub(clubId, id);
    const data = await this.quarterlyReportsService.getReport(id);
    return { status: 'success', data };
  }

  // ========================================
  // USER: PDF
  // ========================================

  @Get('clubs/:clubId/quarterly-reports/:id/pdf')
  @RequirePermissions('reports:download')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({
    summary:
      'Descargar PDF del informe trimestral (usuario). Nombre: informe-trimestral-{club}-{tipo}-{trimestre}-{año}.pdf',
  })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del informe trimestral' })
  async downloadPdfUser(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Res() res: Response,
  ) {
    await this.quarterlyReportsService.assertPeriodicReportsAccess(
      req.user.sub,
    );
    await this.quarterlyReportsService.assertReportBelongsToClub(clubId, id);
    await this.quarterlyReportsService.refreshDraft(id);
    const buffer = await this.quarterlyReportsPdfService.generatePdf(id);
    const filename =
      await this.quarterlyReportsPdfService.resolveDownloadFilename(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': monthlyReportContentDisposition(filename),
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
