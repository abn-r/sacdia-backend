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
import { AnnualReportsService } from './annual-reports.service';
import { AnnualReportsPdfService } from './annual-reports-pdf.service';
import { UpdateAnnualManualDataDto } from './dto';
import { RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

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
  @ApiOperation({ summary: 'Listar informes anuales (admin)' })
  @ApiQuery({ name: 'clubId', required: false, type: Number })
  @ApiQuery({ name: 'ecclesiasticalYearId', required: false, type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['draft', 'finalized', 'archived'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de informes anuales',
  })
  async listAdmin(
    @Query('clubId', new ParseIntPipe({ optional: true })) clubId?: number,
    @Query('ecclesiasticalYearId', new ParseIntPipe({ optional: true }))
    ecclesiasticalYearId?: number,
    @Query('status') status?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const data = await this.annualReportsService.listForAdmin({
      clubId,
      ecclesiasticalYearId,
      status,
      page,
      limit,
    });
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Get single
  // ========================================

  @Get('admin/annual-reports/:id')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Obtener informe anual por ID (admin)' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe anual' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async getAdmin(@Param('id', ParseIntPipe) id: number) {
    const data = await this.annualReportsService.getReport(id);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Update manual data
  // ========================================

  @Patch('admin/annual-reports/:id')
  @RequirePermissions('reports:update')
  @ApiOperation({
    summary: 'Actualizar datos manuales del informe anual (admin)',
  })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Datos actualizados' })
  async updateManualData(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAnnualManualDataDto,
  ) {
    const data = await this.annualReportsService.updateManualData(id, dto);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Regenerate
  // ========================================

  @Post('admin/annual-reports/:id/regenerate')
  @RequirePermissions('reports:update')
  @ApiOperation({
    summary: 'Regenerar datos calculados del informe anual (admin)',
  })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe regenerado' })
  async regenerate(@Param('id', ParseIntPipe) id: number) {
    const data = await this.annualReportsService.regenerate(id);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Finalize
  // ========================================

  @Post('admin/annual-reports/:id/finalize')
  @RequirePermissions('reports:update')
  @ApiOperation({ summary: 'Finalizar informe anual (admin)' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe finalizado' })
  async finalize(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const data = await this.annualReportsService.finalize(id, req.user.sub);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: PDF
  // ========================================

  @Get('admin/annual-reports/:id/pdf')
  @RequirePermissions('reports:download')
  @ApiOperation({ summary: 'Descargar PDF del informe anual (admin)' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del informe anual' })
  async downloadPdfAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const buffer = await this.annualReportsPdfService.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="informe-anual-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  // ========================================
  // USER: List by club
  // ========================================

  @Get('clubs/:clubId/annual-reports')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Listar informes anuales de un club (usuario)' })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiResponse({
    status: 200,
    description: 'Lista de informes anuales del club',
  })
  async listForClub(@Param('clubId', ParseIntPipe) clubId: number) {
    const data = await this.annualReportsService.listForClub(clubId);
    return { status: 'success', data };
  }

  // ========================================
  // USER: Get single
  // ========================================

  @Get('clubs/:clubId/annual-reports/:id')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Obtener informe anual por ID (usuario)' })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe anual' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async getForClub(@Param('id', ParseIntPipe) id: number) {
    const data = await this.annualReportsService.getReport(id);
    return { status: 'success', data };
  }

  // ========================================
  // USER: PDF
  // ========================================

  @Get('clubs/:clubId/annual-reports/:id/pdf')
  @RequirePermissions('reports:download')
  @ApiOperation({ summary: 'Descargar PDF del informe anual (usuario)' })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del informe anual' })
  async downloadPdfUser(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const buffer = await this.annualReportsPdfService.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="informe-anual-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
