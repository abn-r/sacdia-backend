import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
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
import { InvestitureService } from './investiture.service';
import {
  SubmitForValidationDto,
  ValidateEnrollmentDto,
  MarkInvestidoDto,
  CreateInvestitureConfigDto,
  UpdateInvestitureConfigDto,
} from './dto';
import {
  JwtAuthGuard,
  GlobalRolesGuard,
  ClubRolesGuard,
} from '../common/guards';
import { GlobalRoles, ClubRoles } from '../common/decorators';

@ApiTags('investiture')
@ApiBearerAuth()
@Controller('api/v1')
export class InvestitureController {
  constructor(private readonly investitureService: InvestitureService) {}

  // ========================================
  // POST /enrollments/:enrollmentId/submit-for-validation
  // ========================================

  @Post('enrollments/:enrollmentId/submit-for-validation')
  @UseGuards(JwtAuthGuard, ClubRolesGuard)
  @ClubRoles('director', 'counselor')
  @ApiOperation({ summary: 'Enviar enrollment a validación de investidura' })
  @ApiParam({ name: 'enrollmentId', type: Number, description: 'ID del enrollment' })
  @ApiResponse({ status: 200, description: 'Enrollment enviado a validación' })
  @ApiResponse({ status: 400, description: 'Estado actual no permite la transición' })
  @ApiResponse({ status: 403, description: 'Sin rol de director o consejero en el club' })
  @ApiResponse({ status: 404, description: 'Enrollment o investiture_config no encontrado' })
  @ApiResponse({ status: 409, description: 'Ya está en SUBMITTED_FOR_VALIDATION' })
  async submitForValidation(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Body() dto: SubmitForValidationDto,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.submitForValidation(
      enrollmentId,
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  // ========================================
  // POST /enrollments/:enrollmentId/validate
  // ========================================

  @Post('enrollments/:enrollmentId/validate')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({ summary: 'Aprobar o rechazar enrollment para investidura' })
  @ApiParam({ name: 'enrollmentId', type: Number, description: 'ID del enrollment' })
  @ApiResponse({ status: 200, description: 'Validación registrada' })
  @ApiResponse({ status: 400, description: 'Estado inválido o rechazo sin comentarios' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  @ApiResponse({ status: 404, description: 'Enrollment no encontrado' })
  @ApiResponse({ status: 409, description: 'Enrollment no está en SUBMITTED_FOR_VALIDATION' })
  async validateEnrollment(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Body() dto: ValidateEnrollmentDto,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.validateEnrollment(
      enrollmentId,
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  // ========================================
  // POST /enrollments/:enrollmentId/investiture
  // ========================================

  @Post('enrollments/:enrollmentId/investiture')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({ summary: 'Registrar investidura formal de un enrollment' })
  @ApiParam({ name: 'enrollmentId', type: Number, description: 'ID del enrollment' })
  @ApiResponse({ status: 200, description: 'Investidura registrada' })
  @ApiResponse({ status: 400, description: 'Enrollment no está en estado APPROVED' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  @ApiResponse({ status: 404, description: 'Enrollment o investiture_config no encontrado' })
  @ApiResponse({ status: 409, description: 'El enrollment ya fue investido' })
  async markInvestido(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Body() dto: MarkInvestidoDto,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.markInvestido(
      enrollmentId,
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  // ========================================
  // GET /investiture/pending
  // ========================================

  @Get('investiture/pending')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({ summary: 'Listar enrollments pendientes de validación de investidura' })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number, description: 'Filtrar por campo local' })
  @ApiQuery({ name: 'ecclesiastical_year_id', required: false, type: Number, description: 'Filtrar por año eclesiástico' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Número de página (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Resultados por página (default: 20)' })
  @ApiResponse({ status: 200, description: 'Lista paginada de enrollments en SUBMITTED_FOR_VALIDATION' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  async getPending(
    @Request() req,
    @Query('local_field_id', new ParseIntPipe({ optional: true })) localFieldId?: number,
    @Query('ecclesiastical_year_id', new ParseIntPipe({ optional: true })) ecclesiasticalYearId?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.getPending(
      actorId,
      localFieldId,
      ecclesiasticalYearId,
      page,
      limit,
    );
    return { status: 'success', data };
  }

  // ========================================
  // GET /enrollments/:enrollmentId/investiture-history
  // ========================================

  @Get('enrollments/:enrollmentId/investiture-history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Historial de validación de investidura de un enrollment' })
  @ApiParam({ name: 'enrollmentId', type: Number, description: 'ID del enrollment' })
  @ApiResponse({ status: 200, description: 'Historial de validación' })
  @ApiResponse({ status: 403, description: 'Sin acceso al historial de este enrollment' })
  @ApiResponse({ status: 404, description: 'Enrollment no encontrado' })
  async getHistory(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    // Authorization is resolved inside the service via DB lookup — JWT payload does NOT carry roles
    const data = await this.investitureService.getHistory(
      enrollmentId,
      actorId,
    );
    return { status: 'success', data };
  }

  // ========================================
  // GET /admin/investiture/config
  // ========================================

  @Get('admin/investiture/config')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({ summary: 'Listar configuraciones de investidura' })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number, description: 'Filtrar por campo local' })
  @ApiResponse({ status: 200, description: 'Lista de configuraciones de investidura' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  async getConfigs(
    @Query('local_field_id', new ParseIntPipe({ optional: true })) localFieldId?: number,
  ) {
    const data = await this.investitureService.getConfigs(localFieldId);
    return { status: 'success', data };
  }

  // ========================================
  // GET /admin/investiture/config/:configId
  // ========================================

  @Get('admin/investiture/config/:configId')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({ summary: 'Obtener configuración de investidura por ID' })
  @ApiParam({ name: 'configId', type: Number, description: 'ID de la configuración' })
  @ApiResponse({ status: 200, description: 'Configuración de investidura' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  @ApiResponse({ status: 404, description: 'Configuración no encontrada' })
  async getConfig(
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    const data = await this.investitureService.getConfig(configId);
    return { status: 'success', data };
  }

  // ========================================
  // POST /admin/investiture/config
  // ========================================

  @Post('admin/investiture/config')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin')
  @ApiOperation({ summary: 'Crear configuración de investidura' })
  @ApiResponse({ status: 201, description: 'Configuración creada' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin' })
  @ApiResponse({ status: 409, description: 'Ya existe configuración para este campo local y año' })
  async createConfig(
    @Body() dto: CreateInvestitureConfigDto,
  ) {
    const data = await this.investitureService.createConfig(dto);
    return { status: 'success', data };
  }

  // ========================================
  // PATCH /admin/investiture/config/:configId
  // ========================================

  @Patch('admin/investiture/config/:configId')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin')
  @ApiOperation({ summary: 'Actualizar configuración de investidura' })
  @ApiParam({ name: 'configId', type: Number, description: 'ID de la configuración' })
  @ApiResponse({ status: 200, description: 'Configuración actualizada' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin' })
  @ApiResponse({ status: 404, description: 'Configuración no encontrada' })
  async updateConfig(
    @Param('configId', ParseIntPipe) configId: number,
    @Body() dto: UpdateInvestitureConfigDto,
  ) {
    const data = await this.investitureService.updateConfig(configId, dto);
    return { status: 'success', data };
  }

  // ========================================
  // DELETE /admin/investiture/config/:configId
  // ========================================

  @Delete('admin/investiture/config/:configId')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin')
  @ApiOperation({ summary: 'Soft-delete de configuración de investidura (active = false)' })
  @ApiParam({ name: 'configId', type: Number, description: 'ID de la configuración' })
  @ApiResponse({ status: 200, description: 'Configuración desactivada' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin' })
  @ApiResponse({ status: 404, description: 'Configuración no encontrada' })
  async deleteConfig(
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    const data = await this.investitureService.deleteConfig(configId);
    return { status: 'success', data };
  }
}
