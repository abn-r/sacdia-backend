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
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { MonthlyReportsService } from './monthly-reports.service';
import { UpdateManualDataDto } from './dto';
import { RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

@ApiTags('monthly-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('monthly-reports')
export class MonthlyReportsController {
  constructor(
    private readonly monthlyReportsService: MonthlyReportsService,
  ) {}

  // ========================================
  // PREVIEW — live auto-calculated data
  // ========================================

  @Get('preview/:enrollmentId')
  @RequirePermissions('reports:read')
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
  @ApiResponse({ status: 200, description: 'Vista previa con datos calculados' })
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
  @RequirePermissions('reports:read')
  @ApiOperation({
    summary: 'Generar informe (congelar datos)',
    description:
      'Congela los datos auto-calculados en snapshot_data y cambia el estado a "generated". Solo informes en borrador.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'ID del informe mensual',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({ status: 200, description: 'Informe generado con snapshot' })
  @ApiResponse({
    status: 400,
    description: 'Solo se pueden generar informes en borrador',
  })
  @ApiResponse({ status: 404, description: 'Informe no encontrado' })
  async generate(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Req() req: any,
  ) {
    const data = await this.monthlyReportsService.generate(
      reportId,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  // ========================================
  // SUBMIT
  // ========================================

  @Post(':reportId/submit')
  @RequirePermissions('reports:read')
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
  // GET SINGLE REPORT
  // ========================================

  @Get(':reportId')
  @RequirePermissions('reports:read')
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
  async getReport(
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ) {
    const data = await this.monthlyReportsService.getReport(reportId);
    return { status: 'success', data };
  }
}
