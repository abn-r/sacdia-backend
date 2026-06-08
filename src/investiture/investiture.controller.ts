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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { investiture_status_enum } from '@prisma/client';
import { InvestitureService } from './investiture.service';
import {
  SubmitForValidationDto,
  ValidateEnrollmentDto,
  MarkInvestidoDto,
  ApproveInvestitureDto,
  RejectInvestitureDto,
  CreateInvestitureConfigDto,
  UpdateInvestitureConfigDto,
  BulkApproveEnrollmentsDto,
  BulkRejectEnrollmentsDto,
  ExpireOverdueEnrollmentsDto,
} from './dto';
import {
  JwtAuthGuard,
  GlobalRolesGuard,
  ClubRolesGuard,
  PermissionsGuard,
} from '../common/guards';
import {
  GlobalRoles,
  ClubRoles,
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';

@ApiTags('investiture')
@ApiBearerAuth()
@Controller()
export class InvestitureController {
  constructor(private readonly investitureService: InvestitureService) {}

  // ========================================
  // POST /investiture/enrollments/:enrollmentId/submit
  // Counselor submits for investiture
  // ========================================

  @Post('investiture/enrollments/:enrollmentId/submit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ClubRolesGuard, PermissionsGuard)
  @ClubRoles('director', 'counselor')
  @RequirePermissions('investiture:submit')
  @AuthorizationResource({
    type: 'investiture_enrollment',
    idParam: 'enrollmentId',
  })
  @ApiOperation({
    summary:
      'Enviar enrollment a validación de investidura (consejero/director)',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({ status: 200, description: 'Enrollment enviado a validación' })
  @ApiResponse({
    status: 400,
    description: 'Estado actual no permite la transición',
  })
  @ApiResponse({
    status: 403,
    description: 'Sin rol de director o consejero en el club',
  })
  @ApiResponse({
    status: 404,
    description: 'Enrollment o investiture_config no encontrado',
  })
  @ApiResponse({
    status: 409,
    description: 'Ya está en SUBMITTED_FOR_VALIDATION',
  })
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
  // POST /investiture/enrollments/:enrollmentId/club-approve
  // Director of section approves
  // ========================================

  @Post('investiture/enrollments/:enrollmentId/club-approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ClubRolesGuard, PermissionsGuard)
  @ClubRoles('director')
  @RequirePermissions('investiture:validate')
  @AuthorizationResource({
    type: 'investiture_enrollment',
    idParam: 'enrollmentId',
  })
  @ApiOperation({
    summary: 'Director de sección aprueba enrollment para investidura',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({
    status: 200,
    description: 'Enrollment aprobado por director de sección',
  })
  @ApiResponse({ status: 403, description: 'Sin rol de director en el club' })
  @ApiResponse({ status: 404, description: 'Enrollment no encontrado' })
  @ApiResponse({
    status: 409,
    description: 'El enrollment no está en estado SUBMITTED_FOR_VALIDATION',
  })
  async clubApprove(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Body() dto: ApproveInvestitureDto,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.clubApprove(
      enrollmentId,
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  // ========================================
  // POST /investiture/enrollments/:enrollmentId/coordinator-approve
  // Coordinator (zone or local field) validates
  // ========================================

  @Post('investiture/enrollments/:enrollmentId/coordinator-approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
  @GlobalRoles('admin', 'coordinator')
  @RequirePermissions('investiture:validate')
  @AuthorizationResource({
    type: 'investiture_enrollment',
    idParam: 'enrollmentId',
  })
  @ApiOperation({ summary: 'Coordinador aprueba enrollment para investidura' })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({
    status: 200,
    description: 'Enrollment aprobado por coordinador',
  })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  @ApiResponse({ status: 404, description: 'Enrollment no encontrado' })
  @ApiResponse({
    status: 409,
    description: 'El enrollment no está en estado CLUB_APPROVED',
  })
  async coordinatorApprove(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Body() dto: ApproveInvestitureDto,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.coordinatorApprove(
      enrollmentId,
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  // ========================================
  // POST /investiture/enrollments/:enrollmentId/field-approve
  // Local field (assistant-lf / director-lf) authorizes
  // ========================================

  @Post('investiture/enrollments/:enrollmentId/field-approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
  @GlobalRoles('admin')
  @RequirePermissions('investiture:validate')
  @AuthorizationResource({
    type: 'investiture_enrollment',
    idParam: 'enrollmentId',
  })
  @ApiOperation({ summary: 'Campo local aprueba enrollment para investidura' })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({
    status: 200,
    description: 'Enrollment aprobado por campo local',
  })
  @ApiResponse({ status: 403, description: 'Sin rol de admin' })
  @ApiResponse({ status: 404, description: 'Enrollment no encontrado' })
  @ApiResponse({
    status: 409,
    description: 'El enrollment no está en estado COORDINATOR_APPROVED',
  })
  async fieldApprove(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Body() dto: ApproveInvestitureDto,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.fieldApprove(
      enrollmentId,
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  // ========================================
  // POST /investiture/enrollments/:enrollmentId/invest
  // Mark as invested (final step)
  // ========================================

  @Post('investiture/enrollments/:enrollmentId/invest')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
  @GlobalRoles('admin', 'coordinator')
  @RequirePermissions('investiture:mark_invested')
  @AuthorizationResource({
    type: 'investiture_enrollment',
    idParam: 'enrollmentId',
  })
  @ApiOperation({
    summary:
      'Registrar investidura formal de un enrollment (después de FIELD_APPROVED)',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({ status: 200, description: 'Investidura registrada' })
  @ApiResponse({
    status: 400,
    description: 'Enrollment no está en estado FIELD_APPROVED',
  })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  @ApiResponse({
    status: 404,
    description: 'Enrollment o investiture_config no encontrado',
  })
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
  // POST /investiture/enrollments/:enrollmentId/reject
  // Reject at any approval level
  // ========================================

  @Post('investiture/enrollments/:enrollmentId/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
  @GlobalRoles('admin', 'coordinator')
  @RequirePermissions('investiture:validate')
  @AuthorizationResource({
    type: 'investiture_enrollment',
    idParam: 'enrollmentId',
  })
  @ApiOperation({
    summary: 'Rechazar enrollment en cualquier nivel del flujo de aprobación',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({ status: 200, description: 'Enrollment rechazado' })
  @ApiResponse({ status: 400, description: 'Estado actual no permite rechazo' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  @ApiResponse({ status: 404, description: 'Enrollment no encontrado' })
  async reject(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Body() dto: RejectInvestitureDto,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.reject(
      enrollmentId,
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  // ========================================
  // POST /investiture/enrollments/bulk-approve
  // Bulk approval at any stage — role guards same as single operations
  // ========================================

  @Post('investiture/enrollments/bulk-approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({
    summary: 'Aprobar múltiples enrollments en bloque',
    description:
      'Cada enrollment se valida individualmente. Los que no cumplan el estado requerido ' +
      'para la acción se incluyen en `failed` con el motivo. Los elegibles se actualizan ' +
      'atómicamente. Máximo 200 IDs por petición.',
  })
  @ApiResponse({
    status: 200,
    description: 'Resultado parcial o total de la operación en bloque',
    schema: {
      example: {
        status: 'success',
        data: {
          succeeded: [1, 2, 3],
          failed: [
            {
              id: 4,
              reason:
                'Estado inválido para esta acción: INVESTIDO (se requiere CLUB_APPROVED)',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'DTO inválido (array vacío, acción desconocida, etc.)',
  })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  async bulkApprove(@Body() dto: BulkApproveEnrollmentsDto, @Request() req) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.bulkApproveEnrollments(
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  // ========================================
  // POST /investiture/enrollments/bulk-reject
  // Bulk rejection — comments required
  // ========================================

  @Post('investiture/enrollments/bulk-reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({
    summary: 'Rechazar múltiples enrollments en bloque',
    description:
      'El campo `comments` es obligatorio. Cada enrollment se valida individualmente; ' +
      'los que no estén en un estado rechazable se incluyen en `failed`. ' +
      'Máximo 200 IDs por petición.',
  })
  @ApiResponse({
    status: 200,
    description: 'Resultado parcial o total del rechazo en bloque',
    schema: {
      example: {
        status: 'success',
        data: {
          succeeded: [1, 2],
          failed: [
            {
              id: 3,
              reason: 'No se puede rechazar un enrollment en estado INVESTIDO',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'DTO inválido (sin motivo, array vacío, etc.)',
  })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  async bulkReject(@Body() dto: BulkRejectEnrollmentsDto, @Request() req) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.bulkRejectEnrollments(
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post('admin/classes/enrollments/expire-overdue')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
  @GlobalRoles('admin')
  @RequirePermissions('catalogs:update')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Vencer manualmente enrollments atrasados por duración de clase',
  })
  @ApiResponse({
    status: 200,
    description: 'Resultado del vencimiento manual o dry-run',
  })
  async expireOverdueEnrollments(
    @Body() dto: ExpireOverdueEnrollmentsDto,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.expireOverdueEnrollments(
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
  @ApiOperation({
    summary:
      'Listar enrollments pendientes de aprobación (filtrable por nivel)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: investiture_status_enum,
    description: 'Filtrar por nivel de aprobación',
  })
  @ApiQuery({
    name: 'local_field_id',
    required: false,
    type: Number,
    description: 'Filtrar por campo local',
  })
  @ApiQuery({
    name: 'ecclesiastical_year_id',
    required: false,
    type: Number,
    description: 'Filtrar por año eclesiástico',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Número de página (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Resultados por página (default: 20)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de enrollments pendientes',
  })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  async getPending(
    @Request() req,
    @Query('status') status?: investiture_status_enum,
    @Query('local_field_id', new ParseIntPipe({ optional: true }))
    localFieldId?: number,
    @Query('ecclesiastical_year_id', new ParseIntPipe({ optional: true }))
    ecclesiasticalYearId?: number,
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
      status,
    );
    return { status: 'success', data };
  }

  // ========================================
  // GET /investiture/enrollments/:enrollmentId/history
  // ========================================

  @Get('investiture/enrollments/:enrollmentId/history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Historial de validación de investidura de un enrollment',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({ status: 200, description: 'Historial de validación' })
  @ApiResponse({
    status: 403,
    description: 'Sin acceso al historial de este enrollment',
  })
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
  // LEGACY ENDPOINTS (backwards compatibility)
  // ========================================

  @Post('enrollments/:enrollmentId/submit-for-validation')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ClubRolesGuard, PermissionsGuard)
  @ClubRoles('director', 'counselor')
  @RequirePermissions('investiture:submit')
  @AuthorizationResource({
    type: 'investiture_enrollment',
    idParam: 'enrollmentId',
  })
  @ApiOperation({
    summary: '[LEGACY] Enviar enrollment a validación de investidura',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({ status: 200, description: 'Enrollment enviado a validación' })
  async submitForValidationLegacy(
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

  @Post('enrollments/:enrollmentId/validate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
  @GlobalRoles('admin', 'coordinator')
  @RequirePermissions('investiture:validate')
  @AuthorizationResource({
    type: 'investiture_enrollment',
    idParam: 'enrollmentId',
  })
  @ApiOperation({
    summary: '[LEGACY] Aprobar o rechazar enrollment para investidura',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({ status: 200, description: 'Validación registrada' })
  async validateEnrollmentLegacy(
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

  @Post('enrollments/:enrollmentId/investiture')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
  @GlobalRoles('admin', 'coordinator')
  @RequirePermissions('investiture:mark_invested')
  @AuthorizationResource({
    type: 'investiture_enrollment',
    idParam: 'enrollmentId',
  })
  @ApiOperation({
    summary: '[LEGACY] Registrar investidura formal de un enrollment',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({ status: 200, description: 'Investidura registrada' })
  async markInvestidoLegacy(
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

  @Get('enrollments/:enrollmentId/investiture-history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '[LEGACY] Historial de validación de investidura de un enrollment',
  })
  @ApiParam({
    name: 'enrollmentId',
    type: Number,
    description: 'ID del enrollment',
  })
  @ApiResponse({ status: 200, description: 'Historial de validación' })
  async getHistoryLegacy(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.getHistory(
      enrollmentId,
      actorId,
    );
    return { status: 'success', data };
  }

  // ========================================
  // ADMIN: INVESTITURE CONFIG CRUD
  // ========================================

  @Get('admin/investiture/config')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles(
    'admin',
    'coordinator',
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
  )
  @ApiOperation({ summary: 'Listar configuraciones de investidura' })
  @ApiQuery({
    name: 'local_field_id',
    required: false,
    type: Number,
    description: 'Filtrar por campo local',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de configuraciones de investidura',
  })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  async getConfigs(
    @Query('local_field_id', new ParseIntPipe({ optional: true }))
    localFieldId: number | undefined,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.getConfigs(actorId, localFieldId);
    return { status: 'success', data };
  }

  @Get('admin/investiture/config/:configId')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles(
    'admin',
    'coordinator',
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
  )
  @ApiOperation({ summary: 'Obtener configuración de investidura por ID' })
  @ApiParam({
    name: 'configId',
    type: Number,
    description: 'ID de la configuración',
  })
  @ApiResponse({ status: 200, description: 'Configuración de investidura' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  @ApiResponse({ status: 404, description: 'Configuración no encontrada' })
  async getConfig(
    @Param('configId', ParseIntPipe) configId: number,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.getConfig(configId, actorId);
    return { status: 'success', data };
  }

  @Post('admin/investiture/config')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles(
    'admin',
    'coordinator',
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
  )
  @ApiOperation({ summary: 'Crear configuración de investidura' })
  @ApiResponse({ status: 201, description: 'Configuración creada' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe configuración para este campo local y año',
  })
  async createConfig(@Body() dto: CreateInvestitureConfigDto, @Request() req) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.createConfig(actorId, dto);
    return { status: 'success', data };
  }

  @Patch('admin/investiture/config/:configId')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles(
    'admin',
    'coordinator',
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
  )
  @ApiOperation({ summary: 'Actualizar configuración de investidura' })
  @ApiParam({
    name: 'configId',
    type: Number,
    description: 'ID de la configuración',
  })
  @ApiResponse({ status: 200, description: 'Configuración actualizada' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin' })
  @ApiResponse({ status: 404, description: 'Configuración no encontrada' })
  async updateConfig(
    @Param('configId', ParseIntPipe) configId: number,
    @Body() dto: UpdateInvestitureConfigDto,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.updateConfig(actorId, configId, dto);
    return { status: 'success', data };
  }

  @Delete('admin/investiture/config/:configId')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles(
    'admin',
    'coordinator',
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
  )
  @ApiOperation({
    summary: 'Soft-delete de configuración de investidura (active = false)',
  })
  @ApiParam({
    name: 'configId',
    type: Number,
    description: 'ID de la configuración',
  })
  @ApiResponse({ status: 200, description: 'Configuración desactivada' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin' })
  @ApiResponse({ status: 404, description: 'Configuración no encontrada' })
  async deleteConfig(
    @Param('configId', ParseIntPipe) configId: number,
    @Request() req,
  ) {
    const actorId: string = req.user.sub;
    const data = await this.investitureService.deleteConfig(actorId, configId);
    return { status: 'success', data };
  }
}
