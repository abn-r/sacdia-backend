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
import { QuarterlyReportsService } from './quarterly-reports.service';
import { QuarterlyReportsPdfService } from './quarterly-reports-pdf.service';
import { UpdateQuarterlyManualDataDto } from './dto';
import { RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

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
  @ApiOperation({ summary: 'Listar informes trimestrales (admin)' })
  @ApiQuery({ name: 'clubId', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'quarter', required: false, type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['draft', 'finalized', 'archived'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de informes trimestrales',
  })
  async listAdmin(
    @Query('clubId', new ParseIntPipe({ optional: true })) clubId?: number,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
    @Query('quarter', new ParseIntPipe({ optional: true })) quarter?: number,
    @Query('status') status?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const data = await this.quarterlyReportsService.listForAdmin({
      clubId,
      year,
      quarter,
      status,
      page,
      limit,
    });
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Get single
  // ========================================

  @Get('admin/quarterly-reports/:id')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Obtener informe trimestral por ID (admin)' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe trimestral' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async getAdmin(@Param('id', ParseIntPipe) id: number) {
    const data = await this.quarterlyReportsService.getReport(id);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Update manual data
  // ========================================

  @Patch('admin/quarterly-reports/:id')
  @RequirePermissions('reports:update')
  @ApiOperation({
    summary: 'Actualizar datos manuales del informe trimestral (admin)',
  })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Datos actualizados' })
  async updateManualData(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateQuarterlyManualDataDto,
  ) {
    const data = await this.quarterlyReportsService.updateManualData(id, dto);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Regenerate
  // ========================================

  @Post('admin/quarterly-reports/:id/regenerate')
  @RequirePermissions('reports:update')
  @ApiOperation({
    summary: 'Regenerar datos calculados del informe trimestral (admin)',
  })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe regenerado' })
  async regenerate(@Param('id', ParseIntPipe) id: number) {
    const data = await this.quarterlyReportsService.regenerate(id);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: Finalize
  // ========================================

  @Post('admin/quarterly-reports/:id/finalize')
  @RequirePermissions('reports:update')
  @ApiOperation({ summary: 'Finalizar informe trimestral (admin)' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe finalizado' })
  async finalize(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const data = await this.quarterlyReportsService.finalize(id, req.user.sub);
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: PDF
  // ========================================

  @Get('admin/quarterly-reports/:id/pdf')
  @RequirePermissions('reports:download')
  @ApiOperation({ summary: 'Descargar PDF del informe trimestral (admin)' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del informe trimestral' })
  async downloadPdfAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const buffer = await this.quarterlyReportsPdfService.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="informe-trimestral-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  // ========================================
  // USER: List by club
  // ========================================

  @Get('clubs/:clubId/quarterly-reports')
  @RequirePermissions('reports:read')
  @ApiOperation({
    summary: 'Listar informes trimestrales de un club (usuario)',
  })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Lista de informes trimestrales del club',
  })
  async listForClub(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
  ) {
    const data = await this.quarterlyReportsService.listForClub(clubId, year);
    return { status: 'success', data };
  }

  // ========================================
  // USER: Get single
  // ========================================

  @Get('clubs/:clubId/quarterly-reports/:id')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Obtener informe trimestral por ID (usuario)' })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiResponse({ status: 200, description: 'Informe trimestral' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async getForClub(@Param('id', ParseIntPipe) id: number) {
    const data = await this.quarterlyReportsService.getReport(id);
    return { status: 'success', data };
  }

  // ========================================
  // USER: PDF
  // ========================================

  @Get('clubs/:clubId/quarterly-reports/:id/pdf')
  @RequirePermissions('reports:download')
  @ApiOperation({ summary: 'Descargar PDF del informe trimestral (usuario)' })
  @ApiParam({ name: 'clubId', type: 'integer' })
  @ApiParam({ name: 'id', type: 'integer' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del informe trimestral' })
  async downloadPdfUser(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const buffer = await this.quarterlyReportsPdfService.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="informe-trimestral-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
