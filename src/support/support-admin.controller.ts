import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { GlobalRoles, CurrentUser } from '../common/decorators';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';
import {
  AdminSupportReportDto,
  AdminSupportReportsPageDto,
} from './dto/admin-support-report.dto';
import { QuerySupportReportsDto } from './dto/query-support-reports.dto';
import { UpdateSupportReportStatusDto } from './dto/update-support-report-status.dto';
import { SupportService } from './support.service';

@ApiTags('admin-support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@Controller('admin/support')
export class SupportAdminController {
  constructor(private readonly supportService: SupportService) {}

  @Get('reports')
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({
    summary: 'Listar reportes de soporte',
    description:
      'Lista reportes enviados desde la app móvil para que el panel administrativo pueda dar seguimiento.',
  })
  @ApiOkResponse({ type: AdminSupportReportsPageDto })
  async listReports(
    @CurrentUser() user: { sub: string },
    @Query() query: QuerySupportReportsDto,
  ): Promise<{ status: string; data: AdminSupportReportsPageDto }> {
    const data = await this.supportService.listReports(user.sub, query);
    return { status: 'ok', data };
  }

  @Get('reports/:reportId')
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({ summary: 'Obtener detalle de un reporte de soporte' })
  @ApiParam({ name: 'reportId', description: 'UUID del reporte' })
  @ApiOkResponse({ type: AdminSupportReportDto })
  async getReport(
    @CurrentUser() user: { sub: string },
    @Param('reportId') reportId: string,
  ): Promise<{ status: string; data: AdminSupportReportDto }> {
    const data = await this.supportService.getReport(user.sub, reportId);
    return { status: 'ok', data };
  }

  @Patch('reports/:reportId/status')
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({ summary: 'Actualizar estado de un reporte de soporte' })
  @ApiParam({ name: 'reportId', description: 'UUID del reporte' })
  @ApiOkResponse({ type: AdminSupportReportDto })
  async updateReportStatus(
    @CurrentUser() user: { sub: string },
    @Param('reportId') reportId: string,
    @Body() dto: UpdateSupportReportStatusDto,
  ): Promise<{ status: string; data: AdminSupportReportDto }> {
    const data = await this.supportService.updateReportStatus(
      user.sub,
      reportId,
      dto.status,
    );
    return { status: 'ok', data };
  }
}
